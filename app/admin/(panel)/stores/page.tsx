'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Input, Loading, PageHeader, Select, formatDate, statusTone } from '@/components/admin/ui';
import { ApiError, PLATFORM_DOMAIN, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Page, StoreSummary } from '@/lib/types';

export default function StoresPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<StoreSummary> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '15' });
    if (debounced) qs.set('search', debounced);
    if (status) qs.set('status', status);
    if (type) qs.set('type', type);
    let alive = true;
    get<Page<StoreSummary>>(`/stores?${qs}`)
      .then((d) => alive && (setData(d), setError('')))
      .catch((e: ApiError) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [debounced, status, type, page]);

  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <PageHeader
        title="Stores"
        subtitle="Every website managed from this panel."
        action={
          user?.isSuperAdmin && (
            <Link href="/admin/stores/new">
              <Button>New store</Button>
            </Link>
          )
        }
      />
      <Card>
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="min-w-56 flex-1">
            <Input
              type="search"
              aria-label="Search stores"
              placeholder="Search by name or subdomain"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <Select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!w-52">
            <option value="">Active and suspended</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
          </Select>
          <Select aria-label="Type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="!w-36">
            <option value="">All types</option>
            <option value="native">Native</option>
            <option value="external">External</option>
          </Select>
        </div>

        {error && <Alert>{error}</Alert>}
        {!data && !error && <Loading />}
        {data && data.items.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            {debounced || status || type ? 'No stores match these filters.' : 'No stores yet.'}
          </p>
        )}
        {data && data.items.length > 0 && (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Store</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((s) => (
                  <tr key={s._id} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/admin/stores/${s._id}`} className="font-medium text-brand-700 hover:underline">{s.name}</Link>
                      <div className="text-xs text-slate-500">{s.subdomain}.{PLATFORM_DOMAIN}</div>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={s.type === 'native' ? 'info' : 'neutral'}>{s.type}</Badge>
                      {s.type === 'external' && <span className="ml-2 text-xs text-slate-500">{s.platform}</span>}
                    </td>
                    <td className="px-3 py-3"><Badge tone={statusTone(s.status)}>{s.status}</Badge></td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > data.limit && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{data.total} stores</span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span>Page {page} of {pages}</span>
              <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
