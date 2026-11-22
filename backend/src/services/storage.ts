import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import '../config/env'; // loads backend/.env for local runs; on Vercel the variables come from the dashboard

// File storage with two interchangeable drivers, chosen by STORAGE_DRIVER:
//   local : files on this machine's disk (development). Images are served at /media, digital files stay private.
//   s3    : any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2...) for production and Vercel, which has
//           no permanent disk. Images go to a public bucket, digital files to a PRIVATE bucket and are only ever
//           handed out as short-lived signed links. Big digital files are uploaded by the browser straight to the
//           bucket (signed upload), because a Vercel function accepts at most about 4.5 MB per request.

const MB = 1024 * 1024;
const driver = (): 'local' | 's3' => (process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local');

export const usesObjectStorage = () => driver() === 's3';
/** Images pass through the API, which on Vercel accepts about 4.5 MB per request. */
export const MAX_IMAGE_BYTES = 4 * MB;
export const MAX_DIGITAL_BYTES = Number(process.env.MAX_DIGITAL_MB ?? (usesObjectStorage() ? 200 : 50)) * MB;

// ---------------------------------------------------------------- local paths
const backendRoot = process.env.BACKEND_ROOT ?? process.cwd();
export const PUBLIC_DIR = path.join(backendRoot, 'storage', 'public');
const PRIVATE_DIR = path.join(backendRoot, 'storage', 'private');
const safeSegment = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');

// ---------------------------------------------------------------- S3
let client: S3Client | undefined;
function s3(): S3Client {
  client ??= new S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' },
  });
  return client;
}
const publicBucket = () => process.env.S3_BUCKET_PUBLIC ?? '';
const privateBucket = () => process.env.S3_BUCKET_PRIVATE ?? '';
/** Where browsers read public images from (a custom domain or the bucket's public address). */
const publicBase = () => (process.env.S3_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

/** Checks the configuration is complete, so a missing variable is reported at start-up, not at the first upload. */
export function assertStorageConfigured() {
  if (!usesObjectStorage()) return;
  const missing = ['S3_BUCKET_PUBLIC', 'S3_BUCKET_PRIVATE', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_BASE_URL'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`STORAGE_DRIVER=s3 needs these environment variables: ${missing.join(', ')}`);
}

// ---------------------------------------------------------------- images
const IMAGE_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
};

/** The real file type is checked from its first bytes, not from the name or the client's claim. */
export function isAllowedImage(mime: string, buffer: Buffer): boolean {
  const t = IMAGE_TYPES[mime];
  return Boolean(t && t.magic(buffer));
}

/** Returns the address to store on the product: "/media/..." locally, a full https address with S3. */
export async function saveImage(storeId: string, mime: string, buffer: Buffer): Promise<string> {
  const name = `${crypto.randomBytes(12).toString('hex')}.${IMAGE_TYPES[mime].ext}`;
  if (usesObjectStorage()) {
    const key = `${safeSegment(storeId)}/${name}`;
    await s3().send(new PutObjectCommand({ Bucket: publicBucket(), Key: key, Body: buffer, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' }));
    return `${publicBase()}/${key}`;
  }
  const dir = path.join(PUBLIC_DIR, safeSegment(storeId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buffer);
  return `/media/${safeSegment(storeId)}/${name}`;
}

export async function deleteImage(url: string): Promise<void> {
  if (usesObjectStorage()) {
    if (!url.startsWith(`${publicBase()}/`)) return; // an external address: nothing of ours to delete
    const key = url.slice(publicBase().length + 1);
    if (/^[a-zA-Z0-9_-]+\/[a-f0-9]+\.[a-z]+$/.test(key)) await s3().send(new DeleteObjectCommand({ Bucket: publicBucket(), Key: key }));
    return;
  }
  const m = /^\/media\/([a-zA-Z0-9_-]+)\/([a-f0-9]+\.[a-z]+)$/.exec(url);
  if (m) await fs.rm(path.join(PUBLIC_DIR, m[1], m[2]), { force: true });
}

// ---------------------------------------------------------------- digital files (always private)
const KEY_RE = /^[a-zA-Z0-9_-]+\/[a-f0-9]+$/;

/** Returns the storage key to keep on the product. */
export async function savePrivate(storeId: string, buffer: Buffer): Promise<string> {
  const key = `${safeSegment(storeId)}/${crypto.randomBytes(16).toString('hex')}`; // random name; the real name stays in the database
  if (usesObjectStorage()) {
    await s3().send(new PutObjectCommand({ Bucket: privateBucket(), Key: key, Body: buffer }));
    return key;
  }
  await fs.mkdir(path.join(PRIVATE_DIR, safeSegment(storeId)), { recursive: true });
  await fs.writeFile(path.join(PRIVATE_DIR, key), buffer);
  return key;
}

export async function deletePrivate(key: string): Promise<void> {
  if (!KEY_RE.test(key)) return;
  if (usesObjectStorage()) return void (await s3().send(new DeleteObjectCommand({ Bucket: privateBucket(), Key: key })));
  await fs.rm(path.join(PRIVATE_DIR, key), { force: true });
}

/** Local driver only: absolute path of a private file. */
export function privatePath(key: string): string {
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
  return path.join(PRIVATE_DIR, key);
}

/** S3 driver only: a 5 minute signed link that downloads the private file under its real name. */
export async function privateDownloadUrl(key: string, filename: string): Promise<string> {
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
  const safe = filename.replace(/["\\\r\n]/g, '_');
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: privateBucket(), Key: key, ResponseContentDisposition: `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}` }),
    { expiresIn: 300 },
  );
}

/** S3 driver only: lets the browser upload one big file straight to the private bucket (10 minute signed link). */
export async function presignPrivateUpload(storeId: string, contentType: string): Promise<{ key: string; uploadUrl: string; headers: Record<string, string> }> {
  const key = `${safeSegment(storeId)}/${crypto.randomBytes(16).toString('hex')}`;
  const uploadUrl = await getSignedUrl(s3(), new PutObjectCommand({ Bucket: privateBucket(), Key: key, ContentType: contentType }), { expiresIn: 600 });
  return { key, uploadUrl, headers: { 'Content-Type': contentType } };
}

/** Size of an uploaded private object, or null when it does not exist. */
export async function privateObjectSize(key: string): Promise<number | null> {
  if (!KEY_RE.test(key)) return null;
  try {
    if (usesObjectStorage()) return (await s3().send(new HeadObjectCommand({ Bucket: privateBucket(), Key: key }))).ContentLength ?? null;
    return (await fs.stat(path.join(PRIVATE_DIR, key))).size;
  } catch {
    return null;
  }
}

export const isPrivateKey = (key: string) => KEY_RE.test(key);
