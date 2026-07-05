/* MealPrep Mobile — static PWA companion.
   Reads the MealPrep data repo (JSON files pushed by the PC app) via the GitHub
   contents API; writes only mobile-log-inbox.json (append-only, sha-guarded). */

'use strict';

/* ---------- config & storage ---------- */
const LS = {
  cfg: 'mp_cfg',
  cache: 'mp_cache_',    // per-file: { etag, body, fetchedAt }
  outbox: 'mp_outbox',
  inbox: 'mp_inbox_snapshot',
  device: 'mp_device',
};
let cfg = JSON.parse(localStorage.getItem(LS.cfg) || 'null');
let deviceId = localStorage.getItem(LS.device);
if (!deviceId) { deviceId = Math.random().toString(36).slice(2, 7); localStorage.setItem(LS.device, deviceId); }

const FILES = ['ingredients.json','meals.json','recipes-and-books.json','pantry.json','stores.json',
               'daily-log.json','computed-macros.json','settings.json','mobile-log-inbox.json'];

/* ---------- state ---------- */
const S = {
  data: {},            // parsed file bodies by name
  outbox: JSON.parse(localStorage.getItem(LS.outbox) || '[]'),
  inboxEntries: JSON.parse(localStorage.getItem(LS.inbox) || '[]'),
  currentDate: startOfDay(new Date()),
  planWeekStart: startOfWeek(new Date()),
  plantToggles: {},    // mealId -> bool
  recipesView: { mode: 'books', bookId: null, recipeId: null },
  pantrySeg: 'pantry',
  fetchedAt: null,
  lastError: null,
};

/* ---------- date helpers ---------- */
function startOfDay(d){ const x = new Date(d); x.setHours(0,0,0,0); return x; }
function startOfWeek(d){ const x = startOfDay(d); x.setDate(x.getDate() - x.getDay()); return x; }
function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function isToday(d){ return dateKey(d) === dateKey(new Date()); }
function keyOf(csDate){ return (csDate || '').slice(0, 10); }
function esc(s){ const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function newClientId(){ return deviceId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7); }

/* ---------- sync line ---------- */
function setSync(msg, isErr){
  const el = document.getElementById('syncline');
  el.textContent = msg || '';
  el.classList.toggle('err', !!isErr);
}

/* ---------- GitHub API ---------- */
function apiUrl(file){ return `https://api.github.com/repos/${cfg.repo}/contents/${cfg.path ? cfg.path.replace(/\/+$/,'') + '/' : ''}${file}`; }
function headers(extra){
  return Object.assign({
    'Authorization': 'Bearer ' + cfg.token,
    'X-GitHub-Api-Version': '2022-11-28',
  }, extra || {});
}

const isLocalMode = () => cfg && cfg.repo === 'local';

async function fetchFile(file){
  if (isLocalMode()){
    const res = await fetch('data/' + file);
    if (!res.ok) return null;
    const body = await res.text();
    localStorage.setItem(LS.cache + file, JSON.stringify({ etag: null, body, fetchedAt: new Date().toISOString() }));
    return body;
  }
  const cacheKey = LS.cache + file;
  const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
  const h = headers({ 'Accept': 'application/vnd.github.raw+json' });
  if (cached && cached.etag) h['If-None-Match'] = cached.etag;
  const res = await fetch(apiUrl(file), { headers: h });
  if (res.status === 304 && cached) return cached.body;
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const body = await res.text();
  localStorage.setItem(cacheKey, JSON.stringify({ etag: res.headers.get('ETag'), body, fetchedAt: new Date().toISOString() }));
  return body;
}

function cachedFile(file){
  const c = JSON.parse(localStorage.getItem(LS.cache + file) || 'null');
  return c ? c.body : null;
}

/* base64 helpers that survive unicode */
function b64encode(str){ return btoa(String.fromCharCode(...new TextEncoder().encode(str))); }
function b64decode(b64){ return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g,'')), c => c.charCodeAt(0))); }

