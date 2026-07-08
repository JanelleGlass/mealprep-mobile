/* Supabase client + connection/sign-in state.
   Config (project URL + anon key) is pasted by the user once and kept in
   localStorage. "demo" mode substitutes local fixture data (tests/dev). */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CFG_KEY = 'mp_supa_cfg';

export let cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
export let client = null;
export const demoMode = () => !!cfg && cfg.url === 'demo';

export function saveConfig(url, anonKey){
  const cleaned = url.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').replace(/\/+$/, '');
  cfg = { url: cleaned, anonKey: anonKey.trim() };
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  client = null;
  return init();
}

export function init(){
  if (!cfg || demoMode()) return null;
  if (!client){
    client = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

export async function currentUser(){
  if (demoMode()) return { email: 'demo' };
  if (!init()) return null;
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}

export async function signIn(email, password){
  if (!init()) throw new Error('not configured');
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(){
  if (client) await client.auth.signOut();
}

export function onAuthChange(cb){
  if (demoMode() || !init()) return;
  client.auth.onAuthStateChange((_event, session) => cb(session?.user ?? null));
}
