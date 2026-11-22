import Link from 'next/link';
import { mediaUrl } from '@/lib/api';
import { priceRange, rs } from '@/lib/format';
import type { ShopProductCard } from '@/lib/shop-api';
import { QuickAdd } from './quick-add';

// The main button uses the store's own accent colour (--accent), set per store in Admin > Appearance.
export const shopButton =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:active:scale-100';
export const shopButtonOutline =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-slate-300 bg-surface px-6 py-3 text-sm font-semibold text-slate-900 transition-all duration-150 hover:border-ink hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50';
export const shopInput =
  'block w-full rounded-xl border border-slate-300 bg-surface px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-4 focus:ring-[color-mix(in_oklab,var(--accent)_18%,transparent)]';

export function Price({ price, compareAt, className = '' }: { price: number; compareAt?: number | null; className?: string }) {
  return (
    <span className={className}>
      <span className="font-semibold text-slate-900">{rs(price)}</span>
      {compareAt && compareAt > price && <span className="ml-2 text-sm text-slate-500 line-through">{rs(compareAt)}</span>}
    </span>
  );
}

export function ProductCard({ product, base }: { product: ShopProductCard; base: string }) {
  const from = product.priceMin !== product.priceMax;
  return (
    <div className="group/card relative">
      <Link href={`${base}/products/${product.slug}`} className="group block">
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-slate-100 ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-lg">
          {product.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(product.image)} alt={product.imageAlt || product.name} loading="lazy" className={`h-full w-full object-cover transition-all duration-500 ${product.image2 ? 'group-hover:opacity-0' : 'group-hover:scale-105'}`} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">No photo</div>
          )}
          {product.image2 && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaUrl(product.image2)} alt="" loading="lazy" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          )}
          <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1.5">
            {product.onSale && <span className="rounded-md bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Sale</span>}
            {product.type === 'digital' && <span className="rounded-full bg-surface/90 px-2.5 py-0.5 text-xs font-medium text-slate-800 backdrop-blur">Digital</span>}
          </div>
          {!product.inStock && <div className="absolute inset-0 flex items-center justify-center bg-surface/65 text-sm font-semibold text-slate-800">Sold out</div>}
        </div>
        <div className="mt-3.5 px-0.5">
          {product.brand && <div className="text-xs uppercase tracking-wide text-slate-500">{product.brand}</div>}
          <h3 className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-slate-900">{product.name}</h3>
          <div className={`mt-1 text-sm font-semibold ${product.onSale ? 'text-red-600' : 'text-slate-900'}`}>{from && <span className="mr-1 font-normal text-slate-500">from</span>}{from ? rs(product.priceMin) : priceRange(product.priceMin, product.priceMax)}</div>
        </div>
      </Link>
      {product.quickAddSku && <QuickAdd sku={product.quickAddSku} name={product.name} />}
    </div>
  );
}
