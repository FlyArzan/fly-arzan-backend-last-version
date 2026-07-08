import { S3Client } from "@aws-sdk/client-s3";

/**
 * S3-compatible storage client.
 *
 * Works with AWS S3 directly and with any S3-compatible provider (Railway
 * object storage, MinIO, Cloudflare R2, etc.). Configure via env:
 *
 *   S3_ENDPOINT          e.g. https://s3.amazonaws.com  or  https://<id>.r2.cloudflarestorage.com
 *   S3_REGION            e.g. us-east-1  (use "auto" for R2)
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_BUCKET
 *   S3_PUBLIC_URL        public base URL objects are served from (CDN or bucket public URL),
 *                        e.g. https://cdn.flyarzan.com  or  https://<bucket>.s3.amazonaws.com
 *   S3_FORCE_PATH_STYLE  "true" for MinIO/most S3-compatible providers, "false" for AWS S3
 */

export const S3_BUCKET = process.env.S3_BUCKET || "";
export const S3_PUBLIC_URL = (process.env.S3_PUBLIC_URL || "").replace(/\/$/, "");

// Whether storage is configured — lets the API return a clean 503 instead of crashing.
export const isS3Configured = Boolean(
  process.env.S3_ENDPOINT &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    S3_BUCKET,
);

export const s3 = isS3Configured
  ? new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || "auto",
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY as string,
      },
      // Path-style is required by most S3-compatible providers (MinIO, Railway).
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    })
  : null;

// Build the public URL for a stored object key. This is only ever used as the
// raw, canonical "where the object lives" value saved to the DB at upload
// time — it is NOT directly reachable by browsers (see toProxyUrl below), but
// keeping it as the stored value means no migration is needed if the proxy
// scheme ever changes.
export const publicUrlForKey = (key: string) => {
  if (S3_PUBLIC_URL) return `${S3_PUBLIC_URL}/${key}`;
  // Fallback: derive from endpoint + bucket (path-style).
  const endpoint = (process.env.S3_ENDPOINT || "").replace(/\/$/, "");
  return `${endpoint}/${S3_BUCKET}/${key}`;
};

// Railway's Tigris-backed object storage (and most S3-compatible providers)
// has no public-read option — buckets are never directly reachable by
// browsers, confirmed via Railway's own docs: "generate a presigned URL... or
// route the asset request through your application's backend proxy." So every
// stored image is served through our own /api/media proxy instead.
//
// This is a pure READ-TIME transform (nothing is written back to the DB), so
// it works uniformly for images uploaded before this existed (still saved as
// the raw bucket URL) and any future upload — extracting the "<folder>/<file>"
// key from whatever URL is stored and rebuilding it as our own proxy link.
// Anything that doesn't look like one of our own keys (e.g. a genuinely
// external image URL) passes through untouched.
const MEDIA_KEY_PATTERN = /(articles|visa-flags|visa-destinations|article-documents)\/[^/?#]+$/;

export const toProxyUrl = (rawUrl?: string | null): string | null | undefined => {
  if (!rawUrl) return rawUrl;
  const match = rawUrl.match(MEDIA_KEY_PATTERN);
  if (!match) return rawUrl;
  const base = (process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return `${base}/api/media/${match[0]}`;
};

// Same idea as toProxyUrl, but for a whole blob of rich-text HTML (e.g. an
// article body) that can have any number of images embedded anywhere in the
// markup via the WYSIWYG editor's own image tool — those are stored as plain
// <img src="..."> inside the HTML string, not in a dedicated field, so
// toProxyUrl alone never sees them. This finds every occurrence of a stored
// image URL and rewrites it the same way.
const MEDIA_URL_PATTERN_GLOBAL =
  /https?:\/\/\S*?((?:articles|visa-flags|visa-destinations|article-documents)\/[^\s"'<>)]+)/g;

export const proxyImagesInHtml = (html?: string | null): string | null | undefined => {
  if (!html) return html;
  const base = (process.env.BETTER_AUTH_URL || "").replace(/\/$/, "");
  return html.replace(MEDIA_URL_PATTERN_GLOBAL, (_fullMatch, key) => `${base}/api/media/${key}`);
};
