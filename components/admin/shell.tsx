'use client';

import { ChevronsUpDown, LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ScrollText, Search, ShieldCheck, Store as StoreIcon, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Page, StoreSummary } from '@/lib/types';
import { CommandPalette } from './command-palette';
import { Drawer } from './ui';

const NAV = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/stores', label: 'Stores', icon: StoreIcon },
  { href: '/admin/users', label: 'Users', icon: Users, superOnly: true },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, superOnly: true },
  { href: '/admin/security', label: 'Security', icon: ShieldCheck },
];

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** Jump between stores without going back to the list. */
function StoreSwitcher({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<StoreSummary[]>([]);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const currentId = /^\/admin\/stores\/([a-f0-9]{24})/.exec(pathname)?.[1];
  const current = stores.find((s) => s._id === currentId);

  useEffect(() => {
    get<Page<StoreSummary>>('/stores?limit=60').then((d) => setStores(d.items)).catch(() => undefined);
  }, [currentId]);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const shown = stores.filter((s) => `${s.name} ${s.subdomain}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={box} className="relative px-3">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open} title={collapsed ? (current?.name ?? 'All stores') : undefined}
        className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-left transition-colors hover:bg-slate-100">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">{current ? initials(current.name) : <StoreIcon size={16} />}</span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium text-slate-900">{current?.name ?? 'All stores'}</span>
              <span className="block truncate text-xs text-slate-500">{current ? `${current.subdomain}` : `${stores.length} ${stores.length === 1 ? 'store' : 'stores'}`}</span>
            </span>
            <ChevronsUpDown size={14} className="shrink-0 text-slate-400" />
          </>
        )}
      </button>
      {open && (
        <div className="animate-pop absolute left-3 top-full z-30 mt-2 w-64 rounded-xl border border-slate-200 bg-surface p-2 shadow-xl">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a store…" aria-label="Find a store" className="mb-1 w-full rounded-lg border border-slate-200 bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand-500" />
          <ul role="listbox" className="max-h-64 overflow-y-auto">
            <li><button type="button" className="w-full rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100" onClick={() => { setOpen(false); router.push('/admin/stores'); }}>All stores</button></li>
            {shown.map((s) => (
              <li key={s._id}>
                <button type="button" role="option" aria-selected={s._id === currentId} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-100 ${s._id === currentId ? 'bg-brand-50 text-brand-700' : ''}`} onClick={() => { setOpen(false); setQ(''); router.push(`/admin/stores/${s._id}`); }}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200 text-[10px] font-bold text-slate-700">{initials(s.name)}</span>
                  <span className="truncate">{s.name}</span>
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2.5 py-3 text-sm text-slate-500">No store matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const items = user?.mfaSetupRequired ? NAV.filter((n) => n.href === '/admin/security') : NAV.filter((n) => !n.superOnly || user?.isSuperAdmin);
  const active = (n: (typeof NAV)[number]) => (n.exact ? pathname === n.href : pathname.startsWith(n.href));
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-3">
      {items.map((n) => (
        <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active(n) ? 'page' : undefined} title={collapsed ? n.label : undefined}
          className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active(n) ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
          {active(n) && <span className="absolute -left-3 top-1.5 h-6 w-1 rounded-r-full bg-brand-600" aria-hidden />}
          <n.icon size={18} className="shrink-0" aria-hidden />
          {!collapsed && <span>{n.label}</span>}
        </Link>
      ))}
    </nav>
  );
}

function UserCard({ collapsed }: { collapsed: boolean }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  if (!user) return null;
  return (
    <div className="border-t border-slate-100 p-3">
      <div className={`flex items-center gap-2.5 ${collapsed ? 'justify-center' : ''}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700" aria-hidden>{initials(user.name)}</span>
        {!collapsed && (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium text-slate-900">{user.name}</span>
            <span className="block truncate text-xs text-slate-500">{user.isSuperAdmin ? 'Super Admin' : 'Store staff'}</span>
          </span>
        )}
        {!collapsed && <button type="button" onClick={() => logout().then(() => router.replace('/admin/login'))} aria-label="Sign out" title="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><LogOut size={16} /></button>}
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('admin:sidebar') === 'collapsed');
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => setMobile(false), [pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('admin:sidebar', c ? 'open' : 'collapsed');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  const section = useMemo(() => NAV.slice().reverse().find((n) => (n.exact ? pathname === n.href : pathname.startsWith(n.href)))?.label ?? 'Admin', [pathname]);

  return (
    <div className="min-h-screen">
      {/* desktop sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-slate-200 bg-surface transition-[width] duration-200 lg:flex ${collapsed ? 'w-[76px]' : 'w-64'}`}>
        <div className={`flex h-16 items-center gap-2.5 px-5 ${collapsed ? 'justify-center px-0' : ''}`}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm">E</span>
          {!collapsed && <span className="text-sm font-semibold tracking-tight">Ecommerce Platform</span>}
        </div>
        <StoreSwitcher collapsed={collapsed} />
        <div className="mt-4 flex-1 overflow-y-auto"><NavList collapsed={collapsed} /></div>
        <UserCard collapsed={collapsed} />
      </aside>

      <div className={`transition-[padding] duration-200 ${collapsed ? 'lg:pl-[76px]' : 'lg:pl-64'}`}>
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-slate-200 bg-surface/85 px-4 backdrop-blur md:px-8">
          <button type="button" onClick={() => setMobile(true)} aria-label="Open menu" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><Menu size={20} /></button>
          <button type="button" onClick={toggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:block">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <div className="hidden text-sm font-medium text-slate-500 sm:block">{section}</div>
          <button type="button" onClick={() => setPalette(true)} className="ml-auto flex w-full max-w-xs items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 transition-colors hover:bg-slate-100 sm:ml-4 sm:ml-auto">
            <Search size={15} aria-hidden />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="hidden rounded border border-slate-300 bg-surface px-1.5 py-0.5 text-[10px] font-medium text-slate-500 sm:inline">Ctrl K</kbd>
          </button>
          <ThemeToggle />
        </header>
        <main className="min-w-0 px-4 py-6 md:px-8 md:py-8">
          <div key={pathname} className="animate-rise mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      {/* mobile menu */}
      <Drawer open={mobile} onClose={() => setMobile(false)} title="Menu">
        <div className="-mx-3 space-y-4">
          <StoreSwitcher collapsed={false} />
          <NavList collapsed={false} onNavigate={() => setMobile(false)} />
          <UserCard collapsed={false} />
        </div>
      </Drawer>
      <CommandPalette open={palette} setOpen={setPalette} />
    </div>
  );
}
