// S3 (Tigris) helper for basicbugs backups.
//
// Three prefixes share one bucket — the same env vars `fly storage create`
// injects for the Litestream replica are reused here:
//   BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
//   AWS_ENDPOINT_URL_S3, AWS_REGION.
//
//   s3://${BUCKET_NAME}/db/                Litestream WAL stream (not us)
//   s3://${BUCKET_NAME}/attachments/<rel>  per-upload write-through (this module)
//   s3://${BUCKET_NAME}/snapshots/<key>    daily VACUUM INTO snapshots (this module)
//
// All operations are wrapped in a 15s timeout so a stalled or broken
// endpoint cannot hang an upload request. Callers use isConfigured() to
// skip the S3 path cleanly when creds are absent (local dev, tests, e2e).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export const ATTACHMENTS_PREFIX = 'attachments/';
export const SNAPSHOTS_PREFIX = 'snapshots/';
const TIMEOUT_MS = 15_000;

let cachedClient = null;

export function isConfigured() {
  return Boolean(
    process.env.BUCKET_NAME &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_ENDPOINT_URL_S3 &&
      process.env.AWS_REGION,
  );
}

function getClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    requestHandler: {
      requestTimeout: TIMEOUT_MS,
      connectionTimeout: TIMEOUT_MS,
    },
  });
  return cachedClient;
}

export function _resetClientForTests() {
  cachedClient = null;
}

function withTimeout(promise, label) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} exceeded ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
  );
  return Promise.race([promise, timeout]);
}

function attachmentKey(relPath) {
  // relPath is "<projectId>/<issueId>/<uuid>-<safeName>" — already URL-clean.
  return `${ATTACHMENTS_PREFIX}${relPath}`;
}

export function relPathFromAttachmentKey(key) {
  if (!key.startsWith(ATTACHMENTS_PREFIX)) return null;
  return key.slice(ATTACHMENTS_PREFIX.length);
}

export async function putAttachment(relPath, source, contentType) {
  const Body = Buffer.isBuffer(source) ? source : fs.createReadStream(source);
  let ContentLength;
  if (!Buffer.isBuffer(source)) {
    const stat = await fsp.stat(source);
    ContentLength = stat.size;
  } else {
    ContentLength = source.length;
  }
  const cmd = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: attachmentKey(relPath),
    Body,
    ContentLength,
    ContentType: contentType,
    ACL: 'private',
  });
  await withTimeout(getClient().send(cmd), `S3 putAttachment(${relPath})`);
}

export async function getAttachment(relPath) {
  const cmd = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: attachmentKey(relPath),
  });
  const res = await withTimeout(getClient().send(cmd), `S3 getAttachment(${relPath})`);
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

export async function listAttachmentKeys() {
  return listKeys(ATTACHMENTS_PREFIX);
}

async function listKeys(prefix) {
  const out = [];
  let continuationToken;
  do {
    const cmd = new ListObjectsV2Command({
      Bucket: process.env.BUCKET_NAME,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const res = await withTimeout(getClient().send(cmd), `S3 listKeys(${prefix})`);
    for (const obj of res.Contents || []) {
      if (obj.Key) {
        out.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified });
      }
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return out;
}

export async function putSnapshot(localPath, key) {
  const stat = await fsp.stat(localPath);
  const Body = fs.createReadStream(localPath);
  const cmd = new PutObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
    Body,
    ContentLength: stat.size,
    ContentType: 'application/x-sqlite3',
    ACL: 'private',
  });
  await withTimeout(getClient().send(cmd), `S3 putSnapshot(${path.basename(localPath)})`);
}

export async function getSnapshot(key, destPath) {
  const cmd = new GetObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
  });
  const res = await withTimeout(getClient().send(cmd), `S3 getSnapshot(${key})`);
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const tmp = `${destPath}.partial`;
  const out = fs.createWriteStream(tmp);
  await new Promise((resolve, reject) => {
    res.Body.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.Body.pipe(out);
  });
  await fsp.rename(tmp, destPath);
}

export async function listSnapshotKeys() {
  return listKeys(SNAPSHOTS_PREFIX);
}

export async function deleteSnapshot(key) {
  const cmd = new DeleteObjectCommand({
    Bucket: process.env.BUCKET_NAME,
    Key: key,
  });
  await withTimeout(getClient().send(cmd), `S3 deleteSnapshot(${key})`);
}

export function snapshotKey(timestamp = new Date()) {
  // ISO 8601 with colons replaced for filesystem-safe + S3-safe characters.
  const iso = timestamp.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return `${SNAPSHOTS_PREFIX}basicbugs-${iso}.sqlite`;
}
