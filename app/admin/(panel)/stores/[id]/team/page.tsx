'use client';

import { useCallback, useEffect, useState } from 'react';
import { InviteLink } from '@/components/admin/invite-link';
import { PERMISSION_GROUPS } from '@/components/admin/permissions';
import { useStore } from '@/components/admin/store-context';
import { Alert, Badge, Button, Card, ConfirmButton, Field, Input, Loading, Select, formatDate } from '@/components/admin/ui';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { RoleRow, TeamMember } from '@/lib/types';

interface Invite { token: string; days: number; title: string }

function RoleForm({ storeId, grantable, initial, onDone, onCancel }: { storeId: string; grantable: string[]; initial?: RoleRow; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(initial?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (k: string) => setPerms((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <form className="space-y-4 rounded-lg border border-slate-200 p-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true); setError('');
      try {
        const body = { name, permissions: [...perms] };
        if (initial) await patch(`/stores/${storeId}/roles/${initial._id}`, body); else await post(`/stores/${storeId}/roles`, body);
        onDone();
      } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not save the role'); setBusy(false); }
    }}>
      {error && <Alert>{error}</Alert>}
      <Field label="Role name"><Input required minLength={2} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Packing staff" /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {PERMISSION_GROUPS.map((g) => {
          const items = g.items.filter(([k]) => grantable.includes(k));
          if (items.length === 0) return null;
          return (
            <fieldset key={g.title}>
              <legend className="mb-1.5 text-sm font-medium">{g.title}</legend>
              <div className="space-y-1.5">
                {items.map(([k, label]) => (
                  <label key={k} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300" checked={perms.has(k)} onChange={() => toggle(k)} />{label}</label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">You can only choose permissions you have yourself.</p>
      <div className="flex gap-2"><Button type="submit" loading={busy}>{initial ? 'Save role' : 'Create role'}</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

export default function TeamPage() {
  const { store, can } = useStore();
  const { user } = useAuth();
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [grantable, setGrantable] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [invite, setInvite] = useState<Invite | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [roleForm, setRoleForm] = useState<'new' | RoleRow | null>(null);
  const base = `/stores/${store._id}`;

  const load = useCallback(() => {
    Promise.all([get<{ items: TeamMember[] }>(`${base}/staff`), get<{ items: RoleRow[]; grantable: string[] }>(`${base}/roles`)])
      .then(([m, r]) => { setMembers(m.items); setRoles(r.items); setGrantable(r.grantable); })
      .catch((e: ApiError) => setError(e.status === 403 ? 'Your role cannot manage the team.' : e.message));
  }, [base]);
  useEffect(load, [load]);

  async function act(fn: () => Promise<unknown>) {
    setActionError('');
    try { await fn(); load(); } catch (e) { setActionError(e instanceof ApiError ? e.message : 'Something went wrong'); }
  }

  if (error) return <Alert>{error}</Alert>;
  if (!members) return <Loading />;
  const assignable = roles.filter((r) => r.assignable);

  return (
    <div className="space-y-6">
      {invite && <InviteLink token={invite.token} expiresInDays={invite.days} title={invite.title} onClose={() => setInvite(null)} />}
      {actionError && <Alert>{actionError}</Alert>}

      <Card title="Add a team member">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true); setActionError('');
          try {
            const r = await post<{ invited: boolean; inviteToken?: string; expiresInDays?: number }>(`${base}/staff`, { name, email, roleId: roleId || assignable[0]?._id });
            if (r.invited && r.inviteToken) setInvite({ token: r.inviteToken, days: r.expiresInDays ?? 7, title: `Invitation for ${name}` });
            setName(''); setEmail(''); load();
          } catch (err) { setActionError(err instanceof ApiError ? err.message : 'Could not add the person'); } finally { setBusy(false); }
        }}>
          <Field label="Name"><Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Role"><Select value={roleId || assignable[0]?._id || ''} onChange={(e) => setRoleId(e.target.value)}>{assignable.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}</Select></Field>
          <Button type="submit" loading={busy} disabled={assignable.length === 0}>Invite</Button>
        </form>
        <p className="mt-3 text-xs text-slate-500">They get a one-time link to choose their own password. Nobody else ever sees it.</p>
      </Card>

      <Card title={`Team (${members.length})`}>
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-y border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-5 py-2.5 font-medium">Person</th><th className="px-3 py-2.5 font-medium">Role</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-5 py-2.5 text-right font-medium">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.map((m) => {
                const me = m.userId._id === user?.id;
                const pending = m.userId.status === 'invited';
                return (
                  <tr key={m._id}>
                    <td className="px-5 py-3">{m.userId.name}{me && <span className="ml-2 text-xs text-slate-500">(you)</span>}<div className="text-xs text-slate-500">{m.userId.email}{m.userId.lastLoginAt ? ` · last seen ${formatDate(m.userId.lastLoginAt)}` : ''}</div></td>
                    <td className="px-3 py-3">
                      {me ? m.roleId.name : (
                        <Select aria-label={`Role of ${m.userId.name}`} className="!w-44" value={m.roleId._id} onChange={(e) => act(() => patch(`${base}/staff/${m._id}`, { roleId: e.target.value }))}>
                          {roles.filter((r) => r.assignable || r._id === m.roleId._id).map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {pending ? <Badge tone="warn">invitation pending</Badge> : <Badge tone={m.status === 'active' ? 'good' : 'neutral'}>{m.status}</Badge>}
                        {m.userId.mfaEnabled && <Badge tone="info">2-step</Badge>}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {!me && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="secondary" onClick={() => act(() => patch(`${base}/staff/${m._id}`, { status: m.status === 'active' ? 'disabled' : 'active' }))}>{m.status === 'active' ? 'Disable' : 'Enable'}</Button>
                          <Button variant="secondary" onClick={() => act(async () => { const r = await post<{ inviteToken: string; expiresInDays: number }>(`${base}/staff/${m._id}/reset-link`); setInvite({ token: r.inviteToken, days: r.expiresInDays, title: `New password link for ${m.userId.name}` }); })}>{pending ? 'New link' : 'Reset password'}</Button>
                          <ConfirmButton label="Remove" confirmLabel="Yes, remove" onConfirm={() => act(() => del(`${base}/staff/${m._id}`))} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {can('role.manage') && (
        <Card title="Roles" action={!roleForm && <Button variant="secondary" onClick={() => setRoleForm('new')}>New custom role</Button>}>
          {roleForm && <div className="mb-4"><RoleForm storeId={store._id} grantable={grantable} initial={roleForm === 'new' ? undefined : roleForm} onCancel={() => setRoleForm(null)} onDone={() => { setRoleForm(null); load(); }} /></div>}
          <ul className="divide-y divide-slate-100">
            {roles.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <span className="font-medium">{r.name}</span> {r.builtIn ? <Badge>built in</Badge> : <Badge tone="info">custom</Badge>}
                  <div className="text-xs text-slate-500">{r.permissions.length} permissions · used by {members.filter((m) => m.roleId._id === r._id).length}</div>
                </div>
                {!r.builtIn && (
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setRoleForm(r)}>Edit</Button>
                    <ConfirmButton label="Delete" confirmLabel="Yes, delete" onConfirm={() => act(() => del(`${base}/roles/${r._id}`))} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
