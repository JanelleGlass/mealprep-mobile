/* conversionBasis reports which route a conversion took and which gm_wt
   descriptor it actually read. The ingredient editor prints that, so a wrong
   answer here is a claim on screen the arithmetic never made — it used to say
   `1 oz ≈ 28 g (via "1 cup")` for a weight unit that never touched a cup. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionBasis, tryConvertToGrams, isApproxConversion } from '../js/nutrition.js';

/* buckwheat flour: a cup measure and nothing else */
const flour = { energy_kcal: 335, gm_wt_1: 120, gm_wt_desc1: '1 cup', gm_wt_2: null, gm_wt_desc2: '' };
/* gruyere: an ounce measure first, a slice second */
const gruyere = { energy_kcal: 413, gm_wt_1: 28.35, gm_wt_desc1: '1 oz', gm_wt_2: 28, gm_wt_desc2: '1 slice,  (1 oz)' };
/* only the SECOND descriptor is a volume measure — the density must come from
   it, and it is the one the UI has to name */
const patty = { energy_kcal: 200, gm_wt_1: 85, gm_wt_desc1: '1 patty', gm_wt_2: 240, gm_wt_desc2: '1 cup' };
/* nothing to convert with */
const bare = { energy_kcal: 100, gm_wt_1: null, gm_wt_desc1: '', gm_wt_2: null, gm_wt_desc2: '' };

test('a weight unit reads no descriptor at all', () => {
  for (const u of ['g', 'kg', 'oz', 'lb', 'OZ', '  oz  ']){
    const b = conversionBasis(u, flour);
    assert.equal(b.kind, 'mass', u);
    assert.equal(b.desc, null, u);
  }
  assert.equal(Math.round(tryConvertToGrams(1, 'oz', flour)), 28);
});

test('a negligible unit is its own kind', () => {
  for (const u of ['pinch', 'dash', 'to taste']){
    assert.equal(conversionBasis(u, flour).kind, 'negligible');
    assert.equal(tryConvertToGrams(1, u, flour), 0);
  }
});

test('a volume unit names the descriptor that supplied the density', () => {
  const b = conversionBasis('cup', flour);
  assert.equal(b.kind, 'volume');
  assert.equal(b.desc, '1 cup');
  /* the density is on gm_wt_2 here, so naming gm_wt_desc1 would be wrong */
  const p = conversionBasis('cup', patty);
  assert.equal(p.kind, 'volume');
  assert.equal(p.desc, '1 cup');
  assert.notEqual(p.desc, patty.gm_wt_desc1);
});

test('a count unit names the descriptor it matched', () => {
  const b = conversionBasis('slice', gruyere);
  assert.equal(b.kind, 'count');
  assert.equal(b.desc, '1 slice,  (1 oz)');
});

test('an unmatched unit falls back to gm_wt_1 and is flagged as assumed', () => {
  const b = conversionBasis('bunch', flour);
  assert.equal(b.kind, 'assumed');
  assert.equal(b.desc, '1 cup');            // the number used, not a bunch measure
  assert.equal(tryConvertToGrams(1, 'bunch', flour), 120);
});

test('no usable measure at all converts to nothing', () => {
  const b = conversionBasis('bunch', bare);
  assert.equal(b.kind, 'none');
  assert.equal(b.desc, null);
  assert.equal(tryConvertToGrams(1, 'bunch', bare), null);
  /* a volume unit with no density is equally unconvertible */
  assert.equal(conversionBasis('cup', bare).kind, 'none');
});

test('isApproxConversion is exactly the assumed case', () => {
  for (const [u, n] of [['oz', flour], ['cup', flour], ['slice', gruyere], ['pinch', flour],
                        ['bunch', flour], ['bunch', bare], ['cup', bare], ['whole', patty]]){
    assert.equal(isApproxConversion(u, n), conversionBasis(u, n).kind === 'assumed',
      `${u} / gm1=${n.gm_wt_1}`);
  }
});
