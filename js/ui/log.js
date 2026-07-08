/* Log tab: rings, planned-meal tap-to-log, quick chips, manual entry,
   entries list, body card. */
import { cached, queueFoodEntry, queueBodyMeasurement, deleteLogEntry } from '../store.js';
import { computeForMeal } from '../nutrition.js';
import { esc, dateKey, isToday, ringSVG, targets, allFoodEntries, allBodyMeasurements,
         buildMealCalc, MEAL_TYPES, entryNameWithNote, macroLine } from './common.js';

export const logState = { currentDate: new Date(), plantToggles: {} };
logState.currentDate.setHours(0, 0, 0, 0);

export function entriesForDate(key){
  return allFoodEntries().filter(e => (e.date || '').slice(0, 10) === key)
    .sort((a, b) => (a.created_at || '') < (b.created_at || '') ? -1 : 1);
}

function weeklyPlants(asOf){
  const end = dateKey(asOf);
  const start = dateKey(new Date(asOf.getTime() - 6 * 86400000));
  return allFoodEntries().filter(e => e.is_plant && (e.date || '').slice(0, 10) >= start && (e.date || '').slice(0, 10) <= end).length;
}

export function mealsForDate(key){
  return (cached('meals') || []).filter(m => (m.date || '').slice(0, 10) === key)
    .sort((a, b) => (a.meal_type ?? 0) - (b.meal_type ?? 0));
}

export function plannedMealHtml(meal, opts = {}){
  const comp = computeForMeal(buildMealCalc(meal));
  const logged = allFoodEntries().some(e => e.meal_id === meal.id);
  const toggled = !!logState.plantToggles[meal.id];
  return `<div class="planned" data-meal="${meal.id}">
    <div class="pTop">
      <span class="mealType">${MEAL_TYPES[meal.meal_type] || 'meal'}</span>
      <span class="pName">${esc(meal.title)}</span>
      ${opts.editable ? `<button class="plantTgl" data-editmeal="${meal.id}" aria-label="edit">✎</button>` : ''}
      ${logged
        ? '<button class="logBtn" disabled>✓ logged</button>'
        : `<button class="plantTgl ${toggled ? 'on' : ''}" data-plant="${meal.id}" aria-label="plant">🌱</button>
           <button class="logBtn" data-log="${meal.id}">log</button>`}
    </div>
    <div class="macros">${macroLine(comp)}</div>
    ${comp.uncountedNote ? `<div class="warn">⚠ ${esc(comp.uncountedNote)}</div>` : ''}
  </div>`;
}

export function bindPlannedButtons(scope, rerender){
  scope.querySelectorAll('[data-plant]').forEach(b => b.addEventListener('click', () => {
    const id = +b.getAttribute('data-plant');
    logState.plantToggles[id] = !logState.plantToggles[id];
    rerender();
  }));
  scope.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', () => {
    const id = +b.getAttribute('data-log');
    const meal = (cached('meals') || []).find(m => m.id === id);
    if (!meal || allFoodEntries().some(e => e.meal_id === meal.id)) return;
    const comp = computeForMeal(buildMealCalc(meal));
    queueFoodEntry({
      date: (meal.date || '').slice(0, 10),
      name: entryNameWithNote(`${meal.title} (${MEAL_TYPES[meal.meal_type] || 'meal'})`, comp),
      calories: comp.calories, protein_g: comp.proteinG,
      fiber_g: comp.fiberG, iron_mg: comp.ironMg,
      is_plant: !!logState.plantToggles[meal.id], meal_id: meal.id,
    });
  }));
}