/* GET inbox with sha (JSON mode), merge entries by clientId, PUT with sha; retry on conflict */
async function pushToInbox(newEntries, removeClientIds){
  if (isLocalMode()){
    // demo/dev mode: simulate the inbox in localStorage only
    let entries = JSON.parse(localStorage.getItem('mp_local_inbox') || '[]');
    const have = new Set(entries.map(e => e.clientId));
    for (const e of newEntries) if (!have.has(e.clientId)) entries.push(e);
    if (removeClientIds && removeClientIds.length){
      const rm = new Set(removeClientIds);
      entries = entries.filter(e => !rm.has(e.clientId));
    }
    localStorage.setItem('mp_local_inbox', JSON.stringify(entries));
    return entries;
  }
  for (let attempt = 0; attempt < 3; attempt++){
    let sha = null, entries = [];
    const res = await fetch(apiUrl('mobile-log-inbox.json'), { headers: headers({ 'Accept': 'application/vnd.github+json' }) });
    if (res.ok){
      const doc = await res.json();
      sha = doc.sha;
      try { entries = (JSON.parse(b64decode(doc.content)).entries) || []; } catch { entries = []; }
    } else if (res.status !== 404){
      throw new Error('inbox read: HTTP ' + res.status);
    }
    const have = new Set(entries.map(e => e.clientId));
    for (const e of newEntries) if (!have.has(e.clientId)) entries.push(e);
    if (removeClientIds && removeClientIds.length){
      const rm = new Set(removeClientIds);
      entries = entries.filter(e => !rm.has(e.clientId));
    }
    const body = { message: `Mobile log ${new Date().toISOString()}`,
                   content: b64encode(JSON.stringify({ version: 1, entries }, null, 2)) };
    if (sha) body.sha = sha;
    const put = await fetch(apiUrl('mobile-log-inbox.json'), { method: 'PUT', headers: headers({ 'Accept': 'application/vnd.github+json' }), body: JSON.stringify(body) });
    if (put.ok) return entries;
    if (put.status !== 409 && put.status !== 422) throw new Error('inbox write: HTTP ' + put.status);
    /* conflict: someone else wrote; loop re-reads and retries */
  }
  throw new Error('inbox write: too many conflicts');
}

/* ---------- data load ---------- */
async function loadAll(){
  if (!cfg){ openSetup(); return; }
  setSync('syncing…');
  let anyFresh = false, failures = 0;
  await Promise.all(FILES.map(async f => {
    try {
      const body = await fetchFile(f);
      if (body !== null){ S.data[f] = JSON.parse(body); anyFresh = true; }
    } catch (e) {
      failures++;
      const c = cachedFile(f);
      if (c) S.data[f] = JSON.parse(c);
    }
  }));
  const inbox = S.data['mobile-log-inbox.json'];
  if (inbox && Array.isArray(inbox.entries)){
    S.inboxEntries = inbox.entries;
    localStorage.setItem(LS.inbox, JSON.stringify(S.inboxEntries));
  }
  if (failures === FILES.length && !anyFresh){
    const c = JSON.parse(localStorage.getItem(LS.cache + 'daily-log.json') || 'null');
    setSync(c ? 'offline — data as of ' + new Date(c.fetchedAt).toLocaleString() : 'offline — no cached data yet', true);
  } else {
    S.fetchedAt = new Date();
    setSync('synced · ' + new Date().toLocaleTimeString());
  }
  await flushOutbox();
  renderAll();
}

/* ---------- outbox ---------- */
function saveOutbox(){ localStorage.setItem(LS.outbox, JSON.stringify(S.outbox)); }
async function flushOutbox(){
  if (!cfg || !S.outbox.length || !navigator.onLine) { renderAll(); return; }
  try {
    const merged = await pushToInbox(S.outbox, null);
    S.inboxEntries = merged;
    localStorage.setItem(LS.inbox, JSON.stringify(merged));
    S.outbox = [];
    saveOutbox();
    setSync('synced · ' + new Date().toLocaleTimeString());
  } catch (e) {
    setSync('saved on phone — will sync when online', true);
  }
  renderAll();
}
window.addEventListener('online', flushOutbox);

/* ---------- derived data ---------- */
function targets(){
  const p = (S.data['settings.json'] || {}).Preferences || {};
  const num = (k, dflt) => { const v = parseFloat(p[k]); return isNaN(v) ? dflt : v; };
  return { calMin: num('LogCalMin', 1700), calMax: num('LogCalMax', 1950),
           proteinMin: num('LogProteinMin', 130), proteinMax: num('LogProteinMax', 145),
           fiber: num('LogFiberTarget', 30), iron: num('LogIronTarget', 18),
           lowFloor: num('LogLowIntakeFloor', 1600), heightIn: num('LogHeightIn', 71) };
}

