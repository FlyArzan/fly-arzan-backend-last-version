import { Hono } from "hono";
import type { Context } from "hono";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET, isS3Configured } from "@/lib/s3.js";

const app = new Hono();

// Mirrors the folders uploadsModule.ts allows uploads into.
const ALLOWED_FOLDERS = new Set([
  "articles",
  "visa-flags",
  "visa-destinations",
  "article-documents",
]);

/**
 * Streams a stored image back through our own authenticated S3 credentials.
 * Public route — these are the same images already rendered on public pages;
 * the bucket itself has no public-read access (Railway/Tigris object storage
 * never exposes one), so this proxy is how images are actually served.
 * Path-based rather than query-string so served URLs look like real,
 * cacheable, crawlable static assets on our own domain, e.g.
 * https://api.flyarzan.com/api/media/articles/photo.jpg
 */
app.get("/:folder/:filename", async (c: Context) => {
  const folder = c.req.param("folder");
  const filename = c.req.param("filename");

  if (!ALLOWED_FOLDERS.has(folder) || filename.includes("..")) {
    return c.json({ message: "Not found" }, 404);
  }
  if (!isS3Configured || !s3) {
    return c.json({ message: "Image storage is not configured." }, 503);
  }

  const key = `${folder}/${filename}`;
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) return c.json({ message: "Not found" }, 404);
    return c.body(Buffer.from(bytes), 200, {
      "Content-Type": result.ContentType || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch {
    return c.json({ message: "Not found" }, 404);
  }
});

export default app;