export function renderLog(){
  const T = targets();
  const key = dateKey(logState.currentDate);
  document.getElementById('dateLabel').textContent = logState.currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  document.getElementById('dateSub').textContent = isToday(logState.currentDate) ? 'today' : key;

  const entries = entriesForDate(key);
  const t = entries.reduce((a, e) => {
    a.cal += +e.calories || 0; a.protein += +e.protein_g || 0;
    a.fiber += +e.fiber_g || 0; a.iron += +e.iron_mg || 0; return a;
  }, { cal: 0, protein: 0, fiber: 0, iron: 0 });

  const calColor = t.cal < T.calMin ? 'var(--protein)' : (t.cal > T.calMax ? 'var(--iron)' : 'var(--fiber)');
  const proteinColor = t.protein < T.proteinMin ? 'var(--calorie)' : 'var(--fiber)';
  document.getElementById('rings').innerHTML = `
    <div class="ringCard">${ringSVG(t.cal / T.calMax, calColor)}<div class="ringVal">${Math.round(t.cal)}</div><div class="ringTarget">${T.calMin}-${T.calMax}</div><div class="ringLabel">cal</div></div>
    <div class="ringCard">${ringSVG(t.protein / T.proteinMax, proteinColor)}<div class="ringVal">${Math.round(t.protein)}g</div><div class="ringTarget">${T.proteinMin}-${T.proteinMax}</div><div class="ringLabel">protein</div></div>
    <div class="ringCard">${ringSVG(t.fiber / T.fiber, 'var(--fiber)')}<div class="ringVal">${t.fiber.toFixed(1)}g</div><div class="ringTarget">/ ${T.fiber}g</div><div class="ringLabel">fiber</div></div>
    <div class="ringCard">${ringSVG(t.iron / T.iron, 'var(--iron)')}<div class="ringVal">${t.iron.toFixed(1)}mg</div><div class="ringTarget">/ ${T.iron}mg</div><div class="ringLabel">iron</div></div>`;

  const flag = document.getElementById('lowFlag');
  const future = key > dateKey(new Date());
  if (t.cal > 0 && t.cal < T.lowFloor && !future){
    flag.textContent = `Logged so far: ${Math.round(t.cal)} cal. If the day's done, that's under your ~${T.lowFloor} soft floor — fine occasionally, but sustained low days can disrupt cycles and recovery. If you're still eating, ignore this.`;
    flag.classList.add('show');
  } else flag.classList.remove('show');

  document.getElementById('plantsWeek').textContent = weeklyPlants(logState.currentDate) + ' / 30';

  const meals = mealsForDate(key);
  const wrap = document.getElementById('plannedWrap');
  wrap.innerHTML = meals.length
    ? '<div class="sectionTitle">Planned for this day</div>' + meals.map(m => plannedMealHtml(m)).join('')
    : '';
  bindPlannedButtons(wrap, renderLog);

  renderQuick();
  renderEntries(entries);
  renderBody();
}

function renderQuick(){
  const items = (cached('quick_add_items') || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const row = document.getElementById('quickRow');
  row.innerHTML = items.map((q, i) => `<button type="button" class="quickChip" data-q="${i}">+ ${esc((q.name || '').split('(')[0].trim())}</button>`).join('');
  row.querySelectorAll('.quickChip').forEach(b => b.addEventListener('click', () => {
    const q = items[+b.getAttribute('data-q')];
    queueFoodEntry({ date: dateKey(logState.currentDate), name: q.name,
      calories: q.calories || 0, protein_g: q.protein_g || 0,
      fiber_g: q.fiber_g || 0, iron_mg: q.iron_mg || 0, is_plant: !!q.is_plant });
  }));
}

function renderEntries(entries){
  const el = document.getElementById('entries');
  if (!entries.length){
    el.innerHTML = '<div class="empty"><div class="big">Nothing logged yet</div>Add your first item above.</div>';
    return;
  }
  el.innerHTML = entries.map(e => `
    <div class="entry">
      <span class="plantDot ${e.is_plant ? '' : 'hidden'}"></span>
      <div class="info">
        <div class="name">${esc(e.name)}</div>
        <div class="macros">${Math.round(e.calories)} cal · ${(+e.protein_g).toFixed(1)}g P · ${(+e.fiber_g || 0).toFixed(1)}g fiber · ${(+e.iron_mg || 0).toFixed(1)}mg Fe</div>
      </div>
      <span class="sync ${e.source === 'outbox' ? 'pending' : 'ok'}">${e.source === 'outbox' ? '↑' : '✓'}</span>
      <button class="del" data-del="${e.client_id}">✕</button>
    </div>`).join('');
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    try { await deleteLogEntry(b.getAttribute('data-del')); }
    catch (err) { document.getElementById('syncline').textContent = 'delete failed: ' + err.message; }
  }));
}

