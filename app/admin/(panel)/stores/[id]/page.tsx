'use client';

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/components/admin/store-context';
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, Loading, formatDate } from '@/components/admin/ui';
import { ApiError, del, get, patch, post } from '@/lib/api';
import type { ApiKeyRow, Courier, Store } from '@/lib/types';

// ---------------------------------------------------------------- settings
function SettingsForm({ store, onSaved }: { store: Store; onSaved: (s: Store) => void }) {
  const [name, setName] = useState(store.name);
  const [returnDays, setReturnDays] = useState(String(store.settings.returnWindowDays));
  const [lowStock, setLowStock] = useState(String(store.settings.lowStockThreshold));
  const [codEnabled, setCodEnabled] = useState(store.settings.cod.enabled);
  // stored in paisa; shown in rupees. Empty or 0 means no limit.
  const [codMax, setCodMax] = useState(store.settings.cod.maxOrderAmount ? String(store.settings.cod.maxOrderAmount / 100) : '');
  const [shipFlat, setShipFlat] = useState(store.settings.shipping?.flatRate ? String(store.settings.shipping.flatRate / 100) : '');
  const [shipFree, setShipFree] = useState(store.settings.shipping?.freeAbove ? String(store.settings.shipping.freeAbove / 100) : '');
  const [couriers, setCouriers] = useState<Courier[]>(store.settings.couriers);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const updateCourier = (i: number, patchObj: Partial<Courier>) =>
    setCouriers((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patchObj } : c)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const codes = couriers.map((c) => c.code.trim().toLowerCase());
    if (new Set(codes).size !== codes.length) return setMsg({ tone: 'bad', text: 'Each courier needs a different code.' });
    setBusy(true);
    try {
      const saved = await patch<Store>(`/stores/${store._id}`, {
        name,
        settings: {
          returnWindowDays: Number(returnDays),
          lowStockThreshold: Number(lowStock),
          cod: { enabled: codEnabled, maxOrderAmount: codMax ? Math.round(Number(codMax) * 100) : 0 },
          shipping: { flatRate: shipFlat ? Math.round(Number(shipFlat) * 100) : 0, freeAbove: shipFree ? Math.round(Number(shipFree) * 100) : 0 },
          couriers: couriers.map((c) => ({
            name: c.name.trim(),
            code: c.code.trim().toLowerCase(),
            trackingUrlTemplate: c.trackingUrlTemplate ?? '',
            active: c.active,
          })),
        },
      });
      onSaved(saved);
      setMsg({ tone: 'good', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'bad', text: err instanceof ApiError ? err.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card title="Store settings">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Store name">
              <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
          <Field label="Return window (days)" hint="How long customers can request a return after delivery.">
            <Input type="number" min={0} max={365} required value={returnDays} onChange={(e) => setReturnDays(e.target.value)} />
          </Field>
          <Field label="Low-stock alert at" hint="Alert when a variant drops to this many units.">
            <Input type="number" min={0} required value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
          </Field>
        </div>
        <div className="mt-5 rounded-lg border border-slate-200 p-4">
          <label className="flex items-center gap-2.5 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={codEnabled} onChange={(e) => setCodEnabled(e.target.checked)} />
            Accept Cash on Delivery
          </label>
          {codEnabled && (
            <div className="mt-3 max-w-xs">
              <Field label="Maximum COD order (Rs)" hint="Leave empty for no limit.">
                <Input type="number" min={0} step="1" value={codMax} onChange={(e) => setCodMax(e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card title="Delivery fee">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Delivery fee (Rs)" hint="Charged on orders with physical products. 0 means free delivery.">
            <Input type="number" min={0} step="1" value={shipFlat} onChange={(e) => setShipFlat(e.target.value)} />
          </Field>
          <Field label="Free delivery above (Rs)" hint="Leave empty to always charge the fee.">
            <Input type="number" min={0} step="1" value={shipFree} onChange={(e) => setShipFree(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card
        title="Couriers"
        action={
          <Button type="button" variant="secondary" onClick={() => setCouriers([...couriers, { name: '', code: '', trackingUrlTemplate: '', active: true }])}>
            Add courier
          </Button>
        }
      >
        <p className="mb-4 text-sm text-slate-600">
          Couriers staff can choose when shipping an order. In the tracking link, <code className="rounded bg-slate-100 px-1">{'{trackingNumber}'}</code> is replaced by the number.
        </p>
        <div className="space-y-3">
          {couriers.map((c, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-slate-200 p-3.5 md:grid-cols-2 xl:grid-cols-[1fr_9rem_2fr_auto]">
              <Field label="Name"><Input required value={c.name} onChange={(e) => updateCourier(i, { name: e.target.value })} placeholder="Leopard Courier" /></Field>
              <Field label="Code"><Input required value={c.code} onChange={(e) => updateCourier(i, { code: e.target.value })} placeholder="leopard" /></Field>
              <Field label="Tracking link"><Input value={c.trackingUrlTemplate ?? ''} onChange={(e) => updateCourier(i, { trackingUrlTemplate: e.target.value })} placeholder="https://.../{trackingNumber}" /></Field>
              <div className="flex items-end gap-3 pb-1.5">
                <label className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={c.active} onChange={(e) => updateCourier(i, { active: e.target.checked })} />
                  Active
                </label>
                <Button type="button" variant="ghost" disabled={couriers.length === 1} onClick={() => setCouriers(couriers.filter((_, idx) => idx !== i))} aria-label={`Remove ${c.name || 'courier'}`}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy}>Save changes</Button>
        {msg && <span className={`text-sm ${msg.tone === 'good' ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- api keys
function ApiKeys({ storeId }: { storeId: string }) {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<{ key: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    get<{ items: ApiKeyRow[] }>(`/stores/${storeId}/api-keys`)
      .then((d) => setKeys(d.items))
      .catch((e: ApiError) => setError(e.message));
  }, [storeId]);
  useEffect(load, [load]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const k = await post<{ key: string; label: string }>(`/stores/${storeId}/api-keys`, { label: label.trim() || 'Storefront' });
      setFresh(k);
      setCopied(false);
      setLabel('');
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the key');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Storefront API keys">
      <p className="mb-4 text-sm text-slate-600">
        A storefront uses a key to read this store&apos;s catalogue and place orders. Keys are shown once, so copy it into the storefront&apos;s settings straight away.
      </p>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {fresh && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-medium text-amber-900">New key &quot;{fresh.label}&quot;. Copy it now, it will not be shown again.</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-surface px-2 py-1 text-xs ring-1 ring-amber-200">{fresh.key}</code>
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(fresh.key);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="ghost" onClick={() => setFresh(null)}>Done</Button>
          </div>
        </div>
      )}
      <div className="mb-4 flex max-w-lg gap-2">
        <Input aria-label="Key label" placeholder="Label, e.g. Main storefront" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
        <Button onClick={create} loading={busy}>Create key</Button>
      </div>
      {!keys && !error && <Loading />}
      {keys && keys.length === 0 && <p className="text-sm text-slate-500">No keys yet.</p>}
      {keys && keys.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {keys.map((k) => (
            <li key={k._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{k.label}</div>
                <div className="text-xs text-slate-500">
                  <code>{k.prefix}…</code> · created {formatDate(k.createdAt)}
                  {k.lastUsedAt ? ` · last used ${formatDate(k.lastUsedAt)}` : ' · never used'}
                </div>
              </div>
              {k.revokedAt ? (
                <Badge>revoked</Badge>
              ) : (
                <ConfirmButton
                  label="Revoke"
                  confirmLabel="Yes, revoke"
                  onConfirm={async () => {
                    await del(`/stores/${storeId}/api-keys/${k._id}`);
                    load();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- page
export default function StoreSettingsPage() {
  const { store, setStore, can } = useStore();
  return (
    <div className="space-y-6">
      {store.type === 'external' && (
        <Alert tone="info">
          Connecting this store to its website (credentials, sync schedule, sync logs) arrives with the connector module.
        </Alert>
      )}
      {can('store.settings') ? (
        <SettingsForm store={store} onSaved={setStore} />
      ) : (
        <Alert tone="info">Your role can view this store but not change its settings.</Alert>
      )}
      {can('apikey.manage') && store.type === 'native' && <ApiKeys storeId={store._id} />}
    </div>
  );
}
