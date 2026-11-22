import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { authenticate, requirePermission } from '../middleware/auth';
import { StaffMembership, User } from '../models';
import { audit } from '../services/audit';
import { randomToken, sha256 } from '../utils/crypto';
import { badRequest, forbidden, notFound } from '../utils/errors';

// Platform-wide staff accounts. Super Admin only. Mounted at /api/v1/users, so its guard can never touch other routes.
export const usersRouter = Router();
usersRouter.use(authenticate, requirePermission('platform.settings'));

const objectId = z.string().refine(isValidObjectId, 'Not a valid id');

usersRouter.get('/', async (req, res) => {
  const q = z.object({ search: z.string().trim().max(80).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) }).parse(req.query);
  const filter: Record<string, unknown> = { isSuperAdmin: false };
  if (q.search) {
    const rx = new RegExp(q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [users, total] = await Promise.all([
    User.find(filter).select('name email status mfaEnabled lastLoginAt createdAt').sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    User.countDocuments(filter),
  ]);
  const ms = await StaffMembership.find({ userId: { $in: users.map((u) => u._id) } }).populate('storeId', 'name').populate('roleId', 'name').lean();
  res.json({
    items: users.map((u) => ({ ...u, teams: ms.filter((m) => String(m.userId) === String(u._id)).map((m) => ({ store: (m.storeId as any)?.name, role: (m.roleId as any)?.name, status: m.status })) })),
    total, page: q.page, limit: q.limit,
  });
});

async function target(id: string, selfId: unknown) {
  const user = await User.findById(objectId.parse(id)).select('isSuperAdmin status');
  if (!user) throw notFound('User not found');
  if (user.isSuperAdmin || String(user._id) === String(selfId)) throw forbidden('That account cannot be changed here.');
  return user;
}

usersRouter.post('/:id/disable', async (req, res) => {
  const user = await target(req.params.id, req.auth!.userId);
  await User.updateOne({ _id: user._id }, { $set: { status: 'disabled', refreshTokens: [] } }); // signs them out everywhere
  await audit(req, { action: 'user.disable', entity: 'user', entityId: user._id });
  res.json({ ok: true });
});

usersRouter.post('/:id/enable', async (req, res) => {
  const user = await target(req.params.id, req.auth!.userId);
  await User.updateOne({ _id: user._id }, { $set: { status: 'active' } });
  await audit(req, { action: 'user.enable', entity: 'user', entityId: user._id });
  res.json({ ok: true });
});

/** For someone who lost their phone and recovery codes. They will be asked to set up again. */
usersRouter.post('/:id/reset-mfa', async (req, res) => {
  const user = await target(req.params.id, req.auth!.userId);
  await User.updateOne({ _id: user._id }, { $set: { mfaEnabled: false, mfaLastStep: 0, mfaFailures: 0, recoveryCodes: [], refreshTokens: [] }, $unset: { mfaSecret: 1, mfaLockedUntil: 1 } });
  await audit(req, { action: 'user.mfa_reset', entity: 'user', entityId: user._id });
  res.json({ ok: true });
});

usersRouter.post('/:id/reset-link', async (req, res) => {
  const user = await target(req.params.id, req.auth!.userId);
  if (user.status === 'disabled') throw badRequest('Enable the account first.');
  const raw = randomToken(32);
  await User.updateOne({ _id: user._id }, { $set: { inviteTokenHash: sha256(raw), inviteExpiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) } });
  await audit(req, { action: 'user.reset_link', entity: 'user', entityId: user._id });
  res.json({ inviteToken: raw, expiresInDays: 7 });
});
