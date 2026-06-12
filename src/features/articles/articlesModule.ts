import { Hono } from "hono";
import type { Context } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";

const app = new Hono();

// ============================================
// PUBLIC ENDPOINTS
// ============================================

// List published articles — supports ?category=&page=&limit=&search=
app.get("/", async (c: Context) => {
  const category = c.req.query("category");
  const search = c.req.query("search") || "";
  const page = Math.max(0, parseInt(c.req.query("page") || "0"));
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query("limit") || "12")));

  const where: any = { status: "published" };

  if (category) {
    where.articleCategory = { some: { slug: category } };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { shortSummary: { contains: search, mode: "insensitive" } },
      { keywords: { contains: search, mode: "insensitive" } },
    ];
  }

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        shortSummary: true,
        featuredImage: true,
        imageAlt: true,
        authorName: true,
        readingTime: true,
        publishedAt: true,
        updatedAt: true,
        articleCategory: { select: { slug: true, name: true } },
      },
      orderBy: { publishedAt: "desc" },
      skip: page * limit,
      take: limit,
    }),
    prisma.article.count({ where }),
  ]);

  return c.json({ articles, total, page, limit });
});

// Featured articles (newest 6 published)
app.get("/featured", async (c: Context) => {
  const articles = await prisma.article.findMany({
    where: { status: "published" },
    select: {
      id: true,
      slug: true,
      title: true,
      shortSummary: true,
      featuredImage: true,
      imageAlt: true,
      authorName: true,
      readingTime: true,
      publishedAt: true,
      articleCategory: { select: { slug: true, name: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 6,
  });
  return c.json(articles);
});

// All categories with article counts
app.get("/categories", async (c: Context) => {
  const categories = await prisma.articleCategory.findMany({
    include: {
      _count: { select: { article: { where: { status: "published" } } } },
    },
    orderBy: { name: "asc" },
  });
  return c.json(
    categories.map((cat) => ({
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      description: cat.description,
      icon: cat.icon,
      articleCount: cat._count.article,
    }))
  );
});

// Single published article by slug
app.get("/:slug", async (c: Context) => {
  const slug = c.req.param("slug");
  const article = await prisma.article.findFirst({
    where: { slug, status: "published" },
    include: { articleCategory: { select: { slug: true, name: true } } },
  });
  if (!article) return c.json({ message: "Article not found" }, 404);
  return c.json(article);
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

// List all articles (any status)
app.get("/admin/list", requireAdmin, async (c: Context) => {
  const page = Math.max(0, parseInt(c.req.query("page") || "0"));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const search = c.req.query("search") || "";
  const status = c.req.query("status");

  const where: any = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
    ];
  }

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        authorName: true,
        readingTime: true,
        publishedAt: true,
        updatedAt: true,
        articleCategory: { select: { slug: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: page * limit,
      take: limit,
    }),
    prisma.article.count({ where }),
  ]);

  return c.json({ articles, total, page, limit });
});

// Get single article by id (admin)
app.get("/admin/:id", requireAdmin, async (c: Context) => {
  const id = c.req.param("id");
  const article = await prisma.article.findUnique({
    where: { id },
    include: { articleCategory: true },
  });
  if (!article) return c.json({ message: "Not found" }, 404);
  return c.json(article);
});

// Create article
app.post("/admin", requireAdmin, async (c: Context) => {
  const body = await c.req.json();
  const user = c.get("user");

  const {
    title,
    slug,
    categoryIds = [],
    shortSummary,
    body: articleBody,
    featuredImage,
    imageAlt,
    authorName,
    readingTime,
    metaTitle,
    metaDescription,
    keywords,
    faqs,
    relatedArticles,
    status = "draft",
    publishedAt,
  } = body;

  if (!title || !slug || !articleBody) {
    return c.json({ message: "title, slug, and body are required" }, 400);
  }

  const existing = await prisma.article.findUnique({ where: { slug } });
  if (existing) return c.json({ message: "Slug already exists" }, 409);

  const article = await prisma.article.create({
    data: {
      title,
      slug,
      shortSummary,
      body: articleBody,
      featuredImage,
      imageAlt,
      authorName: authorName || "Fly Arzan Travel Team",
      readingTime: readingTime ? parseInt(readingTime) : null,
      metaTitle,
      metaDescription,
      keywords,
      faqs: faqs || null,
      relatedArticles: relatedArticles || null,
      status,
      publishedAt: status === "published" ? (publishedAt ? new Date(publishedAt) : new Date()) : null,
      updatedBy: user?.email || "system",
      articleCategory: categoryIds.length
        ? { connect: categoryIds.map((id: string) => ({ id })) }
        : undefined,
    },
    include: { articleCategory: true },
  });

  return c.json(article, 201);
});

// Update article
app.put("/admin/:id", requireAdmin, async (c: Context) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const user = c.get("user");

  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) return c.json({ message: "Not found" }, 404);

  const {
    title,
    slug,
    categoryIds,
    shortSummary,
    body: articleBody,
    featuredImage,
    imageAlt,
    authorName,
    readingTime,
    metaTitle,
    metaDescription,
    keywords,
    faqs,
    relatedArticles,
    status,
    publishedAt,
  } = body;

  // If slug changed, check uniqueness
  if (slug && slug !== existing.slug) {
    const conflict = await prisma.article.findUnique({ where: { slug } });
    if (conflict) return c.json({ message: "Slug already exists" }, 409);
  }

  const wasPublished = existing.status !== "published" && status === "published";

  const article = await prisma.article.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(slug !== undefined && { slug }),
      ...(shortSummary !== undefined && { shortSummary }),
      ...(articleBody !== undefined && { body: articleBody }),
      ...(featuredImage !== undefined && { featuredImage }),
      ...(imageAlt !== undefined && { imageAlt }),
      ...(authorName !== undefined && { authorName }),
      ...(readingTime !== undefined && { readingTime: readingTime ? parseInt(readingTime) : null }),
      ...(metaTitle !== undefined && { metaTitle }),
      ...(metaDescription !== undefined && { metaDescription }),
      ...(keywords !== undefined && { keywords }),
      ...(faqs !== undefined && { faqs }),
      ...(relatedArticles !== undefined && { relatedArticles }),
      ...(status !== undefined && { status }),
      publishedAt:
        status === "published"
          ? (publishedAt ? new Date(publishedAt) : (wasPublished ? new Date() : existing.publishedAt))
          : existing.publishedAt,
      updatedBy: user?.email || "system",
      ...(categoryIds !== undefined && {
        articleCategory: {
          set: categoryIds.map((cid: string) => ({ id: cid })),
        },
      }),
    },
    include: { articleCategory: true },
  });

  return c.json(article);
});

