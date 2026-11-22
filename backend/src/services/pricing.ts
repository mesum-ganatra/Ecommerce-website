import type { Types } from 'mongoose';
import { Product } from '../models';

export interface CartInput {
  sku: string;
  quantity: number;
}

export interface PricedLine {
  productId: Types.ObjectId;
  sku: string;
  name: string;
  slug: string;
  type: 'physical' | 'digital';
  attributes: Record<string, string>;
  image: string | null;
  unitPrice: number; // paisa
  compareAtPrice?: number;
  quantity: number;
  lineTotal: number;
  /** how many can still be bought; null = no limit (digital, or backorder allowed) */
  available: number | null;
  allowBackorder: boolean;
}

export interface LineProblem {
  sku: string;
  code: 'unavailable' | 'insufficient_stock';
  message: string;
  available?: number;
}

export interface Pricing {
  lines: PricedLine[];
  problems: LineProblem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  hasPhysical: boolean;
  hasDigital: boolean;
}

interface StoreForPricing {
  _id: Types.ObjectId;
  settings?: { shipping?: { flatRate?: number | null; freeAbove?: number | null } | null } | null;
}

/**
 * Prices a basket from the database. Prices, availability and shipping always come from here,
 * never from the browser, so a customer cannot change what they pay.
 */
export async function priceCart(store: StoreForPricing, input: CartInput[]): Promise<Pricing> {
  // merge repeated SKUs
  const wanted = new Map<string, number>();
  for (const i of input) wanted.set(i.sku, Math.min(99, (wanted.get(i.sku) ?? 0) + i.quantity));

  const products = await Product.find({
    storeId: store._id,
    status: 'active',
    'variants.sku': { $in: [...wanted.keys()] },
  }).lean();

  const lines: PricedLine[] = [];
  const problems: LineProblem[] = [];

  for (const [sku, quantity] of wanted) {
    const product = products.find((p) => p.variants.some((v) => v.sku === sku));
    const variant = product?.variants.find((v) => v.sku === sku);
    if (!product || !variant || !variant.active) {
      problems.push({ sku, code: 'unavailable', message: 'This item is no longer available.' });
      continue;
    }
    const physical = product.type === 'physical';
    const unlimited = !physical || product.allowBackorder;
    const available = unlimited ? null : Math.max(0, (variant.stock ?? 0) - (variant.reservedStock ?? 0));
    if (available !== null && quantity > available) {
      problems.push({
        sku,
        code: 'insufficient_stock',
        available,
        message: available === 0 ? 'Sold out.' : `Only ${available} left.`,
      });
    }
    lines.push({
      productId: product._id,
      sku,
      name: product.name,
      slug: product.slug,
      type: product.type,
      attributes: Object.fromEntries(Object.entries((variant.attributes as unknown as Record<string, string>) ?? {})),
      image: product.images?.[0]?.url ?? null,
      unitPrice: variant.price,
      compareAtPrice: variant.compareAtPrice ?? undefined,
      quantity,
      lineTotal: variant.price * quantity,
      available,
      allowBackorder: Boolean(product.allowBackorder),
    });
  }

  const subtotal = lines.reduce((n, l) => n + l.lineTotal, 0);
  const hasPhysical = lines.some((l) => l.type === 'physical');
  const hasDigital = lines.some((l) => l.type === 'digital');

  // Standard delivery: flat fee, free above a threshold. Digital-only baskets have no shipping.
  const ship = store.settings?.shipping;
  let shipping = 0;
  if (hasPhysical) {
    const flat = ship?.flatRate ?? 0;
    const freeAbove = ship?.freeAbove ?? null;
    shipping = freeAbove !== null && freeAbove > 0 && subtotal >= freeAbove ? 0 : flat;
  }
  const tax = 0; // tax rules are configured per store in a later release
  return { lines, problems, subtotal, shipping, tax, total: subtotal + shipping + tax, hasPhysical, hasDigital };
}
