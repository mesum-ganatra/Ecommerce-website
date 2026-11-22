export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  mfaEnabled?: boolean;
  /** the Super Admin must set up two-step verification before using anything else */
  mfaSetupRequired?: boolean;
}

export type StoreStatus = 'active' | 'suspended' | 'archived';
export type StoreType = 'native' | 'external';

export interface Courier {
  name: string;
  code: string;
  trackingUrlTemplate?: string;
  active: boolean;
}

export interface StoreSummary {
  _id: string;
  name: string;
  subdomain: string;
  status: StoreStatus;
  type: StoreType;
  platform: string;
  currency: string;
  lastSyncAt?: string;
  createdAt: string;
}

export interface Store extends StoreSummary {
  logoUrl?: string;
  settings: {
    returnWindowDays: number;
    lowStockThreshold: number;
    cod: { enabled: boolean; maxOrderAmount?: number };
    shipping?: { flatRate?: number; freeAbove?: number };
    couriers: Courier[];
    theme?: { accentColor?: string; tagline?: string; bannerUrl?: string };
  };
}

export interface ApiKeyRow {
  _id: string;
  label: string;
  prefix: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface DashboardData {
  stores: { active: number; suspended: number; native: number; external: number };
  staff: number;
  customers: number;
  products: number;
  orders: number;
}

export interface AuditRow {
  _id: string;
  action: string;
  entity?: string;
  entityId?: string;
  createdAt: string;
  ip?: string;
  viaStoreSwitch?: boolean;
  userId?: { name: string; email: string } | null;
  storeId?: { name: string; subdomain: string } | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Category {
  _id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  sortOrder: number;
  active: boolean;
  productCount: number;
}

export interface ProductRow {
  _id: string;
  name: string;
  slug: string;
  type: 'physical' | 'digital';
  status: 'draft' | 'active' | 'archived';
  brand?: string;
  category: { _id: string; name: string } | null;
  image: string | null;
  variantCount: number;
  priceMin: number;
  priceMax: number;
  stock: number | null;
  lowStock: boolean;
  updatedAt: string;
}

export interface Variant {
  _id?: string;
  sku: string;
  attributes: Record<string, string>;
  price: number; // paisa
  compareAtPrice?: number;
  stock: number;
  reservedStock?: number;
  barcode?: string;
  weightGrams?: number;
  active: boolean;
}

export interface ProductDetail {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  brand?: string;
  categoryId?: string | null;
  type: 'physical' | 'digital';
  status: 'draft' | 'active' | 'archived';
  images: { url: string; alt?: string }[];
  variants: Variant[];
  digitalFiles: { _id: string; name: string; sizeBytes?: number }[];
  allowBackorder: boolean;
  download?: { expiryDays?: number; downloadLimit?: number };
  seo?: { title?: string; description?: string };
}

export interface StockMovement {
  _id: string;
  sku: string;
  delta: number;
  balanceAfter: number;
  reason: string;
  note?: string;
  createdAt: string;
  userId?: { name: string } | null;
}

export interface OrderRow {
  _id: string;
  needsAttention?: boolean;
  number: number;
  status: string;
  paymentStatus: string;
  paymentMethod?: string;
  customer: string;
  phone: string;
  city: string | null;
  itemCount: number;
  total: number;
  hasDigital: boolean;
  createdAt: string;
}

export interface OrderDetail {
  _id: string;
  number: number;
  status: string;
  paymentStatus: string;
  paymentMethod?: string;
  guest?: { name?: string; phone?: string; email?: string };
  items: { sku: string; name: string; type: string; attributes: Record<string, string>; unitPrice: number; quantity: number; lineTotal: number }[];
  shippingAddress?: { fullName?: string; phone?: string; line1?: string; line2?: string; city?: string; province?: string; postalCode?: string };
  totals: { subtotal: number; discount: number; shipping: number; tax: number; total: number };
  note?: string;
  courierCode?: string;
  statusHistory: { status: string; at: string; note?: string; by?: { name: string } | null }[];
  createdAt: string;
  shipment?: { courierCode?: string; trackingNumber?: string; status: string; shippedAt?: string; codAmount?: number; codCollected?: boolean } | null;
  payment?: { gateway: string; status: string; amount: number } | null;
  couriers: { name: string; code: string }[];
  nextStatuses: string[];
  canCancel: boolean;
  canCollectCod: boolean;
  needsAttention?: boolean;
}

export interface TeamMember {
  _id: string;
  status: 'active' | 'disabled';
  userId: { _id: string; name: string; email: string; status: string; mfaEnabled?: boolean; lastLoginAt?: string };
  roleId: { _id: string; key: string; name: string };
}

export interface RoleRow {
  _id: string;
  key: string;
  name: string;
  builtIn: boolean;
  permissions: string[];
  assignable: boolean;
}

export interface UserRow {
  _id: string;
  name: string;
  email: string;
  status: 'active' | 'disabled' | 'invited';
  mfaEnabled?: boolean;
  lastLoginAt?: string;
  teams: { store?: string; role?: string; status?: string }[];
}

export interface PaymentGatewayRow {
  gateway: string;
  label: string;
  verified: boolean;
  canGoLive: boolean;
  fields: { key: string; label: string; secret: boolean; required: boolean; hint?: string }[];
  values: Record<string, string>;
  configured: boolean;
  enabled: boolean;
  mode: 'sandbox' | 'live';
  returnUrl: string;
}

export interface Analytics {
  days: number;
  totals: { revenue: number; orders: number; average: number; previous: { revenue: number; orders: number } };
  series: { date: string; revenue: number; orders: number }[];
  byStatus: { status: string; count: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  payments: { method: string; orders: number; revenue: number }[];
  topStores: { id: string; name: string; subdomain?: string; revenue: number; orders: number }[];
  alerts: { pending: number; awaitingPayment: number; attention: number; lowStock: number };
}
