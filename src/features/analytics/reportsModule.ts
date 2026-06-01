import { Hono } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";
import { validateInput } from "@/lib/validateInput.js";
import { reportsQuerySchema } from "@/schema/analyticsSchema.js";

const app = new Hono();

app.use("*", requireAdmin);

const now = () => new Date();
const subHours = (d: Date, h: number) =>
  new Date(d.getTime() - h * 60 * 60 * 1000);

const buildCsv = (rows: Record<string, any>[]) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => JSON.stringify(r[h] ?? "")).join(","));
  }
  return lines.join("\n");
};

/*
  @route  GET /metrics
  @desc   Returns total searches, total clickouts, clickout rate, and top5 routes for last24h and prev24h
*/
app.get("/metrics", async (c) => {
  // We compute both ranges
  const end = now();
  const startLast24 = subHours(end, 24);
  const startPrev24 = subHours(startLast24, 24);

  const [searchLast, searchPrev, clickLast, clickPrev] = await Promise.all([
    prisma.searchEvent.count({
      where: { createdAt: { gte: startLast24, lt: end } },
    }),
    prisma.searchEvent.count({
      where: { createdAt: { gte: startPrev24, lt: startLast24 } },
    }),
    prisma.clickOutEvent.count({
      where: { createdAt: { gte: startLast24, lt: end } },
    }),
    prisma.clickOutEvent.count({
      where: { createdAt: { gte: startPrev24, lt: startLast24 } },
    }),
  ]);

  const clickRateLast = searchLast ? clickLast / searchLast : 0;
  const clickRatePrev = searchPrev ? clickPrev / searchPrev : 0;

  // Top 5 routes by searches in last 24h
  const topLast = await prisma.searchEvent.groupBy({
    by: ["origin", "destination"],
    _count: { id: true },
    where: { createdAt: { gte: startLast24, lt: end } },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });

  return c.json({
    last24h: {
      totalSearches: searchLast,
      totalClickOuts: clickLast,
      clickOutRate: clickRateLast,
      topRoutes: topLast.map((r) => ({
        origin: r.origin,
        destination: r.destination,
        count: r._count.id,
      })),
    },
    prev24h: {
      totalSearches: searchPrev,
      totalClickOuts: clickPrev,
      clickOutRate: clickRatePrev,
    },
  });
});

/*
  @route  GET /metrics/timeseries
  @desc   Time-series for searches and clickouts
  @query  range=24h|7d|30d (default 24h), or startDate/endDate
*/
app.get("/metrics/timeseries", async (c) => {
  const qs = c.req.query();
  const range = (qs.range || "24h") as "24h" | "7d" | "30d";
  const end = qs.endDate ? new Date(qs.endDate) : now();

  let start: Date;
  let bucketHours: number;
  let bucketCount: number;

  if (qs.startDate) {
    start = new Date(qs.startDate);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = diffMs / (24 * 60 * 60 * 1000);
    if (diffDays <= 1) {
      bucketHours = 1;
      bucketCount = 24;
    } else if (diffDays <= 7) {
      bucketHours = 24;
      bucketCount = Math.ceil(diffDays);
    } else {
      bucketHours = 24;
      bucketCount = Math.min(30, Math.ceil(diffDays));
    }
  } else if (range === "7d") {
    start = subHours(end, 24 * 7);
    bucketHours = 24;
    bucketCount = 7;
  } else if (range === "30d") {
    start = subHours(end, 24 * 30);
    bucketHours = 24;
    bucketCount = 30;
  } else {
    start = subHours(end, 24);
    bucketHours = 1;
    bucketCount = 24;
  }

  const [searches, clicks] = await Promise.all([
    prisma.searchEvent.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.clickOutEvent.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
  ]);

  const buckets: { label: string; searches: number; clickouts: number }[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    const t = subHours(end, i * bucketHours);
    const label =
      bucketHours === 1
        ? `${t.getHours().toString().padStart(2, "0")}:00`
        : `${t.getMonth() + 1}/${t.getDate()}`;
    buckets.push({ label, searches: 0, clickouts: 0 });
  }

  const bucketIndex = (d: Date) => {
    const diffMs = end.getTime() - d.getTime();
    const diffBuckets = Math.floor(diffMs / (bucketHours * 60 * 60 * 1000));
    const idx = bucketCount - 1 - diffBuckets;
    return idx >= 0 && idx < bucketCount ? idx : null;
  };

  for (const s of searches) {
    const idx = bucketIndex(s.createdAt);
    if (idx !== null) buckets[idx].searches += 1;
  }
  for (const cl of clicks) {
    const idx = bucketIndex(cl.createdAt);
    if (idx !== null) buckets[idx].clickouts += 1;
  }

  return c.json({ series: buckets });
});

