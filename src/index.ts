import dotenv from "dotenv";
// On Railway, env vars are injected natively — only override with .env locally
dotenv.config({ override: !process.env.RAILWAY_SERVICE_ID });
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { errorHandler } from "@/lib/errorHandler.js";
import { logger } from "hono/logger";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth.js";
import authModule from "@/features/auth/authModule.js";
import locationModule from "@/features/locations/locationModule.js";
import offerModule from "@/features/flight-offers/offerModule.js";
import geoCurrencyModule from "@/features/geo-currency/geoCurrencyModule.js";
import analyticsModule from "@/features/analytics/analyticsModule.js";
import reportsModule from "@/features/analytics/reportsModule.js";
import logsModule from "@/features/analytics/logsModule.js";
import monitoringModule from "@/features/monitoring/monitoringModule.js";
import systemLogsModule from "@/features/monitoring/systemLogsModule.js";
import cmsModule from "@/features/cms/cmsModule.js";
import rolesModule from "@/features/admin/rolesModule.js";
import usersModule from "@/features/admin/usersModule.js";
import customersModule from "@/features/admin/customersModule.js";
import userModule from "@/features/user/userModule.js";
import notificationModule from "@/features/notifications/notificationModule.js";
import emailModule from "@/features/email/emailModule.js";
import contactModule from "@/features/contact/contactModule.js";
import airportModule from "@/features/airports/airportModule.js";
import { initWebSocket } from "@/lib/websocket.js";

// Hono init with typed variables for session
const app = new Hono<{
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
  };
}>().basePath("/api");

// Logger
app.use(logger());

// Secure headers
app.use(secureHeaders());

// Cors config - must be before routes
app.use(
  cors({
    origin: [
      process.env.APP_CLIENT_URL!,
      "http://localhost:5173",
      "https://flyarzan.com",
      "https://www.flyarzan.com",
    ],
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-session-id"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length", "Set-Cookie"],
    maxAge: 600,
  }),
);

// Request ID header for attribution & tracing
app.use("*", async (c, next) => {
  try {
    const id = randomUUID();
    c.res.headers.set("x-request-id", id);
  } catch {}
  await next();
});

// Session middleware - makes user/session available in all routes
// Wrapped in try-catch so DB errors don't prevent CORS headers from being applied
app.use("*", async (c, next) => {
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      c.set("user", null);
      c.set("session", null);
    } else {
      c.set("user", session.user);
      c.set("session", session.session);
    }
  } catch {
    c.set("user", null);
    c.set("session", null);
  }
  await next();
});

// Routes
app.get("/", (c) => {
  return c.text("The server is healthy and running...!");
});

// Debug endpoint to check current session
app.get("/me", async (c) => {
  const user = c.get("user");
  const session = c.get("session");

  if (!user) {
    return c.json({ authenticated: false, message: "Not logged in" }, 401);
  }

  return c.json({
    authenticated: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    session: {
      id: session?.id,
      expiresAt: session?.expiresAt,
    },
  });
});

// Custom auth routes (for form-based sign-in/sign-up with validation)
// These must come BEFORE the better-auth catch-all handler
app.route("/auth/custom", authModule);

// Mount better-auth handler for all auth routes (including admin endpoints)
// This handles: /api/auth/sign-in, /api/auth/sign-up, /api/auth/admin/*, etc.
app.all("/auth/*", (c) => {
  return auth.handler(c.req.raw);
});
app.route("/cms", cmsModule); // Public CMS routes (uses /public/:slug)
app.route("/geo-currency", geoCurrencyModule);
app.route("/locations", locationModule);
app.route("/flight-offers", offerModule);
app.route("/contact", contactModule);
app.route("/admin/analytics", analyticsModule);
app.route("/admin/reports", reportsModule);
app.route("/admin/logs", logsModule);
app.route("/admin/monitoring", monitoringModule);
app.route("/admin/monitoring", systemLogsModule);
app.route("/admin/cms", cmsModule);
app.route("/admin/roles", rolesModule);
app.route("/admin/users", usersModule);
app.route("/admin/customers", customersModule);
app.route("/admin/email", emailModule);
app.route("/user", userModule);
app.route("/notifications", notificationModule);
app.route("/airports", airportModule);

// Not found
app.notFound((c) => {
  return c.json(
    {
      message: `${c.req.path} Not Found`,
    },
    404,
  );
});

// Error Handler
app.onError(errorHandler);

const port = Number(process.env.PORT);

if (!port) {
  console.error("PORT is not defined");
  process.exit(1);
}

// Server
const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`Server is running on ${info.port}`);
  },
);

// Initialize WebSocket server
initWebSocket(server);

// graceful shutdown
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });
});
