/* Routines tab: opens on today's combined to-do list (daily items, workout,
   cleaning), tracks completion per date as a habit history, and shows a weekly
   overview. All state is device-local under 'routines.log'. */
import { esc, dateKey, isToday, startOfDay, recipeById, targets, allFoodEntries } from './common.js';
import { cached, refresh } from '../store.js';
import { createSyncedBlob } from '../syncblob.js';
import { confirmDialog } from './pickers.js';
import { addToPantry } from './pantry.js';
import { skippedDates } from './log.js';
import { entriesFor, removeRecipe, shoppingFor, owedFor, markApplied, prunePlan,
         planReconcile, planChangedRemotely, planPush, planIsDirty } from './cookplan.js';

/* ---------- content ---------- */
const WARMUP = [
  'Raise (2–3 min): brisk walk / bike / march into high knees — light sweat, not tired.',
  'Dynamic (2–3 min): leg swings (front-back & side-side), walking lunge + reach, deep bodyweight squats, ankle circles + calf rocks.',
  'Activate (1–2 min): 2–3 Bird Dogs or Dead Bugs (exhale, lift pelvic floor) + banded Clamshells or Lateral Walks.',
  'Ramp to jumps (1 min): ankle pogo bounces, then 3–4 low submaximal jumps before working sets.',
];
const WORKOUT = {
  Sunday: { focus: 'Upper + Core', note: 'no jumps — recovery day', primer: [], lifts: [
    'Arnold Press – 3×10',
    'Push-Ups (knee or full) – 3×10',
    'Renegade Rows – 3×10',
    'Plank Shoulder Taps – 3×20 (keep breathing)',
    'Core: Farmer Carry – 3×40 steps',
    'Core: Bird Dog or Bear Hold – 3×20–30 sec',
    'Core: Russian Twists – light/bodyweight (or swap for extra Pallof Press)',
  ]},
  Monday: { focus: 'Lower — Glutes & Legs', note: '+ jumps', primer: [
    'Box Jumps 4×3 (step down)',
    'Skater Bounds 3×6 each side',
  ], lifts: [
    'Goblet Squats – 3×12',
    'DB Romanian Deadlifts – 3×12 (or Kettlebell Swings 3×12)',
    'Step-Ups or Reverse Lunges – 3×10 each leg',
    'Glute Bridges or Hip Thrusts – 3×15',
    'Standing Calf Raises – 3×20',
    'Core: Bird Dog – 3×8 each side (slow, exhale on extend)',
    'Core: Suitcase Carry – 3×30–40 steps each side',
  ]},
  Wednesday: { focus: 'Upper — Arms, Shoulders, Back', note: '+ jumps', primer: [
    'Pogo Hops 3×10',
    'Broad Jumps 4×3 (stick landing)',
    'Squat Jumps 3×5',
  ], lifts: [
    'Bent-over Rows – 3×12',
    'Overhead Press – 3×10',
    'Chest Press – 3×12',
    'Dumbbell Bicep Curls – 3×15',
    'Tricep Kickbacks or Overhead Extensions – 3×12',
    '(Optional) Lateral Raises – 2×15',
    'Core: Pallof Press (band) – 3×10 each side',
    'Core: Dead Bug – 3×8 each side (exhale on the reach)',
  ]},
  Friday: { focus: 'Lower — Legs & Core', note: '+ jumps', primer: [
    'Box Jumps 4×3',
    'Lateral Skater Bounds 3×6 each side',
    'Tuck Jumps 3×4 (if landings solid)',
  ], lifts: [
    'Bulgarian Split Squats – 3×10 each leg',
    'Dumbbell Sumo Squats – 3×12',
    'Hip Thrusts or Glute Bridges – 3×15',
    'Side-Lying Leg Raises – 3×12 each side',
    'Core: Heel Slides or Dead Bug – 3×10 (breath-led)',
    'Core: Side Plank – 3×20–30 sec each side (progress to feet-elevated once 30 sec is clean)',
  ]},
};
const CLEAN_TIPS = [
  'Laundry first — it’s the longest hands-off task, so it runs while you clean.',
  'Spray, then walk away — give cleaners 5–10 min before you scrub.',
  'Top to bottom — dust and wipe high before you touch the floors.',
  'Floors last, backing out — vacuum then mop, working toward the door.',
];
const CLEAN_STEPS = [
  { id: 'c1',    t: 'Strip the beds & start laundry',  d: 'Sheets and towels in the first load. Keep loads moving all afternoon.' },
  { id: 'cook',  t: '🍳 Cook for Sabbath',             d: 'Start the Sabbath meals early so they cook while you clean.' },
  { id: 'c3',    t: 'Kitchen',                          d: 'Top down: backsplash → counters, stovetop, sink → appliance fronts. Run the dishwasher. Leave the floor.' },
  { id: 'c4',    t: 'Bathrooms & showers',             d: 'Top down: mirror → sink & counter → scrub the shower/tub → toilet. Leave the floor.' },
  { id: 'trash', t: 'Take out trash and compost',      d: 'Empty the kitchen and bathroom bins; take the trash and compost out.' },
  { id: 'c5',    t: 'The window',                       d: 'Glass and sill now, before vacuuming — any drips land on the floor you clean next.' },
  { id: 'c6',    t: 'Dust & tidy',                      d: 'Every room, high to low. Put clutter away. Rotate the laundry.' },
  { id: 'c7',    t: 'Remake the bed',                   d: 'Fresh sheets from the wash or a clean set.' },
  { id: 'c8',    t: 'Vacuum',                           d: 'Every room, working from the far room back toward the door.' },
  { id: 'c9',    t: 'Mop',                              d: 'Hard floors last, backing out of each room so you never walk on wet floor.' },
  { id: 'c10',   t: 'Finish laundry',                   d: 'Fold and put away the last loads.' },
];
const WEEK_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = d => d.toLocaleDateString('en-US', { weekday: 'long' });

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
    await refresh('user_preferences');
    routinesLog.reconcile();
    planReconcile();
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
  /* offline, or we hold unsynced local edits in either blob */
  if (!navigator.onLine || routinesLog.isDirty() || planIsDirty()) return;
  try { await refresh('user_preferences'); } catch { return; }
  if (!routinesLog.changedRemotely() && !planChangedRemotely()) return;  // nothing new
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
  const name = dayName(date), dow = date.getDay(), secs = [];

  const daily = [{ id: 'dev', t: 'Devotions' }, { id: 'vit', t: 'Take Supplements' }];
  if (dow === 4) daily.push({ id: 'gas', t: '⛽ Gas in the car' });
  secs.push({ title: 'Daily', hue: 'vitamins', groups: [{ tasks: daily }] });

  secs.push({ title: 'Practice', hue: 'practice', groups: [{ tasks: [
    { id: 'scales', t: 'Scales' },
    { id: 'repertoire', t: 'Repertoire' },
  ] }] });

  const w = WORKOUT[name];
  if (w){
    const tasks = [{ id: 'warmup', t: 'Warm-up', d: 'Raise → dynamic → activate → ramp to jumps (6–8 min).' }];
    if (w.primer.length) tasks.push({ id: 'jumps', t: 'Jumps', d: w.primer.join(' · ') });
    tasks.push({ id: 'lifts', t: 'Lifts', d: w.lifts.join(' · ') });
    secs.push({ title: `Workout — ${w.focus}`, note: w.note, hue: 'workout', groups: [{ tasks }] });
  }

  const dk = dateKey(date);

  if (dow === 1){
    secs.push({ title: 'Meal prep — cook, portion & freeze', groups: [{ tasks: [
      { id: 'mp-rice', t: 'Rice' },
      { id: 'mp-soup', t: 'Soup or entrée' },
      { id: 'mp-chia', t: 'Chia pudding' },
      { id: 'mp-salad', t: 'Salad' },
      { id: 'mp-snacks', t: 'Snacks' },
      ...recipeRows(dk, 'prep'),
    ] }], foot: removeChips(dk, 'prep') });
  }

  if (dow === 5){
    /* assigned recipes hang off the "Cook for Sabbath" step, wherever it sits */
    const cookRows = recipeRows(dk, 'cook');
    const tasks = CLEAN_STEPS.flatMap((s, i) => {
      const row = { id: s.id, t: `${i + 1}. ${s.t}`, d: s.d };
      return s.id === 'cook' ? [row, ...cookRows] : [row];
    });
    secs.push({ title: 'Cleaning — in order', tips: CLEAN_TIPS, hue: 'cleaning',
      groups: [{ tasks }], foot: removeChips(dk, 'cook') });
  }

  const shopping = shoppingFor(dk);
  if (shopping.length){
    const covered = shopping.filter(x => x.covered).length;
    secs.push({
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
  const name = dayName(d);

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

  let ids = [];
  if (habit === 'vitamins') ids = ['vit'];
  else if (habit === 'devotions') ids = ['dev'];
  else if (habit === 'practice') ids = ['scales', 'repertoire'];
  else if (habit === 'workout'){ const w = WORKOUT[name]; if (!w) return 'off'; ids = w.primer.length ? ['warmup', 'jumps', 'lifts'] : ['warmup', 'lifts']; }
  else if (habit === 'cleaning'){ if (name !== 'Friday') return 'off'; ids = CLEAN_STEPS.map(s => s.id); }
  if (!ids.length) return 'off';
  /* per-habit bar: workout/practice count on any one piece, cleaning at 75%
     of steps, everything else needs all items */
  const checked = ids.filter(id => isChecked(dk, id)).length;
  const complete = (habit === 'workout' || habit === 'practice') ? checked > 0
    : habit === 'cleaning' ? checked >= Math.ceil(ids.length * 0.75)
    : checked === ids.length;
  return complete ? 'done' : 'miss';
}
function lastDates(n){
  const out = [], base = startOfDay(new Date());
  for (let i = n - 1; i >= 0; i--){ const x = new Date(base); x.setDate(x.getDate() - i); out.push(x); }
  return out;
}

/* ---------- view ---------- */
const view = { date: startOfDay(new Date()), tipsOpen: false };
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

  html += `<div class="dayProg">${done} / ${allIds.length} done</div>`;

  /* the single list, in sections */
  sections.forEach(sec => {
    const hue = sec.hue ? ` sec-${sec.hue}` : '';
    html += `<div class="sectionTitle${hue}">${esc(sec.title)}${sec.note ? `<span class="rNote">${esc(sec.note)}</span>` : ''}</div>`;
    if (sec.tips){
      html += `<details class="card rTips" id="cleanTips"${view.tipsOpen ? ' open' : ''}>
        <summary class="rTipsHead">How this order saves steps</summary>${
        sec.tips.map(t => `<div class="rTip">${esc(t)}</div>`).join('')}</details>`;
    }
    html += `<div class="card taskList${hue}">${sec.groups.map(g =>
      (g.sub ? `<div class="rSub">${esc(g.sub)}</div>` : '') +
      g.tasks.map(t => taskRow(dk, t)).join('')
    ).join('')}${sec.foot ?? ''}</div>`;
  });

  /* steps for the day shown — typed in, since nothing counts them for us */
  const T = targets();
  const steps = stepsFor(dk);
  html += `<div class="sectionTitle sec-steps">Steps<span class="rNote">goal ${T.stepsGoal.toLocaleString()}</span></div>
    <div class="card stepsCard">
      <input type="number" id="stepsIn" inputmode="numeric" min="0" step="100" placeholder="steps" value="${steps || ''}">
      <span class="stepsNote">${steps
        ? (steps >= T.stepsGoal ? '✓ goal met' : `${(T.stepsGoal - steps).toLocaleString()} to go`)
        : 'not recorded'}</span>
    </div>`;

  /* habit tracker */
  html += `<div class="sectionTitle">Habit tracker<span class="rNote">last 14 days</span></div>
    <div class="card">
      ${historyRow('Supplements', 'vitamins')}
      ${historyRow('Devotions', 'devotions')}
      ${historyRow('Practice', 'practice')}
      ${historyRow('Calories', 'calories')}
      ${historyRow('Steps', 'steps')}
      ${historyRow('Workout', 'workout')}
      ${historyRow('Cleaning', 'cleaning')}
      <div class="hLegend"><span class="hCell done"></span> done <span class="hCell miss"></span> missed <span class="hCell off"></span> not scheduled / no data — tap a day to open it</div>
      <div class="cSub">Calories counts a day done when the Log total is at or under ${T.calMax.toLocaleString()} — in range or under. Steps counts a day done at ${T.stepsGoal.toLocaleString()} or more. Days skipped in the Log's averages don't count either way. Both goals live in Settings → Daily targets.</div>
    </div>`;

  /* weekly overview */
  html += `<div class="sectionTitle">This week</div>` + WEEK_ORDER.map(nm => {
    const w = WORKOUT[nm], items = [];
    if (nm === 'Monday') items.push('🍱 Meal prep — cook, portion & freeze');
    if (nm === 'Thursday') items.push('⛽ Gas in the car');
    if (nm === 'Friday') items.push('🍳 Cook for Sabbath', '🧹 Clean the house');
    if (w) items.push(`Workout — ${w.focus} ${w.note.startsWith('+') ? w.note : '(' + w.note + ')'}`);
    if (!items.length) items.push('Rest');
    const isCur = nm === dayName(view.date);
    return `<div class="card dayCard${isCur ? ' isToday' : ''}">
      <div class="dName">${esc(nm)}${isCur ? '<span class="todayTag">viewing</span>' : ''}</div>
      <div class="dItems">${items.map(i => `<div class="dItem">${esc(i)}</div>`).join('')}</div></div>`;
  }).join('');

  root.innerHTML = html;

  /* wiring */
  root.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
    const n = b.getAttribute('data-nav');
    if (n === 'today') view.date = startOfDay(new Date());
    else { const d = new Date(view.date); d.setDate(d.getDate() + (n === 'next' ? 1 : -1)); view.date = d; }
    renderRoutines();
    window.scrollTo(0, 0);
  }));
  root.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY;
    const id = b.getAttribute('data-check'), wasChecked = isChecked(dk, id);
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
    renderRoutines();
    window.scrollTo(0, 0);
  }));
}
