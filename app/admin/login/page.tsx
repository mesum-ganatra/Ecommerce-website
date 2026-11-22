'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Loading } from '@/components/admin/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { status, user, login, verifyMfa } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authed') router.replace(user?.mfaSetupRequired ? '/admin/security' : '/admin');
  }, [status, user, router]);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await login(email.trim(), password);
      if (r.mfaToken) {
        setMfaToken(r.mfaToken);
        setPassword('');
        setBusy(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in');
      setBusy(false);
    }
  }

  async function onCode(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await verifyMfa(mfaToken, useRecovery ? { recoveryCode: code } : { code });
    } catch (err) {
      const expired = err instanceof ApiError && /expired/i.test(err.message);
      setError(err instanceof ApiError ? err.message : 'Could not verify the code');
      if (expired) setMfaToken('');
      setCode('');
      setBusy(false);
    }
  }

  if (status === 'loading' || status === 'authed') return <Loading />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">E</div>
          <h1 className="text-2xl font-semibold tracking-tight">{mfaToken ? 'Two-step verification' : 'Sign in'}</h1>
          <p className="mt-1 text-sm text-slate-600">{mfaToken ? (useRecovery ? 'Enter one of your recovery codes' : 'Enter the 6-digit code from your authenticator app') : 'Ecommerce Platform admin'}</p>
        </div>

        {!mfaToken ? (
          <form onSubmit={onPassword} className="space-y-4 rounded-xl border border-slate-200 bg-surface p-6 shadow-sm">
            {error && <Alert>{error}</Alert>}
            <Field label="Email"><Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Button type="submit" loading={busy} className="w-full">Sign in</Button>
          </form>
        ) : (
          <form onSubmit={onCode} className="space-y-4 rounded-xl border border-slate-200 bg-surface p-6 shadow-sm">
            {error && <Alert>{error}</Alert>}
            <Field label={useRecovery ? 'Recovery code' : 'Authentication code'}>
              <Input
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode={useRecovery ? 'text' : 'numeric'}
                maxLength={useRecovery ? 9 : 7}
                placeholder={useRecovery ? 'xxxx-xxxx' : '123456'}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="tracking-widest"
              />
            </Field>
            <Button type="submit" loading={busy} className="w-full">Verify</Button>
            <div className="flex justify-between text-sm">
              <button type="button" className="text-brand-700 hover:underline" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setError(''); }}>
                {useRecovery ? 'Use my authenticator app' : 'Use a recovery code'}
              </button>
              <button type="button" className="text-slate-600 hover:underline" onClick={() => { setMfaToken(''); setCode(''); setError(''); }}>Back</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
