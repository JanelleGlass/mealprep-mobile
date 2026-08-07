/* Routines tab: opens on today's combined to-do list (daily items, workout,
   cleaning), tracks completion per date as a habit history, and shows a weekly
   overview. What the list contains lives in routineplan.js and is editable;
   what has been ticked off lives here, per date, under 'routines.log'. */
import { esc, dateKey, isToday, startOfDay, recipeById, targets, allFoodEntries,
         collapsibleSection, openSheet, closeSheet } from './common.js';
import { cached, refresh } from '../store.js';
import { createSyncedBlob } from '../syncblob.js';
import { confirmDialog } from './pickers.js';
import { addToPantry } from './pantry.js';
import { skippedDates } from './log.js';
import { entriesFor, removeRecipe, shoppingFor, owedFor, markApplied, prunePlan,
         planReconcile, planChangedRemotely, planPush, planIsDirty } from './cookplan.js';
import { HABIT_RULE, WEEK_ORDER, DAY_ABBR, allRoutines, routineById, routinesForDow,
         stepsForDow, addRoutine, updateRoutine, deleteRoutine, addStep, updateStep,
         deleteStep, moveStep, moveRoutine, routinePlanReconcile, routinePlanChangedRemotely,
         routinePlanPush, routinePlanIsDirty } from './routineplan.js';

const dayName = d => d.toLocaleDateString('en-US', { weekday: 'long' });
/* "every day" / "Mon · Wed · Fri" — the schedule in a section's note slot */
const dayLabel = days => !days?.length ? 'no days'
  : days.length === 7 ? 'every day' : days.map(i => DAY_ABBR[i]).join(' · ');

/* ---------- per-date completion log ----------
   Local storage is the offline-first mirror; the same object is synced to
   Supabase as a JSON value in user_preferences (key 'RoutinesLog') so a check
   made on the phone shows up on the computer and vice-versa. */
const routinesLog = createSyncedBlob({
  prefKey: 'RoutinesLog', localKey: 'routines.log', dirtyKey: 'routines.dirty',
});
const log = () => routinesLog.get();

/* on tab open: send anything pending, pull the latest, then re-render */
async function syncOpen(){
  shopMsg = null;
  try {
    if (routinesLog.isDirty()) await routinesLog.push();
    if (planIsDirty()) await planPush();
    if (routinePlanIsDirty()) await routinePlanPush();
    await refresh('user_preferences');
    routinesLog.reconcile();
    planReconcile();
    routinePlanReconcile();
  } catch { /* offline — local copy stands */ }
  prunePlan();
  renderRoutines();
  startPolling();
  drainOwed(dateKey(view.date));
}
/* pantry writes owed from a shopping run done offline */
window.addEventListener('online', () => { if (routinesActive()) drainOwed(dateKey(view.date)); });

/* ---------- near-live pull: while the tab is showing, poll for changes made
   on another device and repaint only when something actually changed ---------- */
const POLL_MS = 5000;
let pollTimer = null;
const routinesActive = () => document.getElementById('tab-routines')?.classList.contains('active');

async function pullAndApply(){
  /* offline, or we hold unsynced local edits in any of the blobs */
  if (!navigator.onLine || routinesLog.isDirty() || planIsDirty() || routinePlanIsDirty()) return;
  if (view.editing) return;                      // mid-edit: don't yank the list away
  try { await refresh('user_preferences'); } catch { return; }
  if (!routinesLog.changedRemotely() && !planChangedRemotely()
      && !routinePlanChangedRemotely()) return;  // nothing new
  const y = window.scrollY;
  renderRoutines();                              // reconcile() inside adopts the synced copies
  window.scrollTo(0, y);
}
function startPolling(){
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!routinesActive()){ clearInterval(pollTimer); pollTimer = null; return; }
    if (document.visibilityState === 'visible') pullAndApply();
  }, POLL_MS);
}
/* repaint immediately when the window/tab regains focus */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && routinesActive()) pullAndApply(); });
window.addEventListener('focus', () => { if (routinesActive()) pullAndApply(); });

const isChecked = (dk, id) => !!(log()[dk] && log()[dk][id]);
function toggle(dk, id){
  const l = log();
  if (!l[dk]) l[dk] = {};
  if (l[dk][id]) delete l[dk][id]; else l[dk][id] = true;
  if (!Object.keys(l[dk]).length) delete l[dk];
  routinesLog.save();
}

