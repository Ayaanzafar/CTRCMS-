import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { AuthUser } from "../types/auth";

const TOKEN_KEY = "ctrcms_token";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasModuleAccess: (moduleCode: string) => boolean;
  canWrite: (moduleCode: string) => boolean;
  canFullAccess: (moduleCode: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY)
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const me = await api.me(token);
        setUser(me);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    loadUser();
  }, [token]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    localStorage.setItem(TOKEN_KEY, res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await api.logout(token);
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  const hasModuleAccess = useCallback(
    (moduleCode: string) => {
      const access = user?.permissions[moduleCode];
      return !!access && access !== "NONE";
    },
    [user]
  );

  const canWrite = useCallback(
    (moduleCode: string) => {
      const access = user?.permissions[moduleCode];
      return access === "WRITE" || access === "FULL";
    },
    [user]
  );

  const canFullAccess = useCallback(
    (moduleCode: string) => {
      const access = user?.permissions[moduleCode];
      return access === "FULL";
    },
    [user]
  );

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      login,
      logout,
      hasModuleAccess,
      canWrite,
      canFullAccess,
    }),
    [user, token, loading, login, logout, hasModuleAccess, canWrite, canFullAccess]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
