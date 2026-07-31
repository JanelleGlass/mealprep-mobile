/* Cook plan: which recipes you're cooking on a given Friday (Sabbath cook) or
   Monday (meal prep), plus the shopping list those recipes imply.

   Stored as one JSON blob synced through user_preferences, keyed by date:

     { "2026-08-07": { cook:    [{ r: 12, m: 2 }],     // recipe id, batches
                       prep:    [],
                       applied: { "5": 3 } } }         // ingredient id -> qty
                                                       // already added to pantry

   'applied' is a ledger, not a cache. It is what makes checking a shopping item
   idempotent (uncheck/re-check adds nothing the second time), offline-tolerant
   (the debt survives until you reconnect) and safe across devices.

   Quantities need no unit conversion: recipe_ingredients.quantity and
   pantry_items.quantity are both expressed in ingredients.unit — the same
   contract buildRecipeCalc relies on. Don't "fix" this by converting. */
import { cached } from '../store.js';
import { createSyncedBlob } from '../syncblob.js';
import { dateKey, startOfDay, ingredientById, recipeById } from './common.js';

const plan = createSyncedBlob({
  prefKey: 'CookPlan', localKey: 'cookplan.data', dirtyKey: 'cookplan.dirty',
});

export const SLOTS = { cook: { dow: 5, label: 'cook for Sabbath' },
                       prep: { dow: 1, label: 'meal prep' } };

/* ---------- dates ---------- */
/* The next date with this day-of-week. A delta of 0 means today counts, so on a
   Friday "add to Friday" lands on today rather than a week out. */
export function nextDowDate(dow, from = new Date()){
  const d = startOfDay(from);
  d.setDate(d.getDate() + ((dow - d.getDay() + 7) % 7));
  return d;
}
export const nextCookDate = () => nextDowDate(SLOTS.cook.dow);
export const nextPrepDate = () => nextDowDate(SLOTS.prep.dow);

/* ---------- read ---------- */
export function entriesFor(dk, slot){
  const day = plan.get()[dk];
  return (day && Array.isArray(day[slot])) ? day[slot] : [];
}

/* every day this recipe is assigned to, soonest first */
export function assignedSummary(recipeId){
  const out = [];
  for (const [dk, day] of Object.entries(plan.get())){
    for (const slot of Object.keys(SLOTS)){
      const e = (day[slot] || []).find(x => +x.r === recipeId);
      if (e) out.push({ dk, slot, m: Number(e.m) || 1 });
    }
  }
  return out.sort((a, b) => a.dk.localeCompare(b.dk));
}

/* ---------- write ---------- */
export function assignRecipe(dk, slot, recipeId, batches){
  const m = Math.max(0.5, Number(batches) || 1);
  const day = plan.get()[dk] || (plan.get()[dk] = {});
  const list = day[slot] || (day[slot] = []);
  /* dedupe by recipe: a second add tops up the batch count. Two entries would
     render two rows sharing one data-check id, which checks both at once. */
  const existing = list.find(x => +x.r === recipeId);
  if (existing) existing.m = (Number(existing.m) || 1) + m;
  else list.push({ r: recipeId, m });
  plan.save();
  return existing ? existing.m : m;
}

export function removeRecipe(dk, slot, recipeId){
  const day = plan.get()[dk];
  if (!day || !Array.isArray(day[slot])) return;
  day[slot] = day[slot].filter(x => +x.r !== recipeId);
  if (!day.cook?.length && !day.prep?.length && !Object.keys(day.applied || {}).length) delete plan.get()[dk];
  plan.save();
}

/* drop plan entries older than `days` so the blob can't grow without bound */
export function prunePlan(days = 60){
  const cutoff = startOfDay(new Date());
  cutoff.setDate(cutoff.getDate() - days);
  const key = dateKey(cutoff);
  const data = plan.get();
  let changed = false;
  for (const dk of Object.keys(data)) if (dk < key){ delete data[dk]; changed = true; }
  if (changed) plan.save();
}

/* ---------- shopping ---------- */
/* The one place quantities are computed, so what's displayed and what's written
   to the pantry can never disagree. */
export function shoppingFor(dk){
  const day = plan.get()[dk];
  if (!day) return [];

  const need = new Map();
  for (const slot of Object.keys(SLOTS)){
    for (const e of (day[slot] || [])){
      const r = recipeById(+e.r);
      if (!r) continue;                          // deleted (or not yet synced) recipe
      const m = Number(e.m) || 1;
      for (const ri of (r.ingredients || []))
        need.set(ri.ingredient_id, (need.get(ri.ingredient_id) || 0) + Number(ri.quantity) * m);
    }
  }

  const pantry = cached('pantry_items') || [];
  return [...need].map(([ingredient_id, qty]) => {
    const ing = ingredientById(ingredient_id);
    if (!ing) return null;                       // deleted ingredient
    const have = Number(pantry.find(p => p.ingredient_id === ingredient_id)?.quantity) || 0;
    const rounded = Math.round(qty * 100) / 100;
    return { ingredient_id, name: ing.name, unit: ing.unit, need: rounded, have, covered: have >= rounded };
  }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
}

/* ---------- pantry ledger ----------
   isShopChecked(ingredientId) -> bool, supplied by the routines log. */
export function owedFor(dk, isShopChecked){
  const day = plan.get()[dk];
  if (!day) return [];
  const applied = day.applied || {};
  return shoppingFor(dk)
    .filter(x => isShopChecked(x.ingredient_id))
    .map(x => ({ ingredient_id: x.ingredient_id, need: x.need, delta: x.need - (Number(applied[x.ingredient_id]) || 0) }))
    .filter(x => x.delta > 0);
}

export function markApplied(dk, ingredientId, need){
  const day = plan.get()[dk] || (plan.get()[dk] = {});
  const applied = day.applied || (day.applied = {});
  applied[ingredientId] = need;
  plan.save();
}

/* ---------- sync surface for routines.js ---------- */
export const planReconcile = () => plan.reconcile();
export const planChangedRemotely = () => plan.changedRemotely();
export const planPush = () => plan.push();
export const planIsDirty = () => plan.isDirty();
