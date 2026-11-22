'use client';

import { useState } from 'react';
import { Alert, Button } from './ui';

/** A one-time link to share with the person (email sending comes later). */
export function InviteLink({ token, expiresInDays, title, onClose }: { token: string; expiresInDays: number; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/admin/accept-invite?token=${token}`;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="font-medium text-amber-900">{title}</div>
      <p className="mt-1 text-sm text-amber-900">Send this link to them. It works once and expires in {expiresInDays} days. It will not be shown again.</p>
      <code className="mt-3 block break-all rounded bg-surface px-3 py-2 text-xs ring-1 ring-amber-200">{url}</code>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

export { Alert };
