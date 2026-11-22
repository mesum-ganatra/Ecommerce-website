'use client';

import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { AlertTriangle, GripVertical, KanbanSquare, List, Lock, Package, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { OrderPanel } from '@/components/admin/order-panel';
import { useStore } from '@/components/admin/store-context';
import { Alert, Badge, Button, Card, Drawer, EmptyState, Field, Input, Modal, Select, Skeleton, formatDate } from '@/components/admin/ui';
import { ApiError, get, post } from '@/lib/api';
import { rs } from '@/lib/format';
import type { OrderRow, Page } from '@/lib/types';

const tone = (s: string) => (s === 'pending' ? 'warn' : s === 'cancelled' || s === 'refunded' ? 'bad' : s === 'completed' || s === 'delivered' ? 'good' : 'info');
const COLUMNS = [
  { id: 'pending', title: 'To process', color: '#f59e0b' },
  { id: 'processing', title: 'Processing', color: '#6366f1' },
  { id: 'shipped', title: 'Shipped', color: '#8b5cf6' },
  { id: 'delivered', title: 'Delivered', color: '#10b981' },
] as const;
type ColId = (typeof COLUMNS)[number]['id'];
// the column under the pointer wins; keyboard dragging falls back to overlap
const detect: CollisionDetection = (args) => { const hits = pointerWithin(args); return hits.length ? hits : rectIntersection(args); };
const NEXT: Record<string, ColId> = { pending: 'processing', processing: 'shipped', shipped: 'delivered' };
type Cols = Record<ColId, OrderRow[]>;

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const waitingForPayment = (o: OrderRow) => o.paymentMethod !== 'cod' && o.paymentMethod !== 'external' && o.paymentStatus !== 'paid';

/** How an order looks on the board (no drag logic, so the floating preview can reuse it safely). */
function CardContent({ o }: { o: OrderRow }) {
  const locked = waitingForPayment(o) && o.status === 'pending';
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">#{o.number}</span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          {o.needsAttention && <AlertTriangle size={13} className="text-red-600" aria-label="Needs attention" />}
          {locked && <Lock size={12} aria-label="Waiting for payment" />}
          {ago(o.createdAt)}
          <GripVertical size={13} className="text-slate-300" aria-hidden />
        </span>
      </div>
      <div className="mt-1 truncate text-slate-800">{o.customer}</div>
      <div className="truncate text-xs text-slate-500">{o.city ?? 'No delivery'} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</div>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-medium">{rs(o.total)}</span>
        <Badge tone={o.paymentStatus === 'paid' ? 'good' : locked ? 'warn' : 'neutral'}>{locked ? 'awaiting payment' : o.paymentStatus === 'paid' ? 'paid' : (o.paymentMethod ?? 'unpaid')}</Badge>
      </div>
    </>
  );
}

function OrderCard({ o, onOpen }: { o: OrderRow; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: o._id, data: { order: o } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} onClick={onOpen} className={`cursor-grab touch-none rounded-xl border border-slate-200 bg-surface p-3 text-sm shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing ${isDragging ? 'opacity-30' : ''}`}>
      <CardContent o={o} />
    </div>
  );
}

