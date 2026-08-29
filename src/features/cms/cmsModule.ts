import { Hono } from "hono";
import type { Context } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";
import { airlinesSeedContent } from "./airlinesSeedContent.js";

const app = new Hono();

// ============================================
// PUBLIC ENDPOINTS (no auth required)
// ============================================

// Get published page by slug (PUBLIC - for frontend pages)
app.get("/public/:slug", async (c: Context) => {
  const slug = c.req.param("slug");
  const page = await prisma.cmsPage.findFirst({
    where: {
      slug,
      status: "published",
    },
    select: {
      slug: true,
      title: true,
      content: true,
      updatedAt: true,
    },
  });
  if (!page) return c.json({ message: "Page not found" }, 404);
  return c.json(page);
});

// ============================================
// PUBLIC AIRPORT DIRECTORY (no auth required)
// Backs /Airport (hub) and /Airport/:iata (detail). The generic /public/:slug
// route above returns the whole blob; the paginated hub must not download every
// airport, so these endpoints sort, filter and slice server-side instead.
//
// Static paths are registered BEFORE "/airports/:iata" — otherwise Hono matches
// "letters" against the param and the A-Z rail 404s.
// ============================================

type AirportEntry = Record<string, any>;

/** Lightweight alias for an airline record in the published CMS blob. */
type AirlineEntry = Record<string, any>;

/** Load the published airport_info page, or null. */
async function loadAirportPage() {
  return prisma.cmsPage.findFirst({
    where: { slug: "airport_info", status: "published" },
    select: { title: true, content: true, updatedAt: true },
  });
}

/**
 * Airports that are publishable, i.e. have an IATA code.
 *
 * The code IS the detail-page URL (/Airport/DXB), so a record without one has no
 * page to link to. Filtering here keeps the list, the A-Z counts and the sitemap
 * consistent, and stops the hub rendering a card that links to "/Airport/".
 * The admin editor flags these rows so an editor can fill the code in.
 */
function publishableAirports(content: any): AirportEntry[] {
  const airports = Array.isArray(content?.airports) ? content.airports : [];
  return (airports as AirportEntry[]).filter((airport) =>
    Boolean(String(airport?.iataCode || "").trim()),
  );
}

async function loadPublicAirports(): Promise<AirportEntry[]> {
  const page = await loadAirportPage();
  return publishableAirports(page?.content);
}

const byAirportName = (a: AirportEntry, b: AirportEntry) =>
  String(a?.name || "").localeCompare(String(b?.name || ""));

/** Initial used by the A-Z rail; non-alphabetic names bucket into "#". */
const airportInitial = (airport: AirportEntry) => {
  const first = String(airport?.name || "").trim().charAt(0).toUpperCase();
  if (!first) return "";
  return /^[A-Z]$/.test(first) ? first : "#";
};

const matchesAirportSearch = (airport: AirportEntry, query: string) =>
  Boolean(
    airport.name?.toLowerCase().includes(query) ||
      airport.iataCode?.toLowerCase().includes(query) ||
      airport.city?.toLowerCase().includes(query) ||
      airport.country?.toLowerCase().includes(query),
  );

/** Hub card row — omits sections/tips/baggage/airlines to keep the list light. */
const toAirportListRow = (airport: AirportEntry) => ({
  name: airport.name ?? "",
  iataCode: airport.iataCode ?? "",
  city: airport.city ?? "",
  country: airport.country ?? "",
  flag: airport.flag ?? "",
});

// Everything the hub needs that ISN'T a list page: the editable page title and
// hero, plus which A-Z initials actually have airports (so the rail can disable
// empty letters). Kept as one call because it is all first-paint page chrome —
// and because the alternative, /public/airport_info, would ship every airport.
app.get("/public/airport_info/meta", async (c: Context) => {
  const page = await loadAirportPage();
  const content = page?.content as any;
  const airports = publishableAirports(content);

  const counts: Record<string, number> = {};
  for (const airport of airports) {
    const initial = airportInitial(airport);
    if (!initial) continue;
    counts[initial] = (counts[initial] || 0) + 1;
  }

  return c.json({
    title: page?.title || "Airport Information Hub",
    hero: {
      title: content?.hero?.title || "",
      subtitle: content?.hero?.subtitle || "",
    },
    letters: Object.keys(counts).sort(),
    counts,
    total: airports.length,
    updatedAt: page?.updatedAt || null,
  });
});

