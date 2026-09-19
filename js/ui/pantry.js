/* Pantry tab (editable quantities + add) and the ingredient editor
   (name/unit/price + USDA nutrition linking with live conversion check). */
import { cached, upsertRow, deleteRow } from '../store.js';
import { esc, COOKING_UNITS, PANTRY_CATEGORIES, ingredientById, openSheet, closeSheet,
         collapsibleSection } from './common.js';
import { pickIngredient, pickNutrition, pickCategory, confirmDialog,
         customFoodEditor } from './pickers.js';
import { tryConvertToGrams } from '../nutrition.js';

const seg = { mode: 'pantry' };
/* Ingredients list: show only the ones with no nutrition link */
const ingView = { unlinkedOnly: false };
/* which category sections the user has opened — absent means closed. Keys carry
   the segment, so opening Produce here doesn't open it on the other list. */
const catOpen = {};
const isOpen = key => catOpen[key] ?? false;

/* Both lists file into the same sections, in PANTRY_CATEGORIES order. The
   section lives on the ingredient, so it holds whether or not any is in stock,
   and either list can change it. A blank one lands under 'Other'. */
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

/* Clipboard with a visible confirmation, falling back to a sheet holding the
   text when the clipboard is unreachable — navigator.clipboard is undefined
   outside a secure context, so the call throws rather than rejecting, and iOS
   can refuse it outright. Either way the text is never silently lost. */
async function copyOut(btn, restoreLabel, text, okLabel, sheetTitle){
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = okLabel;
    setTimeout(() => { btn.textContent = restoreLabel; }, 2000);
  } catch {
    btn.textContent = restoreLabel;
    /* The sheet overlay covers the page, so no sheet can have been open when
       the chip was tapped — one showing now belongs to somebody else, opened
       while writeText was settling. #sheetBody is shared, so drawing into it
       would destroy that sheet and strand the promise its caller is waiting
       on. Leave it alone; the tap is cheap to repeat. */
    if (document.getElementById('sheet').classList.contains('show')){
      btn.textContent = '⚠ tap again to copy';
      setTimeout(() => { btn.textContent = restoreLabel; }, 2500);
      return;
    }
    const body = openSheet(sheetTitle, '');
    body.innerHTML = `<div class="cSub">Couldn't reach the clipboard — select all and copy.</div>
      <textarea id="icText" readonly>${esc(text)}</textarea>
      <div class="btnRow"><button class="cancel" id="icClose">close</button></div>`;
    const ta = body.querySelector('#icText');
    ta.focus();
    ta.select();
    body.querySelector('#icClose').addEventListener('click', closeSheet);
  }
}

/* Served at the app's own origin by GitHub Pages as text/markdown, so the app
   can read it back; this link is only the standby for a failed fetch. */
const SPEC_URL = 'https://janelleglass.github.io/mealprep-mobile/RECIPE-JSON.md';

/* The spec is loaded ahead of the tap, never during it. A clipboard write has
   to happen inside the gesture that asked for it — WebKit drops user
   activation across a network round trip, so awaiting a fetch first would make
   the copy fail on the iPhone every time, which is the one place this is used.
   Prefetching also keeps the handler synchronous, so nothing can open a sheet
   between the tap and the fallback. An empty body counts as no spec, so the
   link standby and its label agree. */
let spec = null;
let specLoading = false;
function primeSpec(){
  if (spec !== null || specLoading) return;
  specLoading = true;
  fetch('RECIPE-JSON.md')
    .then(res => res.ok ? res.text() : null)
    .then(text => { spec = (text || '').trim() || null; })
    .catch(() => { /* offline and not cached yet — the link standby covers it */ })
    .finally(() => { specLoading = false; });
}

function buildPrompt(list, spec){
  return `Convert the recipe at the end of this message into MealPrep import JSON.

My existing ingredients, with the unit each one is stored in. Reuse these exact
names wherever they fit, and convert every quantity into the unit shown. Read
the LAST parenthetical as the unit — the names contain their own parentheses.

${list}

=== FORMAT AND RULES ===

${spec ?? 'Read ' + SPEC_URL + ' and follow it exactly.'}

=== RECIPE ===

(paste the recipe here)
`;
}