function allFoodEntries(){
  const synced = ((S.data['daily-log.json'] || {}).FoodLogEntries || []).map(e => ({
    clientId: e.ClientId || ('srv-' + e.Id), date: keyOf(e.Date), name: e.Name,
    calories: e.Calories || 0, proteinG: e.ProteinG || 0, fiberG: e.FiberG || 0, ironMg: e.IronMg || 0,
    isPlant: !!e.IsPlant, mealId: e.MealId ?? null, createdAt: e.CreatedAt, source: 'synced' }));
  const seen = new Set(synced.map(e => e.clientId));
  const inbox = S.inboxEntries.filter(e => (e.type || 'food') === 'food' && !seen.has(e.clientId))
    .map(e => Object.assign({ source: 'inbox' }, e));
  inbox.forEach(e => seen.add(e.clientId));
  const outbox = S.outbox.filter(e => e.type === 'food' && !seen.has(e.clientId))
    .map(e => Object.assign({ source: 'outbox' }, e));
  return synced.concat(inbox, outbox);
}

function entriesForDate(key){
  return allFoodEntries().filter(e => e.date === key)
    .sort((a, b) => (a.createdAt || '') < (b.createdAt || '') ? -1 : 1);
}

function weeklyPlants(asOf){
  const end = dateKey(asOf);
  const start = dateKey(new Date(asOf.getTime() - 6 * 86400000));
  return allFoodEntries().filter(e => e.isPlant && e.date >= start && e.date <= end).length;
}

function bodyMeasurements(){
  const synced = ((S.data['daily-log.json'] || {}).BodyMeasurements || []).map(b => ({
    clientId: b.ClientId || ('srv-' + b.Id), date: keyOf(b.Date), waistIn: b.WaistIn, heightIn: b.HeightIn }));
  const seen = new Set(synced.map(b => b.clientId));
  const extra = S.inboxEntries.concat(S.outbox).filter(e => e.type === 'body' && !seen.has(e.clientId))
    .map(e => ({ clientId: e.clientId, date: e.date, waistIn: e.waistIn, heightIn: e.heightIn }));
  return synced.concat(extra).sort((a, b) => a.date < b.date ? 1 : -1);
}

function mealsForDate(key){
  return ((S.data['meals.json'] || {}).Meals || []).filter(m => keyOf(m.Date) === key)
    .sort((a, b) => (a.MealType ?? 0) - (b.MealType ?? 0));
}
function mealMacros(mealId){
  return (((S.data['computed-macros.json'] || {}).Meals) || []).find(m => m.MealId === mealId) || null;
}
function recipeMacros(recipeId){
  return (((S.data['computed-macros.json'] || {}).Recipes) || []).find(r => r.RecipeId === recipeId) || null;
}
function ingredientById(id){
  return (((S.data['ingredients.json'] || {}).Ingredients) || []).find(i => i.Id === id) || null;
}
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];

/* ---------- logging ---------- */
function addFoodEntry(fields){
  const entry = Object.assign({ clientId: newClientId(), type: 'food',
    date: dateKey(S.currentDate), createdAt: new Date().toISOString() }, fields);
  S.outbox.push(entry);
  saveOutbox();
  renderAll();
  flushOutbox();
}

function entryNameWithNote(base, macros){
  if (!macros || !macros.UncountedNote) return base.slice(0, 200);
  const full = base + ' — ' + macros.UncountedNote.replace('Not counted', 'not counted');
  return full.slice(0, 200);
}

function logPlannedMeal(meal){
  const loggedIds = new Set(allFoodEntries().map(e => e.mealId).filter(x => x != null));
  if (loggedIds.has(meal.Id)) return;
  const m = mealMacros(meal.Id);
  addFoodEntry({
    name: entryNameWithNote(`${meal.Title} (${MEAL_TYPES[meal.MealType] || 'meal'})`, m),
    calories: m ? m.Calories : 0, proteinG: m ? m.ProteinG : 0,
    fiberG: m ? m.FiberG : 0, ironMg: m ? m.IronMg : 0,
    isPlant: !!S.plantToggles[meal.Id], mealId: meal.Id,
  });
}

