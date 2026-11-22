import type { NextFunction, Request, Response } from 'express';
import { Types, isValidObjectId } from 'mongoose';
import { PERMISSIONS, type Permission } from '../permissions';
import { Role, StaffMembership, Store, User } from '../models';
import { AppError, forbidden, notFound, unauthorized } from '../utils/errors';
import { verifyAccessToken } from '../utils/tokens';

// Platform-level permissions only a Super Admin can ever hold (SRS 8.2)
const PLATFORM_ONLY: Permission[] = ['store.create', 'store.suspend', 'store.delete', 'platform.settings'];

/** Valid access token and an active staff account. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw unauthorized();

  let claims;
  try {
    claims = verifyAccessToken(token);
  } catch {
    throw unauthorized('Session expired');
  }
  // Re-check the account on every request so a disabled user is cut off at once (FR-AC-007).
  // an mfa-step token is not a session
  if ((claims as unknown as { purpose?: string }).purpose) throw unauthorized();
  const user = await User.findById(claims.sub).select('status isSuperAdmin mfaEnabled');
  if (!user || user.status !== 'active') throw unauthorized('Account disabled');
  // A Super Admin without two-step verification can do nothing but set it up (FR-AC-002).
  if (user.isSuperAdmin && !user.mfaEnabled && !req.originalUrl.startsWith('/api/v1/auth/')) {
    throw new AppError(403, 'mfa_setup_required', 'Set up two-step verification to continue.');
  }

  req.auth = { userId: user._id, isSuperAdmin: user.isSuperAdmin };
  next();
}

interface PermissionOptions {
  /** name of the route param holding the store id; omit for platform-level routes */
  storeParam?: string;
}

/**
 * Server-side permission check (FR-AC-001). Order: token valid, user active,
 * membership exists for the requested store, role holds the permission.
 * Super Admin passes every check; inside a store it is flagged for the audit log.
 */
export function requirePermission(permission: Permission, opts: PermissionOptions = {}) {
  if (!PERMISSIONS.includes(permission)) throw new Error(`Unknown permission ${permission}`);

  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) throw unauthorized();

    if (opts.storeParam) {
      const raw = String(req.params[opts.storeParam]);
      if (!isValidObjectId(raw)) throw notFound('Store not found');
      req.storeId = new Types.ObjectId(raw);
    }

    if (req.auth.isSuperAdmin) {
      if (req.storeId) req.viaStoreSwitch = true;
      return next();
    }

    if (PLATFORM_ONLY.includes(permission)) throw forbidden();
    if (!req.storeId) throw forbidden();

    // storeId always comes from the route + membership, never from the request body
    const membership = await StaffMembership.findOne({
      userId: req.auth.userId,
      storeId: req.storeId,
      status: 'active',
    });
    if (!membership) throw forbidden(); // 403 rather than 404: do not reveal which stores exist

    const store = await Store.findById(req.storeId).select('status');
    if (!store || store.status !== 'active') throw forbidden('This store is not active');

    const role = await Role.findById(membership.roleId).select('permissions');
    if (!role?.permissions.includes(permission)) throw forbidden();
    next();
  };
}

/** Any signed-in staff member (no specific permission). */
export const requireAuth = authenticate;
