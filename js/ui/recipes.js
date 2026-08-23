/* Recipes tab: flat list, detail, editor sheet. */
import { cached, upsertRow, deleteRow, replaceChildren, refresh, S, queueFoodEntry, searchNutrition } from '../store.js';
import { computeForRecipe } from '../nutrition.js';
import { parseRecipeJson, resolveIngredients, buildDescription } from '../recipeimport.js';
import { esc, ingredientById, buildRecipeCalc, openSheet, closeSheet, macroLine,
         dateKey, isToday, entryNameWithNote, collapsibleSection, RECIPE_CATEGORIES,
         PANTRY_CATEGORIES, COOKING_UNITS } from './common.js';
import { pickIngredient, pickCategory, confirmDialog } from './pickers.js';
import { openIngredientEditor } from './pantry.js';
import { logState } from './log.js';
import { assignRecipe, assignedSummary, nextCookDate, nextPrepDate, SLOTS } from './cookplan.js';

const view = { mode: 'list', recipeId: null, logFlash: null, planFlash: null, catOpen: {} };
const catIsOpen = cat => view.catOpen[cat] ?? false;

/* ---------- sections ----------
   A variation files under its base's section, so a pair never splits across two
   headings; only the base's category is ever consulted. An unfiled recipe (or
   one carrying a category since removed from the list) lands under 'Other'. */
const categoryOf = r => {
  const c = (r.category || '').trim();
  return RECIPE_CATEGORIES.includes(c) ? c : 'Other';
};
function byCategory(groups){
  const buckets = new Map(RECIPE_CATEGORIES.map(c => [c, []]));
  groups.forEach(g => buckets.get(categoryOf(g.base)).push(g));
  return [...buckets].filter(([, gs]) => gs.length);
}
const groupSize = g => 1 + g.variations.length;

/* ---------- variations ----------
   A variation is a recipe carrying parent_recipe_id, so every consumer — the
   cook plan, meals, the food log — keeps treating it as an ordinary recipe.
   The tree is deliberately one level deep: a variation of a variation is filed
   under the same base, which keeps the list readable and the grouping total. */
const baseIdOf = (r, byId) => {
  let cur = r, guard = 0;
  while (cur.parent_recipe_id && byId.has(cur.parent_recipe_id) && guard++ < 10)
    cur = byId.get(cur.parent_recipe_id);
  return cur.id;
};

function groupRecipes(recipes){
  const byId = new Map(recipes.map(r => [r.id, r]));
  const bases = recipes.filter(r => baseIdOf(r, byId) === r.id);
  return bases.map(b => ({
    base: b,
    /* a variation whose base was deleted has had its parent nulled by the FK,
       so it simply shows up as a base of its own — nothing to clean up */
    variations: recipes.filter(r => r.id !== b.id && baseIdOf(r, byId) === b.id),
  }));
}

const fmtDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const chipLabel = slot =>
  `${fmtDay(slot === 'cook' ? nextCookDate() : nextPrepDate())} · ${SLOTS[slot].label}`;

/* "already on: Fri, Aug 7 (2 batches)" — so a second tap isn't blind */
function assignedLine(recipeId){
  const on = assignedSummary(recipeId);
  if (!on.length) return '';
  const parts = on.map(a => {
    const d = new Date(a.dk + 'T00:00:00');
    return `${fmtDay(d)}${a.m === 1 ? '' : ` (${a.m} batches)`}`;
  });
  return `<div class="cSub" style="margin-top:6px;">already on: ${esc(parts.join(' · '))}</div>`;
}

