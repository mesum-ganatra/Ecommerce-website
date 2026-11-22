import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditLog } from '../models';

interface AuditInput {
  action: string; // e.g. store.create, apikey.revoke
  entity?: string;
  entityId?: string | Types.ObjectId;
  storeId?: Types.ObjectId | string | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only record of a sensitive action. Never throws: auditing must not break the request. */
export async function audit(req: Request, input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      userId: req.auth?.userId,
      storeId: input.storeId ?? req.storeId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ? String(input.entityId) : undefined,
      before: input.before,
      after: input.after,
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 200),
      viaStoreSwitch: req.viaStoreSwitch ?? false,
    });
  } catch (err) {
    console.error('audit log failed', err);
  }
}
