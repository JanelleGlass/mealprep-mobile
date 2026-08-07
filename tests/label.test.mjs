/* Label entry is the only place nutrition numbers are typed by hand, so the
   per-serving → per-100 g conversion is checked end to end: through the same
   compute() the rest of the app uses, not just on the row it builds. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelToNutritionRow, compute, Status } from '../js/nutrition.js';

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test('count unit: 2 patties off a "1 patty (85 g)" label', () => {
  const row = labelToNutritionRow({
    description: 'Sausage Patties (Homemade)', servingDesc: '1 patty', servingGrams: 85,
    calories: 180, protein: 12, fiber: 1, iron: 1.2,
  });
  close(row.energy_kcal, 211.7647);          // per 100 g, not per serving
  assert.equal(row.is_usda, false);

  const c = compute([{ ingredient: { id: 1, name: 'Sausage Patties', unit: 'whole', nutrition: row }, quantity: 2 }]);
  assert.equal(c.items[0].status, Status.Counted);
  close(c.items[0].grams, 170);
  close(c.calories, 360);
  close(c.proteinG, 24);
  close(c.ironMg, 2.4);
});

test('volume unit: density comes off the household measure', () => {
  const row = labelToNutritionRow({
    description: 'Moroccan Seasoning', servingDesc: '2 tbsp', servingGrams: 16,
    calories: 60, protein: 2, fiber: 3, iron: 2,
  });
  const c = compute([{ ingredient: { id: 2, name: 'Moroccan Seasoning', unit: 'tbsp', nutrition: row }, quantity: 3 }]);
  close(c.items[0].grams, 24);
  close(c.calories, 90);
});

test('a bare measure gets a leading count so it parses', () => {
  assert.equal(labelToNutritionRow({ description: 'x', servingDesc: 'patty', servingGrams: 85 }).gm_wt_desc1, '1 patty');
  assert.equal(labelToNutritionRow({ description: 'x', servingDesc: '1 can', servingGrams: 250 }).gm_wt_desc1, '1 can');
  assert.equal(labelToNutritionRow({ description: 'x', servingDesc: '', servingGrams: 30 }).gm_wt_desc1, '1 serving');
});

test('blank nutrient fields count as zero, not as missing data', () => {
  const row = labelToNutritionRow({ description: 'x', servingDesc: '1 tsp', servingGrams: 5, calories: 10 });
  assert.equal(row.protein_g, 0);
  const c = compute([{ ingredient: { id: 3, name: 'x', unit: 'tsp', nutrition: row }, quantity: 2 }]);
  assert.equal(c.items[0].status, Status.Counted);
  close(c.calories, 20);
});

test('serving weight is required — nutrition without it can never be converted', () => {
  assert.throws(() => labelToNutritionRow({ description: 'x', servingGrams: 0 }), /grams/);
  assert.throws(() => labelToNutritionRow({ description: 'x' }), /grams/);
});
