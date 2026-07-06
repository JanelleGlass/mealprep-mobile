/* Plan tab: week view with per-slot planning, meal editor sheet (recipe-backed
   or ad-hoc), edit/delete of existing meals. */
import { cached, upsertRow, deleteRow, replaceChildren, refresh, S } from '../store.js';
import { computeForMeal } from '../nutrition.js';
import { esc, dateKey, isToday, startOfWeek, MEAL_TYPES, buildMealCalc, ingredientById,
         recipeById, openSheet, closeSheet, macroLine } from './common.js';
import { plannedMealHtml, bindPlannedButtons, mealsForDate } from './log.js';
import { pickIngredient, confirmDialog } from './pickers.js';

export const planState = { weekStart: startOfWeek(new Date()) };

export function renderPlan(){
  const start = planState.weekStart;
  const end = new Date(start.getTime() + 6 * 86400000);
  document.getElementById('planWeekLabel').textContent =
    start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' +
    end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const root = document.getElementById('planDays');
  let html = '';
  for (let i = 0; i < 7; i++){
    const d = new Date(start.getTime() + i * 86400000);
    const key = dateKey(d);
    const meals = mealsForDate(key);
    const planned = new Set(meals.map(m => m.meal_type));
    const addBtns = MEAL_TYPES.map((t, ti) => planned.has(ti) ? '' :
      `<button class="quickChip" data-add="${key}|${ti}">+ ${t}</button>`).join('');
    html += `<div class="planDay">
      <div class="planDayHead">${d.toLocaleDateString(undefined, { weekday: 'long' })}<span class="sub">${key}${isToday(d) ? ' · today' : ''}</span></div>
      ${meals.map(m => plannedMealHtml(m, { editable: true })).join('')}
      <div class="quickRow">${addBtns}</div>
    </div>`;
  }
  root.innerHTML = html;
  bindPlannedButtons(root, renderPlan);
  root.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const [date, type] = b.getAttribute('data-add').split('|');
    openMealSheet(null, date, +type);
  }));
  root.querySelectorAll('[data-editmeal]').forEach(b => b.addEventListener('click', () => {
    const meal = (cached('meals') || []).find(m => m.id === +b.getAttribute('data-editmeal'));
    if (meal) openMealSheet(meal, (meal.date || '').slice(0, 10), meal.meal_type);
  }));
}

