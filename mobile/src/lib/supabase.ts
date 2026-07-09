import 'react-native-url-polyfill/auto';
// Supabase client for React Native. The node_modules/@supabase/supabase-js package.json
// has been patched (module/exports fields removed) so Metro uses the CJS entry (dist/index.cjs)
// instead of the ESM .mjs file, which fixes the "@supabase/realtime-js" resolution error.
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Supabase hardcodes console.error() when a stored refresh token is invalid during
// INITIAL_SESSION and auto-refresh ticks. The error is already handled (session cleared,
// SIGNED_OUT fired) but there's no library option to suppress the log.
const _origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const e = args[0] as any;
  if (e?.name === 'AuthApiError' && /refresh token/i.test(e?.message ?? '')) return;
  _origConsoleError.apply(console, args);
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
