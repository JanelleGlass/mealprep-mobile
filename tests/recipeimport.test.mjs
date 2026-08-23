import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUnit, parseRecipeJson, resolveIngredients, buildDescription } from '../js/recipeimport.js';

/* Copies of the app's lists (js/ui/common.js) — recipeimport.js takes them as
   parameters so node never has to load the Supabase CDN import behind common.js. */
const COOKING_UNITS = ['tsp','tbsp','fl oz','cup','pt','qt','gal','ml','L','oz','lb','g','kg','pinch','dash','clove','slice','piece','whole','can','bunch','sprig','head','stalk','to taste'];
const RECIPE_CATEGORIES = ['Breakfast','Soup','Salad','Main','Side','Bread','Dessert','Sauce & Dressing','Drink','Snack','Other'];
const PANTRY_CATEGORIES = ['Fridge','Freezer','Produce','Dry Goods','Canned Goods','Baking','Spices & Seasonings','Sauces & Oils','Drinks','Other'];

const OPTS = { units: COOKING_UNITS, categories: RECIPE_CATEGORIES, pantryCategories: PANTRY_CATEGORIES };
const parse = obj => parseRecipeJson(typeof obj === 'string' ? obj : JSON.stringify(obj), OPTS);
const minimal = over => ({ name: 'Test Pie', servings: 8,
  ingredients: [{ name: 'Sugar', quantity: 1, unit: 'cup' }], ...over });

test('normalizeUnit: exact, case, plural, alias, junk', () => {
  assert.equal(normalizeUnit('cup', COOKING_UNITS), 'cup');
  assert.equal(normalizeUnit('Cups', COOKING_UNITS), 'cup');
  assert.equal(normalizeUnit('TBSP', COOKING_UNITS), 'tbsp');
  assert.equal(normalizeUnit('tablespoons', COOKING_UNITS), 'tbsp');
  assert.equal(normalizeUnit('teaspoon', COOKING_UNITS), 'tsp');
  assert.equal(normalizeUnit('ounces', COOKING_UNITS), 'oz');
  assert.equal(normalizeUnit('fluid ounce', COOKING_UNITS), 'fl oz');
  assert.equal(normalizeUnit('liters', COOKING_UNITS), 'L');
  assert.equal(normalizeUnit('l', COOKING_UNITS), 'L');
  assert.equal(normalizeUnit('pinches', COOKING_UNITS), 'pinch');
  assert.equal(normalizeUnit('dashes', COOKING_UNITS), 'dash');
  assert.equal(normalizeUnit('cloves', COOKING_UNITS), 'clove');
  assert.equal(normalizeUnit('slices', COOKING_UNITS), 'slice');
  assert.equal(normalizeUnit('tbsp.', COOKING_UNITS), 'tbsp');
  assert.equal(normalizeUnit('grams', COOKING_UNITS), 'g');
  assert.equal(normalizeUnit('handful', COOKING_UNITS), null);
  assert.equal(normalizeUnit('', COOKING_UNITS), null);
  assert.equal(normalizeUnit(undefined, COOKING_UNITS), null);
});

test('parse: not JSON / not an object', () => {
  assert.match(parse('{nope').errors[0], /not valid JSON/);
  assert.match(parse('[1,2]').errors[0], /single JSON object/);
});

test('parse: required fields', () => {
  const { errors } = parse({ servings: 0, ingredients: [] });
  assert.ok(errors.some(e => e.includes('"name"')));
  assert.ok(errors.some(e => e.includes('"servings"')));
  assert.ok(errors.some(e => e.includes('"ingredients"')));
});

test('parse: happy path normalizes', () => {
  const { draft, errors, warnings } = parse(minimal({
    category: 'dessert', variationOf: ' Lemon Pie ',
    ingredients: [{ name: ' Sugar ', quantity: '1.5', unit: 'Cups', nutrition: 'SUGARS,GRANULATED', section: 'baking' }],
  }));
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(draft.category, 'Dessert');
  assert.equal(draft.variationOf, 'Lemon Pie');
  const r = draft.ingredients[0];
  assert.equal(r.name, 'Sugar');
  assert.equal(r.quantity, 1.5);
  assert.equal(r.unitCanonical, 'cup');
  assert.equal(r.nutrition, 'SUGARS,GRANULATED');
  assert.equal(r.section, 'Baking');
});

test('parse: bad quantity and unknown category/keys warn or error', () => {
  const { errors } = parse(minimal({ ingredients: [{ name: 'Sugar', quantity: -1, unit: 'cup' }] }));
  assert.ok(errors.some(e => e.includes('"quantity"')));
  const { warnings, errors: e2 } = parse(minimal({ category: 'Puddings', extraField: 1 }));
  assert.deepEqual(e2, []);
  assert.ok(warnings.some(w => w.includes('unknown category "Puddings"')));
  assert.ok(warnings.some(w => w.includes('"extraField"')));
});

test('parse: servings rounds to nearest whole', () => {
  const { draft } = parse(minimal({ servings: 7.6 }));
  assert.equal(draft.servings, 8);
});

test('parse: rejects boolean/array coercions Number() would accept', () => {
  const { errors } = parse(minimal({ servings: true }));
  assert.ok(errors.some(e => e.includes('"servings"')));
  const { errors: e2 } = parse(minimal({ ingredients: [{ name: 'Sugar', quantity: [2], unit: 'cup' }] }));
  assert.ok(e2.some(e => e.includes('"quantity"')));
});