async function deleteEntry(clientId, source){
  if (source === 'outbox'){
    S.outbox = S.outbox.filter(e => e.clientId !== clientId);
    saveOutbox();
    renderAll();
  } else if (source === 'inbox'){
    try {
      const merged = await pushToInbox([], [clientId]);
      S.inboxEntries = merged;
      localStorage.setItem(LS.inbox, JSON.stringify(merged));
      renderAll();
    } catch (e) { setSync('delete failed — try again online', true); }
  }
}

/* ---------- render: log tab ---------- */
function ringSVG(pct, color, size = 58, stroke = 6){
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, dash = Math.min(Math.max(pct, 0), 1) * c;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--rule)" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${dash} ${c}" transform="rotate(-90 ${size/2} ${size/2})"/>
  </svg>`;
}

function renderLog(){
  const T = targets();
  const key = dateKey(S.currentDate);
  document.getElementById('dateLabel').textContent = S.currentDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  document.getElementById('dateSub').textContent = isToday(S.currentDate) ? 'today' : key;

  const entries = entriesForDate(key);
  const t = entries.reduce((a, e) => { a.cal += +e.calories || 0; a.protein += +e.proteinG || 0; a.fiber += +e.fiberG || 0; a.iron += +e.ironMg || 0; return a; }, { cal: 0, protein: 0, fiber: 0, iron: 0 });

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

  document.getElementById('plantsWeek').textContent = weeklyPlants(S.currentDate) + ' / 30';

  renderPlanned('plannedWrap', key, true);
  renderQuick();
  renderEntries(entries);
  renderBody();
}

function plannedMealHtml(meal){
  const m = mealMacros(meal.Id);
  const logged = allFoodEntries().some(e => e.mealId === meal.Id);
  const toggled = !!S.plantToggles[meal.Id];
  const macroLine = m
    ? `${m.HasApprox ? '≈ ' : ''}${Math.round(m.Calories)} cal · ${m.ProteinG.toFixed(1)}g P · ${m.FiberG.toFixed(1)}g fiber · ${m.IronMg.toFixed(1)}mg Fe`
    : 'no computed macros — push a fresh backup from the PC';
  return `<div class="planned" data-meal="${meal.Id}">
    <div class="pTop">
      <span class="mealType">${MEAL_TYPES[meal.MealType] || 'meal'}</span>
      <span class="pName">${esc(meal.Title)}</span>
      ${logged
        ? '<button class="logBtn" disabled>✓ logged</button>'
        : `<button class="plantTgl ${toggled ? 'on' : ''}" data-plant="${meal.Id}" aria-label="plant">🌱</button>
           <button class="logBtn" data-log="${meal.Id}">log</button>`}
    </div>
    <div class="macros">${macroLine}</div>
    ${m && m.UncountedNote ? `<div class="warn">⚠ ${esc(m.UncountedNote)}</div>` : ''}
  </div>`;
}

function renderPlanned(containerId, key, withTitle){
  const meals = mealsForDate(key);
  const wrap = document.getElementById(containerId);
  if (!meals.length){ wrap.innerHTML = ''; return; }
  wrap.innerHTML = (withTitle ? '<div class="sectionTitle">Planned for this day</div>' : '')
    + meals.map(plannedMealHtml).join('');
  bindPlannedButtons(wrap);
}

function bindPlannedButtons(scope){
  scope.querySelectorAll('[data-plant]').forEach(b => b.addEventListener('click', () => {
    const id = +b.getAttribute('data-plant');
    S.plantToggles[id] = !S.plantToggles[id];
    renderAll();
  }));
  scope.querySelectorAll('[data-log]').forEach(b => b.addEventListener('click', () => {
    const id = +b.getAttribute('data-log');
    const meal = ((S.data['meals.json'] || {}).Meals || []).find(m => m.Id === id);
    if (meal) logPlannedMeal(meal);
  }));
}

function renderQuick(){
  const items = ((S.data['daily-log.json'] || {}).QuickAddItems || []).slice()
    .sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0));
  const row = document.getElementById('quickRow');
  row.innerHTML = items.map((q, i) => `<button type="button" class="quickChip" data-q="${i}">+ ${esc((q.Name || '').split('(')[0].trim())}</button>`).join('');
  row.querySelectorAll('.quickChip').forEach(b => b.addEventListener('click', () => {
    const q = items[+b.getAttribute('data-q')];
    addFoodEntry({ name: q.Name, calories: q.Calories || 0, proteinG: q.ProteinG || 0,
      fiberG: q.FiberG || 0, ironMg: q.IronMg || 0, isPlant: !!q.IsPlant });
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
      <span class="plantDot ${e.isPlant ? '' : 'hidden'}"></span>
      <div class="info">
        <div class="name">${esc(e.name)}</div>
        <div class="macros">${Math.round(e.calories)} cal · ${(+e.proteinG).toFixed(1)}g P · ${(+e.fiberG || 0).toFixed(1)}g fiber · ${(+e.ironMg || 0).toFixed(1)}mg Fe</div>
      </div>
      <span class="sync ${e.source === 'outbox' ? 'pending' : 'ok'}" title="${e.source}">${e.source === 'outbox' ? '↑' : (e.source === 'inbox' ? '◌' : '✓')}</span>
      ${e.source === 'synced' ? '' : `<button class="del" data-del="${e.clientId}" data-src="${e.source}">✕</button>`}
    </div>`).join('');
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () =>
    deleteEntry(b.getAttribute('data-del'), b.getAttribute('data-src'))));
}

