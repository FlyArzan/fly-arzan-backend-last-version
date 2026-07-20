import { Hono } from "hono";
import type { Context } from "hono";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/auth.js";
import { s3, S3_BUCKET, isS3Configured, publicUrlForKey, toProxyUrl } from "@/lib/s3.js";

const app = new Hono();

// Images, plus PDF for the "PDF article" content type — only the extensions
// we can safely serve inline.
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "application/pdf": "pdf",
};

// Uploads are confined to these folders — both for organisation and so the
// delete endpoint can never be tricked into removing objects elsewhere.
const ALLOWED_FOLDERS = new Set([
  "articles",
  "visa-flags",
  "visa-destinations",
  "article-documents",
]);

const PRESIGN_EXPIRY_SECONDS = 120;

// Make a clean, SEO-friendly, collision-proof object key from the original
// filename: "My Beach Photo.JPG" -> "articles/my-beach-photo-3f9a1c2b.jpg"
const buildKey = (folder: string, fileName: string, ext: string) => {
  const base = (fileName || "image")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "image";
  const unique = randomUUID().split("-")[0];
  return `${folder}/${base}-${unique}.${ext}`;
};

/**
 * Issue a short-lived presigned PUT URL so the browser uploads the file
 * DIRECTLY to the bucket (the file never passes through this server).
 * The content type is baked into the signature, so the client must send the
 * exact same Content-Type or the upload is rejected by the storage provider.
 */
app.post("/presign", requireAdmin, async (c: Context) => {
  if (!isS3Configured || !s3) {
    return c.json(
      { message: "Image storage is not configured. Set the S3_* environment variables." },
      503,
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const { fileName, contentType, folder } = body as {
    fileName?: string;
    contentType?: string;
    folder?: string;
  };

  const ext = contentType ? ALLOWED_CONTENT_TYPES[contentType] : undefined;
  if (!contentType || !ext) {
    return c.json(
      { message: "Unsupported file type. Allowed: JPEG, PNG, WebP, GIF, AVIF, PDF." },
      400,
    );
  }

  const safeFolder = folder && ALLOWED_FOLDERS.has(folder) ? folder : "articles";
  const key = buildKey(safeFolder, fileName || "image", ext);

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
    // Long cache: keys are unique per upload, so they are safe to cache forever.
    CacheControl: "public, max-age=31536000, immutable",
  });

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  // Return the PROXIED (/api/media) URL, not the raw bucket URL. The bucket is
  // private (Tigris has no public-read), so the raw URL is not reachable by a
  // browser — using it as an <img src> immediately after upload shows a broken
  // image until a page reload re-fetches the record (which proxies it). Handing
  // back the proxied URL makes the upload preview work right away and stores a
  // browser-reachable value. toProxyUrl is idempotent, so re-proxying this at
  // read time (withProxiedArticle) is a no-op — no regression for existing
  // records still stored as raw bucket URLs.
  return c.json({
    uploadUrl,
    key,
    publicUrl: toProxyUrl(publicUrlForKey(key)),
    contentType,
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });
});

/**
 * Delete an object. Used when an editor cancels/replaces an image so we never
 * orphan files in the bucket. Restricted to our own upload folders.
 */
app.delete("/", requireAdmin, async (c: Context) => {
  if (!isS3Configured || !s3) {
    return c.json({ message: "Image storage is not configured." }, 503);
  }

  const body = await c.req.json().catch(() => ({}));
  const { key } = body as { key?: string };

  if (!key || typeof key !== "string") {
    return c.json({ message: "key is required" }, 400);
  }

  const folder = key.split("/")[0];
  // Guard against path traversal / deleting outside our managed folders.
  if (!ALLOWED_FOLDERS.has(folder) || key.includes("..")) {
    return c.json({ message: "Refusing to delete a key outside managed folders." }, 400);
  }

  await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  return c.json({ ok: true });
});

export default app;
