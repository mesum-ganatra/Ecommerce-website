// The fixed permission list (SRS section 8). Roles store these keys in
// `roles.permissions`; there is deliberately no `permissions` collection.

export const PERMISSIONS = [
  // platform level (Super Admin only)
  'store.create',
  'store.suspend',
  'store.delete',
  'platform.settings',
  // store level
  'store.settings',
  'store.connect',
  'sync.run',
  'sync.view_logs',
  'apikey.manage',
  'payment.credentials',
  'user.manage',
  'role.manage',
  'product.read',
  'product.write', // create, edit, delete
  'stock.adjust',
  'order.read',
  'order.update',
  'order.cancel',
  'order.refund',
  'customer.read',
  'customer.block',
  'coupon.manage',
  'shipping.manage',
  'tax.manage',
  'cms.manage',
  'review.moderate',
  'report.view',
  'audit.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const PLATFORM_ONLY: Permission[] = ['store.create', 'store.suspend', 'store.delete', 'platform.settings'];
const STORE_LEVEL = PERMISSIONS.filter((p) => !PLATFORM_ONLY.includes(p));

export interface DefaultRole {
  key: string;
  name: string;
  scope: 'platform' | 'store';
  permissions: Permission[];
}

/** Built-in roles, from the matrix in SRS section 8.2. Customers are not staff and have no role. */
export const DEFAULT_ROLES: DefaultRole[] = [
  { key: 'super_admin', name: 'Super Admin', scope: 'platform', permissions: [...PERMISSIONS] },
  { key: 'store_admin', name: 'Store Admin', scope: 'store', permissions: STORE_LEVEL },
  {
    key: 'manager',
    name: 'Manager',
    scope: 'store',
    permissions: [
      'product.read', 'product.write', 'stock.adjust',
      'order.read', 'order.update', 'order.cancel', 'order.refund',
      'customer.read', 'customer.block',
      'coupon.manage', 'shipping.manage', 'tax.manage', 'cms.manage', 'review.moderate', 'report.view',
    ],
  },
  {
    key: 'inventory',
    name: 'Inventory Staff',
    scope: 'store',
    permissions: ['product.read', 'product.write', 'stock.adjust', 'order.read'],
  },
  {
    key: 'support',
    name: 'Support Staff',
    scope: 'store',
    permissions: [
      'product.read', 'order.read', 'order.update', 'order.cancel',
      'customer.read', 'customer.block', 'review.moderate',
    ],
  },
  {
    key: 'content',
    name: 'Content Editor',
    scope: 'store',
    permissions: ['product.read', 'cms.manage', 'review.moderate'],
  },
];
