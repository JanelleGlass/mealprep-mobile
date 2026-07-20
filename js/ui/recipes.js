/* Recipes tab: flat list, detail, editor sheet. */
import { cached, upsertRow, deleteRow, replaceChildren, refresh, S } from '../store.js';
import { computeForRecipe } from '../nutrition.js';
import { esc, ingredientById, buildRecipeCalc, openSheet, closeSheet, macroLine } from './common.js';
import { pickIngredient, confirmDialog } from './pickers.js';
import { openIngredientEditor } from './pantry.js';

const view = { mode: 'list', recipeId: null };

export function renderRecipes(){
  const root = document.getElementById('recipesRoot');
  const recipes = (cached('recipes') || []).slice().sort((a, b) => a.name.localeCompare(b.name));

  if (view.mode === 'detail'){
    const r = recipes.find(x => x.id === view.recipeId);
    if (!r){ view.mode = 'list'; return renderRecipes(); }
    const calc = buildRecipeCalc(r);
    const per = computeForRecipe({ ...calc, servings: r.servings }, 1);
    root.innerHTML = `
      <button class="backLink" id="rBack">← recipes</button>
      <div class="card">
        <div class="cName" style="font-size:16px;font-family:'Fraunces',serif;">${esc(r.name)}</div>
        <div class="cSub">${r.servings || 1} servings${r.description ? ' · ' + esc(r.description) : ''}</div>
        <div class="cSub" style="margin-top:6px;">per serving: ${macroLine(per)}</div>
        ${per.uncountedNote ? `<div class="cSub" style="color:#7A4A26;">⚠ ${esc(per.uncountedNote)}</div>` : ''}
      </div>
      <div class="card">
        ${(r.ingredients || []).map(ri => {
          const ing = ingredientById(ri.ingredient_id);
          return `<div class="listRow"><span>${esc(ing ? ing.name : '#' + ri.ingredient_id)}</span><span class="qty">${ri.quantity} ${esc(ing ? ing.unit : '')}</span></div>`;
        }).join('') || '<div class="empty">No ingredients</div>'}
      </div>
      <button class="addBtn" id="rEdit">✎ edit recipe</button>`;
    root.querySelector('#rBack').addEventListener('click', () => { view.mode = 'list'; renderRecipes(); });
    root.querySelector('#rEdit').addEventListener('click', () => openRecipeSheet(r));
    return;
  }

  root.innerHTML = '<div class="sectionTitle">Recipes</div>'
    + recipes.map(r => {
        const per = computeForRecipe(buildRecipeCalc(r), 1);
        return `<div class="card" data-r="${r.id}" style="cursor:pointer;">
          <div class="cName">${esc(r.name)}</div>
          <div class="cSub">${r.servings || 1} servings · ${Math.round(per.calories)} cal/serving</div>
        </div>`;
      }).join('')
    + '<button class="addBtn" id="rNew" style="margin-top:8px;">＋ new recipe</button>';
  root.querySelectorAll('[data-r]').forEach(c => c.addEventListener('click', () => {
    view.recipeId = +c.getAttribute('data-r'); view.mode = 'detail'; renderRecipes();
  }));
  root.querySelector('#rNew').addEventListener('click', () => openRecipeSheet(null));
}

function openRecipeSheet(recipe){
  const draft = recipe ? {
    id: recipe.id, name: recipe.name, description: recipe.description || '', servings: recipe.servings,
    rows: (recipe.ingredients || []).map(ri => ({ ingredient_id: ri.ingredient_id, quantity: +ri.quantity })),
  } : { name: '', description: '', servings: 4, rows: [] };

  const body = openSheet(recipe ? 'Edit recipe' : 'New recipe', '');

  function draw(){
    body.innerHTML = `
      <span class="miniLabel">name</span>
      <input type="text" id="rcName" value="${esc(draft.name)}">
      <span class="miniLabel">description (optional)</span>
      <input type="text" id="rcDesc" value="${esc(draft.description)}">
      <span class="miniLabel">servings the recipe makes</span>
      <input type="number" id="rcServings" min="1" step="1" value="${draft.servings}">
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
    body.querySelectorAll('.qtyIn').forEach(inp => inp.addEventListener('change', () => {
      draft.rows[+inp.getAttribute('data-i')].quantity = parseFloat(inp.value) || 0; preview();
    }));
    body.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      draft.rows.splice(+b.getAttribute('data-rm'), 1); draw();
    }));
    /* the ingredient editor takes over the sheet, so re-open ours after */
    const reopen = () => { openSheet(recipe ? 'Edit recipe' : 'New recipe', ''); draw(); };
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
        });
        const recipeId = draft.id ?? saved.id;
        await replaceChildren('recipe_ingredients', 'recipe_id', recipeId,
          draft.rows.filter(r => r.quantity > 0).map(r => ({ ingredient_id: r.ingredient_id, quantity: r.quantity })));
        await refresh('recipes');
        S.onChange();
        closeSheet(); view.recipeId = recipeId; view.mode = 'detail'; renderRecipes();
      } catch (err) {
        document.getElementById('rcPreview').textContent = 'save failed: ' + err.message;
      }
    });
  }
  draw();
}
