import { Hono } from "hono";
import { requireAdmin } from "@/lib/auth.js";
import { prisma } from "@/lib/prisma.js";

const app = new Hono();

/**
 * @route GET /api/admin/system-logs
 * @desc Get system logs aggregated from various sources
 * @access Admin only
 */
app.get("/", requireAdmin, async (c) => {
  const limit = parseInt(c.req.query("limit") || "50");
  const offset = parseInt(c.req.query("offset") || "0");
  const level = c.req.query("level") || "all";
  const service = c.req.query("service") || "all";
  const search = c.req.query("search") || "";

  try {
    // Aggregate logs from different sources
    const logs: any[] = [];

    // 1. Get recent search events (info logs)
    if (level === "all" || level === "info") {
      const searchEvents = await prisma.searchEvent.findMany({
        take: Math.min(limit, 20),
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          origin: true,
          destination: true,
          tripType: true,
          adults: true,
          children: true,
        },
      });

      searchEvents.forEach((event) => {
        const totalPassengers = event.adults + event.children;
        logs.push({
          id: `search-${event.id}`,
          timestamp: event.createdAt.toISOString(),
          level: "info",
          service: "Search Service",
          message: "Flight search completed",
          details: `${event.origin} to ${event.destination}, ${totalPassengers} passengers, ${event.tripType}`,
          user: "anonymous",
        });
      });
    }

    // 2. Get user authentication events (info logs)
    if (level === "all" || level === "info") {
      const recentSessions = await prisma.session.findMany({
        take: Math.min(limit, 20),
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              email: true,
            },
          },
        },
      });

      recentSessions.forEach((session) => {
        logs.push({
          id: `auth-${session.id}`,
          timestamp: session.createdAt.toISOString(),
          level: "info",
          service: "Auth Service",
          message: "User session created",
          details: `IP: ${session.ipAddress || "unknown"}, User Agent: ${session.userAgent || "unknown"}`,
          user: session.user?.email || "unknown",
        });
      });
    }

    // 3. Get banned users (warning logs)
    if (level === "all" || level === "warning") {
      const bannedUsers = await prisma.user.findMany({
        where: { banned: true },
        take: Math.min(limit, 10),
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          email: true,
          banReason: true,
          updatedAt: true,
        },
      });

      bannedUsers.forEach((user) => {
        logs.push({
          id: `ban-${user.id}`,
          timestamp: user.updatedAt.toISOString(),
          level: "warning",
          service: "User Management",
          message: "User banned",
          details: user.banReason || "No reason provided",
          user: user.email || "unknown",
        });
      });
    }

    // Sort all logs by timestamp (most recent first)
    logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Apply filters
    let filteredLogs = logs;

    if (service !== "all") {
      filteredLogs = filteredLogs.filter((log) =>
        log.service.toLowerCase().includes(service.toLowerCase())
      );
    }

    if (search) {
      filteredLogs = filteredLogs.filter(
        (log) =>
          log.message.toLowerCase().includes(search.toLowerCase()) ||
          log.details.toLowerCase().includes(search.toLowerCase()) ||
          log.user.toLowerCase().includes(search.toLowerCase())
      );
    }

    // Paginate
    const paginatedLogs = filteredLogs.slice(offset, offset + limit);

    // Calculate stats
    const stats = {
      total: filteredLogs.length,
      errors: filteredLogs.filter((l) => l.level === "error").length,
      warnings: filteredLogs.filter((l) => l.level === "warning").length,
      info: filteredLogs.filter((l) => l.level === "info").length,
    };

    return c.json({
      logs: paginatedLogs,
      stats,
      total: filteredLogs.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching system logs:", error);
    return c.json(
      {
        error: "Failed to fetch system logs",
        logs: [],
        stats: { total: 0, errors: 0, warnings: 0, info: 0 },
      },
      500
    );
  }
});

/**
 * @route GET /api/admin/system-logs/stats
 * @desc Get system logs statistics
 * @access Admin only
 */
app.get("/stats", requireAdmin, async (c) => {
  try {
    const [searchCount, sessionCount, bannedCount] = await Promise.all([
      prisma.searchEvent.count(),
      prisma.session.count(),
      prisma.user.count({ where: { banned: true } }),
    ]);

    return c.json({
      total: searchCount + sessionCount + bannedCount,
      errors: 0, // Would need error logging table
      warnings: bannedCount,
      info: searchCount + sessionCount,
    });
  } catch (error) {
    console.error("Error fetching system log stats:", error);
    return c.json(
      {
        total: 0,
        errors: 0,
        warnings: 0,
        info: 0,
      },
      500
    );
  }
});

export default app;
