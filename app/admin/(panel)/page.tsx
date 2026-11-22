'use client';

import { Boxes, ClipboardList, Plus, Store as StoreIcon, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AnalyticsView } from '@/components/admin/analytics-view';
import { CountUp } from '@/components/admin/charts';
import { Alert, Badge, Button, Card, EmptyState, Loading, PageHeader, Skeleton, formatDate, statusTone } from '@/components/admin/ui';
import { ApiError, PLATFORM_DOMAIN, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AuditRow, DashboardData, Page, StoreSummary } from '@/lib/types';

function Glance({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-surface p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">{icon}</span>
      <div>
        <div className="text-xl font-semibold leading-tight"><CountUp value={value} /></div>
        <div className="text-xs text-slate-500">{label}{hint ? ` · ${hint}` : ''}</div>
      </div>
    </div>
  );
}

function SuperAdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [recent, setRecent] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([get<DashboardData>('/dashboard'), get<{ items: AuditRow[] }>('/audit-logs?limit=8')])
      .then(([d, a]) => {
        setData(d);
        setRecent(a.items);
      })
      .catch((e: ApiError) => setError(e.message));
  }, []);

  if (error) return <Alert>{error}</Alert>;
  const noStores = data && data.stores.active + data.stores.suspended === 0;

  return (
    <div className="space-y-6">
      {data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Glance icon={<StoreIcon size={18} />} label="Active stores" value={data.stores.active} hint={`${data.stores.native} native, ${data.stores.external} external`} />
          <Glance icon={<Boxes size={18} />} label="Products" value={data.products} />
          <Glance icon={<ClipboardList size={18} />} label="Orders, all time" value={data.orders} />
          <Glance icon={<UsersRound size={18} />} label="Customers" value={data.customers} hint={`${data.staff} staff`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[74px]" />)}</div>
      )}

      {noStores && (
        <Card>
          <EmptyState icon={<StoreIcon size={22} />} title="Create your first store" action={<Link href="/admin/stores/new"><Button><Plus size={16} /> New store</Button></Link>}>
            Stores are the websites customers shop on. Create one, add products, and it goes live on its own address.
          </EmptyState>
        </Card>
      )}

      <AnalyticsView />

      <Card title="Recent activity" action={<Link href="/admin/audit" className="text-sm font-medium text-brand-700 hover:underline">View all</Link>}>
        {!recent ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5" />)}</div>
        ) : recent.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.action}</code>{' '}
                  <span className="text-slate-600">by {r.userId?.name ?? 'system'}</span>
                  {r.storeId && <span className="text-slate-500"> in {r.storeId.name}</span>}
                </span>
                <span className="text-xs text-slate-500">{formatDate(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StaffDashboard() {
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  useEffect(() => {
    get<Page<StoreSummary>>('/stores').then((p) => setStores(p.items));
  }, []);
  if (!stores) return <Loading />;
  if (stores.length === 0) {
    return <Card><EmptyState icon={<StoreIcon size={22} />} title="No store yet">You are not assigned to a store. Ask the Super Admin to add you to one.</EmptyState></Card>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {stores.map((s) => (
        <Link key={s._id} href={`/admin/stores/${s._id}/overview`} className="group rounded-2xl border border-slate-200 bg-surface p-5 shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start justify-between">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white">{s.name.slice(0, 2).toUpperCase()}</span>
            <Badge tone={statusTone(s.status)}>{s.status}</Badge>
          </div>
          <div className="mt-4 font-semibold group-hover:text-brand-700">{s.name}</div>
          <div className="text-xs text-slate-500">{s.subdomain}.{PLATFORM_DOMAIN}</div>
        </Link>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return (
    <>
      <PageHeader title={`${greeting}, ${user?.name.split(' ')[0] ?? ''}`} subtitle={user?.isSuperAdmin ? 'Everything across your stores at a glance.' : 'Your stores.'} />
      {user?.isSuperAdmin ? <SuperAdminDashboard /> : <StaffDashboard />}
    </>
  );
}
