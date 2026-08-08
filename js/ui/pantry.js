/* Pantry tab (editable quantities + add) and the ingredient editor
   (name/unit/price + USDA nutrition linking with live conversion check). */
import { cached, upsertRow, deleteRow } from '../store.js';
import { esc, COOKING_UNITS, PANTRY_CATEGORIES, ingredientById, openSheet, closeSheet,
         collapsibleSection } from './common.js';
import { pickIngredient, pickNutrition, pickCategory, confirmDialog,
         customFoodEditor } from './pickers.js';
import { tryConvertToGrams } from '../nutrition.js';

const seg = { mode: 'pantry' };
/* which category sections the user has opened — absent means closed. Keys carry
   the segment, so opening Produce here doesn't open it on the other list. */
const catOpen = {};
const isOpen = key => catOpen[key] ?? false;

/* Both lists file into the same sections, in PANTRY_CATEGORIES order. The
   category lives on the pantry row, so an ingredient you don't stock has none
   and lands under 'Other' — the same place the pantry puts a blank one. */
function byCategory(rows, catOf){
  const groups = new Map(PANTRY_CATEGORIES.map(c => [c, []]));
  rows.forEach(r => {
    const c = catOf(r);
    groups.get(PANTRY_CATEGORIES.includes(c) ? c : 'Other').push(r);
  });
  return [...groups].filter(([, xs]) => xs.length);
}

function wireSections(root){
  root.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => {
    const key = b.getAttribute('data-sec');
    catOpen[key] = !isOpen(key);
    const y = window.scrollY;
    renderPantry();
    window.scrollTo(0, y);
  }));
}

export function renderPantry(){
  const root = document.getElementById('pantryRoot');
  document.querySelectorAll('#tab-pantry .segBtn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-seg') === seg.mode));

  if (seg.mode === 'pantry'){
    const items = (cached('pantry_items') || []).map(p => ({ p, ing: ingredientById(p.ingredient_id) }))
      .filter(x => x.ing).sort((a, b) => a.ing.name.localeCompare(b.ing.name));
    const rowHtml = ({ p, ing }) =>
      `<div class="listRow"><span data-cat="${p.id}" style="cursor:pointer;">${esc(ing.name)}</span>
        <span class="qty"><input type="number" class="qtyIn" data-p="${p.id}" step="0.5" value="${p.quantity}"> ${esc(ing.unit)}
        <button class="del" data-rmp="${p.id}">✕</button></span></div>`;
    root.innerHTML = (items.length
      ? byCategory(items, x => x.p.category).map(([cat, xs]) =>
          collapsibleSection(`pantry|${cat}`, cat, isOpen(`pantry|${cat}`),
            '<div class="card">' + xs.map(rowHtml).join('') + '</div>',
            { count: String(xs.length) })).join('')
      : '<div class="card"><div class="empty">Pantry is empty</div></div>')
      + '<button class="addBtn floatAdd" id="pAdd">＋ add pantry item</button>';
    wireSections(root);
    root.querySelectorAll('.qtyIn').forEach(inp => inp.addEventListener('change', async () => {
      try { await upsertRow('pantry_items', { id: +inp.getAttribute('data-p'), quantity: parseFloat(inp.value) || 0 }); }
      catch (err) { inp.style.outline = '2px solid var(--iron)'; }
    }));
    root.querySelectorAll('[data-rmp]').forEach(b => b.addEventListener('click', async () => {
      await deleteRow('pantry_items', +b.getAttribute('data-rmp'));
      renderPantry();
    }));
    root.querySelectorAll('[data-cat]').forEach(el => el.addEventListener('click', async () => {
      const p = (cached('pantry_items') || []).find(x => x.id === +el.getAttribute('data-cat'));
      if (!p) return;
      const cat = await pickCategory(PANTRY_CATEGORIES.includes(p.category) ? p.category : 'Other');
      if (cat === null || cat === p.category) return;
      await upsertRow('pantry_items', { id: p.id, category: cat });
      renderPantry();
    }));
    root.querySelector('#pAdd').addEventListener('click', async () => {
      const ing = await pickIngredient({ allowCreate: true });
      if (!ing) return;
      const existing = (cached('pantry_items') || []).find(p => p.ingredient_id === ing.id);
      if (existing) await addToPantry(ing.id, 1);         // already stocked: one more
      else {
        const cat = await pickCategory(null);
        await upsertRow('pantry_items', { ingredient_id: ing.id, quantity: 1, category: cat ?? '' });
      }
      renderPantry();
    });
  } else {
    const ingredients = (cached('ingredients') || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const pantry = cached('pantry_items') || [];
    const catOfIngredient = i => pantry.find(p => p.ingredient_id === i.id)?.category;
    const rowHtml = i =>
      `<div class="listRow" data-ing="${i.id}" style="cursor:pointer;">
        <span>${esc(i.name)}</span>
        <span class="qty">${esc(i.unit)} · ${!i.nutrition_id ? 'not linked'
          : i.nutrition && i.nutrition.is_usda === false ? 'label ✓' : 'USDA ✓'}</span>
      </div>`;
    root.innerHTML = (ingredients.length
      ? byCategory(ingredients, catOfIngredient).map(([cat, xs]) =>
          collapsibleSection(`ing|${cat}`, cat, isOpen(`ing|${cat}`),
            '<div class="card">' + xs.map(rowHtml).join('') + '</div>',
            { count: String(xs.length) })).join('')
      : '<div class="card"><div class="empty">No ingredients yet</div></div>')
      + '<button class="addBtn floatAdd" id="iAdd">＋ new ingredient</button>';
    wireSections(root);
    root.querySelectorAll('[data-ing]').forEach(r => r.addEventListener('click', () => {
      const ing = ingredientById(+r.getAttribute('data-ing'));
      if (ing) openIngredientEditor(ing);
    }));
    root.querySelector('#iAdd').addEventListener('click', () => openIngredientEditor(null));
  }
}

