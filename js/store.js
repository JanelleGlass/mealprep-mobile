/* Data access: per-table cache (stale-while-revalidate), CRUD wrappers, and
   the offline outbox for food-log/body/task writes.

   Cached tables render instantly from localStorage; a background refresh
   updates them and calls the registered onChange handler. Editing operations
   are online-only and refresh their table afterwards — except tasks, whose
   adds and edits go through the outbox so ticking one off works offline.

   Demo mode (supa cfg url === 'demo') reads tests/vectors/fixture.json and
   keeps writes in memory so the UI can be exercised without credentials. */
import { client, init, demoMode } from './supa.js';
import { addDaysKey, todayKey } from './taskdates.js';

const CACHE_PREFIX = 'mp_tbl_';
const OUTBOX_KEY = 'mp_outbox2';
const DEVICE_KEY = 'mp_device';

let deviceId = localStorage.getItem(DEVICE_KEY);
if (!deviceId){ deviceId = Math.random().toString(36).slice(2, 7); localStorage.setItem(DEVICE_KEY, deviceId); }
export const newClientId = () => `${deviceId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const S = {
  tables: {},           // name -> rows
  fetchedAt: {},        // name -> iso string
  outbox: JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'),
  onChange: () => {},
  onSync: () => {},     // (msg, isErr)
};

const TABLE_QUERIES = {
  ingredients: t => t.select('*, nutrition:nutritions(*)').order('name'),
  recipes: t => t.select('*, ingredients:recipe_ingredients(*)').order('name'),
  meals: t => t.select('*, ingredients:meal_ingredients(*)').order('date'),
  pantry_items: t => t.select('*').order('id'),
  quick_add_items: t => t.select('*').order('sort_order'),
  user_preferences: t => t.select('*'),
  food_log_entries: t => t.select('*').order('date'),
  body_measurements: t => t.select('*').order('date', { ascending: false }),
  /* every open task, plus what was finished in the last 60 days for the Done list */
  tasks: t => t.select('*')
    .or(`done.eq.false,done_at.gte.${new Date(Date.now() - 60 * 86400000).toISOString()}`)
    .order('created_at'),
};
export const ALL_TABLES = Object.keys(TABLE_QUERIES);

export function cached(name){
  if (S.tables[name]) return S.tables[name];
  const c = JSON.parse(localStorage.getItem(CACHE_PREFIX + name) || 'null');
  if (c){ S.tables[name] = c.rows; S.fetchedAt[name] = c.fetchedAt; return c.rows; }
  return null;
}

function setCache(name, rows){
  S.tables[name] = rows;
  S.fetchedAt[name] = new Date().toISOString();
  try {
    localStorage.setItem(CACHE_PREFIX + name, JSON.stringify({ rows, fetchedAt: S.fetchedAt[name] }));
  } catch { /* quota — keep in memory only */ }
}

export async function refresh(name){
  if (demoMode()) return demoRefresh(name);
  if (!init()) return null;
  const { data, error } = await TABLE_QUERIES[name](client.from(name));
  if (error) throw new Error(`${name}: ${error.message}`);
  setCache(name, data);
  return data;
}

export async function refreshAll(){
  ALL_TABLES.forEach(cached); // hydrate from localStorage first
  S.onChange();
  let failures = 0;
  await Promise.all(ALL_TABLES.map(async name => {
    try { await refresh(name); } catch { failures++; }
  }));
  if (failures === ALL_TABLES.length){
    const asOf = S.fetchedAt.food_log_entries;
    S.onSync(asOf ? 'offline — data as of ' + new Date(asOf).toLocaleString() : 'offline — no cached data yet', true);
  } else {
    S.onSync('synced · ' + new Date().toLocaleTimeString(), false);
  }
  await flushOutbox();
  S.onChange();
}

/* ---------- generic online-only editing ---------- */
export async function upsertRow(table, row){
  if (demoMode()) return demoWrite(table, row);
  if (!init()) throw new Error('not connected');
  const { data, error } = row.id
    ? await client.from(table).update(row).eq('id', row.id).select()
    : await client.from(table).insert(row).select();
  if (error) throw new Error(error.message);
  /* the write landed — a failed read-back must not surface as a failed save,
     because callers respond to "save failed" by retrying, and a retried
     insert duplicates the row; a stale cache just fixes itself next refresh */
  try { await refresh(table); } catch { /* keep the pre-write cache */ }
  S.onChange();
  return data?.[0];
}

export async function deleteRow(table, id){
  if (demoMode()) return demoDelete(table, id);
  if (!init()) throw new Error('not connected');
  const { error } = await client.from(table).delete().eq('id', id);
  if (error) throw new Error(error.message);
  await refresh(table);
  S.onChange();
}

/* child-row replacement for recipe_ingredients / meal_ingredients */
export async function replaceChildren(table, fkCol, fkVal, rows){
  if (demoMode()){
    /* demo rows keep children embedded on the parent (recipes[].ingredients),
       so mirror the write there — otherwise a demo save silently drops them */
    const parentTable = { recipe_ingredients: 'recipes', meal_ingredients: 'meals' }[table];
    if (parentTable && (S.tables[parentTable] || []).some(r => r.id === fkVal))
      demoWrite(parentTable, { id: fkVal, ingredients: rows.map(r => ({ ...r, [fkCol]: fkVal })) });
    return;
  }
  if (!init()) throw new Error('not connected');
  const del = await client.from(table).delete().eq(fkCol, fkVal);
  if (del.error) throw new Error(del.error.message);
  if (rows.length){
    const ins = await client.from(table).insert(rows.map(r => ({ ...r, [fkCol]: fkVal })));
    if (ins.error) throw new Error(ins.error.message);
  }
}

/* Nutrition rows are searched on demand, never cached as a table, so they get
   their own writer — upsertRow's refresh(table) has no query for 'nutritions'
   and would throw straight after a successful insert. */
export async function saveNutrition(row){
  if (demoMode()) return demoWrite('nutritions_demo', row);
  if (!init()) throw new Error('not connected');
  const { data, error } = row.id
    ? await client.from('nutritions').update(row).eq('id', row.id).select()
    : await client.from('nutritions').insert(row).select();
  if (error) throw new Error(error.message);
  return data?.[0];
}

export async function searchNutrition(term){
  if (demoMode()){
    const all = S.tables.nutritions_demo || [];
    return all.filter(n => n.description.toLowerCase().includes(term.toLowerCase())).slice(0, 25);
  }
  if (!init()) throw new Error('not connected');
  const { data, error } = await client.from('nutritions')
    .select('id, description, energy_kcal, protein_g, fiber_td_g, iron_mg, gm_wt_1, gm_wt_desc1, gm_wt_2, gm_wt_desc2')
    .ilike('description', `%${term}%`)
    .limit(25);
  if (error) throw new Error(error.message);
  return data;
}

export async function getPreference(key, dflt){
  const rows = cached('user_preferences') || [];
  const row = rows.find(p => p.key === key);
  const v = row ? parseFloat(row.value) : NaN;
  return isNaN(v) ? dflt : v;
}

export async function setPreference(key, value){
  if (demoMode()){
    const existing = (S.tables.user_preferences || []).find(p => p.key === key);
    demoWrite('user_preferences', existing ? { id: existing.id, value: String(value) } : { key, value: String(value) });
    return;
  }
  if (!init()) throw new Error('not connected');
  const { error } = await client.from('user_preferences')
    .upsert({ key, value: String(value) }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
  await refresh('user_preferences');
}

/* ---------- offline outbox: food log, body, tasks ----------
   Two kinds of item: { table, row } inserts, upserted by client_id so a retry
   lands once; and { table, op: 'patch', match, patch } edits to one row, sent
   in order after the inserts. A patch names its row by id, or by client_id when
   the row was added offline and has no id yet. Rows are never edited inside
   the outbox — the item may already be on its way — a later patch goes after
   it instead. */
function saveOutbox(){ localStorage.setItem(OUTBOX_KEY, JSON.stringify(S.outbox)); }

export function queueFoodEntry(fields){
  const row = { client_id: newClientId(), created_at: new Date().toISOString(), ...fields };
  S.outbox.push({ table: 'food_log_entries', row });
  saveOutbox();
  S.onChange();
  flushOutbox();
  return row;
}

export function queueBodyMeasurement(fields){
  const row = { client_id: newClientId(), ...fields };
  S.outbox.push({ table: 'body_measurements', row });
  saveOutbox();
  S.onChange();
  flushOutbox();
}

/* Tasks: one row each, written by this app and by Claude in claude.ai. Every
   change is a patch of just the fields that changed, so an edit made here
   can't overwrite a different field Claude changed in the meantime. */
export function queueTask(fields){
  const row = { client_id: newClientId(), created_at: new Date().toISOString(),
    area: 'inbox', bucket: 'now', due: null, note: '', done: false, source: 'app', ...fields };
  S.outbox.push({ table: 'tasks', row });
  saveOutbox();
  S.onChange();
  flushOutbox();
  return row;
}

export function queueTaskPatch(task, patch){
  const match = task.id != null ? { id: task.id } : { client_id: task.client_id };
  S.outbox.push({ table: 'tasks', op: 'patch', match, patch });
  saveOutbox();
  S.onChange();
  flushOutbox();
}

/* Deleting needs a connection, unless the task never left the phone */
export async function deleteTask(task){
  while (flushing) await flushing;     // a send in flight may be this task's insert
  const mine = o => o.table === 'tasks' && (o.op === 'patch'
    ? (task.id != null && o.match.id === task.id) || (!!task.client_id && o.match.client_id === task.client_id)
    : !!task.client_id && o.row.client_id === task.client_id);
  if (S.outbox.some(o => !o.op && mine(o))){
    S.outbox = S.outbox.filter(o => !mine(o));
    saveOutbox();
    S.onChange();
    return;
  }
  if (demoMode()){
    const row = (S.tables.tasks || []).find(r => (task.id != null && r.id === task.id) || (!!task.client_id && r.client_id === task.client_id));
    if (row) demoDelete('tasks', row.id);
    return;
  }
  if (!init()) throw new Error('not connected');
  const q = client.from('tasks').delete();
  const { error } = await (task.id != null ? q.eq('id', task.id) : q.eq('client_id', task.client_id));
  if (error) throw new Error(error.message);
  S.outbox = S.outbox.filter(o => !mine(o));
  saveOutbox();
  try { await refresh('tasks'); } catch { /* the delete landed; the next refresh catches up */ }
  S.onChange();
}

/* one flush at a time: a second call while one is running just asks for
   another pass afterwards, so patches to the same row can't cross */
let flushing = null, flushAgain = false;
export function flushOutbox(){
  if (flushing){ flushAgain = true; return flushing; }
  flushing = flushOnce().finally(() => {
    flushing = null;
    if (flushAgain){ flushAgain = false; flushOutbox(); }
  });
  return flushing;
}

async function flushOnce(){
  if (!S.outbox.length) return;
  const batch = [...S.outbox];
  const sent = new Set();
  if (demoMode()){
    for (const item of batch){
      if (item.op === 'patch'){
        const [k, v] = Object.entries(item.match)[0];
        const row = (S.tables[item.table] || []).find(r => r[k] === v);
        if (row) demoWrite(item.table, { id: row.id, ...item.patch });
      } else demoWrite(item.table, item.row);
      sent.add(item);
    }
    S.outbox = S.outbox.filter(o => !sent.has(o)); saveOutbox(); S.onChange();
    return;
  }
  if (!init() || !navigator.onLine) return;

  /* a table that fails keeps its items and stops there; the others still go,
     so a problem with tasks can't hold food log entries hostage */
  const failed = new Map();      // table → message
  const touched = new Set();
  const byTable = {};
  for (const item of batch) if (!item.op) (byTable[item.table] ??= []).push(item);
  for (const [table, items] of Object.entries(byTable)){
    const { error } = await client.from(table)
      .upsert(items.map(i => i.row), { onConflict: 'client_id', ignoreDuplicates: true });
    if (error){ failed.set(table, error.message); continue; }
    items.forEach(i => sent.add(i));
    touched.add(table);
  }
  for (const item of batch){
    if (item.op !== 'patch' || failed.has(item.table)) continue;
    const [k, v] = Object.entries(item.match)[0];
    const { error } = await client.from(item.table).update(item.patch).eq(k, v);
    if (error){ failed.set(item.table, error.message); continue; }
    sent.add(item);
    touched.add(item.table);
  }

  S.outbox = S.outbox.filter(o => !sent.has(o));
  saveOutbox();
  for (const table of touched){
    try { await refresh(table); } catch { /* written; the next refresh catches up */ }
  }
  if (failed.size) S.onSync('saved on phone — sync failed: ' + [...failed.values()][0], true);
  else S.onSync('synced · ' + new Date().toLocaleTimeString(), false);
  S.onChange();
}

export async function deleteLogEntry(clientId){
  const idx = S.outbox.findIndex(o => o.row.client_id === clientId);
  if (idx >= 0){
    S.outbox.splice(idx, 1);
    saveOutbox();
    S.onChange();
    return;
  }
  if (demoMode()){ demoDeleteBy('food_log_entries', clientId); return; }
  if (!init()) throw new Error('not connected');
  const { error } = await client.from('food_log_entries').delete().eq('client_id', clientId);
  if (error) throw new Error(error.message);
  await refresh('food_log_entries');
  S.onChange();
}

window.addEventListener('online', flushOutbox);

/* ---------- demo mode (fixture-backed, in-memory writes) ---------- */
let demoData = null;
async function demoLoad(){
  if (demoData) return demoData;
  const fx = await (await fetch('tests/vectors/fixture.json')).json();
  const nById = new Map(fx.nutritions.map(n => [n.id, {
    id: n.id, description: n.description ?? ('USDA #' + n.id),
    energy_kcal: n.energy_Kcal, protein_g: n.protein_g, fiber_td_g: n.fiber_TD_g, iron_mg: n.iron_mg,
    gm_wt_1: n.gmWt_1, gm_wt_desc1: n.gmWt_Desc1, gm_wt_2: n.gmWt_2, gm_wt_desc2: n.gmWt_Desc2,
  }]));
  /* sections live on the ingredient; the first few get one so the demo shows
     more than a single 'Other' pile */
  const demoCategory = ['Fridge', 'Freezer', 'Produce', 'Dry Goods', 'Spices & Seasonings'];
  demoData = {
    nutritions_demo: [...nById.values()],
    ingredients: fx.ingredients.map((i, n) => ({ id: i.id, name: i.name, unit: i.unit,
      category: demoCategory[n] ?? '', nutrition_id: i.nutritionId,
      nutrition: i.nutritionId ? nById.get(i.nutritionId) : null })),
    recipes: fx.recipes.map(r => ({ id: r.id, name: r.name, servings: r.servings, description: null,
      ingredients: fx.recipeIngredients.filter(ri => ri.recipeId === r.id).map(ri => ({ recipe_id: r.id, ingredient_id: ri.ingredientId, quantity: ri.quantity })) })),
    meals: fx.meals.map(m => ({ id: m.id, date: '2026-07-06', meal_type: 0, title: m.title, servings: m.servings, recipe_id: m.recipeId,
      ingredients: fx.mealIngredients.filter(mi => mi.mealId === m.id).map(mi => ({ meal_id: m.id, ingredient_id: mi.ingredientId, quantity: mi.quantity })) })).slice(0, 3),
    pantry_items: fx.ingredients.slice(0, 6).map((ing, i) => ({
      id: i + 1, ingredient_id: ing.id, quantity: i + 1,
    })), quick_add_items: [{ id: 1, name: 'Soft boiled egg', calories: 70, protein_g: 6, fiber_g: 0, iron_mg: 0.6, is_plant: false, sort_order: 0 }],
    user_preferences: [], food_log_entries: [], body_measurements: [],
    /* fixture dates are days from today, so the demo always has something
       overdue, due today and coming up */
    tasks: (fx.tasks || []).map((t, i) => ({ id: i + 1, title: t.title, area: t.area, bucket: t.bucket,
      due: t.dueIn == null ? null : addDaysKey(todayKey(), t.dueIn), note: t.note || '',
      done: !!t.done, done_at: t.done ? new Date().toISOString() : null, deferrals: 0,
      source: 'app', client_id: null, legacy_id: null,
      created_at: new Date(Date.now() - (60 - i) * 60000).toISOString() })),
  };
  return demoData;
}
async function demoRefresh(name){
  const d = await demoLoad();
  S.tables.nutritions_demo = d.nutritions_demo;
  if (S.tables[name]) return S.tables[name]; // keep in-memory demo writes
  setCache(name, d[name] || []);
  return d[name];
}
let demoNextId = 100000;
function demoWrite(table, row){
  /* mirror the ingredients query's nutrition join, so a demo row saved with a
     nutrition_id computes in recipes instead of showing 'not counted' */
  if (table === 'ingredients' && row.nutrition_id != null && !row.nutrition)
    row = { ...row, nutrition: (S.tables.nutritions_demo || []).find(n => n.id === row.nutrition_id) ?? null };
  const rows = S.tables[table] || [];
  let saved = row;
  if (row.id){
    const i = rows.findIndex(r => r.id === row.id);
    if (i >= 0){ rows[i] = { ...rows[i], ...row }; saved = rows[i]; }
  } else {
    /* stay above any cached ids from previous demo sessions */
    demoNextId = Math.max(demoNextId, ...rows.map(r => (r.id || 0) + 1));
    saved = { id: demoNextId++, ...row };
    rows.push(saved);
  }
  setCache(table, rows);
  S.onChange();
  return saved;
}
function demoDelete(table, id){
  setCache(table, (S.tables[table] || []).filter(r => r.id !== id));
  S.onChange();
}
function demoDeleteBy(table, clientId){
  setCache(table, (S.tables[table] || []).filter(r => r.client_id !== clientId));
  S.onChange();
}