// Dynamic XML sitemap for the airport detail pages. Registered before
// "/airports/:iata" for the same reason as the letters route.
app.get("/public/airport_info/sitemap.xml", async (c: Context) => {
  const page = await loadAirportPage();
  const airports = publishableAirports(page?.content);

  const siteUrl = (
    process.env.APP_CLIENT_URL || "https://flyarzan.com"
  ).replace(/\/$/, "");
  const lastmod = (page?.updatedAt || new Date()).toISOString().split("T")[0];

  const urls = airports
    .slice()
    .sort(byAirportName)
    .map((airport) => String(airport?.iataCode || "").trim().toUpperCase())
    .filter(Boolean)
    .map(
      (iata) =>
        `  <url>\n    <loc>${siteUrl}/Airport/${iata}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return c.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

// Paginated, alphabetically sorted airport list with search + letter filter.
app.get("/public/airport_info/airports", async (c: Context) => {
  const page = Math.max(0, parseInt(c.req.query("page") || "0"));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(c.req.query("limit") || "12")),
  );
  const search = (c.req.query("search") || "").trim().toLowerCase();
  const letter = (c.req.query("letter") || "").trim().toUpperCase();

  let airports = (await loadPublicAirports()).slice().sort(byAirportName);

  if (letter) {
    airports = airports.filter((airport) => airportInitial(airport) === letter);
  }
  if (search) {
    airports = airports.filter((airport) =>
      matchesAirportSearch(airport, search),
    );
  }

  const total = airports.length;
  return c.json({
    airports: airports
      .slice(page * limit, (page + 1) * limit)
      .map(toAirportListRow),
    total,
    page,
    limit,
  });
});

// Single airport by IATA code — powers /Airport/:iata.
app.get("/public/airport_info/airports/:iata", async (c: Context) => {
  const iata = (c.req.param("iata") || "").trim().toUpperCase();
  if (!iata) return c.json({ message: "Not found" }, 404);

  const airports = await loadPublicAirports();
  const airport = airports.find(
    (entry) => String(entry?.iataCode || "").trim().toUpperCase() === iata,
  );
  if (!airport) return c.json({ message: "Not found" }, 404);
  return c.json(airport);
});

// ============================================
// PUBLIC AIRLINE DIRECTORY (no auth required)
// Backs /Airlines (hub) and /Airlines/:iata (detail). Mirrors the airport
// directory above 1:1: the enriched airline records (name, IATA/ICAO, website,
// country, summary, info sections and the baggage guide PDF) live as a JSON
// blob on the published CMS page with slug "airlines". Carrier logos resolve
// from public/logos/<IATA>.png on the frontend; this module only serves data.
//
// Static paths are registered BEFORE "/airlines/:iata" — otherwise Hono would
// match "meta"/"sitemap.xml" against the :iata param.
// ============================================

/** Load the published airlines page, or null. */
async function loadAirlinesPage() {
  return prisma.cmsPage.findFirst({
    where: { slug: "airlines", status: "published" },
    select: { slug: true, title: true, content: true, updatedAt: true },
  });
}

/**
 * Airlines that are publishable, i.e. have an IATA code.
 *
 * The code is the detail-page URL (/Airlines/EK) AND the logo key
 * (/logos/EK.png), so a record without one has neither a page nor a logo to
 * show — filter it out everywhere to keep the list, A-Z counts and sitemap
 * consistent.
 */
function publishableAirlines(content: any): AirlineEntry[] {
  const airlines = Array.isArray(content?.airlines) ? content.airlines : [];
  return (airlines as AirlineEntry[]).filter((airline) =>
    Boolean(String(airline?.iata || "").trim()),
  );
}

async function loadPublicAirlines(): Promise<AirlineEntry[]> {
  const page = await loadAirlinesPage();
  return publishableAirlines(page?.content);
}

const byAirlineName = (a: AirlineEntry, b: AirlineEntry) =>
  String(a?.name || "").localeCompare(String(b?.name || ""));

/** Initial used by the A-Z rail; non-alphabetic names bucket into "#". */
const airlineInitial = (airline: AirlineEntry) => {
  const first = String(airline?.name || "").trim().charAt(0).toUpperCase();
  if (!first) return "";
  return /^[A-Z]$/.test(first) ? first : "#";
};

/** Hub card/search match — name, IATA or ICAO code, country, or city. */
const matchesAirlineSearch = (airline: AirlineEntry, query: string) =>
  Boolean(
    airline.name?.toLowerCase().includes(query) ||
      airline.iata?.toLowerCase().includes(query) ||
      airline.icao?.toLowerCase().includes(query) ||
      airline.country?.toLowerCase().includes(query) ||
      airline.countryCode?.toLowerCase().includes(query),
  );

/** Hub card row — omits sections/summary/baggage to keep the list light. */
const toAirlineListRow = (airline: AirlineEntry) => ({
  name: airline.name ?? "",
  iata: airline.iata ?? "",
  icao: airline.icao ?? "",
  website: airline.website ?? "",
  country: airline.country ?? "",
  countryCode: airline.countryCode ?? "",
  flag: airline.flag ?? "",
});

// Everything the hub needs that ISN'T a list page: the editable page title and
// hero, plus which A-Z initials actually have airlines (so the rail can disable
// empty letters). Kept as one call because it is all first-paint page chrome —
// and because the alternative, /public/airlines, would ship every airline.
app.get("/public/airlines/meta", async (c: Context) => {
  const page = await loadAirlinesPage();
  const content = page?.content as any;
  const airlines = publishableAirlines(content);

  const counts: Record<string, number> = {};
  for (const airline of airlines) {
    const initial = airlineInitial(airline);
    if (!initial) continue;
    counts[initial] = (counts[initial] || 0) + 1;
  }

  return c.json({
    title: page?.title || "Airline Information Hub",
    hero: {
      title: content?.hero?.title || "",
      subtitle: content?.hero?.subtitle || "",
    },
    letters: Object.keys(counts).sort(),
    counts,
    total: airlines.length,
    updatedAt: page?.updatedAt || null,
  });
});

// Dynamic XML sitemap for the airline detail pages. Registered before
// "/airlines/:iata" for the same reason as the letters/meta routes.
app.get("/public/airlines/sitemap.xml", async (c: Context) => {
  const page = await loadAirlinesPage();
  const airlines = publishableAirlines(page?.content);

  const siteUrl = (
    process.env.APP_CLIENT_URL || "https://flyarzan.com"
  ).replace(/\/$/, "");
  const lastmod = (page?.updatedAt || new Date()).toISOString().split("T")[0];

  const urls = airlines
    .slice()
    .sort(byAirlineName)
    .map((airline) => String(airline?.iata || "").trim().toUpperCase())
    .filter(Boolean)
    .map(
      (iata) =>
        `  <url>\n    <loc>${siteUrl}/Airlines/${iata}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return c.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

// Paginated, alphabetically sorted airline list with search + letter filter.
app.get("/public/airlines", async (c: Context) => {
  const page = Math.max(0, parseInt(c.req.query("page") || "0"));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(c.req.query("limit") || "12")),
  );
  const search = (c.req.query("search") || "").trim().toLowerCase();
  const letter = (c.req.query("letter") || "").trim().toUpperCase();

  let airlines = (await loadPublicAirlines()).slice().sort(byAirlineName);

  if (letter) {
    airlines = airlines.filter((airline) => airlineInitial(airline) === letter);
  }
  if (search) {
    airlines = airlines.filter((airline) =>
      matchesAirlineSearch(airline, search),
    );
  }

  const total = airlines.length;
  return c.json({
    airlines: airlines
      .slice(page * limit, (page + 1) * limit)
      .map(toAirlineListRow),
    total,
    page,
    limit,
  });
});

// Single airline by IATA code — powers /Airlines/:iata.
app.get("/public/airlines/:iata", async (c: Context) => {
  const iata = (c.req.param("iata") || "").trim().toUpperCase();
  if (!iata) return c.json({ message: "Not found" }, 404);

  const airlines = await loadPublicAirlines();
  const airline = airlines.find(
    (entry) => String(entry?.iata || "").trim().toUpperCase() === iata,
  );
  if (!airline) return c.json({ message: "Not found" }, 404);
  return c.json(airline);
});

// ============================================
// ADMIN ENDPOINTS (auth required via /admin/cms mount)
// ============================================

// List all CMS pages (slugs and titles)
app.get("/pages", requireAdmin, async (c: Context) => {
  const pages = await prisma.cmsPage.findMany({
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      updatedAt: true,
    },
    orderBy: { slug: "asc" },
  });
  return c.json(pages);
});

