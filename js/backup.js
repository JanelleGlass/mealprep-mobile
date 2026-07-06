/* Manual JSON backup of all Supabase tables to the private GitHub data repo. */
import { client, init, demoMode } from './supa.js';

const PAT_KEY = 'mp_backup_pat';
const REPO = 'JanelleGlass/mealprep-data';

export const getPat = () => localStorage.getItem(PAT_KEY) || '';
export const setPat = v => localStorage.setItem(PAT_KEY, v.trim());
export const lastBackupAt = () => localStorage.getItem('mp_last_backup') || null;

function b64encode(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function fetchAllRows(table){
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page){
    const { data, error } = await client.from(table).select('*').range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < page) break;
  }
  return rows;
}

async function putFile(path, content, pat){
  const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const headers = { 'Authorization': 'Bearer ' + pat, 'Accept': 'application/vnd.github+json' };
  let sha;
  const get = await fetch(url, { headers });
  if (get.ok) sha = (await get.json()).sha;
  const body = { message: `MealPrep backup ${new Date().toISOString()}`, content: b64encode(content) };
  if (sha) body.sha = sha;
  const put = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!put.ok) throw new Error(`GitHub ${put.status}`);
}

export async function runBackup(onProgress){
  if (demoMode()) throw new Error('demo mode');
  if (!init()) throw new Error('not connected');
  const pat = getPat();
  if (!pat) throw new Error('paste your GitHub token first');
  const tables = ['nutritions', 'ingredients', 'recipes', 'recipe_ingredients', 'meals',
                  'meal_ingredients', 'pantry_items', 'food_log_entries', 'body_measurements',
                  'quick_add_items', 'user_preferences'];
  const doc = { version: 2, exportedAt: new Date().toISOString(), tables: {} };
  for (const t of tables){
    onProgress?.(`reading ${t}…`);
    doc.tables[t] = await fetchAllRows(t);
  }
  const json = JSON.stringify(doc);
  onProgress?.('uploading…');
  await putFile('supabase-backup/backup-latest.json', json, pat);
  await putFile(`supabase-backup/backup-${new Date().toISOString().slice(0, 10)}.json`, json, pat);
  localStorage.setItem('mp_last_backup', new Date().toISOString());
  return Object.fromEntries(Object.entries(doc.tables).map(([k, v]) => [k, v.length]));
}
