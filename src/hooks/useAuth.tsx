"use client";

/**
 * Auth context — replaces st.session_state['authenticated'/'api_key'/'user_email'].
 *
 * login() calls /api/eikon/auth, which proxies to the same endpoint the
 * eikonsai SDK used (pagekite /eikon_get_api_key_for_user) and returns the
 * user's API key.
 *
 * The key is cached in localStorage for dev convenience. For production, prefer
 * an httpOnly session cookie set by the auth route handler.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthState } from "@/lib/types";
import { login as loginRequest } from "@/lib/api";

const STORAGE_KEY = "eikon.auth";

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    authenticated: false,
    apiKey: null,
    userEmail: null,
  });

  // Rehydrate from storage on mount (dev convenience; replace with cookie).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as AuthState);
    } catch {
      /* ignore */
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    if (!email || !password) return false;
    try {
      const { apiKey } = await loginRequest(email, password);
      const next: AuthState = { authenticated: true, apiKey, userEmail: email };
      setState(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    setState({ authenticated: false, apiKey: null, userEmail: null });
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, logout }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