/* ---------- steps ----------
   A per-day number rather than a checkbox, stored in the same routines log under
   a reserved key so it syncs with everything else. Task ids are all lowercase
   words, so '__steps' can't collide with one. */
const STEPS_KEY = '__steps';
const stepsFor = dk => +(log()[dk] && log()[dk][STEPS_KEY]) || 0;
function setSteps(dk, n){
  const l = log();
  if (!l[dk]) l[dk] = {};
  if (n > 0) l[dk][STEPS_KEY] = n; else delete l[dk][STEPS_KEY];
  if (!Object.keys(l[dk]).length) delete l[dk];
  routinesLog.save();
}

/* ---------- calories ----------
   Read-only view of the Log tab's entries: calories per date, rebuilt each
   render so the habit row follows whatever has been logged. Days opted out of
   the Log's averages come along, so a day marked unrepresentative there doesn't
   count as a miss here either. */
let calByDate = new Map();
let calSkip = new Set();
function buildCalByDate(){
  calByDate = new Map();
  for (const e of allFoodEntries()){
    const k = (e.date || '').slice(0, 10);
    if (k) calByDate.set(k, (calByDate.get(k) || 0) + (+e.calories || 0));
  }
  calSkip = skippedDates();
}

/* ---------- the list for a given day ---------- */
function sectionsFor(date){
  const dow = date.getDay(), dk = dateKey(date), secs = [];

  for (const r of routinesForDow(dow)){
    const steps = r.steps || [];
    /* a routine holding a cook-plan slot shows the recipes assigned to that day.
       They hang off the step the slot is anchored to ('cook'), or the end of the
       list if that step has been deleted. */
    const rows = r.slot ? recipeRows(dk, r.slot) : [];
    const anchor = r.slot === 'cook' ? steps.findIndex(s => s.id === 'cook') : -1;
    const tasks = [];
    steps.forEach((s, i) => {
      tasks.push({ id: s.id, t: r.numbered ? `${i + 1}. ${s.t}` : s.t, d: s.d || undefined });
      if (i === anchor) tasks.push(...rows);
    });
    if (rows.length && anchor < 0) tasks.push(...rows);

    secs.push({ key: r.id, routine: r, title: r.title, note: r.note, hue: r.hue,
      tips: r.tips?.length ? r.tips : null, groups: [{ tasks }],
      foot: r.slot ? removeChips(dk, r.slot) : '' });
  }

  const shopping = shoppingFor(dk);
  if (shopping.length){
    const covered = shopping.filter(x => x.covered).length;
    secs.push({
      key: 'shopping',
      title: 'Shopping',
      note: covered ? `${covered} of ${shopping.length} already in the pantry`
            : shopping.length === 1 ? '1 item' : `${shopping.length} items`,
      countInProgress: false,          // a 25-item grocery run shouldn't read "3 / 41 done"
      groups: [{ tasks: shopping.map(x => {
        const id = `sh:${x.ingredient_id}`;
        const got = isChecked(dk, id);
        return { id, t: `${x.name} — ${x.need} ${x.unit}`,
          /* once it's in the cart, pantry commentary is just noise */
          d: got ? undefined
             : x.covered ? `✓ pantry has ${x.have} ${x.unit}`
             : x.have > 0 ? `pantry has ${x.have} of ${x.need} ${x.unit}` : undefined,
          flag: (!got && x.covered) ? 'haveIt' : '' };
      }) }],
      foot: shopMsg ? `<div class="cSub" style="color:var(--iron);">${esc(shopMsg)}</div>` : '',
    });
  }
  return secs;
}

/* indented rows for the recipes assigned to a slot */
function recipeRows(dk, slot){
  const known = cached('recipes');    // null when the cache has never been filled
  return entriesFor(dk, slot).map(e => {
    const r = recipeById(+e.r);
    if (!r) return known ? { id: `rc:${slot}:${+e.r}`, t: `⚠ removed recipe #${+e.r}`, child: true } : null;
    const m = Number(e.m) || 1;
    return { id: `rc:${slot}:${r.id}`, child: true, t: r.name,
      d: `${m === 1 ? '1 batch' : m + ' batches'} · ${Math.round((r.servings || 1) * m)} servings` };
  }).filter(Boolean);
}

