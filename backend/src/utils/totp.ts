import crypto from 'node:crypto';

// Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s), compatible with Google Authenticator,
// Microsoft Authenticator, Authy and 1Password. Written with Node's crypto only (no extra dependency).

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const totpAt = (secretB32: string, timeMs = Date.now(), digits = 6) => hotp(base32Decode(secretB32), Math.floor(timeMs / 1000 / STEP), digits);

/**
 * Returns the time step the code matched, or null. A code is accepted a step early or late (clock drift),
 * and never twice: a step at or below `lastStep` is rejected, so a captured code cannot be replayed.
 */
export function verifyTotp(secretB32: string, code: string, lastStep = 0, timeMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32);
  const now = Math.floor(timeMs / 1000 / STEP);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

export const otpauthUrl = (account: string, secretB32: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Ten-character one-time recovery codes like "k7f3-9xqa". */
export function newRecoveryCodes(n = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: n }, () => {
    const bytes = crypto.randomBytes(8);
    const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}
