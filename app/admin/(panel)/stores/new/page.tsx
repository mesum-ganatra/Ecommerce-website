'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert, Button, Card, Field, Input, PageHeader, Select } from '@/components/admin/ui';
import { ApiError, PATH_STORES, PLATFORM_DOMAIN, post, storeAddress } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Store } from '@/lib/types';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export default function NewStorePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [touched, setTouched] = useState(false);
  const [type, setType] = useState<'native' | 'external'>('native');
  const [platform, setPlatform] = useState('generic_rest');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  if (user && !user.isSuperAdmin) {
    return <Alert>Only the Super Admin can create stores.</Alert>;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      const store = await post<Store>('/stores', {
        name,
        subdomain,
        type,
        ...(type === 'external' ? { platform } : {}),
      });
      router.replace(`/admin/stores/${store._id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(Object.fromEntries((err.details ?? []).map((d) => [d.field, d.message])));
      } else setError('Could not create the store');
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New store" subtitle="Create a website on the platform, or connect one that already exists." />
      <form onSubmit={onSubmit} className="max-w-2xl">
        <Card>
          <div className="space-y-5">
          {error && <Alert>{error}</Alert>}
          <Field label="Store name" error={fieldErrors.name}>
            <Input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!touched) setSubdomain(slugify(e.target.value));
              }}
              placeholder="Kabab Jess"
            />
          </Field>
          <Field label="Subdomain" error={fieldErrors.subdomain} hint="Lowercase letters, digits and hyphens. It cannot be changed later by store staff.">
            <div className="flex items-center gap-2">
              <Input
                required
                value={subdomain}
                onChange={(e) => {
                  setTouched(true);
                  setSubdomain(e.target.value.toLowerCase());
                }}
                placeholder="kababjess"
                pattern="[a-z0-9]([a-z0-9\-]{0,61}[a-z0-9])?"
              />
              <span className="whitespace-nowrap text-sm text-slate-500">{PATH_STORES ? `← ${storeAddress(subdomain || 'name')}` : `.${PLATFORM_DOMAIN}`}</span>
            </div>
          </Field>

          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-800">Store type</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['native', 'Native store', 'Runs on this platform with its own storefront, checkout and payments.'],
                  ['external', 'External website', 'An existing site. Its products and orders are synced into this panel.'],
                ] as const
              ).map(([value, title, help]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg border p-3.5 ${type === value ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-slate-300 bg-surface hover:bg-slate-50'}`}
                >
                  <input type="radio" name="type" value={value} checked={type === value} onChange={() => setType(value)} className="sr-only" />
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{help}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {type === 'external' && (
            <Field label="Platform" hint="Pick Generic REST if the site is custom built. Connection details are added on the next screen.">
              <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="generic_rest">Generic REST API</option>
                <option value="woocommerce">WooCommerce</option>
                <option value="shopify">Shopify</option>
              </Select>
            </Field>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={busy}>Create store</Button>
            <Link href="/admin/stores" className="text-sm text-slate-600 hover:underline">Cancel</Link>
          </div>
          </div>
        </Card>
      </form>
    </>
  );
}
