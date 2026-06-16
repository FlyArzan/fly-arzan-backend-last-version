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

// Build the public URL for a stored object key.
export const publicUrlForKey = (key: string) => {
  if (S3_PUBLIC_URL) return `${S3_PUBLIC_URL}/${key}`;
  // Fallback: derive from endpoint + bucket (path-style).
  const endpoint = (process.env.S3_ENDPOINT || "").replace(/\/$/, "");
  return `${endpoint}/${S3_BUCKET}/${key}`;
};
