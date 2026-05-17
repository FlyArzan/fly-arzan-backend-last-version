import { Hono } from "hono";
import { prisma } from "@/lib/prisma.js";

const app = new Hono();

// ─── IP Utilities ───────────────────────────────────────────────────────────

/**
 * Clean IPv6-mapped IPv4 addresses (::ffff: prefix)
 */
const cleanIp = (ip?: string | null) =>
  ip ? ip.replace("::ffff:", "").trim() : undefined;

/**
 * Extract client IP from request headers.
 * Checks multiple common proxy headers in priority order.
 */
function getClientIp(c: any): string | undefined {
  // Try all common proxy/CDN headers
  const xForwardedFor = c.req.header("X-Forwarded-For");
  const xRealIp = c.req.header("X-Real-IP");
  const cfConnectingIp = c.req.header("CF-Connecting-IP");
  const trueClientIp = c.req.header("True-Client-IP");

  // X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
  const forwardedIp = xForwardedFor?.split(",")[0]?.trim();

  const rawIp =
    forwardedIp ||
    xRealIp?.trim() ||
    cfConnectingIp?.trim() ||
    trueClientIp?.trim() ||
    (c.req.raw as any)?.socket?.remoteAddress ||
    undefined;

  return cleanIp(rawIp);
}

// ─── Currency symbol mapping (matches frontend CURRENCY_SYMBOLS) ────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  INR: "₹",
  AUD: "A$",
  CAD: "C$",
  NZD: "NZ$",
  CHF: "CHF",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  PLN: "zł",
  TRY: "₺",
  RUB: "₽",
  BRL: "R$",
  MXN: "$",
  ARS: "$",
  KRW: "₩",
  SGD: "S$",
  MYR: "RM",
  THB: "฿",
  IDR: "Rp",
  PHP: "₱",
  VND: "₫",
  AED: "د.إ",
  SAR: "﷼",
  ZAR: "R",
  EGP: "£",
  ILS: "₪",
  BDT: "৳",
  PKR: "₨",
  LKR: "₨",
  NPR: "₨",
  MMK: "Ks",
  KHR: "៛",
  LAK: "₭",
};

/**
 * Get currency symbol — prefer hardcoded mapping, fallback to Intl.NumberFormat
 */
function getCurrencySymbol(code?: string): string {
  if (!code) return "$";
  if (CURRENCY_SYMBOLS[code]) return CURRENCY_SYMBOLS[code];
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

// ─── Haversine & Airport lookup ─────────────────────────────────────────────

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

let airportsCache: {
  data: Awaited<ReturnType<typeof fetchAllAirports>>;
  timestamp: number;
} | null = null;
const AIRPORTS_CACHE_DURATION = 24 * 60 * 60 * 1000;

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

// ─── Currencies endpoint ────────────────────────────────────────────────────

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

// ─── Exchange rate cache ────────────────────────────────────────────────────

let exchangeRateCache: { data: unknown; timestamp: number } | null = null;
const EXCHANGE_RATE_CACHE_DURATION = 60 * 60 * 1000;

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

// ─── Geolocation cache (per IP, 10 min TTL) ────────────────────────────────
// Avoids hitting BigDataCloud for every page load from the same visitor.
const geoCache = new Map<string, { data: unknown; timestamp: number }>();
const GEO_CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const GEO_CACHE_MAX_ENTRIES = 5000; // prevent unbounded growth

async function getCachedGeoData(ipAddr: string | undefined, geoUrl: string) {
  const cacheKey = ipAddr || "no-ip";
  const cached = geoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < GEO_CACHE_DURATION) {
    return { data: cached.data, fromCache: true };
  }

  const response = await fetch(geoUrl);
  if (!response.ok) {
    return { data: null, response, fromCache: false };
  }
  const data = await response.json();

  // Prune oldest entries if cache gets too big
  if (geoCache.size >= GEO_CACHE_MAX_ENTRIES) {
    const oldestKey = geoCache.keys().next().value;
    if (oldestKey) geoCache.delete(oldestKey);
  }
  geoCache.set(cacheKey, { data, timestamp: Date.now() });
  return { data, response, fromCache: false };
}

// ─── Main geo-currency endpoint ─────────────────────────────────────────────

/*
  @route    GET: /geo-currency
  @access   public
  @desc     Get ip geo location and currency information with all exchange rates
*/
app.get("/", async (c) => {
  try {
    // ── Step 1: Extract client IP ──
    const ipAddr = getClientIp(c);

    // ── Step 2: Call BigDataCloud ──
    const BDC_API_KEY =
      process.env.BIGDATACLOUD_API_KEY || process.env.GEO_LOCATION_API_KEY;

    const geoParams = new URLSearchParams({ localityLanguage: "en" });
    if (BDC_API_KEY) geoParams.set("key", BDC_API_KEY);
    if (ipAddr) geoParams.set("ip", ipAddr);
    const geoUrl = `https://api-bdc.net/data/ip-geolocation?${geoParams.toString()}`;

    const OPEN_EXCHANGE_API_KEY = process.env.OPEN_EXCHANGE_API_KEY;

    // Fetch geo (cached per-IP) and exchange rates in parallel
    const [geoResult, exchangeData] = await Promise.all([
      getCachedGeoData(ipAddr, geoUrl),
      getCachedExchangeRates(OPEN_EXCHANGE_API_KEY || ""),
    ]);

    if (!geoResult.data) {
      const errorText = geoResult.response
        ? await geoResult.response.text().catch(() => "")
        : "";
      console.error(
        "[geo-currency] BigDataCloud error:",
        geoResult.response?.status,
        errorText,
      );
      return c.json({ error: "Failed to fetch geolocation data" }, 500);
    }

    const geoData = geoResult.data as any;

    // ── Step 3: Map response ──
    const countryCode: string | null = geoData.country?.isoAlpha2 || null;
    const countryName: string | null = geoData.country?.name || null;
    const city: string | null = geoData.location?.city || null;
    const latitude: number | null = geoData.location?.latitude ?? null;
    const longitude: number | null = geoData.location?.longitude ?? null;
    const currencyCode: string | null = geoData.country?.currency?.code || null;
    const currencySymbol = getCurrencySymbol(currencyCode || undefined);
    const timezoneId: string | null =
      geoData.location?.timeZone?.ianaTimeId || null;

    // ── Step 4: Find nearest airport ──
    const nearestAirport =
      latitude != null && longitude != null
        ? await findNearestAirport(latitude, longitude)
        : null;

    // ── Step 5: Build response ──
    return c.json({
      countryCode: countryCode || null,
      countryName: countryName || null,
      city: city || null,
      latitude,
      longitude,
      languages: geoData.country?.isoAdminLanguages || [],
      countryFlag: countryCode
        ? `https://flagcdn.com/w320/${countryCode.toLowerCase()}.png`
        : null,
      callingCode: geoData.country?.callingCode || null,
      timeZone: { id: timezoneId },
      currency: {
        code: currencyCode || null,
        name: geoData.country?.currency?.name || null,
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
    console.error("[geo-currency] Unhandled error:", error);
    return c.json({ error: "Failed to fetch geo-currency data" }, 500);
  }
});

export default app;
