import { ArrowRight, CreditCard, RotateCcw, ShieldCheck, Truck } from 'lucide-react';
import Link from 'next/link';
import { ProductCard } from '@/components/shop/ui';
import { mediaUrl } from '@/lib/api';
import { rs } from '@/lib/format';
import { shopBase } from '@/lib/shop-base';
import { shopGet, type ShopCategory, type ShopPage, type ShopProductCard, type ShopStore } from '@/lib/shop-api';

function Section({ id, title, href, children, hrefLabel = 'View all' }: { id: string; title: string; href?: string; hrefLabel?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="animate-rise">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h2 id={id} className="text-2xl font-bold tracking-tight">{title}</h2>
        {href && <Link href={href} className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-slate-900 underline-offset-4 hover:underline">{hrefLabel} <ArrowRight size={14} /></Link>}
      </div>
      {children}
    </section>
  );
}

const btnPrimary = 'inline-flex items-center gap-2 rounded-full bg-accent px-7 py-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98]';
const btnGhost = 'inline-flex items-center rounded-full border border-slate-300 bg-surface px-7 py-3.5 text-sm font-semibold text-slate-900 transition-colors hover:border-ink';

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
  const headline = s?.theme?.tagline ?? 'Everything you need, delivered to your door.';
  const collage = all.filter((p) => p.image).slice(0, 3);

  const perks = [
    s?.shipping.freeAbove ? { icon: Truck, title: 'Free delivery', text: `Over ${rs(s.shipping.freeAbove)}` } : { icon: Truck, title: 'Fast delivery', text: 'Straight to your door' },
    s?.cod.enabled ? { icon: CreditCard, title: 'Pay on delivery', text: 'Cash when it arrives' } : { icon: CreditCard, title: 'Secure payment', text: 'JazzCash and EasyPaisa' },
    { icon: RotateCcw, title: 'Easy returns', text: `${s?.returnWindowDays ?? 7}-day returns` },
    { icon: ShieldCheck, title: 'Quality checked', text: 'Carefully packed' },
  ];

  return (
    <div className="space-y-16">
      {banner ? (
        <section className="relative isolate overflow-hidden rounded-3xl" style={{ background: `linear-gradient(90deg, rgb(0 0 0 / 0.65), rgb(0 0 0 / 0.1)), url(${mediaUrl(banner)}) center / cover` }}>
          <div className="px-6 py-20 text-white sm:px-14 sm:py-32">
            <h1 className="animate-rise max-w-xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">{headline}</h1>
            <div className="animate-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: '120ms' }}>
              <Link href={`${base}/products`} className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-slate-900 transition-transform hover:scale-105">Shop now <ArrowRight size={16} /></Link>
              <Link href={`${base}/track`} className="inline-flex items-center rounded-full border border-white/60 px-7 py-3.5 text-sm font-semibold text-white hover:bg-white/15">Track an order</Link>
            </div>
          </div>
        </section>
      ) : (
        <section className="grid items-center gap-10 overflow-hidden rounded-3xl bg-[color-mix(in_oklab,var(--accent)_9%,var(--surface))] px-6 py-12 sm:px-12 sm:py-16 lg:grid-cols-2">
          <div>
            <span className="animate-rise inline-flex rounded-full bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] px-3.5 py-1 text-xs font-semibold text-accent">Welcome to {s?.name}</span>
            <h1 className="animate-rise mt-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl" style={{ animationDelay: '60ms' }}>{headline}</h1>
            <p className="animate-rise mt-5 max-w-md text-base text-slate-600" style={{ animationDelay: '120ms' }}>Browse the collection, add what you like and check out in a minute.</p>
            <div className="animate-rise mt-8 flex flex-wrap gap-3" style={{ animationDelay: '180ms' }}>
              <Link href={`${base}/products`} className={btnPrimary}>Shop now <ArrowRight size={16} /></Link>
              <Link href={`${base}/track`} className={btnGhost}>Track an order</Link>
            </div>
          </div>
          <div aria-hidden className={`relative mx-auto w-full max-w-md grid-cols-2 gap-3 ${collage.length ? "grid" : "hidden lg:grid"}`}>
            {collage.length > 0 ? (
              collage.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.slug} src={mediaUrl(p.image!)} alt="" className={`w-full rounded-2xl object-cover shadow-lg ${i === 0 ? 'row-span-2 aspect-[3/4]' : 'aspect-square'}`} />
              ))
            ) : (
              <div className="col-span-2 flex aspect-[4/3] items-center justify-center rounded-3xl bg-accent text-8xl font-bold text-white/90">{s?.name.slice(0, 1).toUpperCase()}</div>
            )}
          </div>
        </section>
      )}

      <ul className="grid grid-cols-2 gap-x-4 gap-y-6 border-y border-slate-200 py-6 lg:grid-cols-4" aria-label="Why shop with us">
        {perks.map((p) => (
          <li key={p.title} className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-900"><p.icon size={20} aria-hidden /></span>
            <span className="min-w-0 leading-tight"><span className="block text-sm font-semibold">{p.title}</span><span className="block truncate text-xs text-slate-500">{p.text}</span></span>
          </li>
        ))}
      </ul>

      {categories.length > 0 && (
        <Section id="cats" title="Shop by category">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.slice(0, 8).map((c) => (
              <li key={c._id}>
                <Link href={`${base}/products?category=${c.slug}`} className="group flex items-center justify-between rounded-2xl border border-slate-200 bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-ink hover:shadow-md">
                  <span>
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block text-xs text-slate-500">{c.productCount} {c.productCount === 1 ? 'product' : 'products'}</span>
                  </span>
                  <ArrowRight size={18} className="text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-ink" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {onSale.length > 0 && (
        <Section id="sale" title="On sale" href={`${base}/products`}>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">{onSale.map((p) => <li key={p.slug}><ProductCard product={p} base={base} /></li>)}</ul>
        </Section>
      )}

      <Section id="latest" title="New arrivals" href={`${base}/products`}>
        {latest.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 py-14 text-center text-slate-500">New products are on their way. Please check back soon.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4">{latest.map((p) => <li key={p.slug}><ProductCard product={p} base={base} /></li>)}</ul>
        )}
      </Section>
    </div>
  );
}
