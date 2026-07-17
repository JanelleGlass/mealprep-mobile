/* Shared UI + data-shaping helpers. */
import { S, cached } from '../store.js';

export const esc = s => { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; };
export const dateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
export const isToday = d => dateKey(d) === dateKey(new Date());
export const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const startOfWeek = d => { const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; };
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
export const COOKING_UNITS = ['tsp','tbsp','fl oz','cup','pt','qt','gal','ml','L','oz','lb','g','kg','pinch','dash','clove','slice','piece','whole','can','bunch','sprig','head','stalk','to taste'];

/* center: {text, sub} rendered inside the donut (e.g. remaining amount + 'left') */
export function ringSVG(pct, color, size = 58, stroke = 6, center = null){
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, dash = Math.min(Math.max(pct, 0), 1) * c;
  const centerSVG = !center ? '' : `
    <text x="${size/2}" y="${size/2 + (center.sub ? 2 : 5)}" text-anchor="middle"
      font-family="'IBM Plex Mono',monospace" font-weight="600"
      font-size="${center.text.length > 4 ? 11 : 13}" fill="var(--ink)">${center.text}</text>
    ${center.sub ? `<text x="${size/2}" y="${size/2 + 12}" text-anchor="middle" font-size="6.5"
      letter-spacing="0.06em" fill="var(--ink-soft)">${center.sub}</text>` : ''}`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--rule)" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${dash} ${c}" transform="rotate(-90 ${size/2} ${size/2})"/>${centerSVG}
  </svg>`;
}

/* ---------- joins for nutrition.js ---------- */
export const ingredientById = id => (cached('ingredients') || []).find(i => i.id === id) || null;
export const recipeById = id => (cached('recipes') || []).find(r => r.id === id) || null;

export function buildRecipeCalc(recipe){
  if (!recipe) return null;
  return {
    servings: recipe.servings,
    ingredients: (recipe.ingredients || [])
      .map(ri => ({ ingredient: ingredientById(ri.ingredient_id), quantity: Number(ri.quantity) }))
      .filter(x => x.ingredient),
  };
}

export function buildMealCalc(meal){
  return {
    servings: meal.servings,
    recipe: meal.recipe_id != null ? buildRecipeCalc(recipeById(meal.recipe_id)) : null,
    ingredients: (meal.ingredients || [])
      .map(mi => ({ ingredient: ingredientById(mi.ingredient_id), quantity: Number(mi.quantity) }))
      .filter(x => x.ingredient),
  };
}

/* ---------- combined entry views (synced + outbox) ---------- */
export function allFoodEntries(){
  const synced = (cached('food_log_entries') || []).map(e => ({ ...e, source: 'synced' }));
  const have = new Set(synced.map(e => e.client_id));
  const pending = S.outbox
    .filter(o => o.table === 'food_log_entries' && !have.has(o.row.client_id))
    .map(o => ({ ...o.row, source: 'outbox' }));
  return synced.concat(pending);
}

export function allBodyMeasurements(){
  const synced = (cached('body_measurements') || []).map(b => ({ ...b, source: 'synced' }));
  const have = new Set(synced.map(b => b.client_id));
  const pending = S.outbox
    .filter(o => o.table === 'body_measurements' && !have.has(o.row.client_id))
    .map(o => ({ ...o.row, source: 'outbox' }));
  return synced.concat(pending).sort((a, b) => a.date < b.date ? 1 : -1);
}

export function targets(){
  const rows = cached('user_preferences') || [];
  const num = (k, dflt) => { const r = rows.find(p => p.key === k); const v = r ? parseFloat(r.value) : NaN; return isNaN(v) ? dflt : v; };
  return { calMin: num('LogCalMin', 1700), calMax: num('LogCalMax', 1950),
           proteinMin: num('LogProteinMin', 130), proteinMax: num('LogProteinMax', 145),
           fiber: num('LogFiberTarget', 30), iron: num('LogIronTarget', 18),
           lowFloor: num('LogLowIntakeFloor', 1600), heightIn: num('LogHeightIn', 71) };
}

/* ---------- bottom sheet ---------- */
export function openSheet(title, bodyHtml){
  const sheet = document.getElementById('sheet');
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetBody').innerHTML = bodyHtml;
  sheet.classList.add('show');
  return document.getElementById('sheetBody');
}
export function closeSheet(){
  document.getElementById('sheet').classList.remove('show');
  document.getElementById('sheetBody').innerHTML = '';
}

export function entryNameWithNote(base, comp){
  if (!comp || !comp.uncountedNote) return base.slice(0, 200);
  return (base + ' — ' + comp.uncountedNote.replace('Not counted', 'not counted')).slice(0, 200);
}

export function macroLine(c, prefix){
  return `${prefix ?? ''}${c.hasApprox ? '≈ ' : ''}${Math.round(c.calories)} cal · ${c.proteinG.toFixed(1)}g P · ${c.fiberG.toFixed(1)}g fiber · ${c.ironMg.toFixed(1)}mg Fe`;
}