export function renderPantry(){
  const root = document.getElementById('pantryRoot');
  document.querySelectorAll('#tab-pantry .segBtn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-seg') === seg.mode));

  if (seg.mode === 'pantry'){
    const items = (cached('pantry_items') || []).map(p => ({ p, ing: ingredientById(p.ingredient_id) }))
      .filter(x => x.ing).sort((a, b) => a.ing.name.localeCompare(b.ing.name));
    const rowHtml = ({ p, ing }) =>
      `<div class="listRow"><span data-cat="${ing.id}" style="cursor:pointer;">${esc(ing.name)}</span>
        <span class="qty"><input type="number" class="qtyIn" data-p="${p.id}" step="0.5" value="${p.quantity}"> ${esc(ing.unit)}
        <button class="del" data-rmp="${p.id}">✕</button></span></div>`;
    root.innerHTML = (items.length
      ? byCategory(items, x => x.ing.category).map(([cat, xs]) =>
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
      const ing = ingredientById(+el.getAttribute('data-cat'));
      if (!ing) return;
      const cat = await pickCategory(PANTRY_CATEGORIES.includes(ing.category) ? ing.category : 'Other');
      if (cat === null || cat === ing.category) return;
      await upsertRow('ingredients', { id: ing.id, category: cat });
      renderPantry();
    }));
    root.querySelector('#pAdd').addEventListener('click', async () => {
      const ing = await pickIngredient({ allowCreate: true });
      if (!ing) return;
      const existing = (cached('pantry_items') || []).find(p => p.ingredient_id === ing.id);
      if (existing) await addToPantry(ing.id, 1);         // already stocked: one more
      else {
        /* only ask where it goes if the ingredient isn't filed yet */
        if (!ing.category){
          const cat = await pickCategory(null);
          if (cat) await upsertRow('ingredients', { id: ing.id, category: cat });
        }
        await upsertRow('pantry_items', { ingredient_id: ing.id, quantity: 1 });
      }
      renderPantry();
    });
  } else {
    const ingredients = (cached('ingredients') || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const rowHtml = i =>
      `<div class="listRow" data-ing="${i.id}" style="cursor:pointer;">
        <span>${esc(i.name)}</span>
        <span class="qty">${esc(i.unit)} · ${!i.nutrition_id ? 'not linked'
          : i.nutrition && i.nutrition.is_usda === false ? 'label ✓' : 'USDA ✓'}</span>
      </div>`;
    /* An ingredient with no nutrition link silently drops out of every
       calculation — a recipe just quietly reads low. The count is the standing
       answer to "how much of this is unaccounted for"; tapping it drops the
       sections and lists the offenders flat, which is the shape you want when
       working through them. */
    primeSpec();   // so the prompt chip has the rules ready before it is tapped
    const unlinked = ingredients.filter(i => !i.nutrition_id);
    if (!unlinked.length) ingView.unlinkedOnly = false;
    const filterRow = ingredients.length ? `<div class="quickRow" style="margin-bottom:10px;">
      <button class="quickChip${ingView.unlinkedOnly ? ' on' : ''}" id="iFilter"${unlinked.length ? '' : ' disabled'}>${
        unlinked.length ? `⚠ ${unlinked.length} not linked` : '✓ all linked'}</button>
      <button class="quickChip" id="iCopy">⧉ copy list</button>
      <button class="quickChip" id="iPrompt">⧉ copy prompt</button>
    </div>` : '';

    root.innerHTML = filterRow + (!ingredients.length
      ? '<div class="card"><div class="empty">No ingredients yet</div></div>'
      : ingView.unlinkedOnly
        ? '<div class="card">' + unlinked.map(rowHtml).join('') + '</div>'
        : byCategory(ingredients, i => i.category).map(([cat, xs]) =>
            collapsibleSection(`ing|${cat}`, cat, isOpen(`ing|${cat}`),
              '<div class="card">' + xs.map(rowHtml).join('') + '</div>',
              { count: String(xs.length) })).join(''))
      + '<button class="addBtn floatAdd" id="iAdd">＋ new ingredient</button>';
    wireSections(root);
    root.querySelector('#iFilter')?.addEventListener('click', () => {
      ingView.unlinkedOnly = !ingView.unlinkedOnly;
      renderPantry();
      window.scrollTo(0, 0);
    });
    const listText = rows => rows.map(i => `${i.name} (${i.unit})`).join(', ');

    /* "Name (unit)" for the whole list, to paste into a chat alongside
       RECIPE-JSON.md — a recipe written against real names and stored units
       imports without a pile of unit-mismatch warnings. Copies what's on
       screen, so the not-linked filter narrows this too. */
    root.querySelector('#iCopy')?.addEventListener('click', () => {
      const rows = ingView.unlinkedOnly ? unlinked : ingredients;
      copyOut(root.querySelector('#iCopy'), '⧉ copy list', listText(rows),
        `✓ copied ${rows.length}${ingView.unlinkedOnly ? ' not linked' : ''}`, 'Ingredient list');
    });

    /* The whole prompt in one tap: the rules, the list, and where the recipe
       goes. The spec is fetched rather than kept as a second copy in here, so
       it cannot drift from RECIPE-JSON.md the way duplicated vocabularies have
       — but it is read from the prefetch above, never fetched here, so the
       clipboard write stays inside the tap that asked for it.
       Deliberately always the FULL list, filter or no filter — a subset would
       have the model inventing ingredients that already exist. */
    root.querySelector('#iPrompt')?.addEventListener('click', () => {
      const btn = root.querySelector('#iPrompt');
      const text = buildPrompt(listText(ingredients), spec);
      copyOut(btn, '⧉ copy prompt', text,
        spec ? '✓ copied prompt' : '✓ copied (spec linked)', 'Prompt for Claude');
      primeSpec();   // a retap gets the full text once it lands
    });
    root.querySelectorAll('[data-ing]').forEach(r => r.addEventListener('click', () => {
      const ing = ingredientById(+r.getAttribute('data-ing'));
      if (ing) openIngredientEditor(ing);
    }));
    root.querySelector('#iAdd').addEventListener('click', () => openIngredientEditor(null));
  }
}

