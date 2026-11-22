'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, Select, formatDate } from '@/components/admin/ui';
import { ImageManager, type ImageItem } from '@/components/admin/image-manager';
import { ApiError, del, get, mediaUrl, post, patch, upload, uploadDigitalFile } from '@/lib/api';
import { fileSize, formatAttributes, parseAttributes, rs, toPaisa, toRupees } from '@/lib/format';
import type { Category, ProductDetail, StockMovement, Variant } from '@/lib/types';

interface VariantForm {
  key: string;
  existing: boolean; // already saved: its stock is changed only through "Adjust stock"
  sku: string;
  attrs: string;
  price: string; // rupees
  compareAt: string;
  stock: string;
  barcode: string;
  weight: string;
  active: boolean;
  currentStock: number;
}

let counter = 0;
const newKey = () => `v${++counter}`;

const emptyVariant = (): VariantForm => ({
  key: newKey(), existing: false, sku: '', attrs: '', price: '', compareAt: '', stock: '0', barcode: '', weight: '', active: true, currentStock: 0,
});

const fromVariant = (v: Variant): VariantForm => ({
  key: newKey(), existing: true, sku: v.sku, attrs: formatAttributes(v.attributes), price: toRupees(v.price), compareAt: toRupees(v.compareAtPrice),
  stock: String(v.stock), barcode: v.barcode ?? '', weight: v.weightGrams ? String(v.weightGrams) : '', active: v.active, currentStock: v.stock,
});

const REASONS = [
  ['restock', 'Restock (new stock arrived)'],
  ['correction', 'Correction (stock count)'],
  ['damaged', 'Damaged or lost'],
  ['return', 'Customer return'],
  ['other', 'Other'],
] as const;

