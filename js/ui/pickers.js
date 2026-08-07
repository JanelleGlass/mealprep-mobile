/* Overlay pickers: ingredient list picker and live USDA nutrition search.
   Promise-based: resolve with the chosen row, or null on cancel. */
import { cached, searchNutrition, saveNutrition } from '../store.js';
import { esc, PANTRY_CATEGORIES } from './common.js';
import { tryConvertToGrams, labelToNutritionRow } from '../nutrition.js';
import { openIngredientEditor } from './pantry.js';

function overlay(html){
  const ov = document.createElement('div');
  ov.className = 'overlay show';
  ov.innerHTML = `<div class="panel">${html}</div>`;
  document.body.appendChild(ov);
  return ov;
}

/* opts.allowCreate: show a "new ingredient" row that opens the ingredient
   editor (name prefilled from the search term) and resolves with the created
   row. The editor takes over the bottom sheet, so callers with their own
   sheet open must re-open and redraw it after this resolves. */
export function pickIngredient(opts = {}){
  return new Promise(resolve => {
    const ov = overlay(`
      <h2>Choose ingredient</h2>
      <input type="text" id="pkSearch" placeholder="search…" autocomplete="off">
      <div class="pickList" id="pkList"></div>
      <div class="btnRow"><button class="cancel" id="pkCancel">cancel</button></div>`);
    const list = ov.querySelector('#pkList');
    const render = term => {
      const items = (cached('ingredients') || [])
        .filter(i => !term || i.name.toLowerCase().includes(term.toLowerCase()))
        .slice(0, 40);
      list.innerHTML = (items.map(i =>
        `<button class="pickRow" data-id="${i.id}">${esc(i.name)} <span class="qty">${esc(i.unit)}${i.nutrition_id ? '' : ' · no USDA link'}</span></button>`).join('')
        || '<div class="empty">No matches</div>')
        + (opts.allowCreate ? `<button class="pickRow" id="pkNew">＋ new ingredient${term.trim() ? `: “${esc(term.trim())}”` : ''}</button>` : '');
      list.querySelectorAll('.pickRow[data-id]').forEach(b => b.addEventListener('click', () => {
        const row = (cached('ingredients') || []).find(i => i.id === +b.getAttribute('data-id'));
        ov.remove(); resolve(row);
      }));
      list.querySelector('#pkNew')?.addEventListener('click', async () => {
        ov.remove();
        resolve(await openIngredientEditor(null, { nested: true, name: term.trim() }));
      });
    };
    render('');
    ov.querySelector('#pkSearch').addEventListener('input', e => render(e.target.value));
    ov.querySelector('#pkCancel').addEventListener('click', () => { ov.remove(); resolve(null); });
  });
}

export function pickNutrition(unitForSanity, presetName){
  return new Promise(resolve => {
    const ov = overlay(`
      <h2>USDA nutrition search</h2>
      <p>Search the 8,790-food USDA database. Shorter terms work better ("applesauce", "broccoli frozen").</p>
      <input type="text" id="nuSearch" placeholder="search foods…" autocomplete="off">
      <div class="pickList" id="nuList"></div>
      <div class="quickRow"><button class="quickChip" id="nuCustom">＋ not in the list — enter a label</button></div>
      <div class="btnRow"><button class="cancel" id="nuCancel">cancel</button></div>`);
    ov.querySelector('#nuCustom').addEventListener('click', async () => {
      const typed = ov.querySelector('#nuSearch').value.trim();
      ov.remove();
      resolve(await customFoodEditor(unitForSanity, typed || presetName));
    });
    const list = ov.querySelector('#nuList');
    let timer = null;
    ov.querySelector('#nuSearch').addEventListener('input', e => {
      clearTimeout(timer);
      const term = e.target.value.trim();
      if (term.length < 2){ list.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        list.innerHTML = '<div class="empty">searching…</div>';
        try {
          const rows = await searchNutrition(term);
          list.innerHTML = rows.map(n => {
            const grams = unitForSanity ? tryConvertToGrams(1, unitForSanity, n) : null;
            const sanity = unitForSanity
              ? (grams !== null && grams > 0
                  ? `1 ${esc(unitForSanity)} ≈ ${Math.round(grams)} g`
                  : (grams === 0 ? 'negligible unit' : `⚠ can't convert "${esc(unitForSanity)}"`))
              : '';
            return `<button class="pickRow" data-id="${n.id}">
              <span class="pkMain">${esc(n.description)}</span>
              <span class="qty">${Math.round(n.energy_kcal ?? 0)} cal · ${(n.protein_g ?? 0).toFixed?.(1) ?? n.protein_g}g P /100g${sanity ? ' · ' + sanity : ''}</span>
            </button>`;
          }).join('') || '<div class="empty">No matches</div>';
          list.querySelectorAll('.pickRow').forEach(b => b.addEventListener('click', () => {
            const row = rows.find(n => n.id === +b.getAttribute('data-id'));
            ov.remove(); resolve(row);
          }));
        } catch (err) {
          list.innerHTML = `<div class="empty">search failed: ${esc(err.message)}</div>`;
        }
      }, 350);
    });
    ov.querySelector('#nuCancel').addEventListener('click', () => { ov.remove(); resolve(null); });
  });
}

