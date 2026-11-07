import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { PropsWithChildren } from "react";
import type {
  ChangePasswordRequest,
  LoginRequest,
  PublicSettings,
  SessionUser,
} from "@shared/types";
import { apiRequest, ApiClientError } from "@/lib/api";

const FALLBACK_PUBLIC_SETTINGS: PublicSettings = {
  passwordMinLength: 8,
  passwordRequireSpecial: true,
  loginMaxFailures: 5,
  loginLockMinutes: 10,
};

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  settings: PublicSettings;
  login: (request: LoginRequest) => Promise<SessionUser>;
  logout: () => Promise<void>;
  changePassword: (request: ChangePasswordRequest) => Promise<SessionUser>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<PublicSettings>(FALLBACK_PUBLIC_SETTINGS);

  const refresh = useCallback(async () => {
    try {
      setUser(await apiRequest<SessionUser>("/api/auth/me"));
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        setUser(null);
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([
      apiRequest<SessionUser>("/api/auth/me").catch((error: unknown) => {
        if (error instanceof ApiClientError && error.status === 401) return null;
        throw error;
      }),
      apiRequest<PublicSettings>("/api/auth/settings").catch(() => FALLBACK_PUBLIC_SETTINGS),
    ])
      .then(([sessionUser, publicSettings]) => {
        if (!active) return;
        setUser(sessionUser);
        setSettings(publicSettings);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      settings,
      login: async (request) => {
        const sessionUser = await apiRequest<SessionUser>("/api/auth/login", {
          method: "POST",
          body: JSON.stringify(request),
        });
        setUser(sessionUser);
        return sessionUser;
      },
      logout: async () => {
        await apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
        setUser(null);
      },
      changePassword: async (request) => {
        const sessionUser = await apiRequest<SessionUser>("/api/auth/change-password", {
          method: "POST",
          body: JSON.stringify(request),
        });
        setUser(sessionUser);
        return sessionUser;
      },
      refresh,
    }),
    [loading, refresh, settings, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth는 AuthProvider 안에서 사용해야 합니다.");
  return context;
}
