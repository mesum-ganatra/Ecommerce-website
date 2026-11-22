import crypto from 'node:crypto';
import { env } from '../config/env';

// AES-256-GCM for secrets stored in the database (gateway credentials,
// external-store API credentials, MFA secrets). The key lives in the
// environment, never in the database.

function key(): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(env.encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes). See backend/.env.example.');
  }
  return Buffer.from(env.encryptionKey, 'hex');
}

/** Returns "iv.tag.ciphertext", each part base64. */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !data) throw new Error('Malformed encrypted value.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function encryptJSON(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJSON<T = unknown>(payload: string): T {
  return JSON.parse(decrypt(payload)) as T;
}

/** For API keys: only the hash is stored. */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
