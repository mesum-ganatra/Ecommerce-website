'use client';

import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------- badges
type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-800 ring-amber-200',
  bad: 'bg-red-50 text-red-700 ring-red-200',
  info: 'bg-brand-50 text-brand-700 ring-brand-100',
};
const dotClass: Record<Tone, string> = { neutral: 'bg-slate-400', good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', info: 'bg-brand-500' };

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${toneClass[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass[tone]}`} aria-hidden />
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  return status === 'active' ? 'good' : status === 'suspended' ? 'warn' : 'neutral';
}

// ---------------------------------------------------------------- cards
export function Card({
  title,
  action,
  children,
  className = '',
  padded = true,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.04)] ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {action}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- buttons
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'border border-slate-300 bg-surface text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50',
  danger: 'bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:bg-red-600/50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${variantClass[variant]} ${className}`}
    >
      {loading && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <Loader2 aria-hidden size={small ? 14 : 20} className="animate-spin" />;
}

// ---------------------------------------------------------------- form fields
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-800">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

const inputBase =
  'block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 shadow-sm transition-shadow placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 disabled:bg-slate-50 disabled:text-slate-500';

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={`${inputBase} ${props.className ?? ''}`} />;
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={`${inputBase} ${props.className ?? ''}`} />;

// ---------------------------------------------------------------- messages
export function Alert({ tone = 'bad', children }: { tone?: 'bad' | 'good' | 'info'; children: React.ReactNode }) {
  const cls = { bad: 'border-red-200 bg-red-50 text-red-800', good: 'border-emerald-200 bg-emerald-50 text-emerald-800', info: 'border-brand-100 bg-brand-50 text-brand-700' }[tone];
  const Icon = { bad: AlertTriangle, good: CheckCircle2, info: Info }[tone];
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${cls}`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- loading and empty states
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** A page-shaped placeholder: shown instead of a blank screen while data loads. */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="animate-fade space-y-4 py-2">
      <Skeleton className="h-8 w-1/3" />
      <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
      <Skeleton className="h-56 w-full" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-12 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">{icon}</div>}
      <h3 className="font-medium text-slate-900">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- dialogs (native <dialog>: focus trap and Esc for free)
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const props = {
    ref,
    onCancel: (e: React.SyntheticEvent) => {
      e.preventDefault();
      onClose();
    },
    // a click on the dimmed backdrop (the dialog element itself) closes it
    onMouseDown: (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
  };
  return props;
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children?: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const p = useDialog(open, onClose);
  return (
    <dialog {...p} className={`modal m-auto w-[calc(100%-2rem)] ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-slate-200 bg-surface p-0 text-slate-900 shadow-2xl`}>
      {open && (
        <div>
          <div className="flex items-start justify-between gap-4 px-6 pt-5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
          </div>
          {children && <div className="px-6 py-3 text-sm text-slate-600">{children}</div>}
          {footer && <div className="flex justify-end gap-2 px-6 pb-5 pt-2">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/** A panel that slides in from the right, for looking at one thing without leaving the list. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children?: React.ReactNode }) {
  const p = useDialog(open, onClose);
  return (
    <dialog {...p} className="sheet fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-xl overflow-y-auto rounded-none border-l border-slate-200 bg-surface p-0 text-slate-900 shadow-2xl">
      {open && (
        <div>
          <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-slate-100 bg-surface/95 px-6 py-4 backdrop-blur">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
          </div>
          <div className="p-6">{children}</div>
        </div>
      )}
    </dialog>
  );
}

/** Asks "are you sure?" in a dialog before doing something risky. */
export function ConfirmButton({
  label,
  confirmLabel = 'Yes, do it',
  variant = 'secondary',
  title,
  message,
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  variant?: ButtonVariant;
  title?: string;
  message?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>{label}</Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={title ?? `${label}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                } finally {
                  setBusy(false);
                  setOpen(false);
                }
              }}
            >
              {confirmLabel}
            </Button>
          </>
        }
      >
        {message ?? 'This will take effect right away.'}
      </Modal>
    </>
  );
}

export function formatDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
