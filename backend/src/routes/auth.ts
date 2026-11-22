import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env';
import { authenticate } from '../middleware/auth';
import { StaffMembership, User } from '../models';
import { audit } from '../services/audit';
import { decrypt, encrypt, sha256 } from '../utils/crypto';
import { rateStore } from '../utils/rate-limit-store';
import { AppError, badRequest, forbidden, unauthorized } from '../utils/errors';
import { passwordProblem } from '../utils/password';
import { newRefreshToken, signAccessToken, signMfaToken, verifyMfaToken } from '../utils/tokens';
import { newRecoveryCodes, otpauthUrl, generateSecret, verifyTotp } from '../utils/totp';

export const authRouter = Router();

const REFRESH_COOKIE = 'refresh_token';
const MAX_SESSIONS = 5;
const ISSUER = 'Ecommerce Platform';

const limiter = (name: string, limit: number, message: string) =>
  rateLimit({ windowMs: 15 * 60 * 1000, limit, skipSuccessfulRequests: true, store: rateStore(name), passOnStoreError: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'too_many_attempts', message } } });
const loginLimiter = limiter('login', 10, 'Too many attempts. Try again in a few minutes.');
const mfaLimiter = limiter('mfa', 20, 'Too many attempts. Try again in a few minutes.');

// A real hash to compare against when the email is unknown, so timing does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: env.nodeEnv === 'production', path: '/api/v1/auth', expires: expiresAt });
}

async function issueSession(res: Response, userId: string, isSuperAdmin: boolean, oldHash?: string) {
  const refresh = newRefreshToken();
  const now = new Date();
  const current = await User.findById(userId).select('+refreshTokens').lean();
  if (!current) throw unauthorized();
  type Token = { hash?: string | null; expiresAt?: Date | null; createdAt?: Date | null };
  const existing: Token[] = current.refreshTokens ?? [];
  const kept: Token[] = existing.filter((t) => t.hash !== oldHash && t.expiresAt && t.expiresAt > now);
  kept.push({ hash: refresh.hash, expiresAt: refresh.expiresAt, createdAt: now });
  kept.splice(0, Math.max(0, kept.length - MAX_SESSIONS));
  await User.updateOne({ _id: userId }, { $set: { refreshTokens: kept } });
  setRefreshCookie(res, refresh.token, refresh.expiresAt);
  return signAccessToken({ sub: userId, sa: isSuperAdmin });
}

type U = { id: string; name: string; email: string; isSuperAdmin: boolean; mfaEnabled?: boolean | null };
const publicUser = (u: U) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  isSuperAdmin: u.isSuperAdmin,
  mfaEnabled: Boolean(u.mfaEnabled),
  // the Super Admin must enrol before doing anything else
  mfaSetupRequired: u.isSuperAdmin && !u.mfaEnabled,
});

async function finishLogin(req: Request, res: Response, user: InstanceType<typeof User>) {
  user.lastLoginAt = new Date();
  await user.save();
  const accessToken = await issueSession(res, user.id, user.isSuperAdmin);
  req.auth = { userId: user._id, isSuperAdmin: user.isSuperAdmin };
  await audit(req, { action: 'auth.login', entity: 'user', entityId: user._id });
  res.json({ accessToken, user: publicUser(user) });
}

// ------------------------------------------------------------ sign in
authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1).max(200) }).parse(req.body);
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.status !== 'active') throw unauthorized('Email or password is wrong');

  // password is right; with two-step on, no session yet, only a 5 minute pass to the code screen
  if (user.mfaEnabled) return void res.json({ mfaRequired: true, mfaToken: signMfaToken(user.id) });
  await finishLogin(req, res, user);
});