/* Hand-enter a food from its package label, for anything USDA doesn't carry
   (a seasoning blend, a canned specialty, something you make yourself). Saves a
   nutritions row with is_usda=false and resolves with it, so the caller links it
   exactly as it would a USDA hit. */
export function customFoodEditor(unitForSanity, presetName){
  return new Promise(resolve => {
    const draft = { description: presetName ?? '', servingDesc: '', servingGrams: '',
                    calories: '', protein: '', fiber: '', iron: '' };
    const ov = overlay('');

    /* the same reassurance pickNutrition gives: does this convert to your unit? */
    function sanity(){
      if (!unitForSanity) return '';
      let row;
      try { row = labelToNutritionRow(draft); } catch { return 'enter the serving weight in grams'; }
      const g = tryConvertToGrams(1, unitForSanity, row);
      if (g === 0) return `negligible unit — 1 ${unitForSanity} counts as 0`;
      if (g === null) return `⚠ can't convert "${unitForSanity}" yet — name the household measure below (e.g. "1 patty")`;
      return `1 ${unitForSanity} ≈ ${Math.round(g)} g · ${Math.round(row.energy_kcal * g / 100)} cal`;
    }

    function draw(msg){
      ov.querySelector('.panel').innerHTML = `
        <h2>Enter a food from its label</h2>
        <p>Type what the package says for <em>one serving</em>. The rest is worked out from there.</p>
        <span class="miniLabel">name</span>
        <input type="text" id="cfName" value="${esc(draft.description)}" placeholder="e.g. Moroccan Seasoning">
        <div class="row">
          <div style="flex:1;"><span class="miniLabel">serving size</span>
            <input type="text" id="cfDesc" value="${esc(draft.servingDesc)}" placeholder="e.g. 1 patty, 2 tbsp"></div>
          <div style="flex:0 0 96px;"><span class="miniLabel">weighs (g)</span>
            <input type="number" id="cfGrams" min="0" step="0.1" value="${esc(draft.servingGrams)}"></div>
        </div>
        <div class="row">
          <div style="flex:1;"><span class="miniLabel">calories</span>
            <input type="number" id="cfCal" min="0" step="1" value="${esc(draft.calories)}"></div>
          <div style="flex:1;"><span class="miniLabel">protein g</span>
            <input type="number" id="cfPro" min="0" step="0.1" value="${esc(draft.protein)}"></div>
        </div>
        <div class="row">
          <div style="flex:1;"><span class="miniLabel">fiber g</span>
            <input type="number" id="cfFib" min="0" step="0.1" value="${esc(draft.fiber)}"></div>
          <div style="flex:1;"><span class="miniLabel">iron mg</span>
            <input type="number" id="cfIron" min="0" step="0.1" value="${esc(draft.iron)}"></div>
        </div>
        <div class="macros" id="cfMsg">${esc(msg || sanity())}</div>
        <div class="btnRow">
          <button class="cancel" id="cfCancel">cancel</button>
          <button class="save" id="cfSave">save food</button>
        </div>`;

      const bind = (id, key, redraw) => ov.querySelector(id).addEventListener(redraw ? 'change' : 'input', e => {
        draft[key] = e.target.value;
        if (redraw) draw();
      });
      bind('#cfName', 'description');
      bind('#cfDesc', 'servingDesc', true);
      bind('#cfGrams', 'servingGrams', true);
      bind('#cfCal', 'calories', true);
      bind('#cfPro', 'protein');
      bind('#cfFib', 'fiber');
      bind('#cfIron', 'iron');

      ov.querySelector('#cfCancel').addEventListener('click', () => { ov.remove(); resolve(null); });
      ov.querySelector('#cfSave').addEventListener('click', async () => {
        if (!draft.description.trim()) return draw('give the food a name');
        if (!(Number(draft.servingGrams) > 0)) return draw('the serving weight in grams is required');
        const btn = ov.querySelector('#cfSave');
        btn.disabled = true;
        try {
          const saved = await saveNutrition(labelToNutritionRow(draft));
          ov.remove();
          resolve(saved ?? null);
        } catch (err) {
          btn.disabled = false;
          draw('save failed: ' + err.message);
        }
      });
    }
    draw();
  });
}

export function pickCategory(current){
  return new Promise(resolve => {
    const ov = overlay(`
      <h2>Pantry section</h2>
      <div class="pickList">${PANTRY_CATEGORIES.map(c =>
        `<button class="pickRow" data-cat="${esc(c)}">${esc(c)}${c === current ? ' <span class="qty">✓</span>' : ''}</button>`).join('')}</div>
      <div class="btnRow"><button class="cancel" id="pcCancel">cancel</button></div>`);
    ov.querySelectorAll('.pickRow').forEach(b => b.addEventListener('click', () => {
      ov.remove(); resolve(b.getAttribute('data-cat'));
    }));
    ov.querySelector('#pcCancel').addEventListener('click', () => { ov.remove(); resolve(null); });
  });
}

export function confirmDialog(text){
  return new Promise(resolve => {
    const ov = overlay(`
      <h2>Are you sure?</h2><p>${esc(text)}</p>
      <div class="btnRow"><button class="cancel" id="cfNo">cancel</button><button class="save" id="cfYes">yes, delete</button></div>`);
    ov.querySelector('#cfNo').addEventListener('click', () => { ov.remove(); resolve(false); });
    ov.querySelector('#cfYes').addEventListener('click', () => { ov.remove(); resolve(true); });
  });
}
