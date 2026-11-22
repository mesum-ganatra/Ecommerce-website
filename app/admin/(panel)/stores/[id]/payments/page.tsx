'use client';

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '@/components/admin/store-context';
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, Loading, Select } from '@/components/admin/ui';
import { ApiError, del, get, put } from '@/lib/api';
import type { PaymentGatewayRow } from '@/lib/types';

function GatewayCard({ g, storeId, onChanged }: { g: PaymentGatewayRow; storeId: string; onChanged: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(g.values);
  const [mode, setMode] = useState(g.mode);
  const [enabled, setEnabled] = useState(g.enabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const simulator = g.gateway === 'simulator';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      // a field still showing its masked hint is sent unchanged, and the server keeps the stored secret
      await put(`/stores/${storeId}/payment-configs/${g.gateway}`, { mode, enabled, credentials: values });
      setMsg({ tone: 'good', text: enabled ? 'Saved. Customers can now pay this way.' : 'Saved. This method is switched off.' });
      onChanged();
    } catch (err) {
      setMsg({ tone: 'bad', text: err instanceof ApiError ? err.message : 'Could not save' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title={g.label}
      action={
        <div className="flex flex-wrap gap-1.5">
          {g.configured && <Badge tone={g.enabled ? 'good' : 'neutral'}>{g.enabled ? 'on' : 'off'}</Badge>}
          {g.configured && <Badge tone={g.mode === 'live' ? 'info' : 'warn'}>{g.mode}</Badge>}
          {!simulator && !g.verified && <Badge tone="warn">sandbox only</Badge>}
        </div>
      }
    >
      <form onSubmit={save} className="space-y-4">
        {simulator && <Alert tone="info">A fake payment page for trying the whole checkout without real money. It is only available in development and is never shown in production.</Alert>}
        {!simulator && !g.verified && (
          <Alert tone="info">This connection has not yet been checked against {g.label}&apos;s official guide with your own merchant account, so live payments are locked. You can save your sandbox details and test.</Alert>
        )}
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

        {g.fields.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {g.fields.map((f) => (
              <Field key={f.key} label={f.label} hint={f.hint ?? (f.secret && g.configured ? 'Saved. Type a new value to replace it.' : undefined)}>
                <Input
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  required={f.required}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  onFocus={(e) => f.secret && (values[f.key] ?? '').startsWith('••••') && e.currentTarget.select()}
                />
              </Field>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mode" hint={mode === 'sandbox' ? 'Test payments only. No real money moves.' : 'Real money.'}>
            <Select value={mode} onChange={(e) => setMode(e.target.value as 'sandbox' | 'live')} disabled={simulator}>
              <option value="sandbox">Sandbox (testing)</option>
              <option value="live" disabled={!g.canGoLive}>Live{!g.canGoLive ? ' (locked)' : ''}</option>
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2.5 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Offer this payment method to customers
          </label>
        </div>

        {!simulator && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="font-medium">Return address for the {g.label} portal</div>
            <p className="mt-0.5 text-xs text-slate-500">Register this address as the return (or callback) URL for your merchant account.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-surface px-2 py-1 text-xs ring-1 ring-slate-200">{g.returnUrl}</code>
              <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(g.returnUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={busy}>Save</Button>
          {g.configured && !simulator && (
            <ConfirmButton label="Remove credentials" confirmLabel="Yes, remove" onConfirm={async () => { await del(`/stores/${storeId}/payment-configs/${g.gateway}`); onChanged(); }} />
          )}
        </div>
      </form>
    </Card>
  );
}

export default function PaymentsPage() {
  const { store, can } = useStore();
  const [items, setItems] = useState<PaymentGatewayRow[] | null>(null);
  const [error, setError] = useState('');
  const [rev, setRev] = useState(0);

  const load = useCallback(() => {
    get<{ items: PaymentGatewayRow[] }>(`/stores/${store._id}/payment-configs`)
      .then((d) => { setItems(d.items); setRev((r) => r + 1); })
      .catch((e: ApiError) => setError(e.status === 403 ? 'Your role cannot manage payment settings.' : e.message));
  }, [store._id]);
  useEffect(load, [load]);

  if (!can('payment.credentials')) return <Alert>Your role cannot manage payment settings.</Alert>;
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <Loading />;

  return (
    <div className="space-y-6">
      <Alert tone="info">Each store uses its own merchant account. Cash on Delivery needs no setup (change it under Settings). Your credentials are stored encrypted and are never shown again after saving.</Alert>
      {items.map((g) => <GatewayCard key={`${g.gateway}-${rev}`} g={g} storeId={store._id} onChanged={load} />)}
    </div>
  );
}