authRouter.post('/mfa/verify', mfaLimiter, async (req, res) => {
  const body = z.object({ mfaToken: z.string().min(10), code: z.string().trim().max(20).optional(), recoveryCode: z.string().trim().max(20).optional() }).parse(req.body);
  let userId: string;
  try {
    userId = verifyMfaToken(body.mfaToken);
  } catch {
    throw unauthorized('That sign-in expired. Enter your password again.');
  }
  const user = await User.findById(userId).select('+mfaSecret +recoveryCodes');
  if (!user || user.status !== 'active' || !user.mfaEnabled || !user.mfaSecret) throw unauthorized();

  if (user.mfaLockedUntil && user.mfaLockedUntil > new Date()) {
    const mins = Math.ceil((user.mfaLockedUntil.getTime() - Date.now()) / 60000);
    throw new AppError(429, 'mfa_locked', `Too many wrong codes. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }

  let ok = false;
  if (body.code) {
    const step = verifyTotp(decrypt(user.mfaSecret), body.code.replace(/\s/g, ''), user.mfaLastStep ?? 0);
    if (step) {
      ok = true;
      user.mfaLastStep = step;
    }
  } else if (body.recoveryCode) {
    const hash = sha256(body.recoveryCode.trim().toLowerCase());
    const rc = user.recoveryCodes.find((r) => r.hash === hash && !r.usedAt);
    if (rc) {
      rc.usedAt = new Date();
      ok = true;
    }
  }
  if (!ok) {
    user.mfaFailures = (user.mfaFailures ?? 0) + 1;
    if (user.mfaFailures >= 5) {
      user.mfaLockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      user.mfaFailures = 0;
    }
    await user.save();
    req.auth = { userId: user._id, isSuperAdmin: user.isSuperAdmin };
    await audit(req, { action: 'auth.mfa_failed', entity: 'user', entityId: user._id });
    throw unauthorized('That code is not right');
  }
  user.mfaFailures = 0;
  user.mfaLockedUntil = undefined;
  await finishLogin(req, res, user);
});

authRouter.post('/refresh', async (req, res) => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (!token) throw unauthorized();
  const hash = sha256(token);
  const user = await User.findOne({ 'refreshTokens.hash': hash, 'refreshTokens.expiresAt': { $gt: new Date() } }).select('status isSuperAdmin name email mfaEnabled');
  if (!user || user.status !== 'active') {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    throw unauthorized();
  }
  const accessToken = await issueSession(res, user.id, user.isSuperAdmin, hash);
  res.json({ accessToken, user: publicUser(user) });
});

authRouter.post('/logout', async (req, res) => {
  const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
  if (token) await User.updateOne({ 'refreshTokens.hash': sha256(token) }, { $pull: { refreshTokens: { hash: sha256(token) } } });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  res.json({ ok: true });
});

/** The signed-in user with the stores they can access and their role in each. */
authRouter.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.auth!.userId).select('name email isSuperAdmin mfaEnabled');
  if (!user) throw unauthorized();
  const memberships = user.isSuperAdmin
    ? []
    : await StaffMembership.find({ userId: user._id, status: 'active' }).populate('storeId', 'name subdomain status').populate('roleId', 'key name permissions');
  res.json({ user: publicUser(user), memberships: memberships.map((m) => ({ store: m.storeId, role: m.roleId })) });
});

// ------------------------------------------------------------ two-step setup (signed in)
/** Starts enrolment: makes a secret and shows it once. It is not active until a code from the app is confirmed. */
authRouter.post('/mfa/setup', authenticate, async (req, res) => {
  const user = await User.findById(req.auth!.userId).select('email mfaEnabled');
  if (!user) throw unauthorized();
  if (user.mfaEnabled) throw badRequest('Two-step verification is already on.');
  const secret = generateSecret();
  await User.updateOne({ _id: user._id }, { $set: { mfaSecret: encrypt(secret) } });
  res.json({ secret, otpauthUrl: otpauthUrl(user.email, secret, ISSUER) });
});

authRouter.post('/mfa/enable', authenticate, mfaLimiter, async (req, res) => {
  const { code } = z.object({ code: z.string().trim().max(10) }).parse(req.body);
  const user = await User.findById(req.auth!.userId).select('+mfaSecret mfaEnabled');
  if (!user?.mfaSecret) throw badRequest('Start the setup first.');
  if (user.mfaEnabled) throw badRequest('Two-step verification is already on.');
  const step = verifyTotp(decrypt(user.mfaSecret), code.replace(/\s/g, ''));
  if (!step) throw badRequest('That code is not right. Check the time on your phone and try the next code.');
  const codes = newRecoveryCodes();
  user.mfaEnabled = true;
  user.mfaLastStep = step;
  user.mfaFailures = 0;
  user.set('recoveryCodes', codes.map((c) => ({ hash: sha256(c) })));
  await user.save();
  await audit(req, { action: 'auth.mfa_enabled', entity: 'user', entityId: user._id });
  // recovery codes are shown this one time only
  res.json({ recoveryCodes: codes });
});

async function checkPasswordAndCode(userId: unknown, password: string, code: string) {
  const user = await User.findById(userId).select('+passwordHash +mfaSecret mfaEnabled mfaLastStep isSuperAdmin');
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('Your password is not right');
  if (!user.mfaEnabled || !user.mfaSecret) throw badRequest('Two-step verification is not on.');
  const step = verifyTotp(decrypt(user.mfaSecret), code.replace(/\s/g, ''), user.mfaLastStep ?? 0);
  if (!step) throw unauthorized('That code is not right');
  user.mfaLastStep = step;
  return user;
}

authRouter.post('/mfa/disable', authenticate, mfaLimiter, async (req, res) => {
  const { password, code } = z.object({ password: z.string().max(200), code: z.string().max(10) }).parse(req.body);
  const user = await checkPasswordAndCode(req.auth!.userId, password, code);
  if (user.isSuperAdmin) throw forbidden('Super Admin accounts must keep two-step verification on.');
  user.mfaEnabled = false;
  user.mfaSecret = undefined;
  user.set('recoveryCodes', []);
  await user.save();
  await audit(req, { action: 'auth.mfa_disabled', entity: 'user', entityId: user._id });
  res.json({ ok: true });
});

authRouter.post('/mfa/recovery-codes', authenticate, mfaLimiter, async (req, res) => {
  const { password, code } = z.object({ password: z.string().max(200), code: z.string().max(10) }).parse(req.body);
  const user = await checkPasswordAndCode(req.auth!.userId, password, code);
  const codes = newRecoveryCodes();
  user.set('recoveryCodes', codes.map((c) => ({ hash: sha256(c) })));
  await user.save();
  await audit(req, { action: 'auth.recovery_codes_regenerated', entity: 'user', entityId: user._id });
  res.json({ recoveryCodes: codes });
});

// ------------------------------------------------------------ password
authRouter.post('/change-password', authenticate, mfaLimiter, async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }).parse(req.body);
  const user = await User.findById(req.auth!.userId).select('+passwordHash email isSuperAdmin');
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw unauthorized('Your current password is not right');
  const problem = passwordProblem(newPassword, user.email);
  if (problem) throw badRequest(problem);
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.passwordChangedAt = new Date();
  await user.save();
  // sign out every other device, keep this one
  await User.updateOne({ _id: user._id }, { $set: { refreshTokens: [] } });
  const accessToken = await issueSession(res, user.id, user.isSuperAdmin);
  await audit(req, { action: 'auth.password_changed', entity: 'user', entityId: user._id });
  res.json({ accessToken });
});

// ------------------------------------------------------------ invitations and admin-issued reset links
const inviteLimiter = limiter('invite', 30, 'Too many attempts. Try again later.');

async function findByInvite(token: string) {
  return User.findOne({ inviteTokenHash: sha256(token), inviteExpiresAt: { $gt: new Date() }, status: { $in: ['invited', 'active'] } }).select('+inviteTokenHash name email status');
}

authRouter.post('/invite/check', inviteLimiter, async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
  const user = await findByInvite(token);
  if (!user) throw new AppError(410, 'invite_invalid', 'This link has expired or was already used. Ask your admin for a new one.');
  res.json({ name: user.name, email: user.email, isNew: user.status === 'invited' });
});

authRouter.post('/invite/accept', inviteLimiter, async (req, res) => {
  const { token, password } = z.object({ token: z.string().min(20).max(200), password: z.string().max(200) }).parse(req.body);
  const user = await findByInvite(token);
  if (!user) throw new AppError(410, 'invite_invalid', 'This link has expired or was already used. Ask your admin for a new one.');
  const problem = passwordProblem(password, user.email);
  if (problem) throw badRequest(problem);
  user.passwordHash = await bcrypt.hash(password, 12);
  user.passwordChangedAt = new Date();
  user.status = 'active';
  user.inviteTokenHash = undefined;
  user.inviteExpiresAt = undefined;
  user.set('refreshTokens', []);
  await user.save();
  req.auth = { userId: user._id, isSuperAdmin: false };
  await audit(req, { action: 'auth.invite_accepted', entity: 'user', entityId: user._id });
  res.json({ ok: true, email: user.email });
});
