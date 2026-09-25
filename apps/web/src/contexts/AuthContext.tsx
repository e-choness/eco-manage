import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, register as apiRegister } from "../api/auth";
import { errorMessage, refreshSession, setAccessToken, setSessionExpiredHandler } from "../api/api";
import type { SessionUser } from "../api/types";

type UserData = {
  id: string;
  email: string;
  name?: string;
} | null;

type AuthContextType = {
  isAuthenticated: boolean;
  // True until the first refresh attempt has finished, so routes don't bounce to /login on reload.
  isRestoring: boolean;
  user: UserData;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (fields: Partial<NonNullable<UserData>>) => void;
};

const AuthContext = createContext<AuthContextType | null>(null);

const toUserData = (u: SessionUser): UserData => ({ id: u._id, email: u.email, name: u.name });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserData>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    let active = true;
    refreshSession()
      .then((session) => {
        if (active && session) setUser(toUserData(session.user));
      })
      .finally(() => {
        if (active) setIsRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [clearSession]);

  const login = async (email: string, password: string) => {
    try {
      const { accessToken, ...rest } = await apiLogin(email, password);
      if (!accessToken) throw new Error('Login failed');
      setAccessToken(accessToken);
      setUser(toUserData(rest));
    } catch (error) {
      clearSession();
      throw new Error(errorMessage(error) || 'Login failed');
    }
  };

  // Registration doesn't issue tokens, so sign in right after creating the account.
  const register = async (email: string, password: string, name: string) => {
    try {
      await apiRegister(email, password, name);
    } catch (error) {
      clearSession();
      throw new Error(errorMessage(error) || 'Registration failed');
    }
    await login(email, password);
  };

  const logout = async () => {
    try {
      await apiLogout();
    } finally {
      clearSession();
    }
  };

  const updateUser = (fields: Partial<NonNullable<UserData>>) => {
    setUser((current) => (current ? { ...current, ...fields } : current));
  };

  return (
    <AuthContext.Provider
      value={{ isAuthenticated: !!user, isRestoring, user, login, register, logout, updateUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
