/* Routines tab: opens on today's combined to-do list (daily items, workout,
   cleaning), tracks completion per date as a habit history, and shows a weekly
   overview. All state is device-local under 'routines.log'. */
import { esc, dateKey, isToday, startOfDay } from './common.js';

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
  { id: 'c1',  t: 'Strip the beds & start laundry',  d: 'Sheets and towels in the first load. Keep loads moving all afternoon.' },
  { id: 'c2',  t: 'Spray & let it soak',             d: 'Shower, tub, toilet bowl, and the kitchen stovetop/sink. Walk away 5–10 min.' },
  { id: 'c3',  t: 'Kitchen',                          d: 'Top down: backsplash → counters, stovetop, sink → appliance fronts. Run the dishwasher. Leave the floor.' },
  { id: 'c4',  t: 'Bathrooms & showers',             d: 'Top down: mirror → sink & counter → scrub the soaking shower/tub → toilet. Leave the floor.' },
  { id: 'c5',  t: 'The window',                       d: 'Glass and sill now, before vacuuming — any drips land on the floor you clean next.' },
  { id: 'c6',  t: 'Dust & tidy',                      d: 'Every room, high to low. Put clutter away. Rotate the laundry.' },
  { id: 'c7',  t: 'Remake the bed',                   d: 'Fresh sheets from the wash or a clean set.' },
  { id: 'c8',  t: 'Vacuum',                           d: 'Every room, working from the far room back toward the door.' },
  { id: 'c9',  t: 'Mop',                              d: 'Hard floors last, backing out of each room so you never walk on wet floor.' },
  { id: 'c10', t: 'Finish laundry',                   d: 'Fold and put away the last loads.' },
];
const WEEK_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = d => d.toLocaleDateString('en-US', { weekday: 'long' });

/* ---------- per-date completion log (device-local, no weekly reset) ---------- */
const LOG_KEY = 'routines.log';
function loadLog(){ try { return JSON.parse(localStorage.getItem(LOG_KEY)) || {}; } catch { return {}; } }
function saveLog(l){ try { localStorage.setItem(LOG_KEY, JSON.stringify(l)); } catch { /* private mode */ } }
let log = loadLog();
const isChecked = (dk, id) => !!(log[dk] && log[dk][id]);
function toggle(dk, id){
  log = loadLog();
  if (!log[dk]) log[dk] = {};
  if (log[dk][id]) delete log[dk][id]; else log[dk][id] = true;
  if (!Object.keys(log[dk]).length) delete log[dk];
  saveLog(log);
}

/* ---------- the list for a given day ---------- */
function sectionsFor(date){
  const name = dayName(date), dow = date.getDay(), secs = [];

  const daily = [{ id: 'vit', t: 'Daily vitamins' }];
  if (dow === 4) daily.push({ id: 'gas', t: '⛽ Gas in the car' });
  if (dow === 5) daily.push({ id: 'cook', t: '🍳 Cook the week’s meals' });
  secs.push({ title: 'Daily', groups: [{ tasks: daily }] });

  const w = WORKOUT[name];
  if (w){
    const groups = [{ sub: 'Warm-up', tasks: WARMUP.map((t, i) => ({ id: `warm${i}`, t })) }];
    if (w.primer.length) groups.push({ sub: 'Jump primer', tasks: w.primer.map((t, i) => ({ id: `primer${i}`, t })) });
    groups.push({ sub: 'Lifts', tasks: w.lifts.map((t, i) => ({ id: `lift${i}`, t })) });
    secs.push({ title: `Workout — ${w.focus}`, note: w.note, groups });
  }

  if (dow === 5){
    secs.push({ title: 'Cleaning — in order', tips: CLEAN_TIPS,
      groups: [{ tasks: CLEAN_STEPS.map((s, i) => ({ id: s.id, t: `${i + 1}. ${s.t}`, d: s.d })) }] });
  }
  return secs;
}

