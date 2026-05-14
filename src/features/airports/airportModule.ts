import { Hono } from "hono";
import { prisma } from "@/lib/prisma.js";

const app = new Hono();

// ─── Haversine ──────────────────────────────────────────────────────────────

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Airport list cache (24h) ────────────────────────────────────────────────

type AirportRow = {
  name: string;
  iataCode: string | null;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  city: { name: string; country: { name: string; iso: string } | null } | null;
};

let airportsCache: { data: AirportRow[]; timestamp: number } | null = null;
const AIRPORTS_CACHE_DURATION = 24 * 60 * 60 * 1000;

async function getCachedAirports(): Promise<AirportRow[]> {
  if (
    airportsCache &&
    Date.now() - airportsCache.timestamp < AIRPORTS_CACHE_DURATION
  ) {
    return airportsCache.data;
  }
  const data = await prisma.airport.findMany({
    where: {
      latitudeDeg: { not: null },
      longitudeDeg: { not: null },
      iataCode: { not: null },
      type: { in: ["large_airport", "medium_airport"] },
    },
    select: {
      name: true,
      iataCode: true,
      latitudeDeg: true,
      longitudeDeg: true,
      city: {
        select: {
          name: true,
          country: { select: { name: true, iso: true } },
        },
      },
    },
  });
  airportsCache = { data, timestamp: Date.now() };
  return data;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * @route   GET /api/airports/nearest
 * @desc    Find the nearest airport to given coordinates
 * @access  Public
 */
app.get("/nearest", async (c) => {
  const lat = parseFloat(c.req.query("lat") || "");
  const lon = parseFloat(c.req.query("lon") || "");

  if (isNaN(lat) || isNaN(lon)) {
    return c.json(
      { message: "Valid lat and lon query parameters are required" },
      400,
    );
  }

  try {
    const airports = await getCachedAirports();

    let nearest: AirportRow | null = null;
    let minDistance = Infinity;

    for (const airport of airports) {
      if (airport.latitudeDeg && airport.longitudeDeg) {
        const distance = haversineDistance(
          lat,
          lon,
          airport.latitudeDeg,
          airport.longitudeDeg,
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearest = airport;
        }
      }
    }

    if (!nearest) {
      return c.json({ message: "Could not find nearest airport" }, 404);
    }

    return c.json({
      airport: {
        iataCode: nearest.iataCode,
        name: nearest.name,
        city: nearest.city?.name,
        country: nearest.city?.country?.name,
        countryCode: nearest.city?.country?.iso,
        distance: Math.round(minDistance),
      },
    });
  } catch (error) {
    console.error("Error finding nearest airport:", error);
    return c.json({ message: "Failed to find nearest airport" }, 500);
  }
});

/**
 * @route   GET /api/airports/search
 * @desc    Search airports by name or IATA code
 * @access  Public
 * @query   q - Search query
 */
app.get("/search", async (c) => {
  const query = c.req.query("q") || "";

  if (query.length < 2) {
    return c.json({ airports: [] });
  }

  try {
    const airports = await prisma.airport.findMany({
      where: {
        AND: [
          {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { iataCode: { contains: query, mode: "insensitive" } },
            ],
          },
          { iataCode: { not: null } },
          { type: { in: ["large_airport", "medium_airport"] } },
        ],
      },
      select: {
        id: true,
        name: true,
        iataCode: true,
        city: {
          select: {
            name: true,
            country: {
              select: {
                name: true,
                iso: true,
              },
            },
          },
        },
      },
      take: 10,
    });

    return c.json({
      airports: airports.map((a) => ({
        iataCode: a.iataCode,
        name: a.name,
        city: a.city?.name,
        country: a.city?.country?.name,
        countryCode: a.city?.country?.iso,
      })),
    });
  } catch (error) {
    console.error("Error searching airports:", error);
    return c.json({ message: "Failed to search airports" }, 500);
  }
});

/**
 * @route   GET /api/airports/category-flight/:category/:country
 * @desc    Return airports for a given country, grouped by category tab
 * @access  Public
 */
app.get("/category-flight/:category/:country", async (c) => {
  const country = c.req.param("country");

  try {
    const airports = await prisma.airport.findMany({
      where: {
        type: { in: ["large_airport", "medium_airport"] },
        iataCode: { not: null },
        city: { country: { name: { contains: country, mode: "insensitive" } } },
      },
      select: {
        iataCode: true,
        name: true,
        city: { select: { name: true } },
      },
      take: 20,
      orderBy: { type: "asc" },
    });

    const data = airports.map((a) => ({
      _id: a.iataCode,
      title: a.city?.name || a.name,
    }));

    return c.json({ data });
  } catch (error) {
    console.error("Error fetching category flights:", error);
    return c.json({ message: "Failed to fetch category flights" }, 500);
  }
});

export default app;
