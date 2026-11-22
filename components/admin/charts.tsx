'use client';

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { rs } from '@/lib/format';

/** Counts up to a number, so a changing figure catches the eye. Respects "reduce motion". */
export function CountUp({ value, format = (n: number) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(value);
    const start = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setShown(start + (value - start) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

export const compactRs = (paisa: number) => {
  const r = paisa / 100;
  return r >= 1_000_000 ? `Rs ${(r / 1_000_000).toFixed(1)}M` : r >= 1000 ? `Rs ${(r / 1000).toFixed(r >= 10_000 ? 0 : 1)}k` : `Rs ${Math.round(r)}`;
};

export function Delta({ now, before }: { now: number; before: number }) {
  if (before === 0 && now === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-slate-500"><Minus size={12} /> no change</span>;
  if (before === 0) return <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700"><ArrowUpRight size={14} /> new</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-700' : 'text-red-700'}`}>
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} {Math.abs(pct)}%<span className="font-normal text-slate-500"> vs before</span>
    </span>
  );
}

const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function Tip({ active, payload, label, money }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-medium text-slate-900">{label ? shortDate(label) : ''}</div>
      {payload.map((p) => (
        <div key={p.name} className="text-slate-600">{p.name}: <strong className="text-slate-900">{money ? rs(p.value) : p.value}</strong></div>
      ))}
    </div>
  );
}

export function RevenueChart({ data }: { data: { date: string; revenue: number; orders: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--b500)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--b500)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--s200)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} stroke="var(--s400)" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickFormatter={compactRs} stroke="var(--s400)" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={56} />
        <Tooltip content={<Tip money />} cursor={{ stroke: 'var(--s300)' }} />
        <Area type="monotone" dataKey="revenue" name="Sales" stroke="var(--b500)" strokeWidth={2.5} fill="url(#rev)" animationDuration={700} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function OrdersBars({ data }: { data: { date: string; orders: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <XAxis dataKey="date" hide />
        <Tooltip content={<Tip />} cursor={{ fill: 'var(--s100)' }} />
        <Bar dataKey="orders" name="Orders" fill="var(--b500)" radius={[4, 4, 0, 0]} animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const STATUS_COLOR: Record<string, string> = { pending: '#f59e0b', processing: '#6366f1', shipped: '#8b5cf6', delivered: '#10b981', completed: '#059669', cancelled: '#ef4444', refunded: '#94a3b8' };

export function StatusDonut({ data }: { data: { status: string; count: number }[] }) {
  const total = data.reduce((n, d) => n + d.count, 0);
  if (total === 0) return <p className="py-10 text-center text-sm text-slate-500">No orders in this period.</p>;
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="count" nameKey="status" innerRadius={52} outerRadius={72} paddingAngle={2} stroke="none" animationDuration={700}>
              {data.map((d) => <Cell key={d.status} fill={STATUS_COLOR[d.status] ?? '#94a3b8'} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold"><CountUp value={total} /></span><span className="text-xs text-slate-500">orders</span></div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-sm">
        {data.slice().sort((a, b) => b.count - a.count).map((d) => (
          <li key={d.status} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[d.status] ?? '#94a3b8' }} aria-hidden />
            <span className="flex-1 capitalize text-slate-600">{d.status}</span>
            <strong className="text-slate-900">{d.count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A ranked list with proportional bars: top products, top stores, payment methods. */
export function BarList({ items }: { items: { label: string; sub?: string; value: number; display: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-500">Nothing yet.</p>;
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-slate-800">{i.label}{i.sub && <span className="ml-1.5 text-xs font-normal text-slate-500">{i.sub}</span>}</span>
            <span className="shrink-0 text-slate-600">{i.display}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500 transition-[width] duration-700" style={{ width: `${(i.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
