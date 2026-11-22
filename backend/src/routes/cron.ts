import crypto from 'node:crypto';
import { Router } from 'express';
import { expireStalePayments } from '../services/payments';
import { notFound, unauthorized } from '../utils/errors';

// Scheduled jobs for hosting without a long-running process (Vercel Cron calls these with
// "Authorization: Bearer <CRON_SECRET>"). Switched off unless CRON_SECRET is set.
export const cronRouter = Router();

function secretOk(header: string | undefined) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw notFound();
  const given = Buffer.from(header?.replace(/^Bearer /i, '') ?? '');
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw unauthorized();
}

/** Closes online orders whose payment never arrived and releases their stock. */
cronRouter.get('/expire-payments', async (req, res) => {
  secretOk(req.get('authorization'));
  res.json({ expired: await expireStalePayments() });
});