/*
  @route  GET /metrics/breakdown
  @desc   Breakdown by device/browser/os/geo/travelClass
  @query  type=device|browser|os|geo|travelClass, startDate, endDate
*/
app.get("/metrics/breakdown", async (c) => {
  const qs = c.req.query();
  const type = (qs.type || "device") as
    | "device"
    | "browser"
    | "os"
    | "geo"
    | "travelClass";
  const end = qs.endDate ? new Date(qs.endDate) : now();
  const start = qs.startDate ? new Date(qs.startDate) : subHours(end, 24);

  let byField: "deviceType" | "browser" | "os" | "country" | "travelClass" =
    "deviceType";
  if (type === "browser") byField = "browser";
  if (type === "os") byField = "os";
  if (type === "geo") byField = "country";
  if (type === "travelClass") byField = "travelClass";

  const rows = await prisma.searchEvent.groupBy({
    by: [byField],
    _count: { id: true },
    where: {
      createdAt: { gte: start, lt: end },
      [byField]: { not: null } as any,
    },
    orderBy: { _count: { id: "desc" } },
    take: 8,
  });

  return c.json({
    breakdown: rows.map((r: any) => ({
      key: (r[byField] as string) ?? "Unknown",
      count: r._count.id,
    })),
  });
});

/*
  @route  GET /top-routes
  @desc   Returns top routes by searches for a given range with optional CSV
*/
app.get("/top-routes", async (c) => {
  const q = await validateInput({
    type: "query",
    schema: reportsQuerySchema,
    data: c.req.query(),
  });
  // Support explicit startDate/endDate if provided; fallback to last24h/prev24h
  const end = q.endDate ? new Date(q.endDate as any) : now();
  const start = q.startDate
    ? new Date(q.startDate as any)
    : q.range === "prev24h"
      ? subHours(end, 48)
      : subHours(end, 24);
  const cutoff =
    q.startDate && q.endDate
      ? end
      : q.range === "prev24h"
        ? subHours(end, 24)
        : end;

  const top = await prisma.searchEvent.groupBy({
    by: ["origin", "destination"],
    _count: { id: true },
    where: { createdAt: { gte: start, lt: cutoff } },
    orderBy: { _count: { id: "desc" } },
    take: q.limit ?? 10,
  });

  // Fetch clickouts aggregated in the same window
  const clicks = await prisma.clickOutEvent.groupBy({
    by: ["origin", "destination"],
    _count: { id: true },
    _avg: { price: true },
    where: { createdAt: { gte: start, lt: cutoff } },
  });
  const clickMap = new Map<
    string,
    { clickouts: number; avgPrice: number | null }
  >();
  for (const cRow of clicks) {
    const key = `${cRow.origin}::${cRow.destination}`;
    clickMap.set(key, {
      clickouts: cRow._count.id,
      avgPrice: (typeof cRow._avg.price === "number"
        ? cRow._avg.price
        : null) as number | null,
    });
  }

  const rows = top.map((r) => {
    const key = `${r.origin}::${r.destination}`;
    const c = clickMap.get(key);
    const searches = r._count.id;
    const clickouts = c?.clickouts ?? 0;
    const conversion = searches
      ? Math.round((clickouts / searches) * 1000) / 10
      : 0; // one decimal
    return {
      origin: r.origin,
      destination: r.destination,
      searches,
      clickouts,
      conversion,
      avgPrice: c?.avgPrice ?? null,
    };
  });

  if ((q.format ?? "json") === "csv") {
    const csv = buildCsv(rows);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename=top-routes-${q.range ?? "last24h"}.csv`,
    );
    return c.body(csv);
  }

  return c.json(rows);
});

/*
  @route  GET /clickout-rate
  @desc   Returns clickout rate for last24h or prev24h
*/
app.get("/clickout-rate", async (c) => {
  const q = await validateInput({
    type: "query",
    schema: reportsQuerySchema,
    data: c.req.query(),
  });
  const end = now();
  const start = q.range === "prev24h" ? subHours(end, 48) : subHours(end, 24);
  const cutoff = q.range === "prev24h" ? subHours(end, 24) : end;

  const [searches, clicks] = await Promise.all([
    prisma.searchEvent.count({
      where: { createdAt: { gte: start, lt: cutoff } },
    }),
    prisma.clickOutEvent.count({
      where: { createdAt: { gte: start, lt: cutoff } },
    }),
  ]);

  const rate = searches ? clicks / searches : 0;

  if ((q.format ?? "json") === "csv") {
    const csv = buildCsv([{ searches, clicks, rate }]);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename=clickout-rate-${q.range ?? "last24h"}.csv`,
    );
    return c.body(csv);
  }

  return c.json({ searches, clicks, rate });
});

