import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compute, computeForMeal, computeForRecipe } from '../js/nutrition.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, 'vectors', 'vectors.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(here, 'vectors', 'fixture.json'), 'utf8'));

// The fixture uses C# camelCase names; the calc module expects the Supabase
// snake_case shape. Adapt only the fields the calc reads.
const nutritionById = new Map(fixture.nutritions.map(n => [n.id, {
  energy_kcal: n.energy_Kcal, protein_g: n.protein_g,
  fiber_td_g: n.fiber_TD_g, iron_mg: n.iron_mg,
  gm_wt_1: n.gmWt_1, gm_wt_desc1: n.gmWt_Desc1,
  gm_wt_2: n.gmWt_2, gm_wt_desc2: n.gmWt_Desc2,
}]));

const ingredientById = new Map(fixture.ingredients.map(i => [i.id, {
  id: i.id, name: i.name, unit: i.unit,
  nutrition: i.nutritionId != null ? nutritionById.get(i.nutritionId) ?? null : null,
}]));

const recipeById = new Map(fixture.recipes.map(r => [r.id, {
  id: r.id, servings: r.servings,
  ingredients: fixture.recipeIngredients
    .filter(ri => ri.recipeId === r.id)
    .map(ri => ({ ingredient: ingredientById.get(ri.ingredientId), quantity: ri.quantity })),
}]));

const TOTAL_TOL = 0.05;   // rounded totals: C# decimal banker's vs IEEE double
const ITEM_TOL = 0.01;    // 4-decimal per-item values
const GRAMS_TOL = 0.001;

function assertComputation(actual, expected, label){
  assert.ok(Math.abs(actual.calories - expected.calories) <= TOTAL_TOL, `${label} calories ${actual.calories} vs ${expected.calories}`);
  assert.ok(Math.abs(actual.proteinG - expected.proteinG) <= TOTAL_TOL, `${label} protein ${actual.proteinG} vs ${expected.proteinG}`);
  assert.ok(Math.abs(actual.fiberG - expected.fiberG) <= TOTAL_TOL, `${label} fiber ${actual.fiberG} vs ${expected.fiberG}`);
  assert.ok(Math.abs(actual.ironMg - expected.ironMg) <= TOTAL_TOL, `${label} iron ${actual.ironMg} vs ${expected.ironMg}`);
  assert.equal(actual.hasApprox, expected.hasApprox, `${label} hasApprox`);
  assert.equal(actual.uncountedNote ?? null, expected.uncountedNote ?? null, `${label} uncountedNote`);
  assert.equal(actual.items.length, expected.items.length, `${label} item count`);
  for (let i = 0; i < expected.items.length; i++){
    const a = actual.items[i], e = expected.items[i];
    assert.equal(a.ingredientId, e.ingredientId, `${label} item ${i} ingredientId`);
    assert.equal(a.status, e.status, `${label} item ${i} (${a.name}) status`);
    if (e.grams === null || e.grams === undefined){
      assert.ok(a.grams === null || a.grams === undefined, `${label} item ${i} grams should be null`);
    } else {
      assert.ok(Math.abs(a.grams - e.grams) <= GRAMS_TOL, `${label} item ${i} grams ${a.grams} vs ${e.grams}`);
    }
    for (const f of ['calories', 'proteinG', 'fiberG', 'ironMg'])
      assert.ok(Math.abs(a[f] - e[f]) <= ITEM_TOL, `${label} item ${i} ${f} ${a[f]} vs ${e[f]}`);
  }
}

test('ingredient vectors', () => {
  for (const v of vectors.ingredients){
    const ing = ingredientById.get(v.ingredientId);
    assert.ok(ing, `fixture missing ingredient ${v.ingredientId}`);
    const actual = compute([{ ingredient: ing, quantity: v.quantity }]);
    assertComputation(actual, v.computation, `ingredient ${v.ingredientId} (${v.name})`);
  }
});

test('recipe vectors', () => {
  for (const v of vectors.recipes){
    const recipe = recipeById.get(v.recipeId);
    assert.ok(recipe, `fixture missing recipe ${v.recipeId}`);
    const actual = computeForRecipe(recipe, v.servingsEaten);
    assertComputation(actual, v.computation, `recipe ${v.recipeId} (${v.name}) x${v.servingsEaten}`);
  }
});

test('meal vectors', () => {
  for (const v of vectors.meals){
    const m = fixture.meals.find(x => x.id === v.mealId);
    assert.ok(m, `fixture missing meal ${v.mealId}`);
    const meal = {
      servings: m.servings,
      recipe: m.recipeId != null ? recipeById.get(m.recipeId) ?? null : null,
      ingredients: fixture.mealIngredients
        .filter(mi => mi.mealId === m.id)
        .map(mi => ({ ingredient: ingredientById.get(mi.ingredientId), quantity: mi.quantity })),
    };
    const actual = computeForMeal(meal);
    assertComputation(actual, v.computation, `meal ${v.mealId} (${v.title})`);
  }
});
