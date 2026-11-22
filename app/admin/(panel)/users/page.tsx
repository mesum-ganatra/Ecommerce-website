'use client';

import { useCallback, useEffect, useState } from 'react';
import { InviteLink } from '@/components/admin/invite-link';
import { Alert, Badge, Button, Card, ConfirmButton, Input, Loading, PageHeader, formatDate } from '@/components/admin/ui';
import { ApiError, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Page, UserRow } from '@/lib/types';

export default function UsersPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<UserRow> | null>(null);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState<{ token: string; days: number; title: string } | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), limit: '20' });
    if (debounced) qs.set('search', debounced);
    get<Page<UserRow>>(`/users?${qs}`).then((d) => { setData(d); setError(''); }).catch((e: ApiError) => setError(e.message));
  }, [debounced, page]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try { await fn(); load(); } catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong'); }
  }

  if (user && !user.isSuperAdmin) return <Alert>Only the Super Admin can see all users.</Alert>;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <>
      <PageHeader title="Users" subtitle="Everyone who works in a store. Add people from a store's Team tab." />
      {invite && <div className="mb-4"><InviteLink token={invite.token} expiresInDays={invite.days} title={invite.title} onClose={() => setInvite(null)} /></div>}
      <Card>
        <div className="mb-4 max-w-md"><Input type="search" aria-label="Search users" placeholder="Search by name or email" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        {!data && !error && <Loading />}
        {data && data.items.length === 0 && <p className="py-8 text-center text-sm text-slate-500">{debounced ? 'No one matches.' : 'No store staff yet. Invite people from a store\'s Team tab.'}</p>}
        {data && data.items.length > 0 && (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-2.5 font-medium">Person</th><th className="px-3 py-2.5 font-medium">Works in</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-5 py-2.5 text-right font-medium">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((u) => (
                  <tr key={u._id}>
                    <td className="px-5 py-3">{u.name}<div className="text-xs text-slate-500">{u.email}{u.lastLoginAt ? ` · last seen ${formatDate(u.lastLoginAt)}` : ''}</div></td>
                    <td className="px-3 py-3 text-slate-700">{u.teams.length === 0 ? <span className="text-slate-400">no store</span> : u.teams.map((t, i) => <div key={i}>{t.store} <span className="text-xs text-slate-500">· {t.role}{t.status === 'disabled' ? ' (disabled)' : ''}</span></div>)}</td>
                    <td className="px-3 py-3"><div className="flex flex-wrap gap-1.5"><Badge tone={u.status === 'active' ? 'good' : u.status === 'invited' ? 'warn' : 'neutral'}>{u.status}</Badge>{u.mfaEnabled && <Badge tone="info">2-step</Badge>}</div></td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        {u.status === 'disabled'
                          ? <Button variant="secondary" onClick={() => act(() => post(`/users/${u._id}/enable`))}>Enable</Button>
                          : <ConfirmButton label="Disable" confirmLabel="Yes, disable" onConfirm={() => act(() => post(`/users/${u._id}/disable`))} />}
                        {u.status !== 'disabled' && <Button variant="secondary" onClick={() => act(async () => { const r = await post<{ inviteToken: string; expiresInDays: number }>(`/users/${u._id}/reset-link`); setInvite({ token: r.inviteToken, days: r.expiresInDays, title: `Password link for ${u.name}` }); })}>Password link</Button>}
                        {u.mfaEnabled && <ConfirmButton label="Reset 2-step" confirmLabel="Yes, reset" onConfirm={() => act(() => post(`/users/${u._id}/reset-mfa`))} />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > data.limit && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{data.total} people</span>
            <div className="flex items-center gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {pages}</span><Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button></div>
          </div>
        )}
      </Card>
    </>
  );
}
