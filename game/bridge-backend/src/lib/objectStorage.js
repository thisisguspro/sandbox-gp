// Minimal object-storage helper (Replit App Storage, GCS-backed) for the game
// backend. Ported to plain ESM from the pnpm-workspace object-storage skill; we
// only need public-content uploads (news banners), so the ACL layer is omitted —
// uploaded banners are served unconditionally through our own /objects route.
//
// The GCS client authenticates via the Replit sidecar (auto-configured on
// Replit). Do NOT change the credential block below.
import { Storage } from "@google-cloud/storage";
import { randomUUID } from "crypto";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

function getPrivateObjectDir() {
  const dir = process.env.PRIVATE_OBJECT_DIR || "";
  if (!dir) {
    throw new Error(
      "PRIVATE_OBJECT_DIR not set — provision Object Storage before uploading."
    );
  }
  return dir;
}

function parseObjectPath(p) {
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = p.split("/");
  if (parts.length < 3) throw new Error("Invalid path: missing bucket name");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

async function signObjectURL({ bucketName, objectName, method, ttlSec }) {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL (${response.status}); make sure you're running on Replit`
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

// Generates a presigned PUT URL for a fresh upload plus the local object path
// (`/objects/uploads/<id>`) the client stores + later serves through /objects.
export async function getObjectEntityUploadURL() {
  const privateDir = getPrivateObjectDir();
  const objectId = randomUUID();
  const fullPath = `${privateDir}/uploads/${objectId}`;
  const { bucketName, objectName } = parseObjectPath(fullPath);
  const uploadURL = await signObjectURL({
    bucketName,
    objectName,
    method: "PUT",
    ttlSec: 900,
  });
  return { uploadURL, objectPath: `/objects/uploads/${objectId}` };
}

// Resolves a `/objects/...` path to a GCS File handle (throws if missing).
export async function getObjectEntityFile(objectPath) {
  if (!objectPath || !objectPath.startsWith("/objects/")) {
    throw new ObjectNotFoundError();
  }
  const parts = objectPath.slice(1).split("/");
  if (parts.length < 2) throw new ObjectNotFoundError();
  const entityId = parts.slice(1).join("/");
  let dir = getPrivateObjectDir();
  if (!dir.endsWith("/")) dir = `${dir}/`;
  const { bucketName, objectName } = parseObjectPath(`${dir}${entityId}`);
  const file = objectStorageClient.bucket(bucketName).file(objectName);
  const [exists] = await file.exists();
  if (!exists) throw new ObjectNotFoundError();
  return file;
}

// Streams a GCS File to an Express response with content-type + cache headers.
export async function streamObject(file, res, cacheTtlSec = 3600) {
  const [metadata] = await file.getMetadata();
  res.set({
    "Content-Type": metadata.contentType || "application/octet-stream",
    "Cache-Control": `public, max-age=${cacheTtlSec}`,
    ...(metadata.size ? { "Content-Length": String(metadata.size) } : {}),
  });
  const stream = file.createReadStream();
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
}
