/* A JSON blob that lives in localStorage (offline-first) and is mirrored to
   Supabase as a single value in user_preferences, so an edit on the phone shows
   up on the computer and vice-versa.

   Granularity is the whole blob: a remote pull replaces the local copy, so a
   concurrent edit on another device is overwritten rather than merged. The
   dirty flag is what keeps that from eating your own unsynced work — while it
   is set, we never adopt the remote copy. */
import { cached, setPreference } from './store.js';

export function createSyncedBlob({ prefKey, localKey, dirtyKey }){
  const load = () => { try { return JSON.parse(localStorage.getItem(localKey)) || {}; } catch { return {}; } };
  let data = load();

  const isDirty = () => localStorage.getItem(dirtyKey) === '1';
  const setDirty = v => { try { v ? localStorage.setItem(dirtyKey, '1') : localStorage.removeItem(dirtyKey); } catch { /* private mode */ } };

  /* the synced copy, read from the cached user_preferences table */
  function remote(){
    const row = (cached('user_preferences') || []).find(p => p.key === prefKey);
    if (!row || !row.value) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }

  /* push the whole blob up; on failure (offline) mark dirty to retry later */
  async function push(){
    try { await setPreference(prefKey, JSON.stringify(data)); setDirty(false); }
    catch { setDirty(true); }
  }

  const blob = {
    get: () => data,
    /* replace the in-memory reference (used when adopting a remote copy) */
    set(next){ data = next; blob.persist(); },
    /* persist locally, then send it up */
    save(){ blob.persist(); setDirty(true); push(); },
    persist(){ try { localStorage.setItem(localKey, JSON.stringify(data)); } catch { /* private mode */ } },
    remote,
    /* adopt the synced copy — unless we hold unsynced local edits */
    reconcile(){
      if (isDirty()) return false;
      const r = remote();
      if (!r) return false;
      data = r; blob.persist();
      return true;
    },
    push,
    isDirty,
    /* true when the remote copy differs from what we hold */
    changedRemotely(){
      const r = remote();
      return !!r && JSON.stringify(r) !== JSON.stringify(data);
    },
  };

  window.addEventListener('online', () => { if (isDirty()) push(); });
  return blob;
}