/* draft: { id?, date, meal_type, title, servings, recipe_id, rows:[{ingredient_id, quantity}] } */
function openMealSheet(meal, date, mealType){
  const draft = meal ? {
    id: meal.id, date, meal_type: mealType, title: meal.title, servings: meal.servings,
    recipe_id: meal.recipe_id,
    rows: (meal.ingredients || []).map(mi => ({ ingredient_id: mi.ingredient_id, quantity: +mi.quantity })),
  } : { date, meal_type: mealType, title: '', servings: 1, recipe_id: null, rows: [] };

  const body = openSheet(`${meal ? 'Edit' : 'Plan'} ${MEAL_TYPES[mealType]} · ${date}`, '');
  const recipes = (cached('recipes') || []);

  function draw(){
    const mode = draft.recipe_id != null ? 'recipe' : 'adhoc';
    body.innerHTML = `
      <div class="segRow">
        <button class="segBtn ${mode === 'recipe' ? 'active' : ''}" data-mode="recipe">From recipe</button>
        <button class="segBtn ${mode === 'adhoc' ? 'active' : ''}" data-mode="adhoc">Ad-hoc</button>
      </div>
      ${mode === 'recipe' ? `
        <span class="miniLabel">recipe</span>
        <select id="msRecipe">
          <option value="">-- choose --</option>
          ${recipes.map(r => `<option value="${r.id}" ${draft.recipe_id === r.id ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}
        </select>
        <span class="miniLabel">servings you'll eat</span>
        <input type="number" id="msServings" min="0" step="0.5" value="${draft.servings}">`
      : `
        <span class="miniLabel">title</span>
        <input type="text" id="msTitle" value="${esc(draft.title)}" placeholder="e.g. leftovers bowl">
        <span class="miniLabel">servings</span>
        <input type="number" id="msServings" min="0" step="1" value="${draft.servings}">
        <span class="miniLabel">ingredients</span>
        <div id="msRows">${draft.rows.map((r, i) => {
          const ing = ingredientById(r.ingredient_id);
          return `<div class="listRow"><span>${esc(ing ? ing.name : '#' + r.ingredient_id)}</span>
            <span class="qty"><input type="number" class="qtyIn" data-i="${i}" step="0.25" value="${r.quantity}"> ${esc(ing ? ing.unit : '')}
            <button class="del" data-rm="${i}">✕</button></span></div>`;
        }).join('')}</div>
        <button class="quickChip" id="msAddIng">+ add ingredient</button>`}
      <div class="macros" id="msPreview" style="margin-top:10px;"></div>
      <div class="btnRow">
        ${meal ? '<button class="cancel" id="msDelete" style="color:var(--iron);">delete</button>' : '<button class="cancel" id="msCancel">cancel</button>'}
        <button class="save" id="msSave">save</button>
      </div>`;

    const preview = () => {
      const calc = computeForMeal({
        servings: draft.servings,
        recipe: draft.recipe_id != null ? (() => {
          const r = recipeById(draft.recipe_id);
          return r ? { servings: r.servings, ingredients: (r.ingredients || []).map(ri => ({ ingredient: ingredientById(ri.ingredient_id), quantity: +ri.quantity })).filter(x => x.ingredient) } : null;
        })() : null,
        ingredients: draft.rows.map(r => ({ ingredient: ingredientById(r.ingredient_id), quantity: r.quantity })).filter(x => x.ingredient),
      });
      document.getElementById('msPreview').innerHTML = macroLine(calc) +
        (calc.uncountedNote ? `<div class="warn">⚠ ${esc(calc.uncountedNote)}</div>` : '');
    };
    preview();

    body.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      if (b.getAttribute('data-mode') === 'recipe'){ draft.recipe_id = draft.recipe_id ?? (recipes[0]?.id ?? null); }
      else draft.recipe_id = null;
      draw();
    }));
    body.querySelector('#msRecipe')?.addEventListener('change', e => {
      draft.recipe_id = e.target.value ? +e.target.value : null;
      const r = recipeById(draft.recipe_id);
      if (r) draft.title = r.name;
      preview();
    });
    body.querySelector('#msServings').addEventListener('change', e => { draft.servings = parseFloat(e.target.value) || 1; preview(); });
    body.querySelector('#msTitle')?.addEventListener('input', e => { draft.title = e.target.value; });
    body.querySelectorAll('.qtyIn').forEach(inp => inp.addEventListener('change', () => {
      draft.rows[+inp.getAttribute('data-i')].quantity = parseFloat(inp.value) || 0;
      preview();
    }));
    body.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      draft.rows.splice(+b.getAttribute('data-rm'), 1); draw();
    }));
    body.querySelector('#msAddIng')?.addEventListener('click', async () => {
      const ing = await pickIngredient();
      if (ing){ draft.rows.push({ ingredient_id: ing.id, quantity: 1 }); draw(); }
    });
    body.querySelector('#msCancel')?.addEventListener('click', closeSheet);
    body.querySelector('#msDelete')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Delete "${draft.title}" from the plan? Logged entries keep their macros.`))) return;
      await deleteRow('meals', draft.id);
      closeSheet(); renderPlan();
    });
    body.querySelector('#msSave').addEventListener('click', async () => {
      try {
        const isRecipe = draft.recipe_id != null;
        const title = isRecipe ? (recipeById(draft.recipe_id)?.name ?? draft.title) : draft.title.trim();
        if (!title){ document.getElementById('msPreview').textContent = 'give it a title first'; return; }
        const saved = await upsertRow('meals', {
          ...(draft.id ? { id: draft.id } : {}),
          date: draft.date, meal_type: draft.meal_type, title,
          servings: Math.max(1, Math.round(draft.servings)), recipe_id: draft.recipe_id,
        });
        const mealId = draft.id ?? saved.id;
        await replaceChildren('meal_ingredients', 'meal_id', mealId,
          isRecipe ? [] : draft.rows.filter(r => r.quantity > 0).map(r => ({ ingredient_id: r.ingredient_id, quantity: r.quantity })));
        await refresh('meals');
        S.onChange();
        closeSheet(); renderPlan();
      } catch (err) {
        document.getElementById('msPreview').textContent = 'save failed: ' + err.message;
      }
    });
  }
  draw();
}

export function wirePlanTab(){
  document.getElementById('planPrevWeek').addEventListener('click', () => { planState.weekStart = new Date(planState.weekStart.getTime() - 7 * 86400000); renderPlan(); });
  document.getElementById('planNextWeek').addEventListener('click', () => { planState.weekStart = new Date(planState.weekStart.getTime() + 7 * 86400000); renderPlan(); });
}
