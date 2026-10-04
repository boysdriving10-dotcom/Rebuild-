import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ensureProfileForUser } from '@/lib/profiles';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { User } from '@/types';

type AuthResult = { ok: true } | { ok: false; error: string };

type AuthContextValue = {
  user: User | null;
  isAuthenticated: boolean;
  /** False until the first session restore finishes. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthResult>;
  createAccount: (input: {
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
  }) => Promise<AuthResult>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function appUserFromAuthAndProfile(
  supabaseUser: SupabaseUser,
  profile: { username: string; email: string }
): User {
  const username = profile.username.trim() || 'player';
  return {
    id: supabaseUser.id,
    username,
    email: profile.email || supabaseUser.email || '',
    bio: 'Ready to ball.',
    gamesHosted: 0,
    gamesJoined: 0,
    avatarInitials: username.slice(0, 2).toUpperCase(),
  };
}

/** Fallback if profiles table is unavailable — metadata / email only. */
function appUserFromAuthOnly(supabaseUser: SupabaseUser): User {
  const meta = supabaseUser.user_metadata ?? {};
  const username =
    (typeof meta.username === 'string' && meta.username.trim()) ||
    supabaseUser.email?.split('@')[0] ||
    'player';

  return {
    id: supabaseUser.id,
    username,
    email: supabaseUser.email ?? '',
    bio: 'Ready to ball.',
    gamesHosted: 0,
    gamesJoined: 0,
    avatarInitials: username.slice(0, 2).toUpperCase(),
  };
}

async function resolveAppUser(supabaseUser: SupabaseUser): Promise<User> {
  try {
    const profile = await ensureProfileForUser(supabaseUser);
    return appUserFromAuthAndProfile(supabaseUser, profile);
  } catch (err) {
    if (__DEV__) {
      console.warn('[auth] ensureProfileForUser failed; using auth metadata', err);
    }
    return appUserFromAuthOnly(supabaseUser);
  }
}

function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return 'Incorrect email or password.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirm your email before logging in. Check your inbox for a link.';
  }
  if (lower.includes('user already registered')) {
    return 'An account with this email already exists. Try logging in.';
  }
  if (lower.includes('password should be at least') || lower.includes('password is too short')) {
    return 'Password is too weak. Use at least 6 characters.';
  }
  if (lower.includes('unable to validate email') || lower.includes('invalid email')) {
    return 'Enter a valid email address.';
  }
  if (lower.includes('duplicate key') || lower.includes('unique')) {
    return 'That username is already taken. Try another.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Network error. Check your connection and try again.';
  }

  return message || 'Something went wrong. Please try again.';
}

function missingConfigError(): AuthResult {
  return {
    ok: false,
    error: 'Sign-in is not configured. Add your Supabase URL and anon key to the .env file.',
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const applySession = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setUser(null);
      return;
    }
    const appUser = await resolveAppUser(session.user);
    setUser(appUser);
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!mounted) return;
      await applySession(session);
      if (mounted) setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer Supabase client calls so we avoid auth deadlocks.
      setTimeout(() => {
        void applySession(session);
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [applySession]);

  const login = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured) return missingConfigError();

    if (!email.trim() || !password.trim()) {
      return { ok: false, error: 'Enter your email and password.' };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      return { ok: false, error: friendlyAuthError(error.message) };
    }

    if (!data.session?.user) {
      return { ok: false, error: 'Login failed. Please try again.' };
    }

    try {
      const appUser = await resolveAppUser(data.session.user);
      setUser(appUser);
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load your profile.';
      return { ok: false, error: friendlyAuthError(message) };
    }
  }, []);

  const createAccount = useCallback(
    async (input: {
      username: string;
      email: string;
      password: string;
      confirmPassword: string;
    }): Promise<AuthResult> => {
      if (!isSupabaseConfigured) return missingConfigError();

      const username = input.username.trim();
      const email = input.email.trim();
      const { password, confirmPassword } = input;

      if (!username || !email || !password || !confirmPassword) {
        return { ok: false, error: 'Fill out every field.' };
      }
      if (password.length < 6) {
        return { ok: false, error: 'Password must be at least 6 characters.' };
      }
      if (password !== confirmPassword) {
        return { ok: false, error: 'Passwords do not match.' };
      }

      // Always store username in auth metadata so a profile can be created after
      // email confirmation + first login when there is no session at signup time.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username,
          },
        },
      });

      if (error) {
        return { ok: false, error: friendlyAuthError(error.message) };
      }

      // Email confirmation required — no session / no auth.uid() for RLS insert.
      if (!data.session) {
        return {
          ok: false,
          error: 'Account created. Check your email to confirm your account, then log in.',
        };
      }

      if (!data.session.user) {
        return { ok: false, error: 'Account created, but sign-in failed. Try logging in.' };
      }

      try {
        const appUser = await resolveAppUser(data.session.user);
        setUser(appUser);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not create your profile.';
        return { ok: false, error: friendlyAuthError(message) };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  // Remote auth-user deletion needs a server/admin function.
  // For now, sign out only so Profile "Delete Account" does not crash the API.
  const deleteAccount = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      createAccount,
      logout,
      deleteAccount,
    }),
    [user, isLoading, login, createAccount, logout, deleteAccount]
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
