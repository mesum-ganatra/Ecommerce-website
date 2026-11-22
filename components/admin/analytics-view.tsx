'use client';

import { AlertTriangle, BadgeDollarSign, Clock, CreditCard, PackageX, ReceiptText, ShoppingBag, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, get } from '@/lib/api';
import { rs } from '@/lib/format';
import type { Analytics } from '@/lib/types';
import { BarList, CountUp, Delta, OrdersBars, RevenueChart, StatusDonut, compactRs } from './charts';
import { Alert, Card, Skeleton } from './ui';

const PERIODS = [7, 30, 90] as const;
const METHOD: Record<string, string> = { cod: 'Cash on Delivery', jazzcash: 'JazzCash', easypaisa: 'EasyPaisa', simulator: 'Test gateway', external: 'External site' };

function Kpi({ icon, label, children, foot }: { icon: React.ReactNode; label: string; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-surface p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{icon}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{children}</div>
      <div className="mt-1 min-h-5">{foot}</div>
    </div>
  );
}

function AlertChip({ icon, count, label, href, tone }: { icon: React.ReactNode; count: number; label: string; href?: string; tone: 'warn' | 'bad' }) {
  if (count === 0) return null;
  const cls = tone === 'bad' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900';
  const inner = (
    <>
      <span aria-hidden>{icon}</span>
      <strong>{count}</strong> {label}
    </>
  );
  const base = `inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm ${cls}`;
  return href ? <Link href={href} className={`${base} transition-transform hover:-translate-y-0.5`}>{inner}</Link> : <span className={base}>{inner}</span>;
}

/** Sales dashboard: numbers, trend, what sells, and what needs attention. `storeId` limits it to one store. */
export function AnalyticsView({ storeId }: { storeId?: string }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setError('');
    get<Analytics>(storeId ? `/stores/${storeId}/analytics?days=${days}` : `/dashboard/analytics?days=${days}`)
      .then((d) => alive && setData(d))
      .catch((e: ApiError) => alive && setError(e.status === 403 ? 'Your role cannot view reports.' : e.message));
    return () => {
      alive = false;
    };
  }, [storeId, days]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading dashboard">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
        <Skeleton className="h-80" />
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      </div>
    );
  }

  const t = data.totals;
  const ordersHref = storeId ? `/admin/stores/${storeId}/orders` : undefined;
  const a = data.alerts;
  const noSales = t.orders === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <AlertChip icon={<Clock size={15} />} count={a.pending} label="orders waiting to be processed" href={ordersHref && `${ordersHref}`} tone="warn" />
          <AlertChip icon={<CreditCard size={15} />} count={a.awaitingPayment} label="waiting for online payment" tone="warn" />
          <AlertChip icon={<PackageX size={15} />} count={a.lowStock} label="products low on stock" href={storeId ? `/admin/stores/${storeId}/products` : undefined} tone="warn" />
          <AlertChip icon={<AlertTriangle size={15} />} count={a.attention} label="orders need your attention" href={ordersHref} tone="bad" />
        </div>
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border border-slate-200 bg-surface p-0.5">
          {PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={days === p} onClick={() => setDays(p)} className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${days === p ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{p} days</button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<BadgeDollarSign size={18} />} label="Sales" foot={<Delta now={t.revenue} before={t.previous.revenue} />}><CountUp value={t.revenue / 100} format={(n) => `Rs ${Math.round(n).toLocaleString('en-PK')}`} /></Kpi>
        <Kpi icon={<ShoppingBag size={18} />} label="Orders" foot={<Delta now={t.orders} before={t.previous.orders} />}><CountUp value={t.orders} /></Kpi>
        <Kpi icon={<ReceiptText size={18} />} label="Average order" foot={<span className="text-xs text-slate-500">per order</span>}><CountUp value={t.average / 100} format={(n) => `Rs ${Math.round(n).toLocaleString('en-PK')}`} /></Kpi>
        <Kpi icon={<TrendingUp size={18} />} label="Best day" foot={<span className="text-xs text-slate-500">{t.orders ? 'highest sales' : 'no sales yet'}</span>}>{compactRs(Math.max(0, ...data.series.map((s) => s.revenue)))}</Kpi>
      </div>

      <Card title="Sales over time" action={<span className="text-xs text-slate-500">last {days} days</span>}>
        {noSales ? <p className="py-16 text-center text-sm text-slate-500">No sales in this period yet. They will appear here as orders come in.</p> : (
          <>
            <RevenueChart data={data.series} />
            <div className="mt-2 border-t border-slate-100 pt-3"><div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Orders per day</div><OrdersBars data={data.series} /></div>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Orders by status"><StatusDonut data={data.byStatus} /></Card>
        <Card title="Top products"><BarList items={data.topProducts.map((p) => ({ label: p.name, sub: `${p.quantity} sold`, value: p.revenue, display: rs(p.revenue) }))} /></Card>
        <Card title="How customers pay"><BarList items={data.payments.map((p) => ({ label: METHOD[p.method] ?? p.method, sub: `${p.orders} orders`, value: p.revenue, display: rs(p.revenue) }))} /></Card>
        {!storeId && (
          <Card title="Top stores"><BarList items={data.topStores.map((s) => ({ label: s.name, sub: `${s.orders} orders`, value: s.revenue, display: rs(s.revenue) }))} /></Card>
        )}
      </div>
    </div>
  );
}