/* a ✕ can't live inside a taskRow (it's already a <button>), so removal lives
   in a chip row under the list */
function removeChips(dk, slot){
  const known = cached('recipes');
  const chips = entriesFor(dk, slot).map(e => {
    const r = recipeById(+e.r);
    const label = r ? r.name : (known ? `removed recipe #${+e.r}` : null);
    if (label === null) return '';
    return `<button class="rmChip" data-rmrec="${slot}:${+e.r}" data-rname="${esc(label)}">✕ ${esc(label)}</button>`;
  }).join('');
  return chips ? `<div class="quickRow">${chips}</div>` : '';
}

/* ---------- habit history ---------- */
/* returns 'done' | 'miss' | 'off' for a habit on a date */
function habitStatus(dk, habit){
  const d = startOfDay(new Date(dk + 'T00:00:00'));

  /* the two measured habits: 'off' means no data for that day, not "no plan" */
  if (habit === 'calories'){
    if (calSkip.has(dk)) return 'off';                  // skipped in the Log's averages
    const cal = calByDate.get(dk) || 0;
    if (!cal) return 'off';
    return cal <= targets().calMax ? 'done' : 'miss';   // in range or under counts
  }
  if (habit === 'steps'){
    const s = stepsFor(dk);
    if (!s) return 'off';
    return s >= targets().stepsGoal ? 'done' : 'miss';
  }

  /* the rest come from whatever steps carry that habit tag on that weekday, so
     editing the routines moves the tracker with them. Nothing scheduled that
     day (or the tag edited away entirely) reads as 'off', same as before. */
  const ids = stepsForDow(d.getDay()).filter(s => s.habit === habit).map(s => s.id);
  if (!ids.length) return 'off';
  const checked = ids.filter(id => isChecked(dk, id)).length;
  const rule = HABIT_RULE[habit] || 'all';
  const complete = rule === 'any' ? checked > 0
    : rule === 'most' ? checked >= Math.ceil(ids.length * 0.75)
    : checked === ids.length;
  return complete ? 'done' : 'miss';
}
function lastDates(n){
  const out = [], base = startOfDay(new Date());
  for (let i = n - 1; i >= 0; i--){ const x = new Date(base); x.setDate(x.getDate() - i); out.push(x); }
  return out;
}

/* ---------- view ---------- */
/* secOpen holds only sections the user has explicitly opened or closed; anything
   absent falls back to the default (open, unless every box in it is checked). */
const view = { date: startOfDay(new Date()), tipsOpen: false, secOpen: {}, editing: false };
let shopMsg = null;                    // inline note under the shopping list
export function routinesFocusToday(){ view.date = startOfDay(new Date()); syncOpen(); }

/* ids are always a literal prefix + a row id, so they're safe unescaped */
function taskRow(dk, t){
  const cls = 'taskRow' + (isChecked(dk, t.id) ? ' done' : '') + (t.child ? ' child' : '') + (t.flag ? ' ' + t.flag : '');
  return `<button type="button" class="${cls}" data-check="${t.id}">
    <span class="box"></span>
    <span class="tText"><span class="tTitle">${esc(t.t)}</span>${t.d ? `<span class="tDesc">${esc(t.d)}</span>` : ''}</span>
  </button>`;
}

/* the same row while editing: tap the text to rename it, arrows to move it, ✕ to
   drop it. None of that can sit inside taskRow (already a button), so this is
   its own layout. */
function editStepRow(rid, s, num, i, n){
  return `<div class="editRow">
    <button type="button" class="eName" data-editstep="${rid}|${s.id}">
      <span class="tTitle">${num ? num + '. ' : ''}${esc(s.t)}</span>
      ${s.d ? `<span class="tDesc">${esc(s.d)}</span>` : ''}
    </button>
    <span class="mvCol">
      <button type="button" class="mv" data-mvstep="${rid}|${s.id}|-1"${i === 0 ? ' disabled' : ''} aria-label="Move up">↑</button>
      <button type="button" class="mv" data-mvstep="${rid}|${s.id}|1"${i === n - 1 ? ' disabled' : ''} aria-label="Move down">↓</button>
    </span>
    <button type="button" class="del" data-rmstep="${rid}|${s.id}" aria-label="Remove step">✕</button>
  </div>`;
}