/*
  @route  GET /routes/trending
  @desc   Week-over-week growth by route (searches and clickouts)
*/
app.get("/routes/trending", async (c) => {
  const limit = parseInt(c.req.query("limit") || "10", 10);
  const end = now();
  const startThis = subHours(end, 24 * 7);
  const startPrev = subHours(startThis, 24 * 7);

  const thisPeriod = await prisma.searchEvent.groupBy({
    by: ["origin", "destination"],
    _count: { id: true },
    where: { createdAt: { gte: startThis, lt: end } },
  });
  const prevPeriod = await prisma.searchEvent.groupBy({
    by: ["origin", "destination"],
    _count: { id: true },
    where: { createdAt: { gte: startPrev, lt: startThis } },
  });

  const prevMap = new Map<string, number>();
  for (const p of prevPeriod)
    prevMap.set(`${p.origin}::${p.destination}`, p._count.id);

  const list = thisPeriod
    .map((r) => {
      const key = `${r.origin}::${r.destination}`;
      const prev = prevMap.get(key) ?? 0;
      const growth = prev ? ((r._count.id - prev) / prev) * 100 : 100;
      return {
        route: `${r.origin} → ${r.destination}`,
        growth: Math.round(growth * 10) / 10,
        searches: r._count.id,
      };
    })
    .sort((a, b) => b.growth - a.growth)
    .slice(0, limit);

  return c.json(list);
});

/*
  @route  GET /engagement/series
  @desc   Time series for searches, distinct sessions, clickouts; CTR per bucket
  @query  range=24h|7d|30d
*/
app.get("/engagement/series", async (c) => {
  const range = (c.req.query("range") || "7d") as "24h" | "7d" | "30d";
  const end = now();
  const start =
    range === "24h"
      ? subHours(end, 24)
      : range === "7d"
        ? subHours(end, 24 * 7)
        : subHours(end, 24 * 30);

  // Define bucket granularity
  const bucketHours = range === "24h" ? 1 : 24;
  const bucketCount = range === "24h" ? 24 : range === "7d" ? 7 : 30;

  // Fetch events within window
  const [searches, clickouts] = await Promise.all([
    prisma.searchEvent.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true, sessionId: true },
    }),
    prisma.clickOutEvent.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
  ]);

  // Prepare buckets
  const buckets: {
    label: string;
    start: Date;
    end: Date;
    searches: number;
    sessions: number;
    clickouts: number;
    ctr: number;
  }[] = [];
  for (let i = bucketCount - 1; i >= 0; i--) {
    const bStart = subHours(end, (i + 1) * bucketHours);
    const bEnd = subHours(end, i * bucketHours);
    const label =
      bucketHours === 1
        ? `${bStart.getHours().toString().padStart(2, "0")}:00`
        : `${bStart.getMonth() + 1}/${bStart.getDate()}`;
    buckets.push({
      label,
      start: bStart,
      end: bEnd,
      searches: 0,
      sessions: 0,
      clickouts: 0,
      ctr: 0,
    });
  }

  // Helpers
  const inBucket = (d: Date, b: { start: Date; end: Date }) =>
    d >= b.start && d < b.end;

  // Count searches and distinct sessions per bucket
  for (const b of buckets) {
    let s = 0;
    const sessionSet = new Set<string | null>();
    for (const ev of searches) {
      if (inBucket(ev.createdAt, b)) {
        s += 1;
        sessionSet.add(ev.sessionId ?? null);
      }
    }
    b.searches = s;
    b.sessions = sessionSet.has(null) ? sessionSet.size - 1 : sessionSet.size;

    let cCount = 0;
    for (const ev of clickouts) if (inBucket(ev.createdAt, b)) cCount += 1;
    b.clickouts = cCount;
    b.ctr = b.searches
      ? Math.round((b.clickouts / b.searches) * 100 * 10) / 10
      : 0;
  }

  return c.json({
    buckets: buckets.map(({ label, searches, sessions, clickouts, ctr }) => ({
      label,
      searches,
      sessions,
      clickouts,
      ctr,
    })),
  });
});

