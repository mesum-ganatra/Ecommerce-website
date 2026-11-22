'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, refreshSession, setAccessToken, setAuthLostHandler } from './api';
import type { SessionUser } from './types';

type Status = 'loading' | 'authed' | 'anon';
type LoginResult = { mfaToken: string } | { mfaToken?: undefined };

interface AuthValue {
  user: SessionUser | null;
  status: Status;
  /** Resolves with a mfaToken when a two-step code is needed next. */
  login: (email: string, password: string) => Promise<LoginResult>;
  verifyMfa: (mfaToken: string, proof: { code?: string; recoveryCode?: string }) => Promise<void>;
  /** Re-reads the session (after turning two-step on, changing a password...). */
  reload: () => Promise<void>;
  /** Use a fresh access token the server just issued. */
  adopt: (accessToken: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);
interface Session { accessToken: string; user: SessionUser }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let alive = true;
    setAuthLostHandler(() => {
      setUser(null);
      setStatus('anon');
    });
    refreshSession().then((u) => {
      if (!alive) return;
      setUser(u);
      setStatus(u ? 'authed' : 'anon');
    });
    return () => {
      alive = false;
      setAuthLostHandler(null);
    };
  }, []);

  const start = useCallback((s: Session) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
    setStatus('authed');
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const data = await api<Session | { mfaRequired: true; mfaToken: string }>('POST', '/auth/login', { email, password });
      if ('mfaRequired' in data) return { mfaToken: data.mfaToken };
      start(data);
      return {};
    },
    [start],
  );

  const verifyMfa = useCallback(
    async (mfaToken: string, proof: { code?: string; recoveryCode?: string }) => {
      start(await api<Session>('POST', '/auth/mfa/verify', { mfaToken, ...proof }));
    },
    [start],
  );

  const reload = useCallback(async () => {
    const u = await refreshSession();
    setUser(u);
    setStatus(u ? 'authed' : 'anon');
  }, []);

  const adopt = useCallback((accessToken: string) => setAccessToken(accessToken), []);

  const logout = useCallback(async () => {
    await api('POST', '/auth/logout', {}).catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    setStatus('anon');
  }, []);

  const value = useMemo(() => ({ user, status, login, verifyMfa, reload, adopt, logout }), [user, status, login, verifyMfa, reload, adopt, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
