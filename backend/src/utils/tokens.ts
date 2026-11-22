import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { randomToken, sha256 } from './crypto';

export interface AccessClaims {
  sub: string; // user id
  sa: boolean; // isSuperAdmin
}

function accessSecret() {
  if (env.jwtAccessSecret.length < 32) throw new Error('JWT_ACCESS_SECRET must be at least 32 characters (backend/.env).');
  return env.jwtAccessSecret;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, accessSecret(), { expiresIn: `${env.accessTokenMinutes}m`, issuer: 'ecomm-api' });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, accessSecret(), { issuer: 'ecomm-api' }) as unknown as AccessClaims;
}

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
export function newRefreshToken() {
  const token = randomToken(48);
  return {
    token,
    hash: sha256(token),
    expiresAt: new Date(Date.now() + env.refreshTokenDays * 24 * 3600 * 1000),
  };
}

/** Short-lived proof that the password step passed; only good for the two-step code screen. */
export function signMfaToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: 'mfa' }, accessSecret(), { expiresIn: '5m', issuer: 'ecomm-api' });
}

export function verifyMfaToken(token: string): string {
  const c = jwt.verify(token, accessSecret(), { issuer: 'ecomm-api' }) as unknown as { sub: string; purpose?: string };
  if (c.purpose !== 'mfa') throw new Error('wrong token type');
  return c.sub;
}

/** A 5 minute, single-purpose link token for downloading one purchased file. */
export function signDownloadToken(accessId: string): string {
  return jwt.sign({ sub: accessId, purpose: 'download' }, accessSecret(), { expiresIn: '5m', issuer: 'ecomm-api' });
}

export function verifyDownloadToken(token: string): string {
  const c = jwt.verify(token, accessSecret(), { issuer: 'ecomm-api' }) as unknown as { sub: string; purpose?: string };
  if (c.purpose !== 'download') throw new Error('wrong token type');
  return c.sub;
}
