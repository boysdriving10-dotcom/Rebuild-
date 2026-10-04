import type { User as SupabaseUser } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

export type ProfileRow = {
  id: string;
  username: string;
  email: string;
};

function usernameFromAuthUser(user: SupabaseUser): string {
  const meta = user.user_metadata ?? {};
  if (typeof meta.username === 'string' && meta.username.trim()) {
    return meta.username.trim();
  }
  const fromEmail = user.email?.split('@')[0]?.trim();
  return fromEmail || 'player';
}

/**
 * Load an existing profile, or create one for this auth user.
 * Safe to call on every login / session restore.
 * Requires an authenticated session (RLS typically uses auth.uid()).
 */
export async function ensureProfileForUser(user: SupabaseUser): Promise<ProfileRow> {
  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('id, username, email')
    .eq('id', user.id)
    .maybeSingle();

  if (selectError) {
    throw selectError;
  }

  if (existing) {
    return {
      id: existing.id,
      username: existing.username?.trim() || usernameFromAuthUser(user),
      email: existing.email?.trim() || user.email || '',
    };
  }

  const username = usernameFromAuthUser(user);
  const email = user.email?.trim() || '';

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      username,
      email,
    })
    .select('id, username, email')
    .single();

  // Concurrent create — another request inserted first.
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: again, error: againError } = await supabase
        .from('profiles')
        .select('id, username, email')
        .eq('id', user.id)
        .maybeSingle();

      if (againError) throw againError;
      if (again) {
        return {
          id: again.id,
          username: again.username?.trim() || username,
          email: again.email?.trim() || email,
        };
      }
    }
    throw insertError;
  }

  return {
    id: inserted.id,
    username: inserted.username?.trim() || username,
    email: inserted.email?.trim() || email,
  };
}