/*
  @route  GET /geo/regions
  @desc   Aggregate searches by user region from country codes
*/
app.get("/geo/regions", async (c) => {
  const qs = c.req.query();
  const end = qs.endDate ? new Date(qs.endDate as string) : now();
  const start = qs.startDate
    ? new Date(qs.startDate as string)
    : subHours(end, 24);
  const group = (qs.group || "region") as "region" | "country";
  const top = Math.max(
    1,
    Math.min(12, parseInt((qs.top as string) || "6", 10)),
  );

  const rows = await prisma.searchEvent.findMany({
    where: { createdAt: { gte: start, lt: end }, country: { not: null } },
    select: { country: true },
  });

  if (group === "country") {
    const agg = new Map<string, number>();
    for (const r of rows) {
      const key = (r.country as string) || "Unknown";
      agg.set(key, (agg.get(key) || 0) + 1);
    }
    const sorted = Array.from(agg.entries()).sort((a, b) => b[1] - a[1]);
    const head = sorted
      .slice(0, top)
      .map(([country, searches]) => ({ country, searches }));
    const otherCount = sorted.slice(top).reduce((a, [, v]) => a + v, 0);
    const result =
      otherCount > 0
        ? [...head, { country: "Other", searches: otherCount }]
        : head;
    return c.json(result);
  }

  const regionMap: Record<string, string> = {
    US: "North America",
    CA: "North America",
    MX: "North America",
    BR: "South America",
    AR: "South America",
    CL: "South America",
    GB: "Europe",
    DE: "Europe",
    FR: "Europe",
    ES: "Europe",
    IT: "Europe",
    NL: "Europe",
    PT: "Europe",
    PL: "Europe",
    SE: "Europe",
    NO: "Europe",
    TR: "Middle East",
    AE: "Middle East",
    SA: "Middle East",
    EG: "Middle East",
    IL: "Middle East",
    KZ: "Central Asia",
    UZ: "Central Asia",
    KG: "Central Asia",
    TJ: "Central Asia",
    TM: "Central Asia",
    CN: "East Asia",
    JP: "East Asia",
    KR: "East Asia",
    HK: "East Asia",
    TW: "East Asia",
    IN: "South Asia",
    PK: "South Asia",
    BD: "South Asia",
    LK: "South Asia",
    MY: "Southeast Asia",
    SG: "Southeast Asia",
    TH: "Southeast Asia",
    ID: "Southeast Asia",
    PH: "Southeast Asia",
    AU: "Oceania",
    NZ: "Oceania",
    ZA: "Africa",
    NG: "Africa",
    KE: "Africa",
    MA: "Africa",
  };
  const agg = new Map<string, number>();
  for (const r of rows) {
    const region = regionMap[(r.country as string) || ""] || "Other";
    agg.set(region, (agg.get(region) || 0) + 1);
  }
  const result = Array.from(agg.entries()).map(([region, searches]) => ({
    region,
    searches,
  }));
  return c.json(result);
});

/*
  @route  GET /trends/searches
  @desc   Monthly searches and clickouts for last N months (default 12)
*/
app.get("/trends/searches", async (c) => {
  const months = Math.max(
    1,
    Math.min(24, parseInt(c.req.query("months") || "12", 10)),
  );
  const end = now();
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);

  const [searches, clickouts] = await Promise.all([
    prisma.searchEvent.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
    prisma.clickOutEvent.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { createdAt: true },
    }),
  ]);

  const mapIndex = (d: Date) =>
    (d.getFullYear() - start.getFullYear()) * 12 +
    d.getMonth() -
    start.getMonth();
  const series = Array.from({ length: months }, (_, i) => ({
    month: new Date(start.getFullYear(), start.getMonth() + i, 1),
    searches: 0,
    clickouts: 0,
  }));
  for (const s of searches) {
    const idx = mapIndex(s.createdAt);
    if (idx >= 0 && idx < months) series[idx].searches += 1;
  }
  for (const cl of clickouts) {
    const idx = mapIndex(cl.createdAt);
    if (idx >= 0 && idx < months) series[idx].clickouts += 1;
  }
  return c.json(
    series.map((r) => ({
      month: r.month.toLocaleString("en-US", { month: "short" }),
      searches: r.searches,
      clickouts: r.clickouts,
    })),
  );
});

