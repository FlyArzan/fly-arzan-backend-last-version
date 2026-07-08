import { Hono } from "hono";
import type { Context } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";
import { toProxyUrl, proxyImagesInHtml } from "@/lib/s3.js";

const app = new Hono();

// The bucket has no public-read access, so every stored image/file is served
// through our own /api/media proxy — rewritten here at read time.
const withProxiedImage = <T extends { featuredImage?: string | null }>(article: T): T => ({
  ...article,
  featuredImage: toProxyUrl(article.featuredImage),
});

// Same, but also rewrites images embedded inside the rich-text body itself,
// and the standalone PDF file for PDF-type articles — used wherever the full
// article is returned.
const withProxiedArticle = <
  T extends { featuredImage?: string | null; body?: string | null; pdfFile?: string | null },
>(
  article: T,
): T => ({
  ...article,
  featuredImage: toProxyUrl(article.featuredImage),
  body: proxyImagesInHtml(article.body),
  pdfFile: toProxyUrl(article.pdfFile),
});

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

  return c.json({ articles: articles.map(withProxiedImage), total, page, limit });
});

const FEATURED_LIST_SELECT = {
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
} as const;

// Featured articles — admin-curated (featured: true). Falls back to newest 6
// published articles if none have been curated yet, so the section is never
// empty (e.g. right after this flag was introduced, before an admin uses it).
app.get("/featured", async (c: Context) => {
  const curated = await prisma.article.findMany({
    where: { status: "published", featured: true },
    select: FEATURED_LIST_SELECT,
    orderBy: { publishedAt: "desc" },
    take: 6,
  });
  if (curated.length > 0) return c.json(curated.map(withProxiedImage));

  const fallback = await prisma.article.findMany({
    where: { status: "published" },
    select: FEATURED_LIST_SELECT,
    orderBy: { publishedAt: "desc" },
    take: 6,
  });
  return c.json(fallback.map(withProxiedImage));
});

// "You Might Be Interested" — admin-curated (highlighted: true). Brand new,
// no automatic fallback: the frontend simply hides the section when empty.
app.get("/highlights", async (c: Context) => {
  const articles = await prisma.article.findMany({
    where: { status: "published", highlighted: true },
    select: FEATURED_LIST_SELECT,
    orderBy: { publishedAt: "desc" },
    take: 6,
  });
  return c.json(articles.map(withProxiedImage));
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

// Dynamic XML sitemap — returns all published articles for SEO crawlers.
// IMPORTANT: must be registered BEFORE the "/:slug" route below, otherwise
// Hono matches "/sitemap.xml" against "/:slug" and returns a 404.
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

  const siteUrl = (process.env.APP_CLIENT_URL || "https://flyarzan.com").replace(/\/$/, "");
  const urls = articles
    .map((a) => {
      const catSlug = a.articleCategory[0]?.slug || "general-travel-advice";
      const loc = `${siteUrl}/travel-guides/${catSlug}/${a.slug}`;
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

// Single published article by slug
app.get("/:slug", async (c: Context) => {
  const slug = c.req.param("slug");
  const article = await prisma.article.findFirst({
    where: { slug, status: "published" },
    include: { articleCategory: { select: { slug: true, name: true } } },
  });
  if (!article) return c.json({ message: "Article not found" }, 404);
  return c.json(withProxiedArticle(article));
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
  const category = c.req.query("category");

  const where: any = {};
  if (status) where.status = status;
  if (category) where.articleCategory = { some: { slug: category } };
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
        articleType: true,
        featured: true,
        highlighted: true,
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
  return c.json(withProxiedArticle(article));
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
    articleType = "article",
    pdfFile,
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
    featured = false,
    highlighted = false,
  } = body;

  if (!title || !slug) {
    return c.json({ message: "title and slug are required" }, 400);
  }
  if (articleType === "pdf") {
    if (!pdfFile) return c.json({ message: "A PDF file is required for PDF-type articles" }, 400);
  } else if (!articleBody) {
    return c.json({ message: "body is required" }, 400);
  }

  const existing = await prisma.article.findUnique({ where: { slug } });
  if (existing) return c.json({ message: "Slug already exists" }, 409);

  const article = await prisma.article.create({
    data: {
      title,
      slug,
      shortSummary,
      articleType,
      body: articleType === "pdf" ? null : articleBody,
      pdfFile: articleType === "pdf" ? pdfFile : null,
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
      featured: Boolean(featured),
      highlighted: Boolean(highlighted),
      publishedAt: status === "published" ? (publishedAt ? new Date(publishedAt) : new Date()) : null,
      updatedBy: user?.email || "system",
      articleCategory: categoryIds.length
        ? { connect: categoryIds.map((id: string) => ({ id })) }
        : undefined,
    },
    include: { articleCategory: true },
  });

  return c.json(withProxiedArticle(article), 201);
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
    articleType,
    pdfFile,
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
    featured,
    highlighted,
  } = body;

  // If slug changed, check uniqueness
  if (slug && slug !== existing.slug) {
    const conflict = await prisma.article.findUnique({ where: { slug } });
    if (conflict) return c.json({ message: "Slug already exists" }, 409);
  }

  const wasPublished = existing.status !== "published" && status === "published";
  const effectiveType = articleType !== undefined ? articleType : existing.articleType;

  const article = await prisma.article.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(slug !== undefined && { slug }),
      ...(shortSummary !== undefined && { shortSummary }),
      ...(articleType !== undefined && { articleType }),
      ...(effectiveType === "pdf"
        ? { body: null, pdfFile: pdfFile !== undefined ? pdfFile : existing.pdfFile }
        : { body: articleBody !== undefined ? articleBody : existing.body, pdfFile: null }),
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
      ...(featured !== undefined && { featured: Boolean(featured) }),
      ...(highlighted !== undefined && { highlighted: Boolean(highlighted) }),
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

  return c.json(withProxiedArticle(article));
});

// Delete article
app.delete("/admin/:id", requireAdmin, async (c: Context) => {
  const id = c.req.param("id");
  const existing = await prisma.article.findUnique({ where: { id } });
  if (!existing) return c.json({ message: "Not found" }, 404);
  await prisma.article.delete({ where: { id } });
  return c.json({ ok: true });
});

export default app;
