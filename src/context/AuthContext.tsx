import { apiFetch, API_ROOT } from "@/lib/api";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface User {
  id: string;
  name: string;
  email: string;
  profile?: {
    program?: string;
    semester?: string;
    interests?: string[];
  };
  streak?: {
    current: number;
    longest: number;
    lastStudyDate: string;
  };
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (payload: SignupPayload) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

interface SignupPayload {
  name: string;
  email: string;
  password: string;
  program?: string;
  semester?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem("athenaeum_user");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("athenaeum_token"));
  const [user, setUser] = useState<User | null>(() => readStoredUser());
  const [isLoading, setIsLoading] = useState(Boolean(token));

  const persistSession = useCallback((nextToken: string, nextUser: User) => {
    localStorage.setItem("athenaeum_token", nextToken);
    localStorage.setItem("athenaeum_user", JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("athenaeum_token");
    localStorage.removeItem("athenaeum_user");
    setToken(null);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const currentToken = localStorage.getItem("athenaeum_token");
    if (!currentToken) {
      setIsLoading(false);
      return;
    }

    const response = await apiFetch("/auth/me");
    if (!response.ok) {
      logout();
      setIsLoading(false);
      return;
    }

    const data = await response.json();
    localStorage.setItem("athenaeum_user", JSON.stringify(data.user));
    setUser(data.user);
    setToken(currentToken);
    setIsLoading(false);
  }, [logout]);

  useEffect(() => {
    refreshUser();
    window.addEventListener("athenaeum-auth-expired", logout);
    return () => window.removeEventListener("athenaeum-auth-expired", logout);
  }, [logout, refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch(`${API_ROOT}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Login failed");
    persistSession(data.token, data.user);
  }, [persistSession]);

  const signup = useCallback(async (payload: SignupPayload) => {
    const response = await fetch(`${API_ROOT}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Signup failed");
    persistSession(data.token, data.user);
  }, [persistSession]);

  const value = useMemo<AuthContextType>(() => ({
    user,
    token,
    isAuthenticated: Boolean(token && user),
    isLoading,
    login,
    signup,
    logout,
    refreshUser,
  }), [user, token, isLoading, login, signup, logout, refreshUser]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
