import { Hono } from "hono";
import type { Context } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";

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
