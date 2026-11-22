'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Field, Input, Loading } from '@/components/admin/ui';
import { ApiError, post } from '@/lib/api';

export default function AcceptInvitePage() {
  const [token, setToken] = useState<string | null>(null);
  const [info, setInfo] = useState<{ name: string; email: string; isNew: boolean } | null>(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const started = useRef(false);
  useEffect(() => {
    // read the token exactly once (React runs effects twice in development, and we strip it from the URL below)
    if (started.current) return;
    started.current = true;
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t ?? '');
    if (!t) return;
    // the token is a one-time secret: take it out of the address bar and browser history
    window.history.replaceState(null, '', window.location.pathname);
    post<{ name: string; email: string; isNew: boolean }>('/auth/invite/check', { token: t })
      .then(setInfo)
      .catch((e: ApiError) => setError(e.message));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords are different.');
    setBusy(true);
    setError('');
    try {
      await post('/auth/invite/accept', { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not set the password');
    } finally {
      setBusy(false);
    }
  }

  if (token === null) return <Loading />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">E</div>
          <h1 className="text-2xl font-semibold tracking-tight">{info?.isNew === false ? 'Choose a new password' : 'Set your password'}</h1>
          {info && <p className="mt-1 text-sm text-slate-600">{info.name} · {info.email}</p>}
        </div>
        {done ? (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-surface p-6 text-center shadow-sm">
            <Alert tone="good">Your password is set.</Alert>
            <Link href="/admin/login" className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Sign in</Link>
          </div>
        ) : !token || (!info && error) ? (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-surface p-6 shadow-sm">
            <Alert>{error || 'This link is not valid. Ask your admin for a new one.'}</Alert>
            <Link href="/admin/login" className="block text-center text-sm text-brand-700 hover:underline">Go to sign in</Link>
          </div>
        ) : !info ? (
          <Loading />
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-surface p-6 shadow-sm">
            {error && <Alert>{error}</Alert>}
            <Field label="New password" hint="At least 12 characters, with letters and numbers."><Input type="password" autoComplete="new-password" required minLength={12} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Repeat the password"><Input type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <Button type="submit" loading={busy} className="w-full">Save password</Button>
          </form>
        )}
      </div>
    </main>
  );
}
