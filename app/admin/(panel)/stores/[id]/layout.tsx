'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StoreContext } from '@/components/admin/store-context';
import { Alert, Badge, Button, ConfirmButton, Loading, PageHeader, formatDate, statusTone } from '@/components/admin/ui';
import { ApiError, PLATFORM_DOMAIN, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Store } from '@/lib/types';

interface Me {
  memberships: { store: { _id: string }; role: { permissions: string[] } }[];
}

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { user } = useAuth();
  const [store, setStore] = useState<Store | null>(null);
  const [perms, setPerms] = useState<Set<string> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    get<Store>(`/stores/${id}`)
      .then(setStore)
      .catch((e: ApiError) =>
        setError(e.status === 403 || e.status === 404 ? 'You do not have access to this store, or it does not exist.' : e.message),
      );
    get<Me>('/auth/me')
      .then((me) => {
        const m = me.memberships.find((x) => x.store._id === id);
        setPerms(new Set(m?.role.permissions ?? []));
      })
      .catch(() => setPerms(new Set()));
  }, [id]);

  const isSuper = !!user?.isSuperAdmin;
  const can = useCallback((p: string) => isSuper || (perms?.has(p) ?? false), [isSuper, perms]);
  const ctx = useMemo(() => (store ? { store, setStore, can } : null), [store, can]);

  async function setStatus(action: 'suspend' | 'reactivate' | 'archive') {
    try {
      const s = await post<Store>(`/stores/${id}/${action}`);
      setStore((prev) => (prev ? { ...prev, status: s.status } : prev));
      setNotice(action === 'archive' ? 'Store archived. Its data is kept.' : `Store ${s.status === 'active' ? 'reactivated' : 'suspended'}.`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : 'Could not change the status');
    }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!store || !ctx || !perms) return <Loading />;

  const base = `/admin/stores/${store._id}`;
  // the store's own address; .localhost names open directly in modern browsers during development
  const storefrontUrl = `${PLATFORM_DOMAIN.startsWith('localhost') ? 'http' : 'https'}://${store.subdomain}.${PLATFORM_DOMAIN}`;
  const tabs = [
    ...(can('report.view') ? [{ href: `${base}/overview`, label: 'Overview' }] : []),
    { href: base, label: 'Settings', exact: true },
    { href: `${base}/orders`, label: 'Orders' },
    { href: `${base}/products`, label: 'Products' },
    { href: `${base}/categories`, label: 'Categories' },
    ...(can('store.settings') ? [{ href: `${base}/appearance`, label: 'Appearance' }] : []),
    ...(can('payment.credentials') ? [{ href: `${base}/payments`, label: 'Payments' }] : []),
    ...(can('user.manage') ? [{ href: `${base}/team`, label: 'Team' }] : []),
  ];

  return (
    <StoreContext.Provider value={ctx}>
      <div className="mb-3 text-sm">
        <Link href="/admin/stores" className="text-slate-600 hover:underline">← All stores</Link>
      </div>
      <PageHeader
        title={store.name}
        subtitle={<a href={storefrontUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">{store.subdomain}.{PLATFORM_DOMAIN} ↗</a>}
        action={
          isSuper && store.status !== 'archived' ? (
            <div className="flex flex-wrap gap-2">
              {store.status === 'active' ? (
                <ConfirmButton label="Suspend" confirmLabel="Yes, suspend" onConfirm={() => setStatus('suspend')} />
              ) : (
                <Button variant="secondary" onClick={() => setStatus('reactivate')}>Reactivate</Button>
              )}
              <ConfirmButton label="Archive" confirmLabel="Yes, archive" onConfirm={() => setStatus('archive')} />
            </div>
          ) : undefined
        }
      />
      {notice && <div className="mb-4"><Alert tone="good">{notice}</Alert></div>}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(store.status)}>{store.status}</Badge>
        <Badge tone={store.type === 'native' ? 'info' : 'neutral'}>{store.type}</Badge>
        {store.type === 'external' && <Badge>{store.platform}</Badge>}
        <span className="text-xs text-slate-500">Created {formatDate(store.createdAt)} · {store.currency}</span>
      </div>

      <nav aria-label="Store sections" className="mb-6 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => {
          const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </StoreContext.Provider>
  );
}