// Get single page by slug
app.get("/:slug", requireAdmin, async (c: Context) => {
  const slug = c.req.param("slug");
  const page = await prisma.cmsPage.findUnique({ where: { slug } });
  if (!page) return c.json({ message: "Not found" }, 404);
  return c.json(page);
});

// Get paginated airports with search + letter filter, sorted A-Z.
// Rows are returned VERBATIM (unlike the public list, which strips detail) —
// the admin edit dialog needs every field, including baggage and airlines.
app.get(
  "/airport_info/airports/paginated",
  requireAdmin,
  async (c: Context) => {
    const page = Math.max(0, parseInt(c.req.query("page") || "0"));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(c.req.query("limit") || "10")),
    );
    const search = (c.req.query("search") || "").trim().toLowerCase();
    const letter = (c.req.query("letter") || "").trim().toUpperCase();

    const cmsPage = await prisma.cmsPage.findUnique({
      where: { slug: "airport_info" },
    });

    if (!cmsPage) {
      return c.json({ airports: [], total: 0, page, limit });
    }

    const content = cmsPage.content as any;
    let airports = ((content?.airports || []) as AirportEntry[])
      .slice()
      .sort(byAirportName);

    if (letter) {
      airports = airports.filter(
        (airport) => airportInitial(airport) === letter,
      );
    }
    if (search) {
      airports = airports.filter((airport) =>
        matchesAirportSearch(airport, search),
      );
    }

    const total = airports.length;

    return c.json({
      airports: airports.slice(page * limit, (page + 1) * limit),
      total,
      page,
      limit,
    });
  },
);

