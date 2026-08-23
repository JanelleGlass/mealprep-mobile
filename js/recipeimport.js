/* Parsing, validation, and resolution for "import recipe from JSON"
   (format: RECIPE-JSON.md). Pure functions — no DOM, no store — so node can
   test them without the Supabase CDN import chain behind ui/common.js. The
   unit/category lists are passed in by the caller for the same reason; the
   test file carries its own copies. */

/* Common ways a human (or a chat model) writes a unit, mapped onto the app's
   canonical short forms. Plurals are handled generically below. */
const UNIT_ALIASES = {
  teaspoon: 'tsp', tablespoon: 'tbsp', tbs: 'tbsp',
  'fluid ounce': 'fl oz', 'fluid oz': 'fl oz', floz: 'fl oz',
  ounce: 'oz', pound: 'lb', gram: 'g', gramme: 'g', kilogram: 'kg', kilo: 'kg',
  milliliter: 'ml', millilitre: 'ml', liter: 'L', litre: 'L',
  pint: 'pt', quart: 'qt', gallon: 'gal',
};

/* Returns the matching entry from unitList (the app's own casing) or null. */
export function normalizeUnit(raw, unitList){
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const inList = t => unitList.find(x => x.toLowerCase() === t) || null;
  /* own-property check: a bare UNIT_ALIASES[t] resolves Object.prototype keys,
     so "constructor" as a unit would throw instead of parsing as unknown */
  const alias = t => Object.prototype.hasOwnProperty.call(UNIT_ALIASES, t) ? UNIT_ALIASES[t] : null;
  const resolve = t => inList(t) || (alias(t) ? inList(alias(t).toLowerCase()) : null);
  const u = raw.trim().toLowerCase().replace(/\.+$/, '');
  let hit = resolve(u);
  if (!hit && u.endsWith('s')) hit = resolve(u.slice(0, -1));   // cups, cloves, tablespoons
  if (!hit && u.endsWith('es')) hit = resolve(u.slice(0, -2));  // pinches, dashes
  return hit;
}

const normCategory = (raw, list) => list.find(c => c.toLowerCase() === raw.trim().toLowerCase()) || null;

function stringArray(raw, field, errors){
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.some(s => typeof s !== 'string')){
    errors.push(`"${field}" must be an array of strings`);
    return [];
  }
  return raw.map(s => s.trim()).filter(Boolean);
}

const KNOWN_KEYS = ['name', 'servings', 'category', 'variationOf', 'summary', 'description',
                    'ingredients', 'ingredientLines', 'steps', 'notes'];
const KNOWN_ING_KEYS = ['name', 'quantity', 'unit', 'nutrition', 'section'];

/* -> { draft, errors, warnings }. draft is best-effort; only act on it when
   errors is empty. Ingredient rows come out as { name, quantity, unit (as
   written), unitCanonical, nutrition, section }. */