test('parse: units colliding with Object.prototype keys parse as unknown, not a crash', () => {
  assert.equal(normalizeUnit('constructor', COOKING_UNITS), null);
  assert.equal(normalizeUnit('__proto__', COOKING_UNITS), null);
  assert.equal(normalizeUnit('constructors', COOKING_UNITS), null);
  const { draft, errors } = parse(minimal({ ingredients: [{ name: 'Bread', quantity: 1, unit: 'constructor' }] }));
  assert.deepEqual(errors, []);
  assert.equal(draft.ingredients[0].unitCanonical, null);
});

test('parse: duplicate ingredients — same unit sums, different unit blocks', () => {
  const same = parse(minimal({ ingredients: [
    { name: 'Sugar', quantity: 1, unit: 'cup' },
    { name: 'sugar', quantity: 0.5, unit: 'cups' },
  ] }));
  assert.deepEqual(same.errors, []);
  assert.equal(same.draft.ingredients.length, 1);
  assert.equal(same.draft.ingredients[0].quantity, 1.5);
  assert.ok(same.warnings.some(w => w.includes('summed')));

  const diff = parse(minimal({ ingredients: [
    { name: 'Sugar', quantity: 1, unit: 'cup' },
    { name: 'Sugar', quantity: 3, unit: 'tbsp' },
  ] }));
  assert.ok(diff.errors.some(e => e.includes('different units')));
});

test('parse: merge keeps nutrition/section from whichever occurrence has them', () => {
  const { draft, errors } = parse(minimal({ ingredients: [
    { name: 'Sugar', quantity: 1, unit: 'cup' },
    { name: 'sugar', quantity: 0.5, unit: 'cup', nutrition: 'SUGARS,GRANULATED', section: 'Baking' },
  ] }));
  assert.deepEqual(errors, []);
  assert.equal(draft.ingredients[0].nutrition, 'SUGARS,GRANULATED');
  assert.equal(draft.ingredients[0].section, 'Baking');
});

test('parse: same unknown unit in different casing still merges', () => {
  const { draft, errors } = parse(minimal({ ingredients: [
    { name: 'Spinach', quantity: 1, unit: 'Handful' },
    { name: 'spinach', quantity: 1, unit: 'handful' },
  ] }));
  assert.deepEqual(errors, []);
  assert.equal(draft.ingredients.length, 1);
  assert.equal(draft.ingredients[0].quantity, 2);
});

test('resolveIngredients: existing / mismatch / new / new-no-unit', () => {
  const existing = [
    { id: 1, name: 'Sugar', unit: 'g' },
    { id: 2, name: 'heavy cream', unit: 'fl oz' },
  ];
  const rows = [
    { name: 'sugar', quantity: 100, unit: 'g', unitCanonical: 'g' },
    { name: 'Heavy Cream', quantity: 1, unit: 'cups', unitCanonical: 'cup' },
    { name: 'Blueberries', quantity: 2, unit: 'cup', unitCanonical: 'cup' },
    { name: 'Mystery', quantity: 1, unit: 'handful', unitCanonical: null },
  ];
  const out = resolveIngredients(rows, existing);
  assert.equal(out[0].status, 'existing');
  assert.equal(out[0].match.id, 1);
  assert.equal(out[1].status, 'unit-mismatch');
  assert.equal(out[2].status, 'new');
  assert.equal(out[3].status, 'new-no-unit');
});

test('resolveIngredients: unknown written unit on a match still warns, no unit stays quiet', () => {
  const existing = [{ id: 1, name: 'Butter', unit: 'tbsp' }];
  const out = resolveIngredients([
    { name: 'Butter', quantity: 1, unit: 'stick', unitCanonical: null },
    { name: 'Butter', quantity: 2, unit: null, unitCanonical: null },
  ], existing);
  assert.equal(out[0].status, 'unit-mismatch');   // "stick" vs stored tbsp must not pass silently
  assert.equal(out[1].status, 'existing');        // omitted unit means "in the stored unit"
});

test('buildDescription: verbatim description wins', () => {
  const { draft } = parse(minimal({ description: 'exact text', summary: 'ignored', steps: ['also ignored'] }));
  assert.equal(buildDescription(draft), 'exact text');
});

test('buildDescription: assembles summary/INGREDIENTS/STEPS/NOTES', () => {
  const { draft } = parse(minimal({
    summary: 'A pie.',
    ingredients: [{ name: 'Sugar', quantity: 1.5, unit: 'cups' }],
    steps: ['1. Mix.', 'Bake.'],
    notes: ['Deep dish only.'],
  }));
  assert.equal(buildDescription(draft),
    'A pie.\n\nINGREDIENTS\n1.5 cups Sugar\n\nSTEPS\n1. Mix.\n2. Bake.\n\nNOTES\nDeep dish only.');
});

test('buildDescription: renumbering never eats a leading decimal quantity', () => {
  const { draft } = parse(minimal({ steps: ['1.5 cups of the pineapple juice go in last.', '2. Bake.'] }));
  const desc = buildDescription(draft);
  assert.ok(desc.includes('1. 1.5 cups of the pineapple juice go in last.'));
  assert.ok(desc.includes('2. Bake.'));
});

test('buildDescription: ingredientLines override the generated list', () => {
  const { draft } = parse(minimal({
    steps: ['Mix.'],
    ingredientLines: ['1 cup sugar, for the crust', '0.5 cups sugar, for the filling'],
  }));
  assert.ok(buildDescription(draft).includes('INGREDIENTS\n1 cup sugar, for the crust\n0.5 cups sugar, for the filling'));
});

test('buildDescription: nothing to say -> null, no stray INGREDIENTS block', () => {
  const { draft } = parse(minimal({}));
  assert.equal(buildDescription(draft), null);
  const { draft: d2 } = parse(minimal({ summary: 'Just a line.' }));
  assert.equal(buildDescription(d2), 'Just a line.');
});