// Delete article
app.delete("/admin/:id", requireAdmin, async (c: Context) => {
  const id = c.req.param("id");
  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) return c.json({ message: "Not found" }, 404);
  await prisma.article.delete({ where: { id } });
  return c.json({ ok: true });
});

// Dynamic XML sitemap — returns all published articles for SEO crawlers
app.get("/sitemap.xml", async (c: Context) => {
  const articles = await prisma.article.findMany({
    where: { status: "published" },
    select: {
      slug: true,
      updatedAt: true,
      articleCategory: { select: { slug: true }, take: 1 },
    },
    orderBy: { publishedAt: "desc" },
  });

  const urls = articles
    .map((a) => {
      const catSlug = a.articleCategory[0]?.slug || "general-travel-advice";
      const loc = `https://flyarzan.com/travel-guides/${catSlug}/${a.slug}`;
      const lastmod = a.updatedAt.toISOString().split("T")[0];
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return c.body(xml, 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
});

// Seed default categories
app.post("/admin/seed-categories", requireAdmin, async (c: Context) => {
  const defaults = [
    { slug: "travel-news", name: "Travel News", description: "Latest travel updates, airline news, airport updates and important travel changes.", icon: "Newspaper" },
    { slug: "travel-blogs", name: "Travel Blogs", description: "Personal travel stories, trip reports and destination experiences.", icon: "BookOpen" },
    { slug: "travel-tips", name: "Travel Tips", description: "Practical tips and advice to make your travel easier and more enjoyable.", icon: "Lightbulb" },
    { slug: "travel-feedback", name: "Travel Feedback", description: "Customer experiences and travel reviews.", icon: "MessageSquare" },
    { slug: "travel-guidelines", name: "Travel Guidelines", description: "Essential travel rules, regulations and guidelines for travellers.", icon: "ClipboardList" },
    { slug: "airport-guides", name: "Airport Guides", description: "Helpful airport information including terminals, transport, facilities, lounges and travel tips.", icon: "Building2" },
    { slug: "destination-guides", name: "Destination Guides", description: "Comprehensive guides to popular travel destinations worldwide.", icon: "MapPin" },
    { slug: "flight-booking-tips", name: "Flight Booking Tips", description: "Expert advice on finding cheap flights, best booking times and seat selection.", icon: "Plane" },
    { slug: "baggage-information", name: "Baggage Information", description: "Complete guide to airline baggage policies, allowances and restrictions.", icon: "Luggage" },
    { slug: "travel-restrictions", name: "Travel Restrictions & Updates", description: "Current travel restrictions, entry requirements and health regulations.", icon: "ShieldAlert" },
    { slug: "visa-travel-documents", name: "Visa & Travel Documents", description: "Visa information, passport validity rules, travel documents and entry requirements.", icon: "FileText" },
    { slug: "general-travel-advice", name: "General Travel Advice", description: "Broad travel advice covering safety, insurance, currency and more.", icon: "Info" },
  ];

  for (const cat of defaults) {
    await prisma.articleCategory.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, description: cat.description, icon: cat.icon },
      create: { id: cat.slug, slug: cat.slug, name: cat.name, description: cat.description, icon: cat.icon },
    });
  }

  return c.json({ ok: true, seeded: defaults.length });
});

export default app;
