// Two-step login, passwords, invitations, team and role management, against the real database. Temporary data is removed.
// Start the API on port 4010 first:   PORT=4010 npm run start      then:   npm run test:staff
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { connectDB, disconnectDB } from '../src/db/connect';
import { AuditLog, Role, StaffMembership, Store, User } from '../src/models';
import { encrypt } from '../src/utils/crypto';
import { base32Decode, base32Encode, generateSecret, totpAt, verifyTotp } from '../src/utils/totp';

const API = process.env.TEST_API ?? 'http://localhost:4010';
const base = API + '/api/v1';
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n} ${ok ? '' : '  -> ' + extra}`); };
async function call(method: string, p: string, token?: string, body?: unknown) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

// ---------------------------------------------------------------- TOTP against the RFC 6238 test vectors
const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
check('base32 round trip', base32Decode(rfcSecret).toString() === '12345678901234567890' && rfcSecret === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
check('RFC 6238 vector, t=59 s -> 94287082', totpAt(rfcSecret, 59_000, 8) === '94287082');
check('RFC 6238 vector, t=1111111109 -> 07081804', totpAt(rfcSecret, 1_111_111_109_000, 8) === '07081804');
check('RFC 6238 vector, t=2000000000 -> 69279037', totpAt(rfcSecret, 2_000_000_000_000, 8) === '69279037');
const nowStep = Math.floor(Date.now() / 30000);
check('code accepted one step early and late', verifyTotp(rfcSecret, totpAt(rfcSecret, Date.now() - 30000)) !== null && verifyTotp(rfcSecret, totpAt(rfcSecret, Date.now() + 30000)) !== null);
check('code from 2 steps away rejected', verifyTotp(rfcSecret, totpAt(rfcSecret, Date.now() - 90000)) === null);
check('replay of the same step rejected', verifyTotp(rfcSecret, totpAt(rfcSecret), nowStep) === null);
check('malformed codes rejected', verifyTotp(rfcSecret, '12345') === null && verifyTotp(rfcSecret, 'abcdef') === null && verifyTotp(rfcSecret, '') === null);

// ---------------------------------------------------------------- API
await connectDB();
const tag = 'staff' + Date.now();
const pw = 'Test-' + crypto.randomBytes(8).toString('hex'); const hash = await bcrypt.hash(pw, 10);
const storeA = await Store.create({ name: 'Staff A', subdomain: tag + 'a' });
const storeB = await Store.create({ name: 'Staff B', subdomain: tag + 'b' });
const sidA = String(storeA._id), sidB = String(storeB._id);
const roleId = async (key: string) => String((await Role.findOne({ storeId: null, key }))!._id);
const created: any[] = [];
const mkUser = async (key: string, extra: Record<string, unknown> = {}) => { const u = await User.create({ name: key, email: `${tag}-${key}@test.local`, passwordHash: hash, ...extra }); created.push(u._id); return u; };
const MFA = generateSecret();
const sa = await mkUser('sa', { isSuperAdmin: true, mfaEnabled: true, mfaSecret: encrypt(MFA) });
const saNew = await mkUser('sanew', { isSuperAdmin: true }); // has not set up two-step yet
const email = (k: string) => `${tag}-${k}@test.local`;
async function signIn(k: string, secret = MFA) {
  const r = await call('POST', '/auth/login', undefined, { email: email(k), password: pw });
  if (!r.json?.mfaRequired) return r.json?.accessToken as string;
  return (await call('POST', '/auth/mfa/verify', undefined, { mfaToken: r.json.mfaToken, code: totpAt(secret) })).json?.accessToken as string;
}

try {
  // ---- Super Admin must enrol before anything else
  let r = await call('POST', '/auth/login', undefined, { email: email('sanew'), password: pw });
  const tNew = r.json.accessToken;
  check('Super Admin without two-step gets a session flagged for setup', !!tNew && r.json.user.mfaSetupRequired === true && r.json.mfaRequired === undefined, JSON.stringify(r.json).slice(0, 160));
  r = await call('GET', '/stores', tNew); check('...but is blocked from everything else (mfa_setup_required)', r.status === 403 && r.json.error.code === 'mfa_setup_required', JSON.stringify(r.json));
  r = await call('GET', '/dashboard', tNew); check('...including the dashboard', r.status === 403);
  r = await call('GET', '/auth/me', tNew); check('...but can read their own profile', r.status === 200 && r.json.user.mfaSetupRequired === true);
  r = await call('POST', '/auth/mfa/setup', tNew); const secret = r.json.secret;
  check('setup returns a secret and an otpauth link', r.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && r.json.otpauthUrl.startsWith('otpauth://totp/'), JSON.stringify(r.json));
  r = await call('POST', '/auth/mfa/enable', tNew, { code: '000000' }); check('wrong confirmation code rejected', r.status === 400, r.status + '');
  r = await call('POST', '/auth/mfa/enable', tNew, { code: totpAt(secret) });
  const recovery: string[] = r.json.recoveryCodes;
  check('enable with a right code returns 8 recovery codes', r.status === 200 && recovery.length === 8 && /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(recovery[0]), JSON.stringify(r.json));
  check('recovery codes are stored hashed only', !JSON.stringify(await User.findById(saNew._id).select('+recoveryCodes').lean()).includes(recovery[0]));
  r = await call('GET', '/stores', tNew); check('after enrolling, the same session works', r.status === 200, r.status + '');
  r = await call('POST', '/auth/mfa/disable', tNew, { password: pw, code: totpAt(secret, Date.now() + 30000) }); check('Super Admin cannot turn two-step off', r.status === 403, r.status + '');

  // ---- sign in with two-step
  r = await call('POST', '/auth/login', undefined, { email: email('sanew'), password: pw });
  check('login now asks for a code and gives no session', r.json.mfaRequired === true && !r.json.accessToken, JSON.stringify(Object.keys(r.json)));
  const mfaToken = r.json.mfaToken;
  r = await call('GET', '/stores', mfaToken); check('the code-step token is not a session', r.status === 401, r.status + '');
  r = await call('POST', '/auth/mfa/verify', undefined, { mfaToken, code: '123456' }); check('wrong code -> 401', r.status === 401, r.status + '');
  r = await call('POST', '/auth/mfa/verify', undefined, { mfaToken, code: totpAt(secret, Date.now() + 30000) }); check('right code -> session', r.status === 200 && !!r.json.accessToken && r.json.user.mfaSetupRequired === false, JSON.stringify(r.json).slice(0, 120));
  r = await call('POST', '/auth/mfa/verify', undefined, { mfaToken, code: totpAt(secret, Date.now() + 30000) }); check('the same code cannot be used twice (replay)', r.status === 401, r.status + '');
  r = await call('POST', '/auth/login', undefined, { email: email('sanew'), password: pw });
  r = await call('POST', '/auth/mfa/verify', undefined, { mfaToken: r.json.mfaToken, recoveryCode: recovery[0] }); check('a recovery code signs in', r.status === 200, r.status + '');
  r = await call('POST', '/auth/login', undefined, { email: email('sanew'), password: pw });
  r = await call('POST', '/auth/mfa/verify', undefined, { mfaToken: r.json.mfaToken, recoveryCode: recovery[0] }); check('...but only once', r.status === 401, r.status + '');
  r = await call('POST', '/auth/mfa/verify', undefined, { mfaToken: 'garbage.token.value', code: '123456' }); check('forged code-step token rejected', r.status === 401);

  // ---- lockout after repeated wrong codes (separate user so the admin stays usable)
  const lock = await mkUser('lock', { mfaEnabled: true, mfaSecret: encrypt(MFA) });
  r = await call('POST', '/auth/login', undefined, { email: email('lock'), password: pw }); const lt = r.json.mfaToken;
  for (let i = 0; i < 5; i++) await call('POST', '/auth/mfa/verify', undefined, { mfaToken: lt, code: '000000' });
  r = await call('POST', '/auth/mfa/verify', undefined, { mfaToken: lt, code: totpAt(MFA) }); check('5 wrong codes lock the account, even a right code is refused (429)', r.status === 429 && r.json.error.code === 'mfa_locked', `${r.status} ${JSON.stringify(r.json)}`);

  // ---- passwords
  const tSa = await signIn('sa');
  check('seeded Super Admin signs in with a code', !!tSa);
  r = await call('POST', '/auth/change-password', tSa, { currentPassword: 'wrong-wrong-1234', newPassword: 'Another-Strong-Pass-77' }); check('change password: wrong current -> 401', r.status === 401, r.status + '');
  r = await call('POST', '/auth/change-password', tSa, { currentPassword: pw, newPassword: 'short1' }); check('change password: weak password rejected', r.status === 400, r.status + '');
  r = await call('POST', '/auth/change-password', tSa, { currentPassword: pw, newPassword: `${tag}-sa-password1` }); check('change password: containing the email name rejected', r.status === 400, JSON.stringify(r.json));

  // ---- invitations: Super Admin creates a store and its first admin
  r = await call('POST', `/stores/${sidA}/staff`, tSa, { name: 'Store Admin A', email: email('adminA'), roleId: await roleId('store_admin') });
  const inviteToken = r.json.inviteToken;
  check('Super Admin invites a Store Admin, gets a one-time link', r.status === 201 && r.json.invited === true && inviteToken?.length > 30, JSON.stringify(r.json).slice(0, 100));
  check('invite token stored hashed only', !JSON.stringify(await User.findOne({ email: email('adminA') }).select('+inviteTokenHash').lean()).includes(inviteToken));
  r = await call('POST', '/auth/login', undefined, { email: email('adminA'), password: 'whatever-whatever1' }); check('invited person cannot sign in before accepting', r.status === 401);
  r = await call('POST', '/auth/invite/check', undefined, { token: inviteToken }); check('invite check shows name and email', r.json.email === email('adminA').toLowerCase() && r.json.isNew === true, JSON.stringify(r.json));
  r = await call('POST', '/auth/invite/accept', undefined, { token: inviteToken, password: 'weak' }); check('accepting with a weak password rejected', r.status === 400);
  const adminPw = 'Strong-Pass-' + crypto.randomBytes(5).toString('hex');
  r = await call('POST', '/auth/invite/accept', undefined, { token: inviteToken, password: adminPw }); check('accepting with a good password works', r.status === 200, JSON.stringify(r.json));
  r = await call('POST', '/auth/invite/accept', undefined, { token: inviteToken, password: adminPw + 'x' }); check('the link works only once (410)', r.status === 410, r.status + '');
  r = await call('POST', '/auth/login', undefined, { email: email('adminA'), password: adminPw }); const tAdmin = r.json.accessToken;
  check('new Store Admin signs in (no two-step required for store staff)', !!tAdmin && r.json.user.mfaSetupRequired === false);

  // ---- Store Admin runs their team
  r = await call('GET', `/stores/${sidA}/staff`, tAdmin); check('Store Admin lists the team', r.status === 200 && r.json.items.length === 1 && r.json.items[0].roleId.key === 'store_admin', JSON.stringify(r.json).slice(0, 120));
  r = await call('GET', `/stores/${sidB}/staff`, tAdmin); check("Store Admin cannot see another store's team", r.status === 403);
  r = await call('POST', `/stores/${sidA}/staff`, tAdmin, { name: 'Mina Manager', email: email('mgr'), roleId: await roleId('manager') }); const mgrMembership = r.json.membershipId; const mgrInvite = r.json.inviteToken;
  check('Store Admin invites a Manager', r.status === 201);
  r = await call('POST', `/stores/${sidA}/staff`, tAdmin, { name: 'Dup', email: email('mgr'), roleId: await roleId('manager') }); check('inviting the same person twice -> 409', r.status === 409, r.status + '');
  r = await call('POST', `/stores/${sidA}/staff`, tAdmin, { name: 'Sneaky', email: email('sa'), roleId: await roleId('manager') }); check('a Super Admin account cannot be added as staff', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sidA}/staff`, tAdmin, { name: 'X Y', email: email('x'), roleId: String(new (await import('mongoose')).Types.ObjectId()) }); check('unknown role rejected', r.status === 400, r.status + '');
  r = await call('POST', `/stores/${sidA}/staff`, tAdmin, { name: 'Boss', email: email('boss'), roleId: String((await Role.findOne({ key: 'super_admin' }))!._id) }); check('the platform Super Admin role cannot be handed out', r.status === 400, r.status + '');
  await call('POST', '/auth/invite/accept', undefined, { token: mgrInvite, password: 'Mgr-Pass-' + crypto.randomBytes(5).toString('hex') });
  r = await call('PATCH', `/stores/${sidA}/staff/${mgrMembership}`, tAdmin, { roleId: await roleId('support') }); check('change a role', r.status === 200);
  r = await call('PATCH', `/stores/${sidA}/staff/${mgrMembership}`, tAdmin, { status: 'disabled' }); check('disable a team member', r.status === 200);
  r = await call('PATCH', `/stores/${sidA}/staff/${mgrMembership}`, tAdmin, { status: 'active' }); check('re-enable', r.status === 200);

  // ---- nobody can raise access above their own
  r = await call('POST', `/stores/${sidA}/roles`, tAdmin, { name: 'People Manager', permissions: ['user.manage', 'role.manage', 'product.read'] }); const hrRole = r.json._id;
  check('Store Admin creates a custom role', r.status === 201 && r.json.builtIn === false && r.json.key.startsWith('custom-'), JSON.stringify(r.json).slice(0, 100));
  r = await call('POST', `/stores/${sidA}/roles`, tAdmin, { name: 'Bad', permissions: ['store.create'] }); check('platform permissions cannot be put in a store role', r.status === 400 || r.status === 403, r.status + '');
  r = await call('POST', `/stores/${sidA}/staff`, tAdmin, { name: 'Hana HR', email: email('hr'), roleId: hrRole }); const hrInvite = r.json.inviteToken; const hrMembership = r.json.membershipId;
  const hrPw = 'Hr-Pass-' + crypto.randomBytes(5).toString('hex');
  await call('POST', '/auth/invite/accept', undefined, { token: hrInvite, password: hrPw });
  const tHr = (await call('POST', '/auth/login', undefined, { email: email('hr'), password: hrPw })).json.accessToken;
  r = await call('GET', `/stores/${sidA}/roles`, tHr); const roles = r.json.items;
  check('the lister marks roles above your own as not assignable', r.status === 200 && roles.find((x: any) => x.key === 'store_admin').assignable === false && roles.find((x: any) => x.key === 'content').assignable === false, JSON.stringify(roles.map((x: any) => [x.key, x.assignable])));
  r = await call('POST', `/stores/${sidA}/staff`, tHr, { name: 'Grab Admin', email: email('grab'), roleId: await roleId('store_admin') }); check('a limited manager cannot hand out the Store Admin role (403)', r.status === 403, r.status + '');
  r = await call('POST', `/stores/${sidA}/roles`, tHr, { name: 'Power', permissions: ['product.write'] }); check('...or create a role with permissions they lack (403)', r.status === 403, r.status + '');
  r = await call('PATCH', `/stores/${sidA}/roles/${hrRole}`, tHr, { permissions: ['user.manage', 'role.manage', 'product.read', 'order.refund'] }); check('...or edit their own role (403)', r.status === 403, r.status + '');
  r = await call('PATCH', `/stores/${sidA}/staff/${hrMembership}`, tHr, { roleId: await roleId('manager') }); check('...or change their own membership (403)', r.status === 403, r.status + '');
  r = await call('GET', `/stores/${sidA}/orders`, tHr); check('their role gives no order access (403)', r.status === 403);
  r = await call('DELETE', `/stores/${sidA}/roles/${hrRole}`, tAdmin); check('a role still in use cannot be deleted (409)', r.status === 409, r.status + '');

  // ---- a store always keeps an admin
  const adminMembership = (await StaffMembership.findOne({ storeId: storeA._id, roleId: await roleId('store_admin') }))!._id;
  r = await call('PATCH', `/stores/${sidA}/staff/${adminMembership}`, tSa, { status: 'disabled' }); check('the last Store Admin cannot be disabled (409)', r.status === 409, `${r.status} ${JSON.stringify(r.json)}`);
  r = await call('DELETE', `/stores/${sidA}/staff/${adminMembership}`, tSa); check('...or removed (409)', r.status === 409, r.status + '');
  r = await call('PATCH', `/stores/${sidA}/staff/${adminMembership}`, tAdmin, { status: 'disabled' }); check('nobody can change their own access (403)', r.status === 403);

  // ---- reset links
  r = await call('POST', `/stores/${sidA}/staff/${mgrMembership}/reset-link`, tAdmin); check('Store Admin gets a reset link for a single-store member', r.status === 200 && r.json.inviteToken?.length > 30, r.status + '');
  const resetToken = r.json.inviteToken;
  r = await call('POST', '/auth/invite/check', undefined, { token: resetToken }); check('reset link is for an existing account (isNew false)', r.json.isNew === false);
  const mgrUser = (await User.findOne({ email: email('mgr') }))!;
  await StaffMembership.create({ userId: mgrUser._id, storeId: storeB._id, roleId: await roleId('support') });
  r = await call('POST', `/stores/${sidA}/staff/${mgrMembership}/reset-link`, tAdmin); check('...but not for someone who also works for another store (403)', r.status === 403, r.status + '');

  // ---- platform user list (Super Admin only)
  r = await call('GET', '/users', tAdmin); check('Store Admin cannot list all users (403)', r.status === 403);
  r = await call('GET', `/users?search=${tag}-mgr`, tSa); check('Super Admin lists users with their teams', r.status === 200 && r.json.items.length === 1 && r.json.items[0].teams.length === 2, JSON.stringify(r.json).slice(0, 150));
  await User.updateOne({ _id: mgrUser._id }, { passwordHash: hash });
  const mgrToken = (await call('POST', '/auth/login', undefined, { email: email('mgr'), password: pw })).json.accessToken;
  r = await call('GET', '/stores', mgrToken); check('the member can use their session', r.status === 200);
  r = await call('POST', `/users/${mgrUser._id}/disable`, tSa); check('Super Admin disables a user', r.status === 200);
  r = await call('GET', '/stores', mgrToken); check('...their existing session stops working immediately (401)', r.status === 401, r.status + '');
  r = await call('POST', '/auth/login', undefined, { email: email('mgr'), password: pw }); check('...and they cannot sign in', r.status === 401);
  r = await call('POST', `/users/${mgrUser._id}/enable`, tSa); check('re-enable', r.status === 200);
  r = await call('POST', `/users/${sa._id}/disable`, tSa); check('a Super Admin cannot be disabled from the API (403)', r.status === 403, r.status + '');
  const withMfa = await mkUser('withmfa', { mfaEnabled: true, mfaSecret: encrypt(MFA), refreshTokens: [] });
  r = await call('POST', `/users/${withMfa._id}/reset-mfa`, tSa); check('Super Admin resets a user\'s two-step', r.status === 200 && (await User.findById(withMfa._id).lean())?.mfaEnabled === false);
  check('team and role changes are in the audit log', (await AuditLog.countDocuments({ storeId: storeA._id, action: { $in: ['staff.invite', 'staff.update', 'role.create'] } })) >= 4);
} finally {
  const ids = [storeA._id, storeB._id];
  await StaffMembership.deleteMany({ $or: [{ storeId: { $in: ids } }, { userId: { $in: created } }] });
  await Role.deleteMany({ storeId: { $in: ids } });
  const extra = await User.find({ email: new RegExp(`^${tag}-`) }).select('_id');
  await AuditLog.deleteMany({ $or: [{ storeId: { $in: ids } }, { userId: { $in: [...created, ...extra.map((u) => u._id)] } }] });
  await User.deleteMany({ email: new RegExp(`^${tag}-`) });
  await Store.deleteMany({ _id: { $in: ids } });
  await disconnectDB();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
