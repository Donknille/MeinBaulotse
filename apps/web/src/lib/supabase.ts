/**
 * Supabase-Anbindung für die Anmeldung.
 *
 * Der Client bekommt ausschließlich den öffentlichen Anon-Key; der steht
 * ohnehin im Browser-Bundle. Alles, was Rechte betrifft, entscheidet die
 * Datenbank über RLS.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const anonKey = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

/**
 * Solange kein Supabase-Projekt hinterlegt ist, läuft die Anwendung im
 * Entwicklungsmodus: Die Anmeldemaske erklärt, was fehlt, statt eine
 * Fehlermeldung zu zeigen.
 */
export const isSupabaseConfigured =
  url !== undefined && url !== '' && anonKey !== undefined && anonKey !== '';

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export async function signInWithMagicLink(email: string): Promise<void> {
  if (supabase === null) throw new Error('Supabase ist nicht eingerichtet.');
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error !== null) throw error;
}

export async function signInWithGoogle(): Promise<void> {
  if (supabase === null) throw new Error('Supabase ist nicht eingerichtet.');
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error !== null) throw error;
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
