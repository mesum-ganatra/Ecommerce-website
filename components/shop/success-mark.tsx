'use client';

import { motion } from 'framer-motion';
import { AlertCircle, Check, X } from 'lucide-react';

/** A round icon that pops in with a drawn check, for "order placed" and payment results. */
export function SuccessMark({ kind = 'success' }: { kind?: 'success' | 'fail' | 'warn' }) {
  const tone = { success: 'bg-emerald-100 text-emerald-700', fail: 'bg-red-100 text-red-700', warn: 'bg-amber-100 text-amber-700' }[kind];
  return (
    <motion.div
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full ${tone}`}
      aria-hidden
    >
      <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.15, type: 'spring', stiffness: 300, damping: 16 }}>
        {kind === 'success' ? <Check size={38} strokeWidth={3} /> : kind === 'fail' ? <X size={38} strokeWidth={3} /> : <AlertCircle size={38} strokeWidth={2.5} />}
      </motion.span>
    </motion.div>
  );
}

/** Basket > Details > Payment progress bar for the checkout page. */
export function CheckoutSteps({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Basket', 'Details', 'Payment'];
  return (
    <ol className="mt-4 flex items-center gap-2 text-sm" aria-label="Checkout progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2" aria-current={i + 1 === current ? 'step' : undefined}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${i + 1 <= current ? 'bg-accent text-white' : 'bg-slate-200 text-slate-500'}`}>{i + 1 < current ? <Check size={13} /> : i + 1}</span>
          <span className={i + 1 === current ? 'font-semibold' : 'text-slate-500'}>{s}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-slate-300" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
