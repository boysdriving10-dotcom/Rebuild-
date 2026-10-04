import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * SecureStore has a ~2048 byte limit on some iOS versions.
 * Chunk large session payloads so Supabase auth can persist reliably.
 */
const CHUNK_SIZE = 2000;

async function deleteSecureItem(key: string) {
  await SecureStore.deleteItemAsync(key);
  for (let i = 0; ; i++) {
    const chunkKey = `${key}_chunk_${i}`;
    const existing = await SecureStore.getItemAsync(chunkKey);
    if (existing == null) break;
    await SecureStore.deleteItemAsync(chunkKey);
  }
}

const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    }

    const single = await SecureStore.getItemAsync(key);
    if (single != null) return single;

    const chunks: string[] = [];
    for (let i = 0; ; i++) {
      const piece = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
      if (piece == null) break;
      chunks.push(piece);
    }
    return chunks.length > 0 ? chunks.join('') : null;
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
      return;
    }

    await deleteSecureItem(key);
    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value);
      return;
    }

    let i = 0;
    for (let offset = 0; offset < value.length; offset += CHUNK_SIZE, i++) {
      await SecureStore.setItemAsync(`${key}_chunk_${i}`, value.slice(offset, offset + CHUNK_SIZE));
    }
  },
  removeItem: async (key: string) => {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
      return;
    }
    await deleteSecureItem(key);
  },
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured && __DEV__) {
  console.warn(
    '[auth] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Add them to a .env file.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      storage: ExpoSecureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
