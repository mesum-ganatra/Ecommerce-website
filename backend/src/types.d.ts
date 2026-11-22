import type { Types } from 'mongoose';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: Types.ObjectId;
        isSuperAdmin: boolean;
      };
      /** set by requirePermission when the request is scoped to a store */
      storeId?: Types.ObjectId;
      /** true when a Super Admin is acting inside a store (audited, FR-AC-006) */
      viaStoreSwitch?: boolean;
    }
  }
}

export {};
