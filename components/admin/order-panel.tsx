'use client';

import { Check, Mail, MapPin, Phone, StickyNote, Truck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, get, post } from '@/lib/api';
import { rs } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';
import { useStore } from './store-context';
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, Select, Skeleton, formatDate } from './ui';

const tone = (s: string) => (s === 'pending' ? 'warn' : s === 'cancelled' ? 'bad' : s === 'completed' || s === 'delivered' || s === 'paid' ? 'good' : 'info');
const NEXT_LABEL: Record<string, string> = { processing: 'Start processing', shipped: 'Mark as shipped', delivered: 'Mark as delivered', completed: 'Complete order' };
const STEPS = ['pending', 'processing', 'shipped', 'delivered'] as const;

function Stepper({ status }: { status: string }) {
  if (status === 'cancelled') return <Alert>This order was cancelled.</Alert>;
  const at = Math.max(0, STEPS.indexOf((status === 'completed' ? 'delivered' : status) as (typeof STEPS)[number]));
  return (
    <ol className="flex items-center" aria-label="Order progress">
      {STEPS.map((s, i) => (
        <li key={s} className="flex flex-1 items-center last:flex-none" aria-current={i === at ? 'step' : undefined}>
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${i <= at ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>{i < at || status === 'completed' ? <Check size={14} /> : i + 1}</span>
          <span className={`ml-2 hidden text-xs capitalize sm:inline ${i <= at ? 'font-medium text-slate-900' : 'text-slate-400'}`}>{s}</span>
          {i < STEPS.length - 1 && <span className={`mx-2 h-0.5 flex-1 rounded ${i < at ? 'bg-brand-600' : 'bg-slate-200'}`} />}
        </li>
      ))}
    </ol>
  );
}

/** One order: progress, items, customer, shipment, actions. Used in the side drawer and on its own page. */
export function OrderPanel({ orderId, onChanged }: { orderId: string; onChanged?: () => void }) {
  const { store, can } = useStore();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [note, setNote] = useState('');
  const url = `/stores/${store._id}/orders/${orderId}`;

  const load = useCallback(() => {
    get<OrderDetail>(url)
      .then((o) => {
        setOrder(o);
        setCourier((c) => c || o.shipment?.courierCode || o.courierCode || o.couriers[0]?.code || '');
      })
      .catch((e: ApiError) => setError(e.status === 404 ? 'Order not found.' : e.message));
  }, [url]);
  useEffect(() => {
    setOrder(null);
    setError('');
    load();
  }, [load]);

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      setNote('');
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!order) return <div className="space-y-4" role="status" aria-label="Loading order"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;

  const a = order.shippingAddress;
  const canUpdate = can('order.update');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-semibold tracking-tight">Order #{order.number}</h3>
        <Badge tone={tone(order.status)}>{order.status}</Badge>
        <Badge tone={order.paymentStatus === 'paid' ? 'good' : 'neutral'}>{order.paymentStatus}</Badge>
        {order.needsAttention && <Badge tone="bad">needs attention</Badge>}
        <span className="text-sm text-slate-500">{formatDate(order.createdAt)}</span>
      </div>
      {order.needsAttention && <Alert>Money may have been taken for this order after it was cancelled, or an amount did not match. Check the payment with the gateway, then refund or reopen the order.</Alert>}
      <Stepper status={order.status} />

      <Card title="Items" padded={false}>
        <ul className="divide-y divide-slate-100">
          {order.items.map((i) => (
            <li key={i.sku} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <span className="min-w-0">{i.name}<span className="block text-xs text-slate-500">{i.sku}{Object.values(i.attributes).length ? ` · ${Object.values(i.attributes).join(' / ')}` : ''}{i.type === 'digital' ? ' · digital' : ''} · {rs(i.unitPrice)} × {i.quantity}</span></span>
              <span className="shrink-0 font-medium">{rs(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1.5 border-t border-slate-100 px-5 py-4 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{rs(order.totals.subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Delivery</dt><dd>{rs(order.totals.shipping)}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{rs(order.totals.total)}</dd></div>
          <div className="flex justify-between text-xs text-slate-500"><dt>Payment</dt><dd className="uppercase">{order.paymentMethod}{order.payment ? ` · ${order.payment.status}` : ''}</dd></div>
        </dl>
      </Card>

      {canUpdate && (order.nextStatuses.length > 0 || order.canCancel || order.canCollectCod) && (
        <Card title="Next step">
          <div className="space-y-4">
            {order.nextStatuses.map((s) => (
              <div key={s} className="space-y-3">
                {s === 'shipped' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Courier"><Select value={courier} onChange={(e) => setCourier(e.target.value)}>{order.couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
                    <Field label="Tracking number" hint="Customers see this."><Input value={tracking} maxLength={80} onChange={(e) => setTracking(e.target.value)} /></Field>
                  </div>
                )}
                <Button className="w-full" loading={busy} onClick={() => run(() => post(`${url}/status`, { status: s, courierCode: s === 'shipped' ? courier : undefined, trackingNumber: s === 'shipped' ? tracking || undefined : undefined }), `Order #${order.number} is now ${s}`)}>{NEXT_LABEL[s] ?? s}</Button>
              </div>
            ))}
            {order.canCollectCod && <Button className="w-full" variant="secondary" loading={busy} onClick={() => run(() => post(`${url}/cod-collected`), 'Cash recorded')}>Cash collected ({rs(order.totals.total)})</Button>}
            {order.canCancel && can('order.cancel') && (
              <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                <div className="min-w-48 flex-1"><Field label="Cancel reason (optional)"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field></div>
                <ConfirmButton label="Cancel order" confirmLabel="Cancel and restock" title={`Cancel order #${order.number}?`} message="The customer's items go back into stock. This cannot be undone." onConfirm={() => run(() => post(`${url}/cancel`, { note: note || undefined }), `Order #${order.number} cancelled`)} />
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Card title="Customer">
          <div className="space-y-2 text-sm">
            <div className="font-medium">{order.guest?.name}</div>
            <a className="flex items-center gap-2 text-slate-600 hover:text-brand-700" href={`tel:${order.guest?.phone}`}><Phone size={14} /> {order.guest?.phone}</a>
            {order.guest?.email && <a className="flex items-center gap-2 text-slate-600 hover:text-brand-700" href={`mailto:${order.guest.email}`}><Mail size={14} /> {order.guest.email}</a>}
            {a && <div className="flex items-start gap-2 text-slate-600"><MapPin size={14} className="mt-0.5 shrink-0" /><span>{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city}{a.province ? `, ${a.province}` : ''} {a.postalCode}</span></div>}
            {order.note && <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900"><StickyNote size={14} className="mt-0.5 shrink-0" /> {order.note}</div>}
          </div>
        </Card>
        {order.shipment ? (
          <Card title="Shipment">
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center gap-2 font-medium"><Truck size={15} /> {order.couriers.find((c) => c.code === order.shipment!.courierCode)?.name ?? order.shipment.courierCode}</div>
              <div className="text-slate-600">Tracking: {order.shipment.trackingNumber ?? 'not entered'}</div>
              {order.shipment.codAmount ? <div className="text-slate-600">COD to collect: {rs(order.shipment.codAmount)} {order.shipment.codCollected && <Badge tone="good">collected</Badge>}</div> : null}
            </div>
          </Card>
        ) : <div />}
      </div>

      <Card title="History">
        <ol className="space-y-3 text-sm">
          {[...order.statusHistory].reverse().map((h, i) => (
            <li key={i} className="flex gap-3"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i === 0 ? 'bg-brand-600' : 'bg-slate-300'}`} aria-hidden /><span><strong className="font-medium">{h.status}</strong>{h.note ? ` · ${h.note}` : ''}<span className="block text-xs text-slate-500">{formatDate(h.at)}{h.by ? ` · ${h.by.name}` : ''}</span></span></li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