/* ---------- editors ---------- */
/* routine === null creates one */
function routineSheet(routine){
  const draft = routine
    ? { title: routine.title, days: [...(routine.days || [])], note: routine.note || '' }
    : { title: '', days: [], note: '' };
  const body = openSheet(routine ? 'Edit routine' : 'New routine', '');

  function draw(msg){
    body.innerHTML = `
      <span class="miniLabel">title</span>
      <input type="text" id="rtTitle" value="${esc(draft.title)}" placeholder="e.g. Evening reset">
      <span class="miniLabel">note (optional)</span>
      <input type="text" id="rtNote" value="${esc(draft.note)}" placeholder="e.g. + jumps">
      <span class="miniLabel">days it shows up</span>
      <div class="quickRow dayChips">${DAY_ABBR.map((d, i) =>
        `<button type="button" class="quickChip dayChip${draft.days.includes(i) ? ' on' : ''}" data-day="${i}">${d}</button>`).join('')}</div>
      <div class="macros" id="rtMsg">${esc(msg || '')}</div>
      <div class="btnRow">
        <button class="cancel" id="rtCancel">cancel</button>
        <button class="save" id="rtSave">save</button>
      </div>`;

    body.querySelector('#rtTitle').addEventListener('input', e => draft.title = e.target.value);
    body.querySelector('#rtNote').addEventListener('input', e => draft.note = e.target.value);
    body.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
      const i = +b.getAttribute('data-day');
      draft.days = draft.days.includes(i) ? draft.days.filter(x => x !== i) : [...draft.days, i].sort();
      draw();
    }));
    body.querySelector('#rtCancel').addEventListener('click', () => { closeSheet(); renderRoutines(); });
    body.querySelector('#rtSave').addEventListener('click', () => {
      if (!draft.title.trim()) return draw('give it a title');
      if (!draft.days.length) return draw('pick at least one day');
      const patch = { title: draft.title.trim(), days: draft.days, note: draft.note.trim() };
      if (routine) updateRoutine(routine.id, patch);
      else { const r = addRoutine(patch); view.secOpen[r.id] = true; }
      closeSheet();
      renderRoutines();
    });
  }
  draw();
}

/* step === null adds one to the routine */
function stepSheet(routineId, step){
  const draft = step ? { t: step.t, d: step.d || '' } : { t: '', d: '' };
  const body = openSheet(step ? 'Edit step' : 'New step', '');

  function draw(msg){
    body.innerHTML = `
      <span class="miniLabel">step</span>
      <input type="text" id="stTitle" value="${esc(draft.t)}" placeholder="e.g. Wipe the counters">
      <span class="miniLabel">detail (optional)</span>
      <input type="text" id="stDesc" value="${esc(draft.d)}" placeholder="shown under the step">
      <div class="macros" id="stMsg">${esc(msg || '')}</div>
      <div class="btnRow">
        <button class="cancel" id="stCancel">cancel</button>
        <button class="save" id="stSave">save</button>
      </div>`;

    body.querySelector('#stTitle').addEventListener('input', e => draft.t = e.target.value);
    body.querySelector('#stDesc').addEventListener('input', e => draft.d = e.target.value);
    body.querySelector('#stCancel').addEventListener('click', () => { closeSheet(); renderRoutines(); });
    body.querySelector('#stSave').addEventListener('click', () => {
      if (!draft.t.trim()) return draw('give the step a name');
      const patch = { t: draft.t.trim(), d: draft.d.trim() };
      if (step) updateStep(routineId, step.id, patch);
      else addStep(routineId, patch);
      closeSheet();
      renderRoutines();
    });
  }
  draw();
}

/* push everything checked-but-not-yet-applied into the pantry. Delta-based
   against the 'applied' ledger, so re-checking an item adds nothing and an
   offline run simply catches up later. */