/* ---------- habit history ---------- */
/* returns 'done' | 'miss' | 'off' for a habit on a date */
function habitStatus(dk, habit){
  const d = startOfDay(new Date(dk + 'T00:00:00'));
  const name = dayName(d);
  let ids = [];
  if (habit === 'vitamins') ids = ['vit'];
  else if (habit === 'workout'){ const w = WORKOUT[name]; if (!w) return 'off'; ids = w.lifts.map((_, i) => `lift${i}`); }
  else if (habit === 'cleaning'){ if (name !== 'Friday') return 'off'; ids = CLEAN_STEPS.map(s => s.id); }
  if (!ids.length) return 'off';
  return ids.every(id => isChecked(dk, id)) ? 'done' : 'miss';
}
function vitStreak(){
  const d = startOfDay(new Date());
  if (!isChecked(dateKey(d), 'vit')) d.setDate(d.getDate() - 1); // don't break streak just because today isn't done yet
  let n = 0;
  while (isChecked(dateKey(d), 'vit')){ n++; d.setDate(d.getDate() - 1); }
  return n;
}
function lastDates(n){
  const out = [], base = startOfDay(new Date());
  for (let i = n - 1; i >= 0; i--){ const x = new Date(base); x.setDate(x.getDate() - i); out.push(x); }
  return out;
}

/* ---------- view ---------- */
const view = { date: startOfDay(new Date()) };
export function routinesFocusToday(){ view.date = startOfDay(new Date()); }

function taskRow(dk, id, title, desc){
  return `<button type="button" class="taskRow${isChecked(dk, id) ? ' done' : ''}" data-check="${id}">
    <span class="box"></span>
    <span class="tText"><span class="tTitle">${esc(title)}</span>${desc ? `<span class="tDesc">${esc(desc)}</span>` : ''}</span>
  </button>`;
}

function historyRow(label, habit, streak){
  const cells = lastDates(14).map(d => {
    const dk = dateKey(d), st = habitStatus(dk, habit);
    return `<button type="button" class="hCell ${st}${isToday(d) ? ' today' : ''}" data-goto="${dk}"
      title="${dk}${st === 'off' ? '' : ' · ' + st}"></button>`;
  }).join('');
  return `<div class="habitRow"><div class="hMeta"><span class="hLabel">${esc(label)}</span>${
    streak != null ? `<span class="hStreak">🔥 ${streak}</span>` : ''}</div><div class="hDots">${cells}</div></div>`;
}

export function renderRoutines(){
  log = loadLog();
  const root = document.getElementById('routinesRoot');
  const dk = dateKey(view.date);
  const sections = sectionsFor(view.date);
  const allIds = sections.flatMap(s => s.groups.flatMap(g => g.tasks.map(t => t.id)));
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
    html += `<div class="sectionTitle">${esc(sec.title)}${sec.note ? `<span class="rNote">${esc(sec.note)}</span>` : ''}</div>`;
    if (sec.tips){
      html += `<div class="card rTips"><div class="rTipsHead">How this order saves steps</div>${
        sec.tips.map(t => `<div class="rTip">${esc(t)}</div>`).join('')}</div>`;
    }
    html += `<div class="card taskList">${sec.groups.map(g =>
      (g.sub ? `<div class="rSub">${esc(g.sub)}</div>` : '') +
      g.tasks.map(t => taskRow(dk, t.id, t.t, t.d)).join('')
    ).join('')}</div>`;
  });

  /* habit tracker */
  html += `<div class="sectionTitle">Habit tracker<span class="rNote">last 14 days</span></div>
    <div class="card">
      ${historyRow('Vitamins', 'vitamins', vitStreak())}
      ${historyRow('Workout', 'workout', null)}
      ${historyRow('Cleaning', 'cleaning', null)}
      <div class="hLegend"><span class="hCell done"></span> done <span class="hCell miss"></span> missed <span class="hCell off"></span> not scheduled — tap a day to open it</div>
    </div>`;

  /* weekly overview */
  html += `<div class="sectionTitle">This week</div>` + WEEK_ORDER.map(nm => {
    const w = WORKOUT[nm], items = [];
    if (nm === 'Thursday') items.push('⛽ Gas in the car');
    if (nm === 'Friday') items.push('🍳 Cook the week’s meals', '🧹 Clean the house');
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
    toggle(dk, b.getAttribute('data-check'));
    renderRoutines();
    window.scrollTo(0, y);
  }));
  root.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
    view.date = startOfDay(new Date(b.getAttribute('data-goto') + 'T00:00:00'));
    renderRoutines();
    window.scrollTo(0, 0);
  }));
}