/* Add to what's on hand: bump an existing row, or create one. Online-only
   (upsertRow throws when offline) — callers own the retry. The section comes
   from the ingredient, so a row created here is already filed. */
export async function addToPantry(ingredientId, qty){
  if (!(qty > 0)) return;
  const existing = (cached('pantry_items') || []).find(p => p.ingredient_id === ingredientId);
  if (existing) await upsertRow('pantry_items', { id: existing.id, quantity: (+existing.quantity || 0) + qty });
  else await upsertRow('pantry_items', { ingredient_id: ingredientId, quantity: qty });
}

/* Returns the saved ingredient row (or null). opts.nested: caller re-opens and
   redraws its own sheet after. opts.name: prefill for a new ingredient. */
export function openIngredientEditor(ingredient, opts = {}){
  return new Promise(resolve => {
    const draft = ingredient ? {
      id: ingredient.id, name: ingredient.name, unit: ingredient.unit,
      price: ingredient.price_per_unit, nutrition_id: ingredient.nutrition_id,
      nutrition: ingredient.nutrition ?? null, category: ingredient.category || '',
    } : { name: opts.name ?? '', unit: 'whole', price: null, nutrition_id: null,
          nutrition: null, category: '' };

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
        <span class="miniLabel">pantry section</span>
        <div class="quickRow" style="margin-bottom:8px;">
          <button class="quickChip" id="igCat">${draft.category ? esc(draft.category) : 'Other — tap to file'}</button>
        </div>
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
      body.querySelector('#igCat').addEventListener('click', async () => {
        const cat = await pickCategory(draft.category || null);
        if (cat !== null) draft.category = cat;
        draw();
      });
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
            name: draft.name.trim(), unit: draft.unit, category: draft.category,
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