function renderBody(){
  const T = targets();
  const log = allBodyMeasurements();
  const latest = log[0];
  const height = (latest && latest.height_in > 0) ? +latest.height_in : T.heightIn;
  document.getElementById('fHeight').value = height;
  const rv = document.getElementById('ratioVal');
  const note = document.getElementById('bodyNote');
  document.getElementById('ratioTargetLabel').innerHTML = 'waist ÷ height<br>target under 0.50 (waist &lt; ' + (height * 0.5).toFixed(1) + 'in)';
  if (latest && latest.waist_in > 0){
    const ratio = latest.waist_in / (latest.height_in || height);
    rv.textContent = ratio.toFixed(2);
    rv.className = 'ratioVal ' + (ratio < 0.5 ? 'good' : 'over');
    note.textContent = ratio < 0.5
      ? `Waist ${latest.waist_in}in ÷ ${latest.height_in || height}in = ${ratio.toFixed(2)}. Under 0.5 — associated with lower visceral-fat risk. Tracks composition better than BMI.`
      : `Waist ${latest.waist_in}in ÷ ${latest.height_in || height}in = ${ratio.toFixed(2)}. Above 0.5 is where visceral-fat risk rises; trending it down over time is the goal — no single reading matters much.`;
    document.getElementById('bodyHist').textContent = log.slice(0, 6).map(e => (e.date || '').slice(0, 10) + ': ' + e.waist_in + 'in').join('   ·   ');
  } else {
    rv.textContent = '—'; rv.className = 'ratioVal';
    note.textContent = 'Measure at the narrowest point (usually just above the navel), relaxed, after exhaling. Weekly is plenty. Trend matters more than any single number.';
    document.getElementById('bodyHist').textContent = '';
  }
}

/* History suggestions: distinct past entry names matching the typed term,
   ranked by frequency then recency. Tapping one prefills the whole form. */
function historySuggestions(term){
  const byName = new Map();
  for (const e of allFoodEntries()){
    const k = (e.name || '').toLowerCase();
    if (!k) continue;
    const cur = byName.get(k);
    if (cur){
      cur.count++;
      if ((e.date || '') > (cur.entry.date || '')) cur.entry = e;
    } else {
      byName.set(k, { count: 1, entry: e });
    }
  }
  const t = term.toLowerCase();
  return [...byName.values()]
    .filter(x => x.entry.name.toLowerCase().includes(t))
    .sort((a, b) => b.count - a.count || ((b.entry.date || '') < (a.entry.date || '') ? -1 : 1))
    .slice(0, 6)
    .map(x => x.entry);
}

function renderSuggestions(term){
  const box = document.getElementById('nameSuggest');
  if (!term || term.trim().length < 2){ box.innerHTML = ''; return; }
  const matches = historySuggestions(term.trim());
  box.innerHTML = matches.map((e, i) => `
    <button type="button" class="suggestRow" data-s="${i}">
      <span class="plantDot ${e.is_plant ? '' : 'hidden'}"></span>
      <span class="sName">${esc(e.name)}</span>
      <span class="sMacros">${Math.round(e.calories)} cal · ${(+e.protein_g).toFixed(1)}g P</span>
    </button>`).join('');
  box.querySelectorAll('.suggestRow').forEach(b => b.addEventListener('click', () => {
    const e = matches[+b.getAttribute('data-s')];
    document.getElementById('fName').value = e.name;
    document.getElementById('fCal').value = Math.round(e.calories);
    document.getElementById('fProtein').value = +e.protein_g || 0;
    document.getElementById('fFiber').value = +e.fiber_g || 0;
    document.getElementById('fIron').value = +e.iron_mg || 0;
    document.getElementById('fPlant').checked = !!e.is_plant;
    document.getElementById('addBtn').disabled = false;
    box.innerHTML = '';
  }));
}

export function wireLogTab(rerenderAll){
  document.getElementById('prevDay').addEventListener('click', () => { logState.currentDate = new Date(logState.currentDate.getTime() - 86400000); renderLog(); });
  document.getElementById('nextDay').addEventListener('click', () => { logState.currentDate = new Date(logState.currentDate.getTime() + 86400000); renderLog(); });

  const nameInput = document.getElementById('fName');
  nameInput.addEventListener('input', () => {
    document.getElementById('addBtn').disabled = !nameInput.value.trim();
    renderSuggestions(nameInput.value);
  });
  document.getElementById('addForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    queueFoodEntry({
      date: dateKey(logState.currentDate), name,
      calories: parseFloat(document.getElementById('fCal').value) || 0,
      protein_g: parseFloat(document.getElementById('fProtein').value) || 0,
      fiber_g: parseFloat(document.getElementById('fFiber').value) || 0,
      iron_mg: parseFloat(document.getElementById('fIron').value) || 0,
      is_plant: document.getElementById('fPlant').checked,
    });
    ['fName', 'fCal', 'fProtein', 'fFiber', 'fIron'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fPlant').checked = false;
    document.getElementById('addBtn').disabled = true;
    document.getElementById('nameSuggest').innerHTML = '';
  });

  document.getElementById('saveWaist').addEventListener('click', () => {
    const waist = parseFloat(document.getElementById('fWaist').value);
    const height = parseFloat(document.getElementById('fHeight').value) || targets().heightIn;
    if (!(waist > 0)) return;
    queueBodyMeasurement({ date: dateKey(new Date()), waist_in: waist, height_in: height });
    document.getElementById('fWaist').value = '';
  });
}