function renderBody(){
  const T = targets();
  const log = bodyMeasurements();
  const latest = log[0];
  const height = (latest && latest.heightIn > 0) ? latest.heightIn : T.heightIn;
  document.getElementById('fHeight').value = height;
  const rv = document.getElementById('ratioVal');
  const note = document.getElementById('bodyNote');
  document.getElementById('ratioTargetLabel').innerHTML = 'waist ÷ height<br>target under 0.50 (waist &lt; ' + (height * 0.5).toFixed(1) + 'in)';
  if (latest && latest.waistIn > 0){
    const ratio = latest.waistIn / (latest.heightIn || height);
    rv.textContent = ratio.toFixed(2);
    rv.className = 'ratioVal ' + (ratio < 0.5 ? 'good' : 'over');
    note.textContent = ratio < 0.5
      ? `Waist ${latest.waistIn}in ÷ ${latest.heightIn || height}in = ${ratio.toFixed(2)}. Under 0.5 — associated with lower visceral-fat risk. Tracks composition better than BMI.`
      : `Waist ${latest.waistIn}in ÷ ${latest.heightIn || height}in = ${ratio.toFixed(2)}. Above 0.5 is where visceral-fat risk rises; trending it down over time is the goal — no single reading matters much.`;
    document.getElementById('bodyHist').textContent = log.slice(0, 6).map(e => e.date + ': ' + e.waistIn + 'in').join('   ·   ');
  } else {
    rv.textContent = '—'; rv.className = 'ratioVal';
    note.textContent = 'Measure at the narrowest point (usually just above the navel), relaxed, after exhaling. Weekly is plenty. Trend matters more than any single number.';
    document.getElementById('bodyHist').textContent = '';
  }
}

/* ---------- render: plan tab ---------- */
function renderPlan(){
  const start = S.planWeekStart;
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
    if (!meals.length) continue;
    html += `<div class="planDay"><div class="planDayHead">${d.toLocaleDateString(undefined, { weekday: 'long' })}<span class="sub">${key}${isToday(d) ? ' · today' : ''}</span></div>`
          + meals.map(plannedMealHtml).join('') + '</div>';
  }
  root.innerHTML = html || '<div class="empty"><div class="big">Nothing planned this week</div>Plan meals on the PC and push a backup.</div>';
  bindPlannedButtons(root);
}

