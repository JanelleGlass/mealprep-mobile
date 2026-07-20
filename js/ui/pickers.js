/* Overlay pickers: ingredient list picker and live USDA nutrition search.
   Promise-based: resolve with the chosen row, or null on cancel. */
import { cached, searchNutrition } from '../store.js';
import { esc, PANTRY_CATEGORIES } from './common.js';
import { tryConvertToGrams } from '../nutrition.js';

function overlay(html){
  const ov = document.createElement('div');
  ov.className = 'overlay show';
  ov.innerHTML = `<div class="panel">${html}</div>`;
  document.body.appendChild(ov);
  return ov;
}

export function pickIngredient(){
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
      list.innerHTML = items.map(i =>
        `<button class="pickRow" data-id="${i.id}">${esc(i.name)} <span class="qty">${esc(i.unit)}${i.nutrition_id ? '' : ' · no USDA link'}</span></button>`).join('')
        || '<div class="empty">No matches</div>';
      list.querySelectorAll('.pickRow').forEach(b => b.addEventListener('click', () => {
        const row = (cached('ingredients') || []).find(i => i.id === +b.getAttribute('data-id'));
        ov.remove(); resolve(row);
      }));
    };
    render('');
    ov.querySelector('#pkSearch').addEventListener('input', e => render(e.target.value));
    ov.querySelector('#pkCancel').addEventListener('click', () => { ov.remove(); resolve(null); });
  });
}

export function pickNutrition(unitForSanity){
  return new Promise(resolve => {
    const ov = overlay(`
      <h2>USDA nutrition search</h2>
      <p>Search the 8,790-food USDA database. Shorter terms work better ("applesauce", "broccoli frozen").</p>
      <input type="text" id="nuSearch" placeholder="search foods…" autocomplete="off">
      <div class="pickList" id="nuList"></div>
      <div class="btnRow"><button class="cancel" id="nuCancel">cancel</button></div>`);
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
