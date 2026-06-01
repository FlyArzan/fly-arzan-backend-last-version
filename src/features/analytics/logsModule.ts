import { Hono } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";

const app = new Hono();

app.use("*", requireAdmin);

/*
  @route  GET /search-logs
  @desc   Get paginated search logs with filters
  @query  page, limit, startDate, endDate, tripType, origin, destination, os, browser, deviceType, country
*/
app.get("/search-logs", async (c) => {
  const page = parseInt(c.req.query("page") || "1");
  const limit = parseInt(c.req.query("limit") || "50");
  const skip = (page - 1) * limit;

  // Build filters
  const where: any = {};

  // Date range filter
  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  // Route filters (allow case-insensitive contains for text search)
  if (c.req.query("origin"))
    where.origin = { contains: c.req.query("origin")!, mode: "insensitive" };
  if (c.req.query("destination"))
    where.destination = {
      contains: c.req.query("destination")!,
      mode: "insensitive",
    };
  if (c.req.query("tripType")) where.tripType = c.req.query("tripType");

  // Device filters
  if (c.req.query("os")) where.os = c.req.query("os");
  if (c.req.query("browser")) where.browser = c.req.query("browser");
  if (c.req.query("deviceType")) where.deviceType = c.req.query("deviceType");

  // Geolocation filter
  if (c.req.query("country")) where.country = c.req.query("country");

  // Passenger filters
  if (c.req.query("travelClass"))
    where.travelClass = c.req.query("travelClass");

  const [logs, total] = await Promise.all([
    prisma.searchEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      select: {
        id: true,
        createdAt: true,
        origin: true,
        destination: true,
        tripType: true,
        travelClass: true,
        adults: true,
        children: true,
        browser: true,
        browserVersion: true,
        os: true,
        osVersion: true,
        deviceType: true,
        ipMasked: true,
        country: true,
        region: true,
      },
    }),
    prisma.searchEvent.count({ where }),
  ]);

  return c.json({
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/*
  @route  GET /filter-options
  @desc   Get available filter options (unique values for dropdowns)
*/
app.get("/filter-options", async (c) => {
  // Get unique values for each filterable field
  const [
    origins,
    destinations,
    tripTypes,
    browsers,
    oses,
    deviceTypes,
    countries,
    travelClasses,
  ] = await Promise.all([
    prisma.searchEvent.findMany({
      select: { origin: true },
      distinct: ["origin"],
      orderBy: { origin: "asc" },
    }),
    prisma.searchEvent.findMany({
      select: { destination: true },
      distinct: ["destination"],
      orderBy: { destination: "asc" },
    }),
    prisma.searchEvent.findMany({
      select: { tripType: true },
      distinct: ["tripType"],
    }),
    prisma.searchEvent.findMany({
      select: { browser: true },
      distinct: ["browser"],
      where: { browser: { not: null } },
    }),
    prisma.searchEvent.findMany({
      select: { os: true },
      distinct: ["os"],
      where: { os: { not: null } },
    }),
    prisma.searchEvent.findMany({
      select: { deviceType: true },
      distinct: ["deviceType"],
      where: { deviceType: { not: null } },
    }),
    prisma.searchEvent.findMany({
      select: { country: true },
      distinct: ["country"],
      where: { country: { not: null } },
    }),
    prisma.searchEvent.findMany({
      select: { travelClass: true },
      distinct: ["travelClass"],
      where: { travelClass: { not: null } },
    }),
  ]);

  return c.json({
    origins: origins.map((o) => o.origin),
    destinations: destinations.map((d) => d.destination),
    tripTypes: tripTypes.map((t) => t.tripType),
    browsers: browsers.map((b) => b.browser),
    oses: oses.map((o) => o.os),
    deviceTypes: deviceTypes.map((d) => d.deviceType),
    countries: countries.map((c) => c.country),
    travelClasses: travelClasses.map((t) => t.travelClass),
  });
});

/*
  @route  GET /search-logs/export
  @desc   Export search logs as CSV with filters
*/
app.get("/search-logs/export", async (c) => {
  // Build same filters as search-logs endpoint
  const where: any = {};

  const startDate = c.req.query("startDate");
  const endDate = c.req.query("endDate");
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  if (c.req.query("origin"))
    where.origin = { contains: c.req.query("origin")!, mode: "insensitive" };
  if (c.req.query("destination"))
    where.destination = {
      contains: c.req.query("destination")!,
      mode: "insensitive",
    };
  if (c.req.query("tripType")) where.tripType = c.req.query("tripType");
  if (c.req.query("os")) where.os = c.req.query("os");
  if (c.req.query("browser")) where.browser = c.req.query("browser");
  if (c.req.query("deviceType")) where.deviceType = c.req.query("deviceType");
  if (c.req.query("country")) where.country = c.req.query("country");
  if (c.req.query("travelClass"))
    where.travelClass = c.req.query("travelClass");

  const logs = await prisma.searchEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10000, // Limit to 10k rows for export
  });

  // Generate CSV
  const headers = [
    "Timestamp",
    "Origin",
    "Destination",
    "Trip Type",
    "Travel Class",
    "Adults",
    "Children",
    "Browser",
    "OS",
    "Device Type",
    "Country",
    "Region",
    "IP (Masked)",
  ];

  const rows = logs.map((log) => [
    log.createdAt.toISOString(),
    log.origin,
    log.destination,
    log.tripType,
    log.travelClass || "",
    log.adults,
    log.children,
    log.browser ? `${log.browser} ${log.browserVersion || ""}`.trim() : "",
    log.os ? `${log.os} ${log.osVersion || ""}`.trim() : "",
    log.deviceType || "",
    log.country || "",
    log.region || "",
    log.ipMasked || "",
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${cell}"`).join(","))
    .join("\n");

  return c.text(csv, 200, {
    "Content-Type": "text/csv",
    "Content-Disposition": `attachment; filename="search-logs-${new Date().toISOString().split("T")[0]}.csv"`,
  });
});

export default app;
