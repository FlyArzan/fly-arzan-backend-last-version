import { Hono } from "hono";
import type { Context } from "hono";
import { prisma } from "@/lib/prisma.js";
import { requireAdmin } from "@/lib/auth.js";

const app = new Hono();

// ============================================
// PUBLIC ENDPOINTS
// ============================================

// List published visa countries — supports ?search=&page=&limit=
app.get("/", async (c: Context) => {
  const search = c.req.query("search") || "";
  const page = Math.max(0, parseInt(c.req.query("page") || "0"));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "50")));

  const where: any = { status: "published" };

  if (search) {
    where.OR = [
      { countryName: { contains: search, mode: "insensitive" } },
      { countryCode: { contains: search, mode: "insensitive" } },
    ];
  }

  const [countries, total] = await Promise.all([
    prisma.visaInfo.findMany({
      where,
      select: {
        id: true,
        countrySlug: true,
        countryName: true,
        countryCode: true,
        flagImage: true,
        visaRequired: true,
        eVisaAvailable: true,
        visaOnArrival: true,
        updatedAt: true,
      },
      orderBy: { countryName: "asc" },
      skip: page * limit,
      take: limit,
    }),
    prisma.visaInfo.count({ where }),
  ]);

  return c.json({ countries, total, page, limit });
});

// Single published visa country by slug
app.get("/:slug", async (c: Context) => {
  const slug = c.req.param("slug");
  const country = await prisma.visaInfo.findFirst({
    where: { countrySlug: slug, status: "published" },
  });
  if (!country) return c.json({ message: "Country not found" }, 404);
  return c.json(country);
});

// ============================================
// ADMIN ENDPOINTS
// ============================================

// List all visa entries (any status)
app.get("/admin/list", requireAdmin, async (c: Context) => {
  const page = Math.max(0, parseInt(c.req.query("page") || "0"));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") || "20")));
  const search = c.req.query("search") || "";
  const status = c.req.query("status");

  const where: any = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { countryName: { contains: search, mode: "insensitive" } },
      { countrySlug: { contains: search, mode: "insensitive" } },
    ];
  }

  const [countries, total] = await Promise.all([
    prisma.visaInfo.findMany({
      where,
      select: {
        id: true,
        countrySlug: true,
        countryName: true,
        countryCode: true,
        flagImage: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { countryName: "asc" },
      skip: page * limit,
      take: limit,
    }),
    prisma.visaInfo.count({ where }),
  ]);

  return c.json({ countries, total, page, limit });
});

// Get single visa country by id (admin)
app.get("/admin/:id", requireAdmin, async (c: Context) => {
  const id = c.req.param("id");
  const country = await prisma.visaInfo.findUnique({ where: { id } });
  if (!country) return c.json({ message: "Not found" }, 404);
  return c.json(country);
});

// Create visa country
app.post("/admin", requireAdmin, async (c: Context) => {
  const body = await c.req.json();
  const user = c.get("user");

  const { countrySlug, countryName } = body;
  if (!countrySlug || !countryName) {
    return c.json({ message: "countrySlug and countryName are required" }, 400);
  }

  const existing = await prisma.visaInfo.findUnique({ where: { countrySlug } });
  if (existing) return c.json({ message: "Country slug already exists" }, 409);

  const country = await prisma.visaInfo.create({
    data: {
      id: crypto.randomUUID(),
      countrySlug: body.countrySlug,
      countryName: body.countryName,
      countryCode: body.countryCode || null,
      flagImage: body.flagImage || null,
      destinationImage: body.destinationImage || null,
      travelIntroduction: body.travelIntroduction || null,
      visaRequired: body.visaRequired || "check",
      eVisaAvailable: body.eVisaAvailable || null,
      visaOnArrival: body.visaOnArrival || null,
      passportValidity: body.passportValidity || null,
      typicalProcessingTime: body.typicalProcessingTime || null,
      approximateVisaFee: body.approximateVisaFee || null,
      officialApplicationLink: body.officialApplicationLink || null,
      travelWarning: body.travelWarning || null,
      detailedSections: body.detailedSections || null,
      requiredDocuments: body.requiredDocuments || null,
      faqs: body.faqs || null,
      metaTitle: body.metaTitle || null,
      metaDescription: body.metaDescription || null,
      status: body.status || "draft",
      updatedBy: user?.email || "system",
    },
  });

  return c.json(country, 201);
});

// Update visa country
app.put("/admin/:id", requireAdmin, async (c: Context) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const user = c.get("user");

  const existing = await prisma.visaInfo.findUnique({ where: { id } });
  if (!existing) return c.json({ message: "Not found" }, 404);

  // If slug changed, check uniqueness
  if (body.countrySlug && body.countrySlug !== existing.countrySlug) {
    const conflict = await prisma.visaInfo.findUnique({ where: { countrySlug: body.countrySlug } });
    if (conflict) return c.json({ message: "Country slug already exists" }, 409);
  }

  const fields = [
    "countrySlug", "countryName", "countryCode", "flagImage", "destinationImage",
    "travelIntroduction", "visaRequired", "eVisaAvailable", "visaOnArrival",
    "passportValidity", "typicalProcessingTime", "approximateVisaFee",
    "officialApplicationLink", "travelWarning", "detailedSections",
    "requiredDocuments", "faqs", "metaTitle", "metaDescription", "status",
  ];

  const data: any = { updatedBy: user?.email || "system" };
  for (const field of fields) {
    if (field in body) data[field] = body[field];
  }

  const country = await prisma.visaInfo.update({ where: { id }, data });
  return c.json(country);
});

// Delete visa country
app.delete("/admin/:id", requireAdmin, async (c: Context) => {
  const id = c.req.param("id");
  const existing = await prisma.visaInfo.findUnique({ where: { id } });
  if (!existing) return c.json({ message: "Not found" }, 404);
  await prisma.visaInfo.delete({ where: { id } });
  return c.json({ ok: true });
});

export default app;
