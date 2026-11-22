'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@/components/admin/store-context';
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, Loading, Select } from '@/components/admin/ui';
import { ApiError, del, get, patch, post } from '@/lib/api';
import type { Category } from '@/lib/types';

interface Row extends Category {
  depth: number;
}

/** Depth-first order so children sit under their parent. */
function flatten(items: Category[]): Row[] {
  const byParent = new Map<string, Category[]>();
  for (const c of items) {
    const key = c.parentId ?? '';
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }
  const out: Row[] = [];
  const walk = (parent: string, depth: number) => {
    for (const c of byParent.get(parent) ?? []) {
      out.push({ ...c, depth });
      if (depth < 10) walk(c._id, depth + 1);
    }
  };
  walk('', 0);
  return out;
}

function CategoryForm({
  initial,
  options,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: Category;
  options: Row[];
  onSubmit: (v: { name: string; parentId: string | null; active: boolean }) => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [parentId, setParentId] = useState(initial?.parentId ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), parentId: parentId || null, active });
      if (!initial) setName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[2fr_2fr_auto]">
        <Field label="Name">
          <Input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Frozen food" />
        </Field>
        <Field label="Parent category">
          <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {options
              .filter((o) => o._id !== initial?._id)
              .map((o) => (
                <option key={o._id} value={o._id}>
                  {'— '.repeat(o.depth)}
                  {o.name}
                </option>
              ))}
          </Select>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Visible
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>{submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  );
}

export default function CategoriesPage() {
  const { store, can } = useStore();
  const canWrite = can('product.write');
  const [items, setItems] = useState<Category[] | null>(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    get<{ items: Category[] }>(`/stores/${store._id}/categories`)
      .then((d) => setItems(d.items))
      .catch((e: ApiError) => setError(e.message));
  }, [store._id]);
  useEffect(load, [load]);

  const rows = useMemo(() => flatten(items ?? []), [items]);

  if (error) return <Alert>{error}</Alert>;
  if (!items) return <Loading />;

  return (
    <div className="space-y-6">
      {canWrite && (
        <Card title="Add a category">
          <CategoryForm
            options={rows}
            submitLabel="Add category"
            onSubmit={async (v) => {
              await post(`/stores/${store._id}/categories`, v);
              load();
            }}
          />
        </Card>
      )}

      <Card title={`Categories (${items.length})`}>
        {actionError && <div className="mb-3"><Alert>{actionError}</Alert></div>}
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-slate-500">No categories yet. Categories group your products on the storefront.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((c) => (
              <li key={c._id} className="py-3">
                {editing === c._id ? (
                  <CategoryForm
                    initial={c}
                    options={rows}
                    submitLabel="Save"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (v) => {
                      await patch(`/stores/${store._id}/categories/${c._id}`, v);
                      setEditing(null);
                      load();
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3" style={{ paddingLeft: c.depth * 24 }}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {!c.active && <Badge tone="warn">hidden</Badge>}
                      <span className="text-xs text-slate-500">{c.productCount} {c.productCount === 1 ? 'product' : 'products'}</span>
                    </div>
                    {canWrite && (
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={() => setEditing(c._id)}>Edit</Button>
                        <ConfirmButton
                          label="Delete"
                          confirmLabel="Yes, delete"
                          onConfirm={async () => {
                            try {
                              await del(`/stores/${store._id}/categories/${c._id}`);
                              setActionError('');
                              load();
                            } catch (e) {
                              setActionError(e instanceof ApiError ? e.message : 'Could not delete');
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