function Column({ col, orders, onOpen }: { col: (typeof COLUMNS)[number]; orders: OrderRow[]; onOpen: (o: OrderRow) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <section ref={setNodeRef} aria-label={col.title} className={`flex min-h-64 w-72 shrink-0 flex-col rounded-2xl border p-2.5 transition-colors lg:w-auto lg:flex-1 ${isOver ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50'}`}>
      <header className="mb-2.5 flex items-center justify-between px-1.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: col.color }} aria-hidden />{col.title}</h3>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-slate-600">{orders.length}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2.5">
        {orders.map((o) => <OrderCard key={o._id} o={o} onOpen={() => onOpen(o)} />)}
        {orders.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 px-3 py-8 text-center text-xs text-slate-500">Drop an order here</p>}
      </div>
    </section>
  );
}

function Board({ onOpen, version }: { onOpen: (o: OrderRow) => void; version: number }) {
  const { store, can } = useStore();
  const [cols, setCols] = useState<Cols | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState<OrderRow | null>(null);
  const [ship, setShip] = useState<{ order: OrderRow; from: ColId } | null>(null);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const couriers = store.settings.couriers.filter((c) => c.active);

  const load = useCallback(() => {
    Promise.all(COLUMNS.map((c) => get<Page<OrderRow>>(`/stores/${store._id}/orders?status=${c.id}&limit=${c.id === 'delivered' ? 12 : 50}`)))
      .then((r) => setCols(Object.fromEntries(COLUMNS.map((c, i) => [c.id, r[i].items])) as Cols))
      .catch((e: ApiError) => setError(e.message));
  }, [store._id]);
  useEffect(load, [load, version]);

  async function move(o: OrderRow, from: ColId, to: ColId, extra?: { courierCode: string; trackingNumber?: string }) {
    const before = cols;
    setCols((c) => c && { ...c, [from]: c[from].filter((x) => x._id !== o._id), [to]: [{ ...o, status: to }, ...c[to]] });
    try {
      await post(`/stores/${store._id}/orders/${o._id}/status`, { status: to, ...extra });
      toast.success(`Order #${o.number} moved to ${COLUMNS.find((c) => c.id === to)!.title.toLowerCase()}`);
      load();
    } catch (e) {
      setCols(before);
      toast.error(e instanceof ApiError ? e.message : 'Could not move the order');
    }
  }

  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const o = e.active.data.current?.order as OrderRow | undefined;
    const to = e.over?.id as ColId | undefined;
    if (!o || !to || to === o.status) return;
    const from = o.status as ColId;
    if (!can('order.update')) return void toast.error('Your role cannot change orders.');
    if (NEXT[from] !== to) return void toast.error('Orders move one step at a time, from left to right.');
    if (from === 'pending' && waitingForPayment(o)) return void toast.error('This order is waiting for its online payment.');
    if (to === 'shipped') {
      setCourier(couriers[0]?.code ?? '');
      setTracking('');
      return setShip({ order: o, from });
    }
    void move(o, from, to);
  }

  if (error) return <Alert>{error}</Alert>;
  if (!cols) return <div className="grid gap-3 lg:grid-cols-4">{COLUMNS.map((c) => <Skeleton key={c.id} className="h-72" />)}</div>;

  return (
    <>
      <p className="mb-3 text-sm text-slate-500">Drag an order to the next column to update it. Click an order to open it.</p>
      <DndContext sensors={sensors} collisionDetection={detect} onDragStart={(e: DragStartEvent) => setActive((e.active.data.current?.order as OrderRow) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:overflow-visible lg:px-0">
          {COLUMNS.map((c) => <Column key={c.id} col={c} orders={cols[c.id]} onOpen={onOpen} />)}
        </div>
        <DragOverlay dropAnimation={{ duration: 180 }}>{active ? <div className="rotate-2 cursor-grabbing rounded-xl border border-slate-200 bg-surface p-3 text-sm shadow-xl"><CardContent o={active} /></div> : null}</DragOverlay>
      </DndContext>

      <Modal
        open={!!ship}
        onClose={() => setShip(null)}
        title={`Ship order #${ship?.order.number ?? ''}`}
        footer={<><Button variant="ghost" onClick={() => setShip(null)}>Cancel</Button><Button onClick={() => { const s = ship!; setShip(null); void move(s.order, s.from, 'shipped', { courierCode: courier, trackingNumber: tracking || undefined }); }}>Mark as shipped</Button></>}
      >
        <div className="space-y-3">
          <Field label="Courier"><Select value={courier} onChange={(e) => setCourier(e.target.value)}>{couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
          <Field label="Tracking number (optional)" hint="Customers see this on the tracking page."><Input value={tracking} maxLength={80} onChange={(e) => setTracking(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

function ListView({ onOpen, version }: { onOpen: (o: OrderRow) => void; version: number }) {
  const { store } = useStore();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(Page<OrderRow> & { pendingCount: number }) | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (debounced) qs.set('search', debounced);
    if (status) qs.set('status', status);
    let alive = true;
    get<Page<OrderRow> & { pendingCount: number }>(`/stores/${store._id}/orders?${qs}`)
      .then((d) => alive && (setData(d), setError('')))
      .catch((e: ApiError) => alive && setError(e.message));
    return () => { alive = false; };
  }, [store._id, debounced, status, page, version]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <Card padded={false}>
      <div className="flex flex-wrap gap-3 p-4">
        <div className="relative min-w-56 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input type="search" aria-label="Search orders" placeholder="Order number, name, phone or email" className="!pl-9" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!w-44">
          <option value="">All statuses</option>
          {['pending', 'processing', 'shipped', 'delivered', 'completed', 'cancelled'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
      </div>
      {error && <div className="px-4 pb-4"><Alert>{error}</Alert></div>}
      {!data && !error && <div className="space-y-2 px-4 pb-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
      {data && data.items.length === 0 && <EmptyState icon={<Package size={22} />} title={debounced || status ? 'No orders match' : 'No orders yet'}>{debounced || status ? 'Try a different search or status.' : 'Orders appear here as soon as customers place them.'}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2.5 font-medium">Order</th><th className="px-3 py-2.5 font-medium">Customer</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Payment</th><th className="px-5 py-2.5 text-right font-medium">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((o) => (
                <tr key={o._id} onClick={() => onOpen(o)} className="cursor-pointer transition-colors hover:bg-slate-50">
                  <td className="px-5 py-3"><span className="font-semibold text-brand-700">#{o.number}</span>{o.needsAttention && <AlertTriangle size={13} className="ml-1.5 inline text-red-600" aria-label="Needs attention" />}<div className="text-xs text-slate-500">{formatDate(o.createdAt)} · {o.itemCount} {o.itemCount === 1 ? 'item' : 'items'}</div></td>
                  <td className="px-3 py-3">{o.customer}<div className="text-xs text-slate-500">{o.phone}{o.city ? ` · ${o.city}` : ''}</div></td>
                  <td className="px-3 py-3"><Badge tone={tone(o.status)}>{o.status}</Badge></td>
                  <td className="px-3 py-3"><Badge tone={o.paymentStatus === 'paid' ? 'good' : 'neutral'}>{o.paymentStatus}</Badge><div className="mt-0.5 text-xs uppercase text-slate-500">{o.paymentMethod}</div></td>
                  <td className="whitespace-nowrap px-5 py-3 text-right font-medium">{rs(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.limit && (
        <div className="flex items-center justify-between border-t border-slate-100 p-4 text-sm text-slate-600">
          <span>{data.total} orders</span>
          <div className="flex items-center gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
        </div>
      )}
    </Card>
  );
}

export default function OrdersPage() {
  const [view, setView] = useState<'board' | 'list'>('board');
  const [open, setOpen] = useState<OrderRow | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    try { const v = localStorage.getItem('admin:orders-view'); if (v === 'list' || v === 'board') setView(v); } catch { /* ignore */ }
  }, []);
  const pick = (v: 'board' | 'list') => { setView(v); try { localStorage.setItem('admin:orders-view', v); } catch { /* ignore */ } };
  const tabs = useMemo(() => [{ id: 'board' as const, label: 'Board', icon: KanbanSquare }, { id: 'list' as const, label: 'List', icon: List }], []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Orders</h2>
        <div role="group" aria-label="View" className="inline-flex rounded-lg border border-slate-200 bg-surface p-0.5">
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-pressed={view === t.id} onClick={() => pick(t.id)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === t.id ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}><t.icon size={15} /> {t.label}</button>
          ))}
        </div>
      </div>
      {view === 'board' ? <Board onOpen={setOpen} version={version} /> : <ListView onOpen={setOpen} version={version} />}
      <Drawer open={!!open} onClose={() => setOpen(null)} title={open ? `Order #${open.number}` : 'Order'}>
        {open && <OrderPanel orderId={open._id} onChanged={() => setVersion((v) => v + 1)} />}
      </Drawer>
    </div>
  );
}
