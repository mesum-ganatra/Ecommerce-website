import { ArrowRight, CreditCard, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import Link from 'next/link';
import { ProductCard } from '@/components/shop/ui';
import { mediaUrl } from '@/lib/api';
import { rs } from '@/lib/format';
import { shopBase } from '@/lib/shop-base';
import { shopGet, type ShopCategory, type ShopPage, type ShopProductCard, type ShopStore } from '@/lib/shop-api';

const TILE_GRADIENTS = [
  'from-indigo-500 to-violet-600', 'from-emerald-500 to-teal-600', 'from-orange-500 to-rose-500', 'from-sky-500 to-indigo-600', 'from-fuchsia-500 to-pink-600', 'from-amber-500 to-orange-600',
];

function Section({ id, title, href, children, hrefLabel = 'View all' }: { id: string; title: string; href?: string; hrefLabel?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="animate-rise">
      <div className="mb-5 flex items-end justify-between">
        <h2 id={id} className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>
        {href && <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">{hrefLabel} <ArrowRight size={14} /></Link>}
      </div>
      {children}
    </section>
  );
}

export default async function ShopHome({ params }: { params: Promise<{ sub: string }> }) {
  const { sub } = await params;
  const [store, products, cats, base] = await Promise.all([
    shopGet<ShopStore>(sub, '/store'),
    shopGet<ShopPage<ShopProductCard>>(sub, '/products?limit=24'),
    shopGet<{ items: ShopCategory[] }>(sub, '/categories'),
    shopBase(sub),
  ]);
  const all = products.ok ? products.data.items : [];
  const latest = all.slice(0, 8);
  const onSale = all.filter((p) => p.onSale).slice(0, 4);
  const categories = (cats.ok ? cats.data.items : []).filter((c) => !c.parentId && c.productCount > 0);
  const s = store.ok ? store.data : null;
  const banner = s?.theme?.bannerUrl;

  const perks = [
    s?.shipping.freeAbove ? { icon: Truck, title: 'Free delivery', text: `On baskets over ${rs(s.shipping.freeAbove)}` } : { icon: Truck, title: 'Delivered to you', text: 'Straight to your door' },
    s?.cod.enabled ? { icon: CreditCard, title: 'Pay on delivery', text: 'Cash when it arrives' } : { icon: CreditCard, title: 'Secure payment', text: 'JazzCash and EasyPaisa' },
    { icon: RotateCcw, title: 'Easy returns', text: `${s?.returnWindowDays ?? 7}-day returns` },
    { icon: ShieldCheck, title: 'Quality checked', text: 'Fresh and carefully packed' },
  ];

  return (
    <div className="space-y-14">
      <section
        className="relative isolate overflow-hidden rounded-3xl px-6 py-16 text-center text-white sm:px-12 sm:py-24"
        style={{ background: banner ? `linear-gradient(rgb(0 0 0 / 0.5), rgb(0 0 0 / 0.5)), url(${mediaUrl(banner)}) center / cover` : 'linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 50%, black))' }}
      >
        {!banner && <div aria-hidden className="absolute -right-24 -top-24 -z-10 h-80 w-80 rounded-full bg-white/10 blur-3xl" />}
        <h1 className="animate-rise text-4xl font-extrabold tracking-tight sm:text-6xl">{s?.name}</h1>
        <p className="animate-rise mx-auto mt-4 max-w-xl text-base text-white/90 sm:text-lg" style={{ animationDelay: '80ms' }}>{s?.theme?.tagline ?? 'Fresh, simple ordering.'}</p>
        <div className="animate-rise mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: '160ms' }}>
          <Link href={`${base}/products`} className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-slate-900 shadow-lg transition-transform hover:scale-105">Shop now <ArrowRight size={16} /></Link>
          <Link href={`${base}/track`} className="inline-flex items-center rounded-full border border-white/50 px-7 py-3 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/15">Track an order</Link>
        </div>
      </section>

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Why shop with us">
        {perks.map((p) => (
          <li key={p.title} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-surface p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-accent"><p.icon size={20} aria-hidden /></span>
            <span className="min-w-0 leading-tight"><span className="block text-sm font-semibold">{p.title}</span><span className="block truncate text-xs text-slate-500">{p.text}</span></span>
          </li>
        ))}
      </ul>

      {categories.length > 0 && (
        <Section id="cats" title="Shop by category">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.slice(0, 8).map((c, i) => (
              <li key={c._id}>
                <Link href={`${base}/products?category=${c.slug}`} className={`group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br ${TILE_GRADIENTS[i % TILE_GRADIENTS.length]} p-4 text-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg`}>
                  <span aria-hidden className="absolute -right-4 -top-4 text-8xl font-black text-white/15 transition-transform duration-300 group-hover:scale-110">{c.name.slice(0, 1)}</span>
                  <span className="text-lg font-bold">{c.name}</span>
                  <span className="text-xs text-white/85">{c.productCount} {c.productCount === 1 ? 'product' : 'products'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {onSale.length > 0 && (
        <Section id="sale" title="On sale" href={`${base}/products`}>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">{onSale.map((p) => <li key={p.slug}><ProductCard product={p} base={base} /></li>)}</ul>
        </Section>
      )}

      <Section id="latest" title="New arrivals" href={`${base}/products`}>
        {latest.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 py-14 text-center text-slate-500">New products are on their way. Please check back soon.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">{latest.map((p) => <li key={p.slug}><ProductCard product={p} base={base} /></li>)}</ul>
        )}
      </Section>
    </div>
  );
}
