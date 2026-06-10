import { useState, useEffect, useCallback } from "react";
import { api, ApiError } from "../lib/api";

interface AuthUser {
  id: string;
  displayName: string;
  email: string | null;
  preferredLanguage: "ar" | "en";
  roles: string[];
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

export function useAuth(): AuthState & {
  login: (returnTo?: string) => Promise<void>;
  logout: () => Promise<void>;
} {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
  });

  const fetchMe = useCallback(async () => {
    try {
      const user = await api.auth.me();
      setState({ user, loading: false, error: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setState({ user: null, loading: false, error: null });
      } else {
        setState({ user: null, loading: false, error: "Failed to load session" });
      }
    }
  }, []);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  const login = useCallback(async (returnTo?: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { auth_url } = await api.auth.login(returnTo);
      window.location.href = auth_url;
    } catch {
      setState((prev) => ({ ...prev, loading: false, error: "Login failed" }));
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const { logout_url } = await api.auth.logout();
      window.location.href = logout_url;
    } catch {
      setState({ user: null, loading: false, error: null });
    }
  }, []);

  return { ...state, login, logout };
}
