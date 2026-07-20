/* Pantry tab (editable quantities + add) and the ingredient editor
   (name/unit/price + USDA nutrition linking with live conversion check). */
import { cached, upsertRow, deleteRow } from '../store.js';
import { esc, COOKING_UNITS, PANTRY_CATEGORIES, ingredientById, openSheet, closeSheet } from './common.js';
import { pickIngredient, pickNutrition, pickCategory, confirmDialog } from './pickers.js';
import { tryConvertToGrams } from '../nutrition.js';

const seg = { mode: 'pantry' };

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
    const groups = new Map(PANTRY_CATEGORIES.map(c => [c, []]));
    items.forEach(x => groups.get(PANTRY_CATEGORIES.includes(x.p.category) ? x.p.category : 'Other').push(x));
    root.innerHTML = (items.length
      ? [...groups].filter(([, xs]) => xs.length).map(([cat, xs]) =>
          `<div class="sectionTitle">${esc(cat)} <span class="qty">${xs.length}</span></div>
           <div class="card">` + xs.map(rowHtml).join('') + '</div>').join('')
      : '<div class="card"><div class="empty">Pantry is empty</div></div>')
      + '<button class="addBtn floatAdd" id="pAdd">＋ add pantry item</button>';
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
      if (!existing){
        const cat = await pickCategory(null);
        await upsertRow('pantry_items', { ingredient_id: ing.id, quantity: 1, category: cat ?? '' });
      }
      renderPantry();
    });
  } else {
    const ingredients = (cached('ingredients') || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    root.innerHTML = '<div class="card">' + ingredients.map(i =>
      `<div class="listRow" data-ing="${i.id}" style="cursor:pointer;">
        <span>${esc(i.name)}</span>
        <span class="qty">${esc(i.unit)} · ${i.nutrition_id ? 'USDA ✓' : 'no USDA'}</span>
      </div>`).join('') + '</div>'
      + '<button class="addBtn floatAdd" id="iAdd">＋ new ingredient</button>';
    root.querySelectorAll('[data-ing]').forEach(r => r.addEventListener('click', () => {
      const ing = ingredientById(+r.getAttribute('data-ing'));
      if (ing) openIngredientEditor(ing);
    }));
    root.querySelector('#iAdd').addEventListener('click', () => openIngredientEditor(null));
  }
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
        const n = await pickNutrition(draft.unit);
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
