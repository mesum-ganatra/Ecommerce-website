import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import { isValidObjectId, type Types } from 'mongoose';
import { z } from 'zod';
import { requirePermission } from '../middleware/auth';
import { PERMISSIONS, type Permission } from '../permissions';
import { Role, StaffMembership, User } from '../models';
import { audit } from '../services/audit';
import { randomToken, sha256 } from '../utils/crypto';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';

// Store team management. Mounted at /api/v1/stores/:storeId (see app.ts).
export const staffRouter = Router({ mergeParams: true });
const scope = { storeParam: 'storeId' };
const objectId = z.string().refine(isValidObjectId, 'Not a valid id');

const PLATFORM_ONLY: Permission[] = ['store.create', 'store.suspend', 'store.delete', 'platform.settings'];
const STORE_PERMS = PERMISSIONS.filter((p) => !PLATFORM_ONLY.includes(p));
const INVITE_DAYS = 7;

/** What the person making the request may hand out: Super Admin everything store-level, others only their own role's permissions. */
async function actorPerms(req: Request): Promise<Set<string>> {
  if (req.auth!.isSuperAdmin) return new Set(STORE_PERMS);
  const m = await StaffMembership.findOne({ userId: req.auth!.userId, storeId: req.storeId, status: 'active' });
  const role = m && (await Role.findById(m.roleId).select('permissions'));
  return new Set(role?.permissions ?? []);
}

function assertGrantable(have: Set<string>, wanted: readonly string[]) {
  if (wanted.some((p) => !have.has(p) || PLATFORM_ONLY.includes(p as Permission))) {
    throw forbidden('You cannot give a role more access than you have yourself.');
  }
}

/** Roles a store may use: the built-in store roles and its own custom ones. */
const roleFor = (storeId: Types.ObjectId | undefined, roleId: string) => Role.findOne({ _id: roleId, scope: 'store', $or: [{ storeId: null }, { storeId }] });

async function otherActiveStoreAdmins(storeId: Types.ObjectId | undefined, excludeMembershipId: Types.ObjectId) {
  const admin = await Role.findOne({ storeId: null, key: 'store_admin' }).select('_id');
  return StaffMembership.countDocuments({ storeId, roleId: admin?._id, status: 'active', _id: { $ne: excludeMembershipId } });
}

/** A store must always keep at least one active Store Admin (FR-AC-004). */
async function assertNotLastAdmin(storeId: Types.ObjectId | undefined, m: { _id: Types.ObjectId; roleId: Types.ObjectId; status?: string | null }) {
  const admin = await Role.findOne({ storeId: null, key: 'store_admin' }).select('_id');
  if (String(m.roleId) !== String(admin?._id) || m.status !== 'active') return;
  if ((await otherActiveStoreAdmins(storeId, m._id)) === 0) throw conflict('This is the only Store Admin. Make someone else a Store Admin first.');
}

function newInvite() {
  const raw = randomToken(32);
  return { raw, hash: sha256(raw), expires: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000) };
}

// ------------------------------------------------------------ list team and roles
staffRouter.get('/staff', requirePermission('user.manage', scope), async (req, res) => {
  const items = await StaffMembership.find({ storeId: req.storeId })
    .populate('userId', 'name email status mfaEnabled lastLoginAt')
    .populate('roleId', 'key name')
    .sort({ createdAt: 1 })
    .lean();
  res.json({ items: items.filter((m) => m.userId) });
});

staffRouter.get('/roles', requirePermission('user.manage', scope), async (req, res) => {
  const have = await actorPerms(req);
  const roles = await Role.find({ scope: 'store', $or: [{ storeId: null }, { storeId: req.storeId }] }).sort({ builtIn: -1, name: 1 }).lean();
  res.json({
    items: roles.map((r) => ({ _id: r._id, key: r.key, name: r.name, builtIn: r.builtIn, permissions: r.permissions, assignable: r.permissions.every((p) => have.has(p)) })),
    grantable: STORE_PERMS.filter((p) => have.has(p)),
  });
});

// ------------------------------------------------------------ add a person
staffRouter.post('/staff', requirePermission('user.manage', scope), async (req, res) => {
  const body = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email().max(120), roleId: objectId }).parse(req.body);
  const role = await roleFor(req.storeId, body.roleId);
  if (!role) throw badRequest('Choose a role for this store.');
  assertGrantable(await actorPerms(req), role.permissions);

  const existing = await User.findOne({ email: body.email }).select('isSuperAdmin status');
  if (existing?.isSuperAdmin) throw badRequest('That email cannot be added as store staff.');
  if (existing?.status === 'disabled') throw badRequest('That account is disabled. Ask the Super Admin.');

  if (existing) {
    if (await StaffMembership.exists({ userId: existing._id, storeId: req.storeId })) throw conflict('That person is already on this team.');
    const m = await StaffMembership.create({ userId: existing._id, storeId: req.storeId, roleId: role._id });
    await audit(req, { action: 'staff.add', entity: 'membership', entityId: m._id, after: { email: body.email, role: role.key } });
    return void res.status(201).json({ membershipId: m._id, invited: false });
  }

  const invite = newInvite();
  const user = await User.create({
    name: body.name,
    email: body.email,
    status: 'invited',
    // nobody knows this password; the person sets their own through the invite link
    passwordHash: await bcrypt.hash(randomToken(24), 10),
    inviteTokenHash: invite.hash,
    inviteExpiresAt: invite.expires,
  });
  const m = await StaffMembership.create({ userId: user._id, storeId: req.storeId, roleId: role._id });
  await audit(req, { action: 'staff.invite', entity: 'membership', entityId: m._id, after: { email: body.email, role: role.key } });
  // The link is shown to the admin once. Share it with the person (email sending comes later).
  res.status(201).json({ membershipId: m._id, invited: true, inviteToken: invite.raw, expiresInDays: INVITE_DAYS });
});

