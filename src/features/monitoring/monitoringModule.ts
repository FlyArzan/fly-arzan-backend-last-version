import { Hono } from "hono";
import { performance } from "node:perf_hooks";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";

const app = new Hono();

// Internal service key middleware — only trusted back-end callers may reach these routes
const requireInternalKey = async (c: any, next: () => Promise<void>) => {
  const key = c.req.header("x-internal-key");
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
};

// Track server start time for uptime
const serverStartTime = Date.now();

// Polling configuration
const POLL_INTERVAL_MS = 120_000; // 2 minutes
const HEALTHY_THRESHOLD_MS = 500; // <500ms healthy, otherwise degraded

// Cached health results
type ComponentStatus = "healthy" | "degraded" | "down" | "unknown";
interface CachedCheck {
  status: ComponentStatus;
  latencyMs: number | null;
  lastChecked: Date | null;
  lastError: string | null;
}

const dbHealth: CachedCheck = {
  status: "unknown",
  latencyMs: null,
  lastChecked: null,
  lastError: null,
};

const amadeusHealth: CachedCheck = {
  status: "unknown",
  latencyMs: null,
  lastChecked: null,
  lastError: null,
};

async function pollDatabase() {
  const start = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const ms = Math.round(performance.now() - start);
    dbHealth.latencyMs = ms;
    dbHealth.status = ms < HEALTHY_THRESHOLD_MS ? "healthy" : "degraded";
    dbHealth.lastChecked = new Date();
    dbHealth.lastError = null;
  } catch (e: any) {
    dbHealth.status = "down";
    dbHealth.lastChecked = new Date();
    dbHealth.lastError = e?.message || String(e);
  }
}