/* ---------- render: recipes tab ---------- */
function renderRecipes(){
  const root = document.getElementById('recipesRoot');
  const data = S.data['recipes-and-books.json'] || {};
  const recipes = data.Recipes || [];
  const books = data.RecipeBooks || [];
  const entries = data.RecipeBookEntries || [];
  const v = S.recipesView;

  if (v.mode === 'detail'){
    const r = recipes.find(x => x.Id === v.recipeId);
    if (!r){ v.mode = 'books'; return renderRecipes(); }
    const m = recipeMacros(r.Id);
    root.innerHTML = `
      <button class="backLink" id="rBack">← recipes</button>
      <div class="card">
        <div class="cName" style="font-size:16px;font-family:'Fraunces',serif;">${esc(r.Name)}</div>
        <div class="cSub">${r.Servings || 1} servings${r.Description ? ' · ' + esc(r.Description) : ''}</div>
        ${m ? `<div class="cSub" style="margin-top:6px;">per serving: ${m.HasApprox ? '≈ ' : ''}${Math.round(m.PerServingCalories)} cal · ${m.PerServingProteinG.toFixed(1)}g P · ${m.PerServingFiberG.toFixed(1)}g fiber · ${m.PerServingIronMg.toFixed(1)}mg Fe</div>` : ''}
        ${m && m.UncountedNote ? `<div class="cSub" style="color:#7A4A26;">⚠ ${esc(m.UncountedNote)}</div>` : ''}
      </div>
      <div class="card">
        ${((data.RecipeIngredients || []).filter(ri => ri.RecipeId === r.Id)).map(ri => {
          const ing = ingredientById(ri.IngredientId);
          return `<div class="listRow"><span>${esc(ing ? ing.Name : '#' + ri.IngredientId)}</span><span class="qty">${ri.Quantity} ${esc(ing ? ing.Unit : '')}</span></div>`;
        }).join('') || '<div class="empty">No ingredients</div>'}
      </div>`;
    document.getElementById('rBack').addEventListener('click', () => { v.mode = v.bookId != null ? 'list' : 'books'; renderRecipes(); });
    return;
  }

  if (v.mode === 'list'){
    const book = books.find(b => b.Id === v.bookId);
    const ids = v.bookId == null ? null : new Set(entries.filter(e => e.RecipeBookId === v.bookId).map(e => e.RecipeId));
    const list = recipes.filter(r => !ids || ids.has(r.Id)).sort((a, b) => a.Name.localeCompare(b.Name));
    root.innerHTML = `<button class="backLink" id="rBack">← books</button>
      <div class="sectionTitle">${esc(book ? book.Name : 'All recipes')}</div>`
      + (list.map(r => {
          const m = recipeMacros(r.Id);
          return `<div class="card" data-r="${r.Id}" style="cursor:pointer;">
            <div class="cName">${esc(r.Name)}</div>
            <div class="cSub">${r.Servings || 1} servings${m ? ` · ${Math.round(m.PerServingCalories)} cal/serving` : ''}</div>
          </div>`;
        }).join('') || '<div class="empty">No recipes</div>');
    document.getElementById('rBack').addEventListener('click', () => { v.mode = 'books'; v.bookId = null; renderRecipes(); });
    root.querySelectorAll('[data-r]').forEach(c => c.addEventListener('click', () => { v.recipeId = +c.getAttribute('data-r'); v.mode = 'detail'; renderRecipes(); }));
    return;
  }

  root.innerHTML = '<div class="sectionTitle">Recipe books</div>'
    + `<div class="card" data-b="all" style="cursor:pointer;"><div class="cName">All recipes</div><div class="cSub">${recipes.length} recipes</div></div>`
    + books.map(b => {
        const count = entries.filter(e => e.RecipeBookId === b.Id).length;
        return `<div class="card" data-b="${b.Id}" style="cursor:pointer;"><div class="cName">${esc(b.Name)}</div><div class="cSub">${count} recipes</div></div>`;
      }).join('');
  root.querySelectorAll('[data-b]').forEach(c => c.addEventListener('click', () => {
    const val = c.getAttribute('data-b');
    v.bookId = val === 'all' ? null : +val;
    v.mode = 'list';
    renderRecipes();
  }));
}