async function drainOwed(dk){
  const owed = owedFor(dk, ing => isChecked(dk, `sh:${ing}`));
  if (!owed.length) return;
  let wrote = false;
  for (const o of owed){
    try {
      await addToPantry(o.ingredient_id, o.delta);
      markApplied(dk, o.ingredient_id, o.need);
      wrote = true;
      shopMsg = null;
    } catch {
      shopMsg = 'offline — pantry updates will apply when you reconnect';
      break;
    }
  }
  if (!wrote && !shopMsg) return;
  const y = window.scrollY;            // addToPantry re-renders through S.onChange
  renderRoutines();
  window.scrollTo(0, y);
}

function historyRow(label, habit){
  const cells = lastDates(14).map(d => {
    const dk = dateKey(d), st = habitStatus(dk, habit);
    return `<button type="button" class="hCell ${st}${isToday(d) ? ' today' : ''}" data-goto="${dk}"
      title="${dk}${st === 'off' ? '' : ' · ' + st}"></button>`;
  }).join('');
  return `<div class="habitRow h-${habit}"><span class="hLabel">${esc(label)}</span><div class="hDots">${cells}</div></div>`;
}

export function renderRoutines(){
  routinesLog.reconcile();
  planReconcile();
  routinePlanReconcile();
  buildCalByDate();
  const root = document.getElementById('routinesRoot');
  const dk = dateKey(view.date);
  const sections = sectionsFor(view.date);
  const allIds = sections.filter(s => s.countInProgress !== false)
    .flatMap(s => s.groups.flatMap(g => g.tasks.map(t => t.id)));
  const done = allIds.filter(id => isChecked(dk, id)).length;
  const today = isToday(view.date);

  /* date nav */
  let html = `<div class="datenav">
    <button data-nav="prev" aria-label="Previous day">←</button>
    <div class="dateLabel"><span>${esc(dayName(view.date))}</span>
      <span class="dateSub">${view.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${today ? ' · today' : ''}</span>
      ${today ? '' : '<button type="button" class="todayBtn show" data-nav="today">↩ today</button>'}</div>
    <button data-nav="next" aria-label="Next day">→</button>
  </div>`;

  html += `<div class="dayProg">${done} / ${allIds.length} done</div>
    <div class="quickRow rEditRow">
      <button type="button" class="quickChip${view.editing ? ' on' : ''}" id="rEdit">${
        view.editing ? '✓ done editing' : '✎ edit routines'}</button>
    </div>`;

  /* the single list, in sections. A section collapses on its own once every box
     in it is checked, and stays however the user last left it after that —
     except while editing, where a hidden section is a section you can't fix. */
  const openState = new Map();         // section key → open, for the click handler
  const sectionOf = new Map();         // task id → section key
  const routineSecs = sections.filter(s => s.routine);   // Shopping is generated, not a routine
  sections.forEach(sec => {
    const hue = sec.hue ? ` sec-${sec.hue}` : '';
    const ids = sec.groups.flatMap(g => g.tasks.map(t => t.id));
    ids.forEach(id => sectionOf.set(id, sec.key));
    const secDone = ids.filter(id => isChecked(dk, id)).length;
    const open = view.editing || (view.secOpen[sec.key] ?? !(ids.length && secDone === ids.length));
    openState.set(sec.key, open);
    const r = sec.routine;             // absent on Shopping, which is generated

    let body = '';
    if (sec.tips){
      body += `<details class="card rTips" id="cleanTips"${view.tipsOpen ? ' open' : ''}>
        <summary class="rTipsHead">How this order saves steps</summary>${
        sec.tips.map(t => `<div class="rTip">${esc(t)}</div>`).join('')}</details>`;
    }
    if (view.editing && r){
      const steps = r.steps || [];
      const ri = routineSecs.indexOf(sec);
      body += `<div class="card taskList${hue}">${
        steps.map((s, i) => editStepRow(r.id, s, r.numbered ? i + 1 : 0, i, steps.length)).join('')
        || '<div class="cSub">no steps yet</div>'}
        <div class="quickRow">
          <button class="quickChip" data-addstep="${r.id}">＋ step</button>
          <button class="quickChip" data-editroutine="${r.id}">✎ title &amp; days</button>
          <button class="quickChip" data-mvroutine="${r.id}|-1"${ri === 0 ? ' disabled' : ''}>↑ up</button>
          <button class="quickChip" data-mvroutine="${r.id}|1"${ri === routineSecs.length - 1 ? ' disabled' : ''}>↓ down</button>
          <button class="quickChip" data-rmroutine="${r.id}">✕ delete routine</button>
        </div></div>`;
    } else {
      body += `<div class="card taskList${hue}">${sec.groups.map(g =>
        (g.sub ? `<div class="rSub">${esc(g.sub)}</div>` : '') +
        g.tasks.map(t => taskRow(dk, t)).join('')
      ).join('')}${sec.foot ?? ''}</div>`;
    }

    html += collapsibleSection(sec.key, sec.title, open, body,
      { hue: sec.hue, note: view.editing && r ? dayLabel(r.days) : sec.note,
        count: open || !ids.length ? '' : `${secDone} / ${ids.length}` });
  });

  /* routines that don't land on this day are invisible here, so editing needs a
     way in to all of them */
  if (view.editing){
    const offToday = allRoutines().filter(r => !(r.days || []).includes(view.date.getDay()));
    html += `<div class="card rEditCard">
      <button class="addBtn" id="rNew">＋ new routine</button>
      ${offToday.length ? `<div class="cSub" style="margin-top:10px;">not on ${esc(dayName(view.date))}s — tap to edit</div>
      <div class="quickRow">${offToday.map(r =>
        `<button class="quickChip" data-editroutine="${r.id}">${esc(r.title)}<span class="chipDays"> ${esc(dayLabel(r.days))}</span></button>`).join('')}</div>` : ''}
    </div>`;
  }

  /* steps for the day shown — typed in, since nothing counts them for us */
  const T = targets();
  const steps = stepsFor(dk);
  const stepsOpen = view.secOpen.steps ?? true;
  openState.set('steps', stepsOpen);
  html += collapsibleSection('steps', 'Steps', stepsOpen, `<div class="card stepsCard">
      <input type="number" id="stepsIn" inputmode="numeric" min="0" step="100" placeholder="steps" value="${steps || ''}">
      <span class="stepsNote">${steps
        ? (steps >= T.stepsGoal ? '✓ goal met' : `${(T.stepsGoal - steps).toLocaleString()} to go`)
        : 'not recorded'}</span>
    </div>`, { hue: 'steps', note: `goal ${T.stepsGoal.toLocaleString()}` });

  /* habit tracker */
  const habitsOpen = view.secOpen.habits ?? true;
  openState.set('habits', habitsOpen);
  html += collapsibleSection('habits', 'Habit tracker', habitsOpen, `<div class="card">
      ${historyRow('Supplements', 'vitamins')}
      ${historyRow('Devotions', 'devotions')}
      ${historyRow('Practice', 'practice')}
      ${historyRow('Calories', 'calories')}
      ${historyRow('Steps', 'steps')}
      ${historyRow('Workout', 'workout')}
      ${historyRow('Cleaning', 'cleaning')}
      <div class="hLegend"><span class="hCell done"></span> done <span class="hCell miss"></span> missed <span class="hCell off"></span> not scheduled / no data — tap a day to open it</div>
      <div class="cSub">Calories counts a day done when the Log total is at or under ${T.calMax.toLocaleString()} — in range or under. Steps counts a day done at ${T.stepsGoal.toLocaleString()} or more. Days skipped in the Log's averages don't count either way. Both goals live in Settings → Daily targets.</div>
    </div>`, { note: 'last 14 days' });

  /* weekly overview */
  const weekOpen = view.secOpen.week ?? true;
  openState.set('week', weekOpen);
  html += collapsibleSection('week', 'This week', weekOpen, WEEK_ORDER.map((nm, dow) => {
    const items = routinesForDow(dow).map(r =>
      r.note ? `${r.title} ${r.note.startsWith('+') ? r.note : '(' + r.note + ')'}` : r.title);
    if (!items.length) items.push('Rest');
    const isCur = nm === dayName(view.date);
    return `<div class="card dayCard${isCur ? ' isToday' : ''}">
      <div class="dName">${esc(nm)}${isCur ? '<span class="todayTag">viewing</span>' : ''}</div>
      <div class="dItems">${items.map(i => `<div class="dItem">${esc(i)}</div>`).join('')}</div></div>`;
  }).join(''));

  root.innerHTML = html;

  /* wiring */
  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const n = b.getAttribute('data-nav');
    if (n === 'today') view.date = startOfDay(new Date());
    else { const d = new Date(view.date); d.setDate(d.getDate() + (n === 'next' ? 1 : -1)); view.date = d; }
    view.secOpen = {};                 // another day, its own defaults
    renderRoutines();
    window.scrollTo(0, 0);
  }));
  root.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY;
    const k = b.getAttribute('data-sec');
    view.secOpen[k] = !openState.get(k);
    renderRoutines();
    window.scrollTo(0, y);
  }));

  /* ---------- editing ---------- */
  root.querySelector('#rEdit').addEventListener('click', () => {
    const y = window.scrollY;
    view.editing = !view.editing;
    if (!view.editing) view.secOpen = {};    // let completed sections fold away again
    renderRoutines();
    window.scrollTo(0, y);
  });
  root.querySelector('#rNew')?.addEventListener('click', () => routineSheet(null));
  root.querySelectorAll('[data-editroutine]').forEach(b => b.addEventListener('click', () =>
    routineSheet(routineById(b.getAttribute('data-editroutine')))));
  root.querySelectorAll('[data-rmroutine]').forEach(b => b.addEventListener('click', async () => {
    const r = routineById(b.getAttribute('data-rmroutine'));
    if (!r || !(await confirmDialog(`Delete the "${r.title}" routine and all of its steps?`))) return;
    deleteRoutine(r.id);
    renderRoutines();
  }));
  root.querySelectorAll('[data-mvroutine]').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY;
    const [id, dir] = b.getAttribute('data-mvroutine').split('|');
    moveRoutine(id, +dir, view.date.getDay());
    renderRoutines();
    window.scrollTo(0, y);
  }));
  root.querySelectorAll('[data-mvstep]').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY;
    const [rid, sid, dir] = b.getAttribute('data-mvstep').split('|');
    moveStep(rid, sid, +dir);
    renderRoutines();
    window.scrollTo(0, y);
  }));
  root.querySelectorAll('[data-addstep]').forEach(b => b.addEventListener('click', () =>
    stepSheet(b.getAttribute('data-addstep'), null)));
  root.querySelectorAll('[data-editstep]').forEach(b => b.addEventListener('click', () => {
    const [rid, sid] = b.getAttribute('data-editstep').split('|');
    const step = (routineById(rid)?.steps || []).find(s => s.id === sid);
    if (step) stepSheet(rid, step);
  }));
  root.querySelectorAll('[data-rmstep]').forEach(b => b.addEventListener('click', async () => {
    const [rid, sid] = b.getAttribute('data-rmstep').split('|');
    const step = (routineById(rid)?.steps || []).find(s => s.id === sid);
    if (!step || !(await confirmDialog(`Remove "${step.t}" from this routine?`))) return;
    deleteStep(rid, sid);
    renderRoutines();
  }));
  root.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY;
    const id = b.getAttribute('data-check'), wasChecked = isChecked(dk, id);
    /* checking the last box in a section should collapse it, so drop whatever
       the user had pinned open or closed and let the default take over again */
    delete view.secOpen[sectionOf.get(id)];
    toggle(dk, id);
    renderRoutines();
    window.scrollTo(0, y);
    /* just added to the cart → put it in the pantry (unchecking never removes) */
    if (id.startsWith('sh:') && !wasChecked) drainOwed(dk);
  }));
  root.querySelectorAll('[data-rmrec]').forEach(b => b.addEventListener('click', async () => {
    const [slot, rid] = b.getAttribute('data-rmrec').split(':');
    if (!(await confirmDialog(`Remove "${b.getAttribute('data-rname')}" from this day?`))) return;
    removeRecipe(dk, slot, +rid);
    renderRoutines();
  }));
  const stepsIn = root.querySelector('#stepsIn');
  stepsIn.addEventListener('change', () => {
    const y = window.scrollY;
    setSteps(dk, Math.max(0, Math.round(parseFloat(stepsIn.value) || 0)));
    renderRoutines();
    window.scrollTo(0, y);
  });
  const tips = root.querySelector('#cleanTips');
  if (tips) tips.addEventListener('toggle', () => { view.tipsOpen = tips.open; });
  root.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    view.date = startOfDay(new Date(b.getAttribute('data-goto') + 'T00:00:00'));
    view.secOpen = {};
    renderRoutines();
    window.scrollTo(0, 0);
  }));
}