// ------------------------------------------------------------------ stock adjuster
function StockAdjuster({ storeId, productId, sku, onChanged }: { storeId: string; productId: string; sku: string; onChanged: (stock: number) => void }) {
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<string>('restock');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!open) return <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Adjust stock</Button>;

  async function apply() {
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0) return setError('Enter a whole number, like 10 or -3.');
    setBusy(true);
    setError('');
    try {
      const r = await post<{ stock: number }>(`/stores/${storeId}/products/${productId}/stock`, { sku, delta: n, reason, note: note.trim() || undefined });
      onChanged(r.stock);
      setOpen(false);
      setDelta('');
      setNote('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not adjust stock');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/50 p-3">
      {error && <div className="mb-2"><Alert>{error}</Alert></div>}
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
        <Field label="Change by" hint="Use a minus to remove">
          <Input type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+10 or -3" autoFocus />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Note (optional)"><Input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" onClick={apply} loading={busy}>Apply</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ main form
export function ProductForm({ storeId, product }: { storeId: string; product?: ProductDetail }) {
  const router = useRouter();
  const editing = Boolean(product);

  const [name, setName] = useState(product?.name ?? '');
  const [slug, setSlug] = useState(product?.slug ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [type, setType] = useState<'physical' | 'digital'>(product?.type ?? 'physical');
  const [status, setStatus] = useState(product?.status ?? 'draft');
  const [images, setImages] = useState<ImageItem[]>((product?.images ?? []).map((i) => ({ url: i.url, alt: i.alt ?? '' })));
  const [variants, setVariants] = useState<VariantForm[]>(product ? product.variants.map(fromVariant) : [emptyVariant()]);
  const [allowBackorder, setAllowBackorder] = useState(product?.allowBackorder ?? false);
  const [expiryDays, setExpiryDays] = useState(product?.download?.expiryDays ? String(product.download.expiryDays) : '');
  const [downloadLimit, setDownloadLimit] = useState(product?.download?.downloadLimit ? String(product.download.downloadLimit) : '');
  const [seoTitle, setSeoTitle] = useState(product?.seo?.title ?? '');
  const [seoDescription, setSeoDescription] = useState(product?.seo?.description ?? '');
  const [files, setFiles] = useState(product?.digitalFiles ?? []);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [history, setHistory] = useState<StockMovement[]>([]);
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get<{ items: Category[] }>(`/stores/${storeId}/categories`).then((d) => setCategories(d.items)).catch(() => undefined);
  }, [storeId]);

  const loadHistory = () => {
    if (product) get<{ items: StockMovement[] }>(`/stores/${storeId}/products/${product._id}/stock-movements`).then((d) => setHistory(d.items)).catch(() => undefined);
  };
  useEffect(loadHistory, [storeId, product?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  // surface a "some uploads failed" notice after creating a product
  useEffect(() => {
    const failed = new URLSearchParams(window.location.search).get('uploadFailed');
    if (failed) setError(`${failed} file(s) could not be uploaded. Add them again below.`);
  }, []);

  const digital = type === 'digital';
  const updateVariant = (key: string, patchObj: Partial<VariantForm>) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patchObj } : v)));

  const summary = useMemo(() => {
    const prices = variants.map((v) => toPaisa(v.price)).filter((n) => Number.isFinite(n) && n > 0);
    return prices.length ? `${rs(Math.min(...prices))}${Math.min(...prices) !== Math.max(...prices) ? ` – ${rs(Math.max(...prices))}` : ''}` : '';
  }, [variants]);

  // ---------------------------------------------------------- images
  async function addImageFiles(list: FileList | File[] | null) {
    if (!list) return;
    const picked = Array.from(list);
    setError('');
    if (images.length + picked.length > 10) return setError('A product can have up to 10 photos.');
    for (const f of picked) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) return setError('Photos must be JPEG, PNG or WebP.');
      if (f.size > 4 * 1024 * 1024) return setError(`${f.name} is larger than 4 MB.`);
    }
    if (!editing) {
      setImages((prev) => [...prev, ...picked.map((file) => ({ url: URL.createObjectURL(file), alt: '', file }))]);
      return;
    }
    setUploading(true);
    try {
      for (const f of picked) {
        const r = await upload<{ url: string }>(`/stores/${storeId}/products/${product!._id}/images`, 'image', f);
        setImages((prev) => [...prev, { url: r.url, alt: '' }]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (imageInput.current) imageInput.current.value = '';
    }
  }

  function addImageUrl() {
    const u = imageUrl.trim();
    if (!/^https:\/\//.test(u)) return setError('Image links must start with https://');
    if (images.length >= 10) return setError('A product can have up to 10 photos.');
    setImages((prev) => [...prev, { url: u, alt: '' }]);
    setImageUrl('');
    setError('');
  }

  const moveImage = (i: number, dir: -1 | 1) =>
    setImages((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // ---------------------------------------------------------- digital files
  async function addDigitalFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list);
    setError('');
    for (const f of picked) if (f.size > 50 * 1024 * 1024) return setError(`${f.name} is larger than 50 MB.`);
    if (!editing) {
      setQueuedFiles((prev) => [...prev, ...picked]);
      return;
    }
    setUploading(true);
    try {
      for (const f of picked) {
        const r = await uploadDigitalFile(storeId, product!._id, f);
        setFiles((prev) => [...prev, r]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  // ---------------------------------------------------------- save
  function buildPayload() {
    return {
      name: name.trim(),
      ...(editing && slug ? { slug } : {}),
      description,
      brand: brand.trim(),
      categoryId: categoryId || null,
      status,
      allowBackorder,
      download: digital ? { ...(expiryDays ? { expiryDays: Number(expiryDays) } : {}), ...(downloadLimit ? { downloadLimit: Number(downloadLimit) } : {}) } : {},
      seo: { title: seoTitle.trim() || undefined, description: seoDescription.trim() || undefined },
      // photos already on the server (queued files are uploaded after the product exists)
      ...(editing ? { images: images.filter((i) => !i.file).map((i) => ({ url: i.url, alt: i.alt || undefined })) } : {
        images: images.filter((i) => !i.file).map((i) => ({ url: i.url, alt: i.alt || undefined })),
      }),
      variants: variants.map((v) => ({
        sku: v.sku.trim(),
        attributes: parseAttributes(v.attrs),
        price: toPaisa(v.price),
        ...(v.compareAt ? { compareAtPrice: toPaisa(v.compareAt) } : {}),
        stock: digital ? 0 : Math.max(0, Math.floor(Number(v.stock) || 0)),
        ...(v.barcode.trim() ? { barcode: v.barcode.trim() } : {}),
        ...(!digital && v.weight ? { weightGrams: Number(v.weight) } : {}),
        active: v.active,
      })),
    };
  }

  function validate(): string {
    if (!name.trim()) return 'Give the product a name.';
    for (const [i, v] of variants.entries()) {
      if (!v.sku.trim()) return `Variant ${i + 1} needs a SKU (a code for this item, like KJ-SEEKH-500).`;
      if (v.price === '' || !Number.isFinite(toPaisa(v.price)) || toPaisa(v.price) < 0) return `Variant ${i + 1} needs a price.`;
    }
    const skus = variants.map((v) => v.sku.trim().toLowerCase());
    if (new Set(skus).size !== skus.length) return 'Each variant needs a different SKU.';
    if (digital && status === 'active' && files.length + queuedFiles.length === 0) return 'Add a file before making a digital product active, or keep it as a draft.';
    return '';
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setFieldErrors({});
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    try {
      if (!editing) {
        const created = await post<{ _id: string }>(`/stores/${storeId}/products`, {
          ...buildPayload(),
          type,
          // a digital product cannot be active until its file is uploaded; activate afterwards
          status: digital && status === 'active' ? 'draft' : status,
        });
        let failed = 0;
        for (const img of images.filter((i) => i.file)) {
          try { await upload(`/stores/${storeId}/products/${created._id}/images`, 'image', img.file!); } catch { failed++; }
        }
        for (const f of queuedFiles) {
          try { await uploadDigitalFile(storeId, created._id, f); } catch { failed++; }
        }
        if (digital && status === 'active' && queuedFiles.length > failed) {
          await patch(`/stores/${storeId}/products/${created._id}`, { status: 'active' }).catch(() => undefined);
        }
        router.replace(`/admin/stores/${storeId}/products/${created._id}${failed ? `?uploadFailed=${failed}` : ''}`);
        return;
      }
      const updated = await patch<ProductDetail>(`/stores/${storeId}/products/${product!._id}`, buildPayload());
      setVariants(updated.variants.map(fromVariant));
      setSlug(updated.slug);
      setSaved(true);
      loadHistory();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries((err.details ?? []).map((d) => [d.field, d.message])));
      } else setError('Could not save the product');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {saved && <Alert tone="good">Saved.</Alert>}

      <Card title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Product name" error={fieldErrors.name}>
              <Input required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chicken seekh kabab 500 g" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Description">
              <textarea
                rows={5}
                maxLength={20000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </Field>
          </div>
          <Field label="Category">
            <Select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">No category</option>
              {categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Brand"><Input maxLength={80} value={brand} onChange={(e) => setBrand(e.target.value)} /></Field>

          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Product type</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['physical', 'Physical product', 'Shipped to the customer. Has stock, weight and a shipping step.'], ['digital', 'Digital product', 'A file the customer downloads after paying. No shipping or stock.']] as const).map(([v, t, h]) => (
                <label key={v} className={`rounded-lg border p-3.5 ${editing ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${type === v ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-300 bg-surface'}`}>
                  <input type="radio" name="type" className="sr-only" checked={type === v} disabled={editing} onChange={() => setType(v)} />
                  <span className="block text-sm font-medium">{t}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{h}</span>
                </label>
              ))}
            </div>
            {editing && <p className="mt-1.5 text-xs text-slate-500">The type cannot be changed after the product is created.</p>}
          </fieldset>

          <Field label="Status" hint="Only active products appear on the storefront.">
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </Field>
          {editing && (
            <Field label="URL name (slug)" error={fieldErrors.slug} hint="Used in the product link.">
              <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} pattern="[a-z0-9]+(-[a-z0-9]+)*" />
            </Field>
          )}
        </div>
      </Card>

      <Card title={`Photos (${images.length}/10)`}>
        <ImageManager images={images} setImages={setImages} onFiles={addImageFiles} uploading={uploading} />
        <div className="mt-3 flex max-w-xl gap-2">
          <Input aria-label="Image link" placeholder="Or paste an https:// image link" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
          <Button type="button" variant="secondary" onClick={addImageUrl}>Add link</Button>
        </div>
      </Card>

      {digital && (
        <Card title="Downloadable files">
          <p className="mb-3 text-sm text-slate-600">Customers get these after payment. Files are stored privately and are never shown on a public link.</p>
          {(files.length > 0 || queuedFiles.length > 0) && (
            <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {files.map((f) => (
                <li key={f._id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>{f.name} <span className="text-xs text-slate-500">{fileSize(f.sizeBytes)}</span></span>
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Yes, remove"
                    onConfirm={async () => {
                      try {
                        await del(`/stores/${storeId}/products/${product!._id}/files/${f._id}`);
                        setFiles((p) => p.filter((x) => x._id !== f._id));
                        setError('');
                      } catch (e) {
                        setError(e instanceof ApiError ? e.message : 'Could not remove the file');
                      }
                    }}
                  />
                </li>
              ))}
              {queuedFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>{f.name} <span className="text-xs text-slate-500">{fileSize(f.size)} · uploads when you save</span></span>
                  <Button type="button" variant="ghost" onClick={() => setQueuedFiles((p) => p.filter((_, k) => k !== i))}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileInput} type="file" multiple className="sr-only" id="file-input" onChange={(e) => addDigitalFiles(e.target.files)} />
          <label htmlFor="file-input" className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-surface px-3.5 py-2 text-sm font-medium hover:bg-slate-50 ${uploading ? 'pointer-events-none opacity-50' : ''}`}>
            {uploading ? 'Uploading…' : 'Add a file'}
          </label>
          <span className="ml-3 text-xs text-slate-500">Up to 50 MB each.</span>
          <div className="mt-5 grid max-w-lg gap-4 sm:grid-cols-2">
            <Field label="Download link valid for (days)" hint="Empty uses the store default."><Input type="number" min={1} max={3650} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} /></Field>
            <Field label="Downloads allowed" hint="Empty uses the store default."><Input type="number" min={1} max={1000} value={downloadLimit} onChange={(e) => setDownloadLimit(e.target.value)} /></Field>
          </div>
        </Card>
      )}

      <Card
        title={`Variants and pricing${summary ? ` · ${summary}` : ''}`}
        action={<Button type="button" variant="secondary" onClick={() => setVariants((v) => [...v, emptyVariant()])}>Add variant</Button>}
      >
        <p className="mb-4 text-sm text-slate-600">
          A variant is one thing a customer can buy, like &quot;1 kg pack&quot; or &quot;Size L, Red&quot;. A simple product has just one. Prices are in rupees.
        </p>
        <div className="space-y-4">
          {variants.map((v, i) => (
            <div key={v.key} className="rounded-lg border border-slate-200 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium">Variant {i + 1}</span>
                <span className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={v.active} onChange={(e) => updateVariant(v.key, { active: e.target.checked })} /> On sale</label>
                  {variants.length > 1 && <Button type="button" variant="ghost" className="!px-2 !py-1 text-red-600" onClick={() => setVariants((p) => p.filter((x) => x.key !== v.key))}>Remove</Button>}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="SKU" error={fieldErrors[`variants.${i}.sku`]}><Input required value={v.sku} maxLength={64} onChange={(e) => updateVariant(v.key, { sku: e.target.value })} placeholder="KJ-SEEKH-500" /></Field>
                <Field label="Price (Rs)" error={fieldErrors[`variants.${i}.price`]}><Input required type="number" min={0} step="0.01" value={v.price} onChange={(e) => updateVariant(v.key, { price: e.target.value })} /></Field>
                <Field label="Compare-at price (Rs)" hint="Crossed-out old price"><Input type="number" min={0} step="0.01" value={v.compareAt} onChange={(e) => updateVariant(v.key, { compareAt: e.target.value })} /></Field>
                <Field label="Options" hint="e.g. Size: L, Color: Red"><Input value={v.attrs} onChange={(e) => updateVariant(v.key, { attrs: e.target.value })} /></Field>
                {!digital && !v.existing && <Field label="Starting stock"><Input type="number" min={0} step="1" value={v.stock} onChange={(e) => updateVariant(v.key, { stock: e.target.value })} /></Field>}
                {!digital && <Field label="Weight (grams)"><Input type="number" min={0} value={v.weight} onChange={(e) => updateVariant(v.key, { weight: e.target.value })} /></Field>}
                <Field label="Barcode"><Input value={v.barcode} maxLength={64} onChange={(e) => updateVariant(v.key, { barcode: e.target.value })} /></Field>
              </div>
              {!digital && v.existing && product && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                      In stock: <span className="text-lg font-semibold">{v.currentStock}</span>
                      {v.currentStock <= 0 && !allowBackorder && <span className="ml-2"><Badge tone="bad">sold out</Badge></span>}
                    </div>
                    <StockAdjuster storeId={storeId} productId={product._id} sku={v.sku} onChanged={(stock) => { updateVariant(v.key, { currentStock: stock }); loadHistory(); }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        {!digital && (
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} />
            Keep selling when stock runs out (backorder)
          </label>
        )}
      </Card>

      <Card title="Search engine listing">
        <div className="grid gap-4">
          <Field label="Page title" hint="Empty uses the product name."><Input maxLength={120} value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} /></Field>
          <Field label="Description" hint="Shown under the title in search results."><Input maxLength={320} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} /></Field>
        </div>
      </Card>

      {editing && !digital && history.length > 0 && (
        <Card title="Stock history">
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">SKU</th><th className="px-3 py-2 font-medium">Change</th><th className="px-3 py-2 font-medium">Balance</th><th className="px-3 py-2 font-medium">Reason</th><th className="px-5 py-2 font-medium">By</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => (
                  <tr key={h._id}>
                    <td className="whitespace-nowrap px-5 py-2 text-slate-600">{formatDate(h.createdAt)}</td>
                    <td className="px-3 py-2">{h.sku}</td>
                    <td className={`px-3 py-2 font-medium ${h.delta > 0 ? 'text-emerald-700' : 'text-red-600'}`}>{h.delta > 0 ? `+${h.delta}` : h.delta}</td>
                    <td className="px-3 py-2">{h.balanceAfter}</td>
                    <td className="px-3 py-2">{h.reason}{h.note ? ` · ${h.note}` : ''}</td>
                    <td className="px-5 py-2 text-slate-600">{h.userId?.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-slate-200 bg-canvas/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <Button type="submit" loading={busy}>{editing ? 'Save changes' : 'Create product'}</Button>
        <Button type="button" variant="ghost" onClick={() => router.push(`/admin/stores/${storeId}/products`)}>Back to products</Button>
      </div>
    </form>
  );
}