export function renderRecipes(){
  const root = document.getElementById('recipesRoot');
  const recipes = (cached('recipes') || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  if (view.mode === 'detail'){
    const r = recipes.find(x => x.id === view.recipeId);
    if (!r){ view.mode = 'list'; return renderRecipes(); }
    const group = groupRecipes(recipes).find(g => g.base.id === r.id || g.variations.some(v => v.id === r.id));
    const kin = { base: group && group.base.id !== r.id ? group.base : null,
                  variations: group && group.base.id === r.id ? group.variations : [] };
    const calc = buildRecipeCalc(r);
    const per = computeForRecipe({ ...calc, servings: r.servings }, 1);
    root.innerHTML = `
      <button class="backLink" id="rBack">← recipes</button>
      <div class="card">
        <div class="cName" style="font-size:16px;font-family:'Fraunces',serif;">${esc(r.name)}</div>
        <div class="cSub">${esc(categoryOf(kin.base || r))} · ${r.servings || 1} servings${r.description ? ' · ' + esc(r.description) : ''}</div>
        <div class="cSub" style="margin-top:6px;">per serving: ${macroLine(per)}</div>
        ${per.uncountedNote ? `<div class="cSub" style="color:#7A4A26;">⚠ ${esc(per.uncountedNote)}</div>` : ''}
      </div>
      <div class="card">
        ${(r.ingredients || []).map(ri => {
          const ing = ingredientById(ri.ingredient_id);
          return `<div class="listRow"><span>${esc(ing ? ing.name : '#' + ri.ingredient_id)}</span><span class="qty">${ri.quantity} ${esc(ing ? ing.unit : '')}</span></div>`;
        }).join('') || '<div class="empty">No ingredients</div>'}
      </div>
      <div class="card">
        <div class="cSub">Log this to your day without planning it.</div>
        <div class="row" style="align-items:flex-end;margin-top:8px;">
          <div style="flex:0 0 90px;"><span class="miniLabel">servings</span><input type="number" id="rLogServings" min="0.25" step="0.25" value="1"></div>
          <label class="plantCheck" style="margin:0 0 4px;"><input type="checkbox" id="rLogPlant"> counts as a plant</label>
        </div>
        <div class="macros" id="rLogPreview" style="margin-top:8px;"></div>
        <button class="addBtn" id="rLog" style="margin-top:8px;">+ log to ${isToday(logState.currentDate) ? 'today' : esc(dateKey(logState.currentDate))}</button>
        ${view.logFlash ? `<div class="cSub" style="color:var(--fiber);">${esc(view.logFlash)}</div>` : ''}
      </div>
      <div class="card">
        <div class="cSub">Plan a cooking day. The shopping list and pantry follow from it.</div>
        <div class="row" style="align-items:flex-end;margin-top:8px;">
          <div style="flex:0 0 90px;"><span class="miniLabel">batches</span><input type="number" id="rBatches" min="0.5" step="0.5" value="1"></div>
          <div class="cSub" id="rBatchNote" style="flex:1;margin-bottom:6px;"></div>
        </div>
        <div class="quickRow">
          <button class="quickChip" data-assign="cook">🍳 ${esc(chipLabel('cook'))}</button>
          <button class="quickChip" data-assign="prep">🍱 ${esc(chipLabel('prep'))}</button>
        </div>
        ${assignedLine(r.id)}
        ${view.planFlash ? `<div class="cSub" style="color:var(--fiber);">${esc(view.planFlash)}</div>` : ''}
      </div>
      <div class="card">
        <div class="cSub">${kin.base
          ? `A variation of <button type="button" class="linkChip" data-open="${kin.base.id}">${esc(kin.base.name)}</button>.`
          : kin.variations.length
            ? `Variations: ${kin.variations.map(v => `<button type="button" class="linkChip" data-open="${v.id}">${esc(v.name)}</button>`).join(' ')}`
            : 'Cooking it differently this time? Start a variation — a copy you can change without touching this one.'}</div>
        <button class="addBtn" id="rVary" style="margin-top:8px;">＋ make a variation</button>
      </div>
      <button class="addBtn" id="rEdit">✎ edit recipe</button>`;
    /* come back to a list with this recipe's section open, so you land looking
       at where you just were rather than at a wall of closed headings */
    root.querySelector('#rBack').addEventListener('click', () => {
      view.catOpen[categoryOf(kin.base || r)] = true;
      view.logFlash = view.planFlash = null; view.mode = 'list'; renderRecipes();
    });
    root.querySelector('#rEdit').addEventListener('click', () => openRecipeSheet(r));
    root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
      view.recipeId = +b.getAttribute('data-open'); view.logFlash = view.planFlash = null; renderRecipes();
    }));
    root.querySelector('#rVary').addEventListener('click', () => openRecipeSheet(null, {
      /* nothing is written until save, so backing out leaves no orphan copy */
      parentId: kin.base ? kin.base.id : r.id,
      prefill: {
        name: `${kin.base ? kin.base.name : r.name} — variation`,
        description: r.description || '', servings: r.servings,
        /* filed with its base, which is where the list will show it anyway */
        category: (kin.base || r).category || '',
        rows: (r.ingredients || []).map(ri => ({ ingredient_id: ri.ingredient_id, quantity: +ri.quantity })),
      },
    }));

    const servingsInput = root.querySelector('#rLogServings');
    const plantInput = root.querySelector('#rLogPlant');
    const logComp = () => computeForRecipe(buildRecipeCalc(r), Math.max(0, parseFloat(servingsInput.value) || 0));
    const drawLogPreview = () => {
      const c = logComp();
      root.querySelector('#rLogPreview').innerHTML = 'this logs: ' + macroLine(c) +
        (c.uncountedNote ? `<div class="warn">⚠ ${esc(c.uncountedNote)}</div>` : '');
    };
    drawLogPreview();
    servingsInput.addEventListener('input', drawLogPreview);
    root.querySelector('#rLog').addEventListener('click', () => {
      const servings = Math.max(0, parseFloat(servingsInput.value) || 0);
      if (!(servings > 0)) return;
      const comp = computeForRecipe(buildRecipeCalc(r), servings);
      const label = servings === 1 ? r.name : `${r.name} (${+servings.toFixed(2)} servings)`;
      queueFoodEntry({
        date: dateKey(logState.currentDate),
        name: entryNameWithNote(label, comp),
        calories: comp.calories, protein_g: comp.proteinG,
        fiber_g: comp.fiberG, iron_mg: comp.ironMg,
        is_plant: plantInput.checked,
      });
      view.logFlash = `Logged ${label} to ${isToday(logState.currentDate) ? 'today' : dateKey(logState.currentDate)}.`;
      renderRecipes();
    });

    /* --- cook plan --- */
    const batchesInput = root.querySelector('#rBatches');
    const batches = () => Math.max(0.5, parseFloat(batchesInput.value) || 1);
    const drawBatchNote = () => {
      root.querySelector('#rBatchNote').textContent = `≈ ${Math.round((r.servings || 1) * batches())} servings`;
    };
    drawBatchNote();
    batchesInput.addEventListener('input', drawBatchNote);
    root.querySelectorAll('[data-assign]').forEach(b => b.addEventListener('click', () => {
      const slot = b.getAttribute('data-assign');
      const d = slot === 'cook' ? nextCookDate() : nextPrepDate();
      const total = assignRecipe(dateKey(d), slot, r.id, batches());
      view.planFlash = `Added to ${fmtDay(d)} — ${total === 1 ? '1 batch' : total + ' batches'} total.`;
      renderRecipes();
    }));
    return;
  }

  const card = (r, isVariation) => {
    const per = computeForRecipe(buildRecipeCalc(r), 1);
    return `<div class="card${isVariation ? ' varCard' : ''}" data-r="${r.id}" style="cursor:pointer;">
      <div class="cName">${esc(r.name)}</div>
      <div class="cSub">${r.servings || 1} servings · ${Math.round(per.calories)} cal/serving</div>
    </div>`;
  };
  const sections = byCategory(groupRecipes(recipes));
  root.innerHTML = (sections.length
    ? sections.map(([cat, gs]) => collapsibleSection(`rec|${cat}`, cat, catIsOpen(cat),
        gs.map(g => card(g.base, false) + g.variations.map(v => card(v, true)).join('')).join(''),
        { count: String(gs.reduce((n, g) => n + groupSize(g), 0)) })).join('')
    : '<div class="card"><div class="empty">No recipes yet</div></div>')
    + '<button class="addBtn" id="rNew" style="margin-top:8px;">＋ new recipe</button>'
    + '<div class="quickRow" style="justify-content:center;margin-top:8px;"><button class="quickChip" id="rImportJson">⇪ import from JSON</button></div>';
  root.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY;
    const cat = b.getAttribute('data-sec').slice(4);   // strip the 'rec|' prefix
    view.catOpen[cat] = !catIsOpen(cat);
    renderRecipes();
    window.scrollTo(0, y);
  }));
  root.querySelectorAll('[data-r]').forEach(c => c.addEventListener('click', () => {
    view.recipeId = +c.getAttribute('data-r'); view.mode = 'detail'; view.logFlash = view.planFlash = null; renderRecipes();
  }));
  root.querySelector('#rNew').addEventListener('click', () => openRecipeSheet(null));
  root.querySelector('#rImportJson').addEventListener('click', openImportSheet);
}

