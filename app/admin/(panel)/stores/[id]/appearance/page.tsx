'use client';

import { ImagePlus, Palette } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useStore } from '@/components/admin/store-context';
import { Alert, Button, Card, Field, Input, Spinner } from '@/components/admin/ui';
import { ApiError, mediaUrl, patch, upload } from '@/lib/api';
import type { Store } from '@/lib/types';

const PRESETS = [
  ['Indigo', '#4f46e5'], ['Emerald', '#059669'], ['Violet', '#7c3aed'], ['Orange', '#ea580c'],
  ['Rose', '#e11d48'], ['Sky', '#0284c7'], ['Amber', '#d97706'], ['Slate', '#334155'],
] as const;

function PictureUpload({ label, hint, current, shape, kind, storeId, onDone }: { label: string; hint: string; current?: string; shape: 'logo' | 'banner'; kind: 'logo' | 'banner'; storeId: string; onDone: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function pick(file?: File) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return void toast.error('Use a JPEG, PNG or WebP picture.');
    if (file.size > 4 * 1024 * 1024) return void toast.error('That picture is larger than 4 MB.');
    setBusy(true);
    try {
      const r = await upload<{ url: string }>(`/stores/${storeId}/branding/${kind}`, 'image', file);
      onDone(r.url);
      toast.success(`${label} updated`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">{label}</div>
      <div className="flex items-center gap-4">
        <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-slate-200 bg-slate-100 text-slate-400 ${shape === 'logo' ? 'h-20 w-20 rounded-full' : 'h-20 w-44 rounded-xl'}`}>
          {current ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={mediaUrl(current)} alt={`${label} preview`} className="h-full w-full object-cover" /> : <ImagePlus size={22} aria-hidden />}
        </div>
        <div>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id={`up-${kind}`} onChange={(e) => pick(e.target.files?.[0])} />
          <label htmlFor={`up-${kind}`} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-surface px-3.5 py-2 text-sm font-medium hover:bg-slate-50 ${busy ? 'pointer-events-none opacity-60' : ''}`}>{busy ? <Spinner small /> : null}{current ? 'Replace' : 'Upload'}</label>
          <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
        </div>
      </div>
    </div>
  );
}

export default function AppearancePage() {
  const { store, setStore, can } = useStore();
  const theme = store.settings.theme ?? {};
  const [accent, setAccent] = useState(theme.accentColor ?? '#4f46e5');
  const [tagline, setTagline] = useState(theme.tagline ?? '');
  const [busy, setBusy] = useState(false);
  const validHex = /^#[0-9a-fA-F]{6}$/.test(accent);

  if (!can('store.settings')) return <Alert tone="info">Your role cannot change the store&apos;s appearance.</Alert>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!validHex) return void toast.error('Use a colour like #4f46e5.');
    setBusy(true);
    try {
      const saved = await patch<Store>(`/stores/${store._id}`, { settings: { theme: { accentColor: accent, tagline } } });
      setStore(saved);
      toast.success('Appearance saved. Your storefront now uses it.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card title="Brand">
          <div className="space-y-6">
            <PictureUpload label="Logo" hint="Square or round works best. JPEG, PNG or WebP, up to 4 MB." current={store.logoUrl} shape="logo" kind="logo" storeId={store._id} onDone={(url) => setStore({ ...store, logoUrl: url })} />
            <PictureUpload label="Home page banner" hint="Wide picture behind the title on your home page, about 1600×600." current={theme.bannerUrl} shape="banner" kind="banner" storeId={store._id} onDone={(url) => setStore({ ...store, settings: { ...store.settings, theme: { ...theme, bannerUrl: url } } })} />
            <Field label="Tagline" hint="One short line under your store name."><Input maxLength={120} value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Fresh, simple ordering" /></Field>
          </div>
        </Card>

        <Card title="Accent colour">
          <p className="mb-4 text-sm text-slate-600">Used for buttons, links and highlights on your storefront.</p>
          <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent colour presets">
            {PRESETS.map(([name, hex]) => (
              <button key={hex} type="button" role="radio" aria-checked={accent.toLowerCase() === hex} aria-label={name} title={name} onClick={() => setAccent(hex)}
                className={`h-9 w-9 rounded-full ring-offset-2 ring-offset-[var(--surface)] transition-all hover:scale-110 ${accent.toLowerCase() === hex ? 'ring-2 ring-slate-900' : ''}`} style={{ background: hex }} />
            ))}
          </div>
          <div className="mt-4 flex max-w-xs items-end gap-3">
            <input type="color" aria-label="Pick a custom colour" value={validHex ? accent : '#4f46e5'} onChange={(e) => setAccent(e.target.value)} className="h-10 w-12 cursor-pointer rounded-lg border border-slate-300 bg-surface p-1" />
            <Field label="Custom colour" error={validHex ? undefined : 'Use a colour like #4f46e5'}><Input value={accent} onChange={(e) => setAccent(e.target.value)} maxLength={7} /></Field>
          </div>
        </Card>

        <div className="flex items-center gap-3"><Button type="submit" loading={busy}><Palette size={16} /> Save appearance</Button></div>
      </div>

      <aside aria-label="Preview" className="lg:sticky lg:top-24 lg:self-start">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Preview</div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-sm" style={{ ['--accent' as string]: validHex ? accent : '#4f46e5' }}>
          <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3">
            {store.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={mediaUrl(store.logoUrl)} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="h-7 w-7 rounded-full bg-accent" />}
            <span className="text-sm font-bold">{store.name}</span>
          </div>
          <div className="relative px-5 py-9 text-center text-white" style={{ background: theme.bannerUrl ? `linear-gradient(rgb(0 0 0/.45), rgb(0 0 0/.45)), url(${mediaUrl(theme.bannerUrl)}) center/cover` : 'linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 55%, black))' }}>
            <div className="text-xl font-bold">{store.name}</div>
            <div className="mt-1 text-xs opacity-90">{tagline || 'Your tagline appears here'}</div>
            <span className="mt-4 inline-block rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-slate-900">Shop now</span>
          </div>
          <div className="space-y-3 p-4">
            <div className="grid grid-cols-3 gap-2">{[0, 1, 2].map((i) => <div key={i} className="aspect-square rounded-lg bg-slate-100" />)}</div>
            <span className="inline-flex w-full items-center justify-center rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white">Add to basket</span>
          </div>
        </div>
      </aside>
    </form>
  );
}