/* ---------- render: pantry tab ---------- */
function renderPantry(){
  const root = document.getElementById('pantryRoot');
  if (S.pantrySeg === 'pantry'){
    const items = ((S.data['pantry.json'] || {}).PantryItems || []).map(p => ({ p, ing: ingredientById(p.IngredientId) }))
      .filter(x => x.ing).sort((a, b) => a.ing.Name.localeCompare(b.ing.Name));
    root.innerHTML = '<div class="card">' + (items.map(({ p, ing }) =>
      `<div class="listRow"><span>${esc(ing.Name)}</span><span class="qty">${p.Quantity} ${esc(ing.Unit)}</span></div>`).join('')
      || '<div class="empty">Pantry is empty</div>') + '</div>';
  } else {
    const data = S.data['stores.json'] || {};
    const stores = data.Stores || [];
    const products = data.StoreProducts || [];
    root.innerHTML = stores.map(s => {
      const rows = products.filter(p => p.StoreId === s.Id).map(p => {
        const ing = ingredientById(p.IngredientId);
        return `<div class="listRow"><span>${esc(ing ? ing.Name : p.ProductName)}</span><span class="qty">$${(+p.Price).toFixed(2)}</span></div>`;
      }).join('');
      return `<div class="sectionTitle">${esc(s.Name)}</div><div class="card">${rows || '<div class="empty">No products</div>'}</div>`;
    }).join('') || '<div class="empty"><div class="big">No stores</div>Add stores on the PC.</div>';
  }
}

/* ---------- render all ---------- */
function renderAll(){
  renderLog();
  renderPlan();
  renderRecipes();
  renderPantry();
}

/* ---------- setup overlay ---------- */
function openSetup(){
  const ov = document.getElementById('setupOverlay');
  if (cfg){
    document.getElementById('setupRepo').value = cfg.repo || '';
    document.getElementById('setupPath').value = cfg.path || 'mealprep-backup';
    document.getElementById('setupToken').value = cfg.token || '';
  }
  ov.classList.add('show');
}

/* ---------- wire up ---------- */
document.getElementById('gearBtn').addEventListener('click', openSetup);
document.getElementById('setupCancel').addEventListener('click', () => document.getElementById('setupOverlay').classList.remove('show'));
document.getElementById('setupSave').addEventListener('click', () => {
  cfg = {
    repo: document.getElementById('setupRepo').value.trim(),
    path: document.getElementById('setupPath').value.trim(),
    token: document.getElementById('setupToken').value.trim(),
  };
  localStorage.setItem(LS.cfg, JSON.stringify(cfg));
  document.getElementById('setupOverlay').classList.remove('show');
  loadAll();
});

document.getElementById('prevDay').addEventListener('click', () => { S.currentDate = new Date(S.currentDate.getTime() - 86400000); renderLog(); });
document.getElementById('nextDay').addEventListener('click', () => { S.currentDate = new Date(S.currentDate.getTime() + 86400000); renderLog(); });
document.getElementById('planPrevWeek').addEventListener('click', () => { S.planWeekStart = new Date(S.planWeekStart.getTime() - 7 * 86400000); renderPlan(); });
document.getElementById('planNextWeek').addEventListener('click', () => { S.planWeekStart = new Date(S.planWeekStart.getTime() + 7 * 86400000); renderPlan(); });

const nameInput = document.getElementById('fName');
nameInput.addEventListener('input', () => { document.getElementById('addBtn').disabled = !nameInput.value.trim(); });
document.getElementById('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (!name) return;
  addFoodEntry({
    name,
    calories: parseFloat(document.getElementById('fCal').value) || 0,
    proteinG: parseFloat(document.getElementById('fProtein').value) || 0,
    fiberG: parseFloat(document.getElementById('fFiber').value) || 0,
    ironMg: parseFloat(document.getElementById('fIron').value) || 0,
    isPlant: document.getElementById('fPlant').checked,
  });
  ['fName', 'fCal', 'fProtein', 'fFiber', 'fIron'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('fPlant').checked = false;
  document.getElementById('addBtn').disabled = true;
});

document.getElementById('saveWaist').addEventListener('click', () => {
  const waist = parseFloat(document.getElementById('fWaist').value);
  const height = parseFloat(document.getElementById('fHeight').value) || targets().heightIn;
  if (!(waist > 0)) return;
  S.outbox.push({ clientId: newClientId(), type: 'body', date: dateKey(new Date()),
    waistIn: waist, heightIn: height, createdAt: new Date().toISOString() });
  saveOutbox();
  document.getElementById('fWaist').value = '';
  renderAll();
  flushOutbox();
});

document.querySelectorAll('.tabBtn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabBtn').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + b.getAttribute('data-tab')));
}));
document.querySelectorAll('.segBtn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.segBtn').forEach(x => x.classList.toggle('active', x === b));
  S.pantrySeg = b.getAttribute('data-seg');
  renderPantry();
}));

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

/* ---------- boot ---------- */
renderAll();
loadAll();
