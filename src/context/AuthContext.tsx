import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { MOCK_USER } from '@/data/mock';
import type { User } from '@/types';

type AuthContextValue = {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => { ok: true } | { ok: false; error: string };
  createAccount: (input: {
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => { ok: true } | { ok: false; error: string };
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      login: (email, password) => {
        if (!email.trim() || !password.trim()) {
          return { ok: false, error: 'Enter your email and password.' };
        }
        // Mock auth — any non-empty credentials succeed
        const username = email.split('@')[0] || MOCK_USER.username;
        setUser({
          ...MOCK_USER,
          email: email.trim(),
          username,
          avatarInitials: username.slice(0, 2).toUpperCase(),
        });
        return { ok: true };
      },
      createAccount: ({ username, email, password, confirmPassword }) => {
        if (!username.trim() || !email.trim() || !password || !confirmPassword) {
          return { ok: false, error: 'Fill out every field.' };
        }
        if (password.length < 6) {
          return { ok: false, error: 'Password must be at least 6 characters.' };
        }
        if (password !== confirmPassword) {
          return { ok: false, error: 'Passwords do not match.' };
        }
        setUser({
          id: 'user-new',
          username: username.trim(),
          email: email.trim(),
          gamesHosted: 0,
          gamesJoined: 0,
          avatarInitials: username.trim().slice(0, 2).toUpperCase(),
        });
        return { ok: true };
      },
      logout: () => setUser(null),
    }),
    [user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
