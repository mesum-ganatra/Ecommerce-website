'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Card, Loading, PageHeader, formatDate } from '@/components/admin/ui';
import { ApiError, get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { AuditRow } from '@/lib/types';

export default function AuditPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    get<{ items: AuditRow[] }>('/audit-logs?limit=100')
      .then((d) => setRows(d.items))
      .catch((e: ApiError) => setError(e.message));
  }, [user]);

  if (user && !user.isSuperAdmin) return <Alert>Only the Super Admin can read the platform audit log.</Alert>;

  return (
    <>
      <PageHeader title="Audit log" subtitle="Sign-ins and sensitive changes, newest first. The last 100 entries." />
      <Card>
        {error && <Alert>{error}</Alert>}
        {!rows && !error && <Loading />}
        {rows && rows.length === 0 && <p className="py-6 text-center text-sm text-slate-500">No activity yet.</p>}
        {rows && rows.length > 0 && (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">When</th>
                  <th className="px-3 py-2.5 font-medium">Who</th>
                  <th className="px-3 py-2.5 font-medium">Action</th>
                  <th className="px-5 py-2.5 font-medium">Store</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r._id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-slate-600">{formatDate(r.createdAt)}</td>
                    <td className="px-3 py-2.5">{r.userId?.name ?? 'system'}</td>
                    <td className="px-3 py-2.5">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{r.action}</code>
                      {r.viaStoreSwitch && <span className="ml-2"><Badge tone="warn">via store switch</Badge></span>}
                    </td>
                    <td className="px-5 py-2.5 text-slate-600">{r.storeId?.name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