/* ---------- JSON import ----------
   Paste a recipe as JSON (format: RECIPE-JSON.md), preview how every ingredient
   resolves against the existing list, then save. Nothing is written until the
   import button on the preview step. */
let importGen = 0;
function openImportSheet(){
  const st = { text: '', prep: null, busy: false };
  const body = openSheet('Import recipe from JSON', '');
  /* #sheetBody is shared by every sheet, so an async step that resumes after
     the ✕ close (or after another sheet took over) must not draw into it */
  const gen = ++importGen;
  const live = () => gen === importGen
    && document.getElementById('sheet').classList.contains('show')
    && document.getElementById('sheetTitle').textContent === 'Import recipe from JSON';

  function drawPaste(msgs = []){
    body.innerHTML = `
      <div class="cSub" style="margin-bottom:8px;">Paste a recipe in the RECIPE-JSON.md format —
        ask Claude for “MealPrep recipe JSON” and paste the result here.</div>
      <textarea id="imText" placeholder='{ "name": "…", "servings": 4, "ingredients": [ … ] }'></textarea>
      ${msgs.map(m => `<div class="warn">✕ ${esc(m)}</div>`).join('')}
      <div class="btnRow">
        <button class="cancel" id="imCancel">cancel</button>
        <button class="save" id="imPreview">preview</button>
      </div>`;
    const ta = body.querySelector('#imText');
    ta.value = st.text;
    ta.addEventListener('input', () => st.text = ta.value);
    body.querySelector('#imCancel').addEventListener('click', closeSheet);
    body.querySelector('#imPreview').addEventListener('click', preview);
  }

  async function preview(){
    const { draft, errors, warnings } = parseRecipeJson(st.text,
      { units: COOKING_UNITS, categories: RECIPE_CATEGORIES, pantryCategories: PANTRY_CATEGORIES });
    if (errors.length) return drawPaste(errors);

    const recipes = cached('recipes') || [];
    const blocking = [];
    if (recipes.some(r => (r.name || '').trim().toLowerCase() === draft.name.toLowerCase()))
      blocking.push(`a recipe named "${draft.name}" already exists — rename one of them`);
    let parent = null;
    if (draft.variationOf){
      parent = recipes.find(r => (r.name || '').trim().toLowerCase() === draft.variationOf.toLowerCase()) || null;
      if (!parent) blocking.push(`no recipe named "${draft.variationOf}" to file this under — check the spelling`);
      /* naming a variation as the parent files under its base instead, the same
         one-level-deep rule the in-app "make a variation" flow keeps */
      for (let hop = 0; parent && parent.parent_recipe_id && hop < 10; hop++){
        const up = recipes.find(r => r.id === parent.parent_recipe_id);
        if (!up) break;
        parent = up;
      }
    }

    const rows = resolveIngredients(draft.ingredients, cached('ingredients') || []);
    rows.filter(r => r.status === 'new-no-unit').forEach(r => blocking.push(r.unit
      ? `new ingredient "${r.name}": "${r.unit}" isn't a unit the app knows (${COOKING_UNITS.join(', ')})`
      : `new ingredient "${r.name}" needs a "unit" (${COOKING_UNITS.join(', ')})`));

    /* exact-description USDA lookups for the ingredients we'd create */
    body.innerHTML = '<div class="empty">checking USDA links…</div>';
    for (const r of rows){
      if (r.status !== 'new' || !r.nutrition) continue;
      try {
        const hits = await searchNutrition(r.nutrition);
        r.nutritionRow = hits.find(n => (n.description || '').toLowerCase() === r.nutrition.toLowerCase()) ?? null;
      } catch { r.nutritionRow = null; r.lookupFailed = true; }
    }
    if (!live()) return;

    st.prep = { draft, rows, parent, blocking, warnings, description: buildDescription(draft) };
    drawPreview();
  }

  function drawPreview(){
    const { draft, rows, parent, blocking, warnings } = st.prep;
    const per = computeForRecipe({
      servings: draft.servings,
      ingredients: rows.map(r => ({
        ingredient: r.match ?? { id: 0, name: r.name, unit: r.unitCanonical ?? '', nutrition: r.nutritionRow ?? null },
        quantity: r.quantity,
      })),
    }, 1);
    const rowHtml = r => {
      if (r.match) return `<div class="listRow"><span>${esc(r.name)}</span>
          <span class="qty">${r.quantity} ${esc(r.match.unit)} · existing</span></div>`
        + (r.status === 'unit-mismatch'
          ? `<div class="warn">⚠ "${esc(r.match.name)}" is stored in ${esc(r.match.unit)}, not ${esc(r.unit)} —
             so ${r.quantity} here means ${r.quantity} ${esc(r.match.unit)}. If that's wrong, convert the quantity in the JSON.</div>` : '');
      return `<div class="listRow"><span>${esc(r.name)}</span>
          <span class="qty">${r.quantity} ${esc(r.unitCanonical ?? r.unit ?? '')} · new${r.nutritionRow ? ' · USDA linked' : ''}</span></div>`
        + (r.nutritionRow ? '' : r.lookupFailed
          ? `<div class="warn">⚠ couldn't reach the USDA table to check “${esc(r.nutrition)}” — created unlinked; link it later under Pantry → Ingredients</div>`
          : r.nutrition
          ? `<div class="warn">⚠ no USDA food called “${esc(r.nutrition)}” — created unlinked, not counted until you link it under Pantry → Ingredients</div>`
          : '<div class="warn">⚠ no "nutrition" description given — created unlinked, not counted until you link it</div>');
    };
    body.innerHTML = `
      <div class="card">
        <div class="cName">${esc(draft.name)}</div>
        <div class="cSub">${esc(draft.category || 'Other')} · ${draft.servings} servings${parent ? ` · variation of ${esc(parent.name)}` : ''}</div>
        <div class="cSub" style="margin-top:6px;">per serving: ${macroLine(per)}</div>
        ${per.uncountedNote ? `<div class="warn">⚠ ${esc(per.uncountedNote)}</div>` : ''}
      </div>
      <div class="card">${rows.map(rowHtml).join('')}</div>
      ${warnings.length ? `<div class="card">${warnings.map(w => `<div class="warn">⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
      ${blocking.length ? `<div class="card">${blocking.map(b => `<div class="warn" style="color:var(--iron);">✕ ${esc(b)}</div>`).join('')}</div>` : ''}
      <div class="macros" id="imMsg"></div>
      <div class="btnRow">
        <button class="cancel" id="imBack">back</button>
        <button class="save" id="imGo" ${blocking.length ? 'disabled' : ''}>import recipe</button>
      </div>`;
    /* back stays dead while a save is in flight — a second import racing the
       first would double-write; a failed save re-enables it via the catch */
    body.querySelector('#imBack').addEventListener('click', () => { if (!st.busy) drawPaste(); });
    body.querySelector('#imGo').addEventListener('click', doImport);
  }

  async function doImport(){
    if (st.busy) return;
    st.busy = true;
    const btn = body.querySelector('#imGo');
    const back = body.querySelector('#imBack');
    btn.disabled = back.disabled = true;
    const msg = t => { const el = body.querySelector('#imMsg'); if (el) el.textContent = t; };
    const { draft, rows, parent, description } = st.prep;
    try {
      for (const r of rows){
        if (r.match) continue;
        msg(`creating ${r.name}…`);
        r.match = await upsertRow('ingredients', {
          name: r.name, unit: r.unitCanonical, category: r.section || '',
          price_per_unit: null, nutrition_id: r.nutritionRow ? r.nutritionRow.id : null,
        });
      }
      /* recipe row is kept on st.prep so a retry after a mid-save failure
         (e.g. the ingredient rows below) doesn't create it twice */
      if (!st.prep.savedRecipe){
        msg('saving recipe…');
        st.prep.savedRecipe = await upsertRow('recipes', {
          name: draft.name, description, servings: draft.servings,
          ...(draft.category ? { category: draft.category } : {}),
          ...(parent ? { parent_recipe_id: parent.id } : {}),
        });
      }
      msg('adding ingredients…');
      await replaceChildren('recipe_ingredients', 'recipe_id', st.prep.savedRecipe.id,
        rows.map(r => ({ ingredient_id: r.match.id, quantity: r.quantity })));
      await refresh('recipes');
      S.onChange();
      /* if the sheet was closed (or replaced) mid-save, the recipe is in the
         list via onChange — just don't yank whatever the user is doing now */
      if (live()){
        view.catOpen[categoryOf(parent ?? draft)] = true;
        closeSheet();
        view.recipeId = st.prep.savedRecipe.id; view.mode = 'detail'; renderRecipes();
      }
    } catch (err) {
      st.busy = false;
      btn.disabled = back.disabled = false;
      msg('import failed: ' + err.message + ' — fix and tap import again');
    }
  }

  drawPaste();
}

/* opts.parentId + opts.prefill: start a new recipe seeded from another one and
   filed under it as a variation */
function openRecipeSheet(recipe, opts = {}){
  const draft = recipe ? {
    id: recipe.id, name: recipe.name, description: recipe.description || '', servings: recipe.servings,
    category: recipe.category || '',
    rows: (recipe.ingredients || []).map(ri => ({ ingredient_id: ri.ingredient_id, quantity: +ri.quantity })),
  } : { name: '', description: '', servings: 4, category: '', rows: [], ...(opts.prefill || {}) };

  const title = recipe ? 'Edit recipe' : opts.parentId ? 'New variation' : 'New recipe';
  const body = openSheet(title, '');

  function draw(){
    body.innerHTML = `
      <span class="miniLabel">name</span>
      <input type="text" id="rcName" value="${esc(draft.name)}">
      <span class="miniLabel">description (optional)</span>
      <input type="text" id="rcDesc" value="${esc(draft.description)}">
      <span class="miniLabel">servings the recipe makes</span>
      <input type="number" id="rcServings" min="1" step="1" value="${draft.servings}">
      <span class="miniLabel">section</span>
      <div class="quickRow" style="margin-bottom:8px;">
        <button class="quickChip" id="rcCat">${draft.category ? esc(draft.category) : 'Other — tap to file'}</button>
      </div>
      <span class="miniLabel">ingredients</span>
      <div id="rcRows">${draft.rows.map((r, i) => {
        const ing = ingredientById(r.ingredient_id);
        return `<div class="listRow"><span>${esc(ing ? ing.name : '#' + r.ingredient_id)}</span>
          <span class="qty"><input type="number" class="qtyIn" data-i="${i}" step="0.25" value="${r.quantity}"> ${esc(ing ? ing.unit : '')}
          <button class="del" data-rm="${i}">✕</button></span></div>`;
      }).join('')}</div>
      <div class="quickRow">
        <button class="quickChip" id="rcAddIng">+ add ingredient</button>
        <button class="quickChip" id="rcNewIng">+ new ingredient</button>
      </div>
      <div class="macros" id="rcPreview" style="margin-top:10px;"></div>
      <div class="btnRow">
        ${recipe ? '<button class="cancel" id="rcDelete" style="color:var(--iron);">delete</button>' : '<button class="cancel" id="rcCancel">cancel</button>'}
        <button class="save" id="rcSave">save</button>
      </div>`;

    const preview = () => {
      const per = computeForRecipe({
        servings: Math.max(1, Math.round(draft.servings)),
        ingredients: draft.rows.map(r => ({ ingredient: ingredientById(r.ingredient_id), quantity: r.quantity })).filter(x => x.ingredient),
      }, 1);
      document.getElementById('rcPreview').innerHTML = 'per serving: ' + macroLine(per) +
        (per.uncountedNote ? `<div class="warn">⚠ ${esc(per.uncountedNote)}</div>` : '');
    };
    preview();

    body.querySelector('#rcName').addEventListener('input', e => draft.name = e.target.value);
    body.querySelector('#rcDesc').addEventListener('input', e => draft.description = e.target.value);
    body.querySelector('#rcServings').addEventListener('change', e => { draft.servings = parseInt(e.target.value) || 1; preview(); });
    body.querySelector('#rcCat').addEventListener('click', async () => {
      const cat = await pickCategory(draft.category || null,
        { title: 'Recipe section', options: RECIPE_CATEGORIES });
      if (cat !== null) draft.category = cat;
      draw();
    });
    body.querySelectorAll('.qtyIn').forEach(inp => inp.addEventListener('change', () => {
      draft.rows[+inp.getAttribute('data-i')].quantity = parseFloat(inp.value) || 0; preview();
    }));
    body.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      draft.rows.splice(+b.getAttribute('data-rm'), 1); draw();
    }));
    /* the ingredient editor takes over the sheet, so re-open ours after */
    const reopen = () => { openSheet(title, ''); draw(); };
    body.querySelector('#rcAddIng').addEventListener('click', async () => {
      const ing = await pickIngredient({ allowCreate: true });
      if (ing) draft.rows.push({ ingredient_id: ing.id, quantity: 1 });
      reopen();
    });
    body.querySelector('#rcNewIng').addEventListener('click', async () => {
      const created = await openIngredientEditor(null, { nested: true });
      if (created) draft.rows.push({ ingredient_id: created.id, quantity: 1 });
      reopen();
    });
    body.querySelector('#rcCancel')?.addEventListener('click', closeSheet);
    body.querySelector('#rcDelete')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete recipe "${draft.name}"? Planned meals using it lose their recipe link.`))) return;
      await deleteRow('recipes', draft.id);
      closeSheet(); view.mode = 'list'; renderRecipes();
    });
    body.querySelector('#rcSave').addEventListener('click', async () => {
      try {
        if (!draft.name.trim()){ document.getElementById('rcPreview').textContent = 'name required'; return; }
        const saved = await upsertRow('recipes', {
          ...(draft.id ? { id: draft.id } : {}),
          name: draft.name.trim(), description: draft.description.trim() || null,
          servings: Math.max(1, Math.round(draft.servings)),
          /* left out entirely while both the draft and the saved row are unfiled,
             so the app still saves against a database where 011 hasn't been run */
          ...(draft.category || recipe?.category ? { category: draft.category } : {}),
          /* only sent when creating a variation — an edit leaves the column
             alone, so an existing recipe keeps whatever it was filed under */
          ...(opts.parentId && !draft.id ? { parent_recipe_id: opts.parentId } : {}),
        });
        const recipeId = draft.id ?? saved.id;
        await replaceChildren('recipe_ingredients', 'recipe_id', recipeId,
          draft.rows.filter(r => r.quantity > 0).map(r => ({ ingredient_id: r.ingredient_id, quantity: r.quantity })));
        await refresh('recipes');
        S.onChange();
        view.catOpen[categoryOf(draft)] = true;      // so backing out shows it
        closeSheet(); view.recipeId = recipeId; view.mode = 'detail'; renderRecipes();
      } catch (err) {
        document.getElementById('rcPreview').textContent = 'save failed: ' + err.message;
      }
    });
  }
  draw();
}
