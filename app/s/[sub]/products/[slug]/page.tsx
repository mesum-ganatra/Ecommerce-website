import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CreditCard, RotateCcw, Truck } from 'lucide-react';
import { Gallery } from '@/components/shop/gallery';
import { ProductBuy } from '@/components/shop/product-buy';
import { mediaUrl } from '@/lib/api';
import { rs } from '@/lib/format';
import { shopBase } from '@/lib/shop-base';
import { shopGet, type ShopProduct, type ShopStore } from '@/lib/shop-api';

type Props = { params: Promise<{ sub: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sub, slug } = await params;
  const r = await shopGet<ShopProduct>(sub, `/products/${slug}`);
  if (!r.ok) return { title: 'Product not found' };
  const p = r.data;
  return {
    title: p.seo.title,
    description: p.seo.description,
    openGraph: { title: p.seo.title, description: p.seo.description, images: p.images[0] ? [mediaUrl(p.images[0].url)] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { sub, slug } = await params;
  const [r, base, store] = await Promise.all([shopGet<ShopProduct>(sub, `/products/${slug}`, 15), shopBase(sub), shopGet<ShopStore>(sub, '/store')]);
  if (!r.ok) notFound();
  const p = r.data;
  const st = store.ok ? store.data : null;
  const assurances = st && p.type === 'physical'
    ? [
        { icon: Truck, text: st.shipping.freeAbove ? `Free delivery on orders over ${rs(st.shipping.freeAbove)}` : 'Delivered to your door' },
        { icon: CreditCard, text: st.cod.enabled ? 'Pay with cash on delivery' : 'Secure online payment' },
        ...(st.returnWindowDays > 0 ? [{ icon: RotateCcw, text: `${st.returnWindowDays}-day returns` }] : []),
      ]
    : [];

  // structured data helps search engines show price and availability
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: p.seo.description,
    image: p.images.map((i) => mediaUrl(i.url)),
    sku: p.variants[0]?.sku,
    brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'PKR',
      lowPrice: p.priceMin / 100,
      highPrice: p.priceMax / 100,
      availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };

  return (
    <article>
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-slate-500">
        <Link href={`${base}/`} className="hover:underline">Home</Link> /{' '}
        <Link href={`${base}/products`} className="hover:underline">Products</Link>
        {p.category && (
          <> / <Link href={`${base}/products?category=${p.category.slug}`} className="hover:underline">{p.category.name}</Link></>
        )}
      </nav>
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        <Gallery images={p.images} name={p.name} />
        <div className="md:sticky md:top-32 md:self-start">
          {p.brand && <div className="text-xs uppercase tracking-wide text-slate-500">{p.brand}</div>}
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{p.name}</h1>
          {p.type === 'digital' && <span className="mt-2 inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">Digital product</span>}
          <div className="mt-5">
            <ProductBuy variants={p.variants} digital={p.type === 'digital'} />
          </div>
          {assurances.length > 0 && (
            <ul className="mt-6 space-y-2.5 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
              {assurances.map((a) => (
                <li key={a.text} className="flex items-center gap-3"><a.icon size={18} className="shrink-0 text-slate-500" aria-hidden />{a.text}</li>
              ))}
            </ul>
          )}
          {p.description && (
            <section aria-labelledby="desc" className="mt-8 border-t border-slate-200 pt-6">
              <h2 id="desc" className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Description</h2>
              <p className="whitespace-pre-line leading-relaxed text-slate-700">{p.description}</p>
            </section>
          )}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
    </article>
  );
}