export function parseRecipeJson(text, { units, categories, pantryCategories }){
  const errors = [], warnings = [];
  const draft = { name: '', servings: 0, category: null, variationOf: null,
                  summary: null, description: null, ingredients: [],
                  ingredientLines: [], steps: [], notes: [] };
  let raw;
  try { raw = JSON.parse(text); }
  catch (e){ return { draft, errors: ['not valid JSON — ' + e.message], warnings }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { draft, errors: ['expected a single JSON object, {...}'], warnings };

  Object.keys(raw).filter(k => !KNOWN_KEYS.includes(k))
    .forEach(k => warnings.push(`ignored unknown field "${k}"`));

  if (typeof raw.name === 'string' && raw.name.trim()) draft.name = raw.name.trim();
  else errors.push('"name" is required');

  /* Number() alone would quietly accept true (1) or [2] (2) */
  const num = v => (typeof v === 'number' || typeof v === 'string') ? Number(v) : NaN;

  const sv = num(raw.servings);
  if (Number.isFinite(sv) && sv >= 1) draft.servings = Math.round(sv);
  else errors.push('"servings" must be a number of at least 1');

  if (raw.category != null){
    if (typeof raw.category !== 'string') errors.push('"category" must be a string');
    else {
      draft.category = normCategory(raw.category, categories);
      if (!draft.category)
        warnings.push(`unknown category "${raw.category.trim()}" — the recipe will file under Other (sections: ${categories.join(', ')})`);
    }
  }

  if (raw.variationOf != null){
    if (typeof raw.variationOf === 'string' && raw.variationOf.trim()) draft.variationOf = raw.variationOf.trim();
    else errors.push('"variationOf" must be a recipe name');
  }

  for (const f of ['summary', 'description']){
    if (raw[f] == null) continue;
    if (typeof raw[f] === 'string') draft[f] = raw[f].trim() || null;
    else errors.push(`"${f}" must be a string`);
  }

  draft.ingredientLines = stringArray(raw.ingredientLines, 'ingredientLines', errors);
  draft.steps = stringArray(raw.steps, 'steps', errors);
  draft.notes = stringArray(raw.notes, 'notes', errors);

  if (!Array.isArray(raw.ingredients) || !raw.ingredients.length){
    errors.push('"ingredients" must be a non-empty array');
    return { draft, errors, warnings };
  }
  raw.ingredients.forEach((ri, idx) => {
    const label = `ingredient ${idx + 1}`;
    if (typeof ri !== 'object' || ri === null || Array.isArray(ri)){
      errors.push(`${label} must be an object like { "name": ..., "quantity": ..., "unit": ... }`);
      return;
    }
    Object.keys(ri).filter(k => !KNOWN_ING_KEYS.includes(k))
      .forEach(k => warnings.push(`${label}: ignored unknown field "${k}"`));
    const row = { name: '', quantity: 0, unit: null, unitCanonical: null, nutrition: null, section: null };
    if (typeof ri.name === 'string' && ri.name.trim()) row.name = ri.name.trim();
    else errors.push(`${label} needs a "name"`);
    const q = num(ri.quantity);
    if (Number.isFinite(q) && q > 0) row.quantity = q;
    else errors.push(`${label}${row.name ? ` ("${row.name}")` : ''}: "quantity" must be a number above 0`);
    if (ri.unit != null){
      if (typeof ri.unit !== 'string') errors.push(`${label}${row.name ? ` ("${row.name}")` : ''}: "unit" must be a string`);
      else { row.unit = ri.unit.trim() || null; row.unitCanonical = normalizeUnit(ri.unit, units); }
    }
    if (ri.nutrition != null){
      if (typeof ri.nutrition === 'string') row.nutrition = ri.nutrition.trim() || null;
      else errors.push(`${label}${row.name ? ` ("${row.name}")` : ''}: "nutrition" must be a USDA description string`);
    }
    if (ri.section != null && typeof ri.section === 'string' && ri.section.trim()){
      row.section = normCategory(ri.section, pantryCategories);
      if (!row.section) warnings.push(`${label}${row.name ? ` ("${row.name}")` : ''}: unknown pantry section "${ri.section.trim()}" — a new ingredient files under Other`);
    }
    draft.ingredients.push(row);
  });

  /* The DB stores one row per ingredient, so a name used twice merges — same
     convention as the bulk-add SQL files, which sum repeated ingredients. */
  const byName = new Map();
  const merged = [];
  const unitKey = r => (r.unitCanonical || r.unit || '').toLowerCase();
  for (const row of draft.ingredients){
    const key = row.name.toLowerCase();
    const prev = byName.get(key);
    if (!prev){ byName.set(key, row); merged.push(row); continue; }
    if (unitKey(prev) !== unitKey(row)){
      errors.push(`"${row.name}" appears twice with different units (${prev.unit ?? '—'} vs ${row.unit ?? '—'}) — convert one and sum them yourself`);
      continue;
    }
    prev.quantity = +(prev.quantity + row.quantity).toFixed(4);
    if (!prev.nutrition) prev.nutrition = row.nutrition;  // whichever occurrence
    if (!prev.section) prev.section = row.section;        // carried them wins
    warnings.push(`"${row.name}" appears more than once — quantities summed to ${prev.quantity}`);
  }
  draft.ingredients = merged;

  return { draft, errors, warnings };
}

/* Match each parsed row against the existing ingredient rows (by name,
   case-insensitive — the same rule as pg_temp.mp_ing in the bulk-add SQL).
   status: 'existing' | 'unit-mismatch' | 'new' | 'new-no-unit'.
   An existing match keeps its own unit, so a differing written unit only warns;
   a brand-new ingredient can't be created without a unit the app knows. */
export function resolveIngredients(rows, existing){
  return rows.map(r => {
    const match = existing.find(i => (i.name || '').trim().toLowerCase() === r.name.toLowerCase()) || null;
    if (match){
      /* fall back to the raw written unit — "stick" (unknown to the app) against
         a butter stored in tbsp needs the warning more than "cups" does */
      const written = (r.unitCanonical || r.unit || '').trim().toLowerCase();
      const mismatch = written && match.unit && written !== match.unit.trim().toLowerCase();
      return { ...r, match, status: mismatch ? 'unit-mismatch' : 'existing' };
    }
    return { ...r, match: null, status: r.unitCanonical ? 'new' : 'new-no-unit' };
  });
}

/* Assemble the written-recipe description in the INGREDIENTS/STEPS/NOTES shape
   the bulk-add SQL files established. An explicit "description" wins verbatim. */
export function buildDescription(draft){
  if (draft.description) return draft.description;
  const parts = [];
  if (draft.summary) parts.push(draft.summary);
  if (draft.ingredientLines.length || draft.steps.length){
    const lines = draft.ingredientLines.length
      ? draft.ingredientLines
      : draft.ingredients.map(r => `${r.quantity}${r.unit ? ' ' + r.unit : ''} ${r.name}`);
    parts.push('INGREDIENTS\n' + lines.join('\n'));
  }
  if (draft.steps.length)
    parts.push('STEPS\n' + draft.steps
      /* tolerate pre-numbered steps; the \s+ keeps a leading decimal quantity
         ("1.5 cups go in last") from losing its integer part */
      .map((s, i) => `${i + 1}. ${s.replace(/^\d+[.)]\s+/, '')}`)
      .join('\n'));
  if (draft.notes.length) parts.push('NOTES\n' + draft.notes.join('\n\n'));
  return parts.join('\n\n') || null;
}
