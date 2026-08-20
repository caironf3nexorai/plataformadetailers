import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key';

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn(
    '[Supabase] Variáveis VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY não estão configuradas no .env. As chamadas ao Supabase falharão até que sejam preenchidas.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
