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

// Get paginated airports with search
app.get(
  "/airport_info/airports/paginated",
  requireAdmin,
  async (c: Context) => {
    const page = parseInt(c.req.query("page") || "0");
    const limit = parseInt(c.req.query("limit") || "10");
    const search = c.req.query("search") || "";

    const cmsPage = await prisma.cmsPage.findUnique({
      where: { slug: "airport_info" },
    });

    if (!cmsPage) {
      return c.json({ airports: [], total: 0, page, limit });
    }

    const content = cmsPage.content as any;
    let airports = (content?.airports || []) as any[];

    // Filter by search query
    if (search) {
      const query = search.toLowerCase();
      airports = airports.filter((airport: any) => {
        return (
          airport.name?.toLowerCase().includes(query) ||
          airport.iataCode?.toLowerCase().includes(query) ||
          airport.city?.toLowerCase().includes(query) ||
          airport.country?.toLowerCase().includes(query)
        );
      });
    }

    const total = airports.length;
    const paginatedAirports = airports.slice(page * limit, (page + 1) * limit);

    return c.json({
      airports: paginatedAirports,
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
    { slug: "faq", title: "FAQ", content: { items: [] } },
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