async function pollAmadeus() {
  const start = performance.now();
  try {
    // We don't rely on authenticated endpoints. A lightweight reachability probe is enough.
    // Accept any HTTP response as "reachable"; only network errors/timeouts are treated as down.
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${process.env.AMADEUS_BASE_URL}/`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(id);
    const ms = Math.round(performance.now() - start);
    amadeusHealth.latencyMs = ms;
    amadeusHealth.status = ms < HEALTHY_THRESHOLD_MS ? "healthy" : "degraded";
    amadeusHealth.lastChecked = new Date();
    amadeusHealth.lastError = null;
  } catch (e: any) {
    amadeusHealth.status = "down";
    amadeusHealth.lastChecked = new Date();
    amadeusHealth.lastError =
      e?.name === "AbortError" ? "timeout" : e?.message || String(e);
  }
}

// Kick off polling loop (best-effort in-memory cache)
void pollDatabase();
void pollAmadeus();
setInterval(() => {
  void pollDatabase();
  void pollAmadeus();
}, POLL_INTERVAL_MS);

// --- DB-backed quota helpers ---
async function readQuota(): Promise<{
  daily: number;
  dailyLimit: number;
  lastReset: string;
}> {
  const today = new Date().toISOString().split("T")[0];
  const [dailyRec, limitRec, resetRec] = await Promise.all([
    prisma.setting.upsert({
      where: { key: "quota_daily" },
      update: {},
      create: { key: "quota_daily", value: "0" },
    }),
    prisma.setting.upsert({
      where: { key: "quota_daily_limit" },
      update: {},
      create: { key: "quota_daily_limit", value: "2000" },
    }),
    prisma.setting.upsert({
      where: { key: "quota_last_reset" },
      update: {},
      create: { key: "quota_last_reset", value: today },
    }),
  ]);

  let daily = parseInt(dailyRec.value, 10);
  const dailyLimit = parseInt(limitRec.value, 10);
  let lastReset = resetRec.value;

  // Daily reset: if stored date is behind today, zero the counter
  if (lastReset !== today) {
    daily = 0;
    lastReset = today;
    await Promise.all([
      prisma.setting.update({
        where: { key: "quota_daily" },
        data: { value: "0" },
      }),
      prisma.setting.update({
        where: { key: "quota_last_reset" },
        data: { value: today },
      }),
    ]);
  }

  return { daily, dailyLimit, lastReset };
}

// Track last Amadeus API check (compat field used by alerts endpoint)
let lastAmadeusCheck = {
  status: "unknown" as "healthy" | "degraded" | "down" | "unknown",
  lastChecked: null as Date | null,
  lastError: null as string | null,
};

/*
  @route  GET /health
  @desc   Returns overall system health status
*/
app.get("/health", async (c) => {
  const checks = {
    database: dbHealth.status,
    amadeus: amadeusHealth.status,
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    latencies: {
      databaseMs: dbHealth.latencyMs,
      amadeusMs: amadeusHealth.latencyMs,
    },
    lastChecked: {
      database: dbHealth.lastChecked?.toISOString() || null,
      amadeus: amadeusHealth.lastChecked?.toISOString() || null,
    },
  } as const;

  // Determine overall status
  let overallStatus: "green" | "yellow" | "red" = "green";
  if (checks.database === "down" || checks.amadeus === "down") {
    overallStatus = "red";
  } else if (
    checks.database === "degraded" ||
    checks.amadeus === "degraded" ||
    checks.database === "unknown" ||
    checks.amadeus === "unknown"
  ) {
    overallStatus = "yellow";
  }

  return c.json({
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
  });
});

/*
  @route  GET /quota
  @desc   Returns current API quota usage and thresholds
*/
app.get("/quota", requireAdmin, async (c) => {
  const { daily, dailyLimit, lastReset } = await readQuota();

  const usagePercent = (daily / dailyLimit) * 100;
  let alert: { level: string; message: string } | null = null;

  if (usagePercent >= 100) {
    alert = { level: "critical", message: "API quota limit reached (100%)" };
  } else if (usagePercent >= 80) {
    alert = { level: "warning", message: "API quota at 80% or above" };
  }

  return c.json({
    daily,
    limit: dailyLimit,
    percent: Math.round(usagePercent),
    alert,
    lastReset,
  });
});

/*
  @route  POST /quota/increment
  @desc   Internal endpoint to increment quota usage (called by offerService)
*/
app.post("/quota/increment", requireInternalKey, async (c) => {
  const { daily: current, dailyLimit } = await readQuota();

  const newDaily = current + 1;
  await prisma.setting.update({
    where: { key: "quota_daily" },
    data: { value: String(newDaily) },
  });

  const usagePercent = (newDaily / dailyLimit) * 100;
  if (usagePercent >= 100 || usagePercent >= 80) {
    // TODO: Trigger alert (email/Slack) - implement in alertService
    console.warn(`[ALERT] API quota at ${Math.round(usagePercent)}%`);
  }

  return c.json({ ok: true, daily: newDaily });
});

/*
  @route  POST /amadeus/status
  @desc   Update Amadeus API status (called by offerService on success/failure)
*/
app.post("/amadeus/status", requireInternalKey, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { status, error } = body;

  lastAmadeusCheck.status = status || "unknown";
  lastAmadeusCheck.lastChecked = new Date();
  lastAmadeusCheck.lastError = error || null;

  // Also update cached amadeus health to reflect external signals
  amadeusHealth.status = lastAmadeusCheck.status;
  amadeusHealth.lastChecked = lastAmadeusCheck.lastChecked;
  amadeusHealth.lastError = lastAmadeusCheck.lastError;

  // If down for >1 minute, trigger alert
  if (status === "down") {
    // TODO: Implement alert logic with timestamp tracking
    console.error(`[ALERT] Amadeus API is down: ${error}`);
  }

  return c.json({ ok: true });
});

/*
  @route  GET /alerts
  @desc   Returns active alerts (quota, outages)
*/
app.get("/alerts", requireAdmin, async (c) => {
  const alerts: any[] = [];

  // Check quota (DB-backed)
  const { daily, dailyLimit } = await readQuota();
  const usagePercent = (daily / dailyLimit) * 100;

  if (usagePercent >= 100) {
    alerts.push({
      type: "quota",
      level: "critical",
      message: "API quota limit reached (100%)",
      timestamp: new Date().toISOString(),
    });
  } else if (usagePercent >= 80) {
    alerts.push({
      type: "quota",
      level: "warning",
      message: `API quota at ${Math.round(usagePercent)}%`,
      timestamp: new Date().toISOString(),
    });
  }

  // Check Amadeus status
  if (lastAmadeusCheck.status === "down") {
    alerts.push({
      type: "api_outage",
      level: "critical",
      message: "Amadeus API is down",
      error: lastAmadeusCheck.lastError,
      timestamp: lastAmadeusCheck.lastChecked?.toISOString(),
    });
  } else if (lastAmadeusCheck.status === "degraded") {
    alerts.push({
      type: "api_degraded",
      level: "warning",
      message: "Amadeus API performance degraded",
      timestamp: lastAmadeusCheck.lastChecked?.toISOString(),
    });
  }

  return c.json({ alerts, count: alerts.length });
});

export default app;
