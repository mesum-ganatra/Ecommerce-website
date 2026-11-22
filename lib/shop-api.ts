// Server-side helpers for the storefront (Server Components). The browser side uses lib/api.ts.
const API = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export interface ShopStore {
  name: string;
  subdomain: string;
  logoUrl: string | null;
  currency: string;
  cod: { enabled: boolean; maxOrderAmount: number | null };
  shipping: { flatRate: number; freeAbove: number | null };
  returnWindowDays: number;
  theme?: { accentColor: string | null; tagline: string | null; bannerUrl: string | null };
}

export interface ShopCategory {
  _id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  productCount: number;
}

export interface ShopProductCard {
  name: string;
  slug: string;
  type: 'physical' | 'digital';
  brand: string | null;
  image: string | null;
  image2?: string | null;
  quickAddSku?: string | null;
  imageAlt: string;
  priceMin: number;
  priceMax: number;
  onSale: boolean;
  inStock: boolean;
}

export interface ShopVariant {
  sku: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice: number | null;
  inStock: boolean;
  maxQuantity: number;
  fewLeft: boolean;
}

export interface ShopProduct extends ShopProductCard {
  description: string;
  images: { url: string; alt: string }[];
  category: { name: string; slug: string } | null;
  seo: { title: string; description: string };
  variants: ShopVariant[];
}

export interface ShopPage<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export type ShopResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export async function shopGet<T>(sub: string, path: string, revalidate = 30): Promise<ShopResult<T>> {
  try {
    const res = await fetch(`${API}/shop/${encodeURIComponent(sub)}${path}`, { next: { revalidate } });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: json?.error?.message ?? 'Something went wrong' };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, message: 'The shop is temporarily unreachable.' };
  }
}