// Upsert page by slug
app.put("/:slug", requireAdmin, async (c: Context) => {
  const slug = c.req.param("slug") as string;
  const body = await c.req.json();
  const {
    title,
    content,
    status = "published",
    updatedBy,
  } = body as {
    title?: string;
    content?: any;
    status?: string;
    updatedBy?: string;
  };

  if (!title || typeof title !== "string") {
    return c.json({ message: "title is required" }, 400);
  }
  const titleStr: string = title;

  // Get current user for audit trail
  const user = c.get("user");
  const actualUpdatedBy = updatedBy || user?.email || "system";

  // content can be any JSON serializable structure
  try {
    const saved = await prisma.cmsPage.upsert({
      where: { slug },
      update: {
        title: titleStr,
        content: content as any,
        status,
        updatedBy: actualUpdatedBy,
      },
      create: {
        slug,
        title: titleStr,
        content: content as any,
        status,
        updatedBy: actualUpdatedBy,
      },
    });
    return c.json(saved);
  } catch (error) {
    console.error("CMS upsert error:", error);
    return c.json(
      {
        message: "Failed to save page",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// Seed default pages if missing
app.post("/seed-defaults", requireAdmin, async (c: Context) => {
  const defaults: Array<{
    slug: string;
    title: string;
    content: Record<string, any>;
  }> = [
    { slug: "about_us", title: "About Us", content: { sections: [] } },
    {
      slug: "faq",
      title: "FAQ",
      content: { hero: { title: "", subtitle: "" }, categories: [] },
    },
    {
      slug: "privacy_policy",
      title: "Privacy Policy",
      content: { blocks: [] },
    },
    {
      slug: "terms_and_conditions",
      title: "Terms & Conditions",
      content: { blocks: [] },
    },
    {
      slug: "contact",
      title: "Contact",
      content: { address: {}, channels: [] },
    },
    {
      slug: "visa_requirements",
      title: "Visa Requirements",
      content: { countries: [] },
    },
    {
      slug: "covid_19_info",
      title: "COVID-19 Travel Information",
      content: {
        hero: { title: "", subtitle: "" },
        introduction: "",
        guidelines: [],
        travelRestrictions: "",
        healthRequirements: "",
        lastUpdated: new Date().toISOString(),
      },
    },
    {
      slug: "airport_info",
      title: "Airport Information Hub",
      content: {
        hero: {
          title: "Airport Information Hub",
          subtitle: "Find detailed information about airports worldwide",
        },
        airports: [],
      },
    },
    {
      slug: "airlines",
      title: "Airline Information Hub",
      content: airlinesSeedContent,
    },
  ];
  for (const d of defaults) {
    await prisma.cmsPage.upsert({
      where: { slug: d.slug },
      update: {},
      create: { slug: d.slug, title: d.title, content: d.content },
    });
  }
  return c.json({ ok: true });
});

export default app;