/* Add to what's on hand: bump an existing row, or create one. Online-only
   (upsertRow throws when offline) — callers own the retry. New rows land
   uncategorised, which renders under 'Other', rather than interrupting a
   grocery run with a category picker. */
export async function addToPantry(ingredientId, qty){
  if (!(qty > 0)) return;
  const existing = (cached('pantry_items') || []).find(p => p.ingredient_id === ingredientId);
  if (existing) await upsertRow('pantry_items', { id: existing.id, quantity: (+existing.quantity || 0) + qty });
  else await upsertRow('pantry_items', { ingredient_id: ingredientId, quantity: qty, category: '' });
}

/* Returns the saved ingredient row (or null). opts.nested: caller re-opens and
   redraws its own sheet after. opts.name: prefill for a new ingredient. */
export function openIngredientEditor(ingredient, opts = {}){
  return new Promise(resolve => {
    const draft = ingredient ? {
      id: ingredient.id, name: ingredient.name, unit: ingredient.unit,
      price: ingredient.price_per_unit, nutrition_id: ingredient.nutrition_id,
      nutrition: ingredient.nutrition ?? null,
    } : { name: opts.name ?? '', unit: 'whole', price: null, nutrition_id: null, nutrition: null };

    const body = openSheet(ingredient ? 'Edit ingredient' : 'New ingredient', '');

    function conversionLine(){
      if (!draft.nutrition) return 'no USDA link — recipes using this ingredient show "not counted"';
      const g = tryConvertToGrams(1, draft.unit, draft.nutrition);
      if (g === 0) return 'negligible unit — counts as 0';
      if (g === null) return `⚠ can't convert "${draft.unit}" for this food — pick a USDA entry with a matching serving weight, or use a weight unit (g/oz)`;
      return `1 ${draft.unit} ≈ ${Math.round(g)} g${draft.nutrition.gm_wt_desc1 ? ` (via "${draft.nutrition.gm_wt_desc1}")` : ''}`;
    }

    function draw(){
      body.innerHTML = `
        <span class="miniLabel">name</span>
        <input type="text" id="igName" value="${esc(draft.name)}">
        <span class="miniLabel">unit you measure it in</span>
        <select id="igUnit">${COOKING_UNITS.map(u => `<option ${u === draft.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
        <span class="miniLabel">price per unit (optional)</span>
        <input type="number" id="igPrice" step="0.01" value="${draft.price ?? ''}">
        <span class="miniLabel">usda nutrition</span>
        <div class="card" style="margin-bottom:8px;">
          <div class="cSub">${draft.nutrition ? esc(draft.nutrition.description ?? 'linked') : 'not linked'}</div>
          <div class="cSub">${conversionLine()}</div>
          <div class="quickRow" style="margin-top:8px;">
            <button class="quickChip" id="igLink">${draft.nutrition ? 'change link' : 'link USDA food'}</button>
            <button class="quickChip" id="igCustom">＋ enter a label</button>
            ${draft.nutrition ? '<button class="quickChip" id="igUnlink">unlink</button>' : ''}
          </div>
        </div>
        <div class="macros" id="igMsg"></div>
        <div class="btnRow">
          <button class="cancel" id="igCancel">cancel</button>
          <button class="save" id="igSave">save</button>
        </div>`;

      body.querySelector('#igName').addEventListener('input', e => draft.name = e.target.value);
      body.querySelector('#igUnit').addEventListener('change', e => { draft.unit = e.target.value; draw(); });
      body.querySelector('#igPrice').addEventListener('change', e => draft.price = e.target.value ? parseFloat(e.target.value) : null);
      body.querySelector('#igLink').addEventListener('click', async () => {
        const n = await pickNutrition(draft.unit, draft.name);
        if (n){ draft.nutrition = n; draft.nutrition_id = n.id; }
        draw();
      });
      body.querySelector('#igCustom').addEventListener('click', async () => {
        const n = await customFoodEditor(draft.unit, draft.name);
        if (n){ draft.nutrition = n; draft.nutrition_id = n.id; }
        draw();
      });
      body.querySelector('#igUnlink')?.addEventListener('click', () => { draft.nutrition = null; draft.nutrition_id = null; draw(); });
      body.querySelector('#igCancel').addEventListener('click', () => { closeSheet(); resolve(null); });
      body.querySelector('#igSave').addEventListener('click', async () => {
        try {
          if (!draft.name.trim()){ document.getElementById('igMsg').textContent = 'name required'; return; }
          const saved = await upsertRow('ingredients', {
            ...(draft.id ? { id: draft.id } : {}),
            name: draft.name.trim(), unit: draft.unit,
            price_per_unit: draft.price, nutrition_id: draft.nutrition_id,
          });
          closeSheet();
          resolve(saved ?? null);
          if (!opts.nested) renderPantry();
        } catch (err) {
          document.getElementById('igMsg').textContent = 'save failed: ' + err.message;
        }
      });
    }
    draw();
  });
}

export function wirePantryTab(){
  document.querySelectorAll('#tab-pantry .segBtn').forEach(b => b.addEventListener('click', () => {
    seg.mode = b.getAttribute('data-seg');
    renderPantry();
  }));
}
