import { Hono } from "hono";
import { prisma } from "@/lib/prisma.js";

const app = new Hono();

/**
 * Clean IPv6-mapped IPv4 addresses (::ffff: prefix)
 */
const cleanIp = (ip?: string | null) =>
  ip ? ip.replace("::ffff:", "") : undefined;

/**
 * Extract client IP from request, with fallback to socket remote address
 */
const getClientIp = (c: any) => {
  const forwardedFor = c.req.header("X-Forwarded-For");
  const ip =
    forwardedFor?.split(",")[0]?.trim() ||
    c.req.raw?.socket?.remoteAddress ||
    undefined;
  return cleanIp(ip);
};

/**
 * Check if an IP is private/local (loopback, LAN, link-local).
 * Skip external geo API calls for these to save quota.
 */
const isPrivateIp = (ip?: string | null): boolean => {
  if (!ip) return true;
  // IPv6 loopback or private
  if (ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd")) return true;
  // IPv4 ranges
  if (
    ip.startsWith("127.") ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("169.254.")
  )
    return true;
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (!isNaN(second) && second >= 16 && second <= 31) return true;
  }
  return false;
};

/**
 * Default geo response for local/private IPs (saves API calls in dev)
 */
const DEFAULT_LOCAL_GEO = {
  countryCode: "US",
  countryName: "United States",
  city: "New York",
  latitude: 40.7128,
  longitude: -74.006,
  languages: [],
  countryFlag: "https://flagcdn.com/w320/us.png",
  callingCode: "1",
  timeZone: { id: "America/New_York" },
  currency: {
    code: "USD",
    name: "United States Dollar",
    symbol: "$",
    symbol_native: "$",
  },
  exchangeRate: { base: "USD", rates: { USD: 1 } },
  nearestAirport: null,
};
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
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// In-memory cache for airports (valid for 24 hours - airports don't change often)
let airportsCache: {
  data: Awaited<ReturnType<typeof fetchAllAirports>>;
  timestamp: number;
} | null = null;
const AIRPORTS_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

async function fetchAllAirports() {
  return prisma.airport.findMany({
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
}

async function getCachedAirports() {
  if (
    airportsCache &&
    Date.now() - airportsCache.timestamp < AIRPORTS_CACHE_DURATION
  ) {
    return airportsCache.data;
  }
  const data = await fetchAllAirports();
  airportsCache = { data, timestamp: Date.now() };
  return data;
}

/**
 * Find nearest airport to given coordinates (uses cached airports)
 */
async function findNearestAirport(lat: number, lon: number) {
  try {
    const airports = await getCachedAirports();

    let nearest: (typeof airports)[0] | null = null;
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

    if (!nearest) return null;

    return {
      iataCode: nearest.iataCode,
      name: nearest.name,
      city: nearest.city?.name,
      country: nearest.city?.country?.name,
      countryCode: nearest.city?.country?.iso,
    };
  } catch {
    return null;
  }
}

/*
  @route    GET: /geo-currency/currencies
  @access   public
  @desc     Get list of all currencies with names
*/
app.get("/currencies", async (c) => {
  const OPEN_EXCHANGE_API_KEY = process.env.OPEN_EXCHANGE_API_KEY;
  const currenciesUrl = `https://openexchangerates.org/api/currencies.json?app_id=${OPEN_EXCHANGE_API_KEY}`;

  try {
    const response = await fetch(currenciesUrl);
    if (!response.ok) {
      throw new Error("Failed to fetch currencies data");
    }
    const currenciesData = await response.json();

    return c.json(currenciesData);
  } catch (error) {
    console.error("Error fetching currencies data:", error);
    return c.json({ error: "Failed to fetch currencies" }, 500);
  }
});

// In-memory cache for exchange rates (valid for 1 hour)
let exchangeRateCache: { data: unknown; timestamp: number } | null = null;
const EXCHANGE_RATE_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

async function getCachedExchangeRates(apiKey: string) {
  if (
    exchangeRateCache &&
    Date.now() - exchangeRateCache.timestamp < EXCHANGE_RATE_CACHE_DURATION
  ) {
    return exchangeRateCache.data;
  }
  const exchangeUrl = `https://openexchangerates.org/api/latest.json?app_id=${apiKey}`;
  const response = await fetch(exchangeUrl);
  if (!response.ok) return null;
  const data = await response.json();
  exchangeRateCache = { data, timestamp: Date.now() };
  return data;
}

/**
 * Derive currency symbol from ISO currency code using Intl.NumberFormat.
 * e.g. "USD" → "$", "EUR" → "€", "GBP" → "£"
 */
function getCurrencySymbol(code?: string): string {
  if (!code) return "$";
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: code,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? code
    );
  } catch {
    return code;
  }
}