// ------------------------------------------------------------ change role / disable / remove
async function loadMembership(req: Request, id: string) {
  const m = await StaffMembership.findOne({ _id: objectId.parse(id), storeId: req.storeId });
  if (!m) throw notFound('Team member not found');
  if (String(m.userId) === String(req.auth!.userId)) throw forbidden('You cannot change your own access.');
  return m;
}

staffRouter.patch('/staff/:membershipId', requirePermission('user.manage', scope), async (req, res) => {
  const body = z.object({ roleId: objectId.optional(), status: z.enum(['active', 'disabled']).optional() }).strict().parse(req.body);
  const m = await loadMembership(req, String(req.params.membershipId));

  if (body.roleId && body.roleId !== String(m.roleId)) {
    const role = await roleFor(req.storeId, body.roleId);
    if (!role) throw badRequest('Choose a role for this store.');
    assertGrantable(await actorPerms(req), role.permissions);
    await assertNotLastAdmin(req.storeId, m); // moving the last Store Admin to another role
    m.roleId = role._id;
  }
  if (body.status && body.status !== m.status) {
    if (body.status === 'disabled') await assertNotLastAdmin(req.storeId, m);
    m.status = body.status;
  }
  await m.save();
  await audit(req, { action: 'staff.update', entity: 'membership', entityId: m._id, after: body });
  res.json({ ok: true });
});

staffRouter.delete('/staff/:membershipId', requirePermission('user.manage', scope), async (req, res) => {
  const m = await loadMembership(req, String(req.params.membershipId));
  await assertNotLastAdmin(req.storeId, m);
  await m.deleteOne();
  // an invited person with no team left has nothing to come back to
  if (!(await StaffMembership.exists({ userId: m.userId }))) await User.deleteOne({ _id: m.userId, status: 'invited' });
  await audit(req, { action: 'staff.remove', entity: 'membership', entityId: m._id });
  res.json({ ok: true });
});

/** A new password link. Only for people who work for this store alone, so a store admin cannot take over an account used elsewhere. */
staffRouter.post('/staff/:membershipId/reset-link', requirePermission('user.manage', scope), async (req, res) => {
  const m = await loadMembership(req, String(req.params.membershipId));
  const user = await User.findById(m.userId).select('isSuperAdmin status');
  if (!user || user.isSuperAdmin) throw forbidden();
  if (await StaffMembership.exists({ userId: m.userId, storeId: { $ne: req.storeId } })) {
    throw forbidden('This person also works for another store. Ask the Super Admin to reset their password.');
  }
  if (user.status === 'disabled') throw badRequest('This account is disabled.');
  const invite = newInvite();
  await User.updateOne({ _id: user._id }, { $set: { inviteTokenHash: invite.hash, inviteExpiresAt: invite.expires } });
  await audit(req, { action: 'staff.reset_link', entity: 'membership', entityId: m._id });
  res.json({ inviteToken: invite.raw, expiresInDays: INVITE_DAYS });
});

// ------------------------------------------------------------ custom roles
const roleBody = z.object({ name: z.string().trim().min(2).max(60), permissions: z.array(z.enum(PERMISSIONS)).max(40) });

staffRouter.post('/roles', requirePermission('role.manage', scope), async (req, res) => {
  const body = roleBody.parse(req.body);
  assertGrantable(await actorPerms(req), body.permissions);
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'role';
  const role = await Role.create({ key: `custom-${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, name: body.name, scope: 'store', storeId: req.storeId, builtIn: false, permissions: [...new Set(body.permissions)] });
  await audit(req, { action: 'role.create', entity: 'role', entityId: role._id, after: { name: role.name, permissions: role.permissions } });
  res.status(201).json(role);
});

staffRouter.patch('/roles/:roleId', requirePermission('role.manage', scope), async (req, res) => {
  const roleId = objectId.parse(req.params.roleId);
  const body = roleBody.partial().strict().parse(req.body);
  const role = await Role.findOne({ _id: roleId, storeId: req.storeId, builtIn: false });
  if (!role) throw notFound('Custom role not found');
  // nobody may edit the role they hold themselves (that would be a way to raise their own access)
  const mine = await StaffMembership.exists({ userId: req.auth!.userId, storeId: req.storeId, roleId });
  if (mine) throw forbidden('You cannot edit the role you hold.');
  if (body.permissions) {
    assertGrantable(await actorPerms(req), body.permissions);
    role.set('permissions', [...new Set(body.permissions)]);
  }
  if (body.name) role.name = body.name;
  await role.save();
  await audit(req, { action: 'role.update', entity: 'role', entityId: role._id, after: body });
  res.json(role);
});

staffRouter.delete('/roles/:roleId', requirePermission('role.manage', scope), async (req, res) => {
  const roleId = objectId.parse(req.params.roleId);
  const role = await Role.findOne({ _id: roleId, storeId: req.storeId, builtIn: false });
  if (!role) throw notFound('Custom role not found');
  if (await StaffMembership.exists({ roleId })) throw conflict('Some team members still have this role. Change their role first.');
  await role.deleteOne();
  await audit(req, { action: 'role.delete', entity: 'role', entityId: roleId });
  res.json({ ok: true });
});
