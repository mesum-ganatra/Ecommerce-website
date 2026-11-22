'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from '@/components/admin/ui';
import { ApiError, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join('\n');
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="font-medium text-amber-900">Save your recovery codes</h3>
      <p className="mt-1 text-sm text-amber-900">If you lose your phone, each code lets you sign in once. They will not be shown again. Keep them somewhere safe, like a password manager.</p>
      <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
        {codes.map((c) => <li key={c} className="rounded bg-surface px-2 py-1 text-center ring-1 ring-amber-200">{c}</li>)}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => navigator.clipboard.writeText(text)}>Copy</Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([`Recovery codes\n\n${text}\n`], { type: 'text/plain' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = 'recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download
        </Button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved them</label>
        <Button type="button" disabled={!saved} onClick={onDone}>Continue</Button>
      </div>
    </div>
  );
}

function TwoStep() {
  const { user, reload } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [manage, setManage] = useState<'disable' | 'codes' | null>(null);

  useEffect(() => {
    if (!setup) return setQr('');
    import('qrcode').then((m) => m.toDataURL(setup.otpauthUrl, { margin: 1, width: 192 })).then(setQr).catch(() => setQr(''));
  }, [setup]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return <RecoveryCodes codes={codes} onDone={async () => { setCodes(null); setSetup(null); setCode(''); await reload(); }} />;
  }

  if (user?.mfaEnabled) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Your account asks for a code from your authenticator app each time you sign in.</p>
        {error && <Alert>{error}</Alert>}
        {manage ? (
          <div className="max-w-sm space-y-3 rounded-lg border border-slate-200 p-4">
            <Field label="Your password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Current code from your app"><Input inputMode="numeric" maxLength={7} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <div className="flex gap-2">
              <Button loading={busy} variant={manage === 'disable' ? 'danger' : 'primary'} onClick={async () => {
                const r = await run(() => (manage === 'disable' ? post('/auth/mfa/disable', { password, code }) : post<{ recoveryCodes: string[] }>('/auth/mfa/recovery-codes', { password, code })));
                if (!r) return;
                if (manage === 'codes') setCodes((r as { recoveryCodes: string[] }).recoveryCodes);
                else await reload();
                setManage(null); setPassword(''); setCode('');
              }}>{manage === 'disable' ? 'Turn off' : 'Make new codes'}</Button>
              <Button variant="ghost" onClick={() => { setManage(null); setError(''); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setManage('codes')}>New recovery codes</Button>
            {!user.isSuperAdmin && <Button variant="secondary" onClick={() => setManage('disable')}>Turn off</Button>}
          </div>
        )}
        {user.isSuperAdmin && <p className="text-xs text-slate-500">Two-step verification is required for the Super Admin and cannot be turned off.</p>}
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Add a second lock: after your password, you will enter a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</p>
        {error && <Alert>{error}</Alert>}
        <Button loading={busy} onClick={async () => { const r = await run(() => post<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup')); if (r) setSetup(r); }}>Set up two-step verification</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-4 pl-5 text-sm">
        <li>
          Open your authenticator app and scan this QR code.
          <div className="mt-3 flex flex-wrap items-center gap-5">
            {qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr} alt="QR code to add this account to your authenticator app" width={192} height={192} className="rounded-lg border border-slate-200" />}
            <div className="text-slate-600">
              Cannot scan? Enter this key by hand:
              <div className="mt-1 break-all rounded bg-slate-100 px-3 py-2 font-mono text-sm text-slate-900">{setup.secret.match(/.{1,4}/g)?.join(' ')}</div>
            </div>
          </div>
        </li>
        <li>Enter the 6-digit code your app shows to confirm.</li>
      </ol>
      {error && <Alert>{error}</Alert>}
      <form className="flex max-w-xs items-end gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => post<{ recoveryCodes: string[] }>('/auth/mfa/enable', { code })); if (r) setCodes(r.recoveryCodes); }}>
        <Field label="Code"><Input required inputMode="numeric" maxLength={7} autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Button type="submit" loading={busy}>Confirm</Button>
      </form>
    </div>
  );
}

function ChangePassword() {
  const { adopt } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form className="max-w-sm space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setMsg(null);
      try {
        const r = await post<{ accessToken: string }>('/auth/change-password', { currentPassword: current, newPassword: next });
        adopt(r.accessToken);
        setCurrent(''); setNext('');
        setMsg({ tone: 'good', text: 'Password changed. You were signed out on your other devices.' });
      } catch (err) {
        setMsg({ tone: 'bad', text: err instanceof ApiError ? err.message : 'Could not change the password' });
      } finally {
        setBusy(false);
      }
    }}>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Field label="Current password"><Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="New password" hint="At least 12 characters, with letters and numbers."><Input type="password" autoComplete="new-password" required minLength={12} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Button type="submit" loading={busy}>Change password</Button>
    </form>
  );
}

export default function SecurityPage() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Security" subtitle={user?.email} />
      {user?.mfaSetupRequired && (
        <div className="mb-6">
          <Alert tone="info">As Super Admin you must turn on two-step verification before you can use the admin panel.</Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="Two-step verification" action={user?.mfaEnabled ? <Badge tone="good">on</Badge> : <Badge tone="warn">off</Badge>}>
          <TwoStep />
        </Card>
        <Card title="Password"><ChangePassword /></Card>
      </div>
    </>
  );
}