/*
  @route  GET /trends/prices
  @desc   Monthly avg/min/max price from clickouts for last N months (default 12)
*/
app.get("/trends/prices", async (c) => {
  const months = Math.max(
    1,
    Math.min(24, parseInt(c.req.query("months") || "12", 10)),
  );
  const end = now();
  const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);

  const clicks = await prisma.clickOutEvent.findMany({
    where: { createdAt: { gte: start, lt: end }, price: { not: null } },
    select: { createdAt: true, price: true },
  });
  const mapIndex = (d: Date) =>
    (d.getFullYear() - start.getFullYear()) * 12 +
    d.getMonth() -
    start.getMonth();
  const series: { month: Date; values: number[] }[] = Array.from(
    { length: months },
    (_, i) => ({
      month: new Date(start.getFullYear(), start.getMonth() + i, 1),
      values: [],
    }),
  );
  for (const cl of clicks) {
    const idx = mapIndex(cl.createdAt);
    if (idx >= 0 && idx < months && typeof cl.price === "number")
      series[idx].values.push(cl.price);
  }
  return c.json(
    series.map((r) => ({
      month: r.month.toLocaleString("en-US", { month: "short" }),
      avgPrice: r.values.length
        ? Math.round(
            (r.values.reduce((a, b) => a + b, 0) / r.values.length) * 100,
          ) / 100
        : 0,
      minPrice: r.values.length ? Math.min(...r.values) : 0,
      maxPrice: r.values.length ? Math.max(...r.values) : 0,
    })),
  );
});

/*
  @route  POST /refresh
  @desc   Placeholder to invalidate caches if we add caching later
*/
app.post("/refresh", async (c) => {
  // No server-side cache yet; respond OK for now.
  return c.json({ ok: true });
});

/*
  @route  GET /engagement/summary
  @desc   Totals for current range and previous period deltas; includes CTR
  @query  range=24h|7d|30d
*/
app.get("/engagement/summary", async (c) => {
  const range = (c.req.query("range") || "7d") as "24h" | "7d" | "30d";
  const end = now();
  const start =
    range === "24h"
      ? subHours(end, 24)
      : range === "7d"
        ? subHours(end, 24 * 7)
        : subHours(end, 24 * 30);
  const prevEnd = start;
  const prevStart =
    range === "24h"
      ? subHours(prevEnd, 24)
      : range === "7d"
        ? subHours(prevEnd, 24 * 7)
        : subHours(prevEnd, 24 * 30);

  // Compute totals for current and previous window
  const [
    searches,
    clickouts,
    sessionsRows,
    searchesPrev,
    clickoutsPrev,
    sessionsPrevRows,
  ] = await Promise.all([
    prisma.searchEvent.count({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.clickOutEvent.count({
      where: { createdAt: { gte: start, lt: end } },
    }),
    prisma.searchEvent.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { sessionId: true },
    }),
    prisma.searchEvent.count({
      where: { createdAt: { gte: prevStart, lt: prevEnd } },
    }),
    prisma.clickOutEvent.count({
      where: { createdAt: { gte: prevStart, lt: prevEnd } },
    }),
    prisma.searchEvent.findMany({
      where: { createdAt: { gte: prevStart, lt: prevEnd } },
      select: { sessionId: true },
    }),
  ]);

  const sessions = (() => {
    const set = new Set<string>();
    for (const r of sessionsRows) if (r.sessionId) set.add(r.sessionId);
    return set.size;
  })();
  const sessionsPrev = (() => {
    const set = new Set<string>();
    for (const r of sessionsPrevRows) if (r.sessionId) set.add(r.sessionId);
    return set.size;
  })();

  const ctr = searches ? (clickouts / searches) * 100 : 0;
  const ctrPrev = searchesPrev ? (clickoutsPrev / searchesPrev) * 100 : 0;

  const pct = (curr: number, prev: number) => {
    if (!prev) return curr ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  };

  return c.json({
    current: {
      searches,
      clickouts,
      sessions,
      ctr,
    },
    prev: {
      searches: searchesPrev,
      clickouts: clickoutsPrev,
      sessions: sessionsPrev,
      ctr: ctrPrev,
    },
    deltas: {
      searches: pct(searches, searchesPrev),
      clickouts: pct(clickouts, clickoutsPrev),
      sessions: pct(sessions, sessionsPrev),
      ctr: pct(ctr, ctrPrev),
    },
  });
});

export default app;