/*
  @route    GET: /geo-currency
  @access   public
  @desc     Get ip geo location and currency information with all exchange rates
*/
app.get("/", async (c) => {
  try {
    // Get real client IP (X-Forwarded-For first, then socket fallback)
    const ipAddr = getClientIp(c);

    // Skip external geo API for private/local IPs — saves API quota in dev
    if (isPrivateIp(ipAddr)) {
      console.log("[geo-currency] Private/local IP detected, skipping geo API");
      return c.json(DEFAULT_LOCAL_GEO);
    }

    // BigDataCloud IP Geolocation API
    // The ip parameter is REQUIRED when using an API key — without it BDC returns 403
    const BDC_API_KEY =
      process.env.BIGDATACLOUD_API_KEY || process.env.GEO_LOCATION_API_KEY;
    const geoParams = new URLSearchParams({ localityLanguage: "en" });
    if (BDC_API_KEY) geoParams.set("key", BDC_API_KEY);
    if (ipAddr) geoParams.set("ip", ipAddr);
    const geoUrl = `https://api-bdc.net/data/ip-geolocation?${geoParams.toString()}`;

    const OPEN_EXCHANGE_API_KEY = process.env.OPEN_EXCHANGE_API_KEY;

    // Fetch geo and exchange rates in parallel (exchange rates are cached)
    const [geoResponse, exchangeData] = await Promise.all([
      fetch(geoUrl),
      getCachedExchangeRates(OPEN_EXCHANGE_API_KEY || ""),
    ]);

    if (!geoResponse.ok) {
      console.error(
        "[BigDataCloud] Geolocation API error:",
        await geoResponse.text(),
      );
      return c.json({ error: "Failed to fetch geolocation data" }, 500);
    }
    const geoData = await geoResponse.json();

    // Map BigDataCloud response to our output shape
    const countryCode: string | undefined = geoData.country?.isoAlpha2;
    const lat: number | undefined = geoData.location?.latitude;
    const lon: number | undefined = geoData.location?.longitude;
    const currencyCode: string | undefined = geoData.country?.currency?.code;
    const currencySymbol = getCurrencySymbol(currencyCode);

    // Fetch nearest airport (don't block response if it fails)
    const nearestAirport =
      lat != null && lon != null ? await findNearestAirport(lat, lon) : null;

    return c.json({
      countryCode,
      countryName: geoData.country?.name,
      city: geoData.location?.city,
      latitude: lat,
      longitude: lon,
      languages: geoData.country?.isoAdminLanguages || [],
      // Use flagcdn.com for flag images (same CDN as before, driven by ISO code)
      countryFlag: countryCode
        ? `https://flagcdn.com/w320/${countryCode.toLowerCase()}.png`
        : undefined,
      callingCode: geoData.country?.callingCode,
      // Frontend reads timeZone.id — keep same shape
      timeZone: { id: geoData.location?.timeZone?.ianaTimeId },
      // Keep same currency shape the frontend expects
      currency: {
        code: currencyCode,
        name: geoData.country?.currency?.name,
        symbol: currencySymbol,
        symbol_native: currencySymbol,
      },
      exchangeRate: exchangeData
        ? {
            base: (
              exchangeData as { base: string; rates: Record<string, number> }
            ).base,
            rates: (
              exchangeData as { base: string; rates: Record<string, number> }
            ).rates,
          }
        : { base: "USD", rates: { USD: 1 } },
      nearestAirport,
    });
  } catch (error) {
    console.error("[geo-currency] Error:", error);
    return c.json({ error: "Failed to fetch geo-currency data" }, 500);
  }
});

export default app;
