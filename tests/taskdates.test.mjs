import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTaskDay, isRestDay, restDayAlternatives, addDaysKey, daysBetween } from '../js/taskdates.js';

// 2026-10-30 is a Friday, 2026-10-31 a Saturday, 2026-11-01 a Sunday (and the
// day US daylight saving ends, so a 24-hour step would go wrong here).

test('Saturday is the rest day', () => {
  assert.equal(isRestDay('2026-10-31'), true);
  for (const k of ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-11-01'])
    assert.equal(isRestDay(k), false, k);
  assert.equal(isRestDay(''), false);
  assert.equal(isRestDay(null), false);
});

test('next task day steps over Saturday', () => {
  assert.equal(nextTaskDay('2026-10-29'), '2026-10-30');   // Thu → Fri
  assert.equal(nextTaskDay('2026-10-30'), '2026-11-01');   // Fri → Sun
  assert.equal(nextTaskDay('2026-10-31'), '2026-11-01');   // Sat → Sun
  assert.equal(nextTaskDay('2026-11-01'), '2026-11-02');   // Sun → Mon, across the DST change
});

test('next task day never lands on a Saturday', () => {
  let k = '2026-01-01';
  for (let i = 0; i < 400; i++){
    const n = nextTaskDay(k);
    assert.equal(isRestDay(n), false, `${k} → ${n}`);
    assert.ok(daysBetween(k, n) === 1 || daysBetween(k, n) === 2, `${k} → ${n}`);
    k = addDaysKey(k, 1);
  }
});

test('a Saturday offers the Sunday after or the Friday before', () => {
  assert.deepEqual(restDayAlternatives('2026-10-31'), { sunday: '2026-11-01', friday: '2026-10-30' });
  assert.deepEqual(restDayAlternatives('2027-01-02'), { sunday: '2027-01-03', friday: '2027-01-01' });
});

test('day arithmetic crosses month, year and DST boundaries', () => {
  assert.equal(addDaysKey('2026-10-31', 1), '2026-11-01');
  assert.equal(addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysKey('2027-03-14', -1), '2027-03-13');
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3);
  assert.equal(daysBetween('2027-03-13', '2027-03-15'), 2);
  assert.equal(daysBetween('2026-11-02', '2026-10-30'), -3);
});
