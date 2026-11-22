import { Schema, model } from 'mongoose';
import { PERMISSIONS } from '../permissions';
import { baseOptions, hideOnJSON, storeRef } from './_shared';

// ---- users (staff accounts: Super Admin and store staff). Customers are separate. ----
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    isSuperAdmin: { type: Boolean, default: false },
    mfaSecret: { type: String, select: false }, // encrypted (utils/crypto.ts)
    mfaEnabled: { type: Boolean, default: false },
    mfaLastStep: { type: Number, default: 0 }, // last accepted time step: a code cannot be used twice
    mfaFailures: { type: Number, default: 0 },
    mfaLockedUntil: Date,
    recoveryCodes: { type: [{ _id: false, hash: String, usedAt: Date }], select: false, default: [] },
    // invite / admin-issued reset links: only the hash is stored
    inviteTokenHash: { type: String, select: false },
    inviteExpiresAt: Date,
    passwordChangedAt: Date,
    status: { type: String, enum: ['active', 'disabled', 'invited'], default: 'active' },
    lastLoginAt: Date,
    // Rotating refresh tokens: only hashes are stored (FR-AC-007).
    refreshTokens: {
      type: [{ _id: false, hash: String, expiresAt: Date, createdAt: Date }],
      select: false,
      default: [],
    },
  },
  baseOptions,
);
hideOnJSON(userSchema, 'passwordHash', 'mfaSecret', 'refreshTokens', 'recoveryCodes', 'inviteTokenHash');

// ---- roles: a named set of permission keys (SRS 8.1) ----
const roleSchema = new Schema(
  {
    key: { type: String, required: true }, // super_admin, store_admin, manager...
    name: { type: String, required: true },
    scope: { type: String, enum: ['platform', 'store'], required: true },
    // null = built-in role shared by every store; set = custom role for that store
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', default: null, index: true },
    builtIn: { type: Boolean, default: false },
    permissions: [{ type: String, enum: PERMISSIONS }],
  },
  baseOptions,
);
roleSchema.index({ storeId: 1, key: 1 }, { unique: true });

// ---- staff_memberships: user + store + role (one user can hold different roles per store) ----
const membershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    storeId: storeRef,
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true },
    status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  },
  baseOptions,
);
membershipSchema.index({ userId: 1, storeId: 1 }, { unique: true });

// ---- api_keys: storefront keys, one or more per store. Only the hash is stored. ----
const apiKeySchema = new Schema(
  {
    storeId: storeRef,
    label: { type: String, default: 'Storefront' },
    keyHash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true }, // first characters, to recognise a key in the UI
    lastUsedAt: Date,
    revokedAt: Date,
  },
  baseOptions,
);

export const User = model('User', userSchema);
export const Role = model('Role', roleSchema);
export const StaffMembership = model('StaffMembership', membershipSchema, 'staff_memberships');
export const ApiKey = model('ApiKey', apiKeySchema, 'api_keys');
