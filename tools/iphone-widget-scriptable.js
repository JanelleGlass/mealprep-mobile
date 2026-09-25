// MealPrep — iPhone widget (runs in the Scriptable app).
//
// Reads straight from your Supabase database. iOS doesn't allow web apps to
// provide home-screen widgets, so this script bridges the gap via Scriptable
// (free, App Store). What it shows depends on the widget size you add:
//
//   small   what's left today: calories / protein / fiber / iron
//   medium  calories left + today's to-do list
//   large   calories left + the 14-day habit tracker + today's to-do list
//
// SETUP
// 1. Install "Scriptable" from the App Store.
// 2. In Scriptable: + new script, paste this whole file, name it "MealPrep".
// 3. Fill in the four CONFIG values below (same URL + anon key you pasted
//    into the app's gear menu, same email + password you sign in with).
// 4. Run it once inside Scriptable — you should see the large preview.
// 5. Long-press home screen -> + -> Scriptable -> pick a size -> add,
//    then long-press the widget -> Edit Widget -> Script: MealPrep.
//    Add more than one (say a small and a large) and each draws its own size.
//
// The widget is read-only: tick things off in the app. iOS refreshes widgets
// on its own schedule (roughly every 15-60 min). Tapping the widget opens
// OPEN_URL if set — note that opens Safari, not the home-screen app.

const CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co', // gear menu -> project URL
  ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',
  EMAIL: 'you@example.com',
  PASSWORD: 'your-mealprep-login-password',
  OPEN_URL: '', // optional: URL where you host the app, e.g. 'https://you.github.io/mealprep-mobile/'
};

// Same defaults as the app (js/ui/common.js targets()); overridden by
// user_preferences rows when present.
const DEFAULTS = { LogCalMin: 1700, LogCalMax: 1950, LogProteinMin: 130,
                   LogFiberTarget: 30, LogIronTarget: 18, LogStepsGoal: 8000 };

const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function lastDates(n){
  const out = [], base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--){ const x = new Date(base); x.setDate(x.getDate() - i); out.push(x); }
  return out;
}

// --- auth: cache the session in the iOS Keychain, refresh when stale ------
const KEY = 'mealprep_widget_session';

async function gotrue(path, body){
  const req = new Request(`${CONFIG.SUPABASE_URL}/auth/v1/${path}`);
  req.method = 'POST';
  req.headers = { apikey: CONFIG.ANON_KEY, 'Content-Type': 'application/json' };
  req.body = JSON.stringify(body);
  const res = await req.loadJSON();
  if (!res.access_token) throw new Error(res.error_description || res.msg || 'auth failed');
  return res;
}

async function getToken(){
  let s = null;
  if (Keychain.contains(KEY)){
    try { s = JSON.parse(Keychain.get(KEY)); } catch (e) { s = null; }
  }
  if (s && s.expires_at > Date.now() / 1000 + 60) return s.access_token;
  let res;
  try {
    if (!s || !s.refresh_token) throw new Error('no session');
    res = await gotrue('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
  } catch (e) {
    res = await gotrue('token?grant_type=password', { email: CONFIG.EMAIL, password: CONFIG.PASSWORD });
  }
  Keychain.set(KEY, JSON.stringify({
    access_token: res.access_token,
    refresh_token: res.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (res.expires_in || 3600),
  }));
  return res.access_token;
}

async function rest(token, pathAndQuery){
  const req = new Request(`${CONFIG.SUPABASE_URL}/rest/v1/${pathAndQuery}`);
  req.headers = { apikey: CONFIG.ANON_KEY, Authorization: `Bearer ${token}` };
  return await req.loadJSON();
}

// --- routines: a read-only copy of the app's habit logic -------------------
// Mirrors js/ui/routines.js habitStatus() and js/ui/routineplan.js. Keep the
// two in step if the rules there change.
const HABIT_RULE = { vitamins: 'all', devotions: 'all', practice: 'any',
                     workout: 'any', cleaning: 'most' };
const HABITS = [
  ['Supplements', 'vitamins'], ['Devotions', 'devotions'], ['Practice', 'practice'],
  ['Calories', 'calories'], ['Steps', 'steps'], ['Workout', 'workout'], ['Cleaning', 'cleaning'],
];

// The app's shipped routines, reduced to what the tracker counts (step id +
// habit tag). Only used until the routines have been edited once in the app —
// before that, the plan exists only on the phone and was never synced.
const ALL = [0, 1, 2, 3, 4, 5, 6];
const tag = (habit, ids) => ids.map(id => ({ id, habit }));
const SEED_ROUTINES = [
  { days: ALL, steps: [{ id: 'dev', habit: 'devotions' }, { id: 'vit', habit: 'vitamins' }] },
  { days: ALL, steps: tag('practice', ['scales', 'repertoire']) },
  { days: [0], steps: tag('workout', ['warmup', 'lifts']) },
  { days: [1, 3, 5], steps: tag('workout', ['warmup', 'jumps', 'lifts']) },
  { days: [5], steps: tag('cleaning', ['c1', 'cook', 'c3', 'c4', 'trash', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10']) },
];

function habitTracker(log, routines, calByDate, skip, T){
  const isChecked = (dk, id) => !!(log[dk] && log[dk][id]);
  const stepsForDow = dow => routines.filter(r => (r.days || []).includes(dow)).flatMap(r => r.steps || []);

  function status(dk, dow, habit){
    if (habit === 'calories'){
      if (skip.has(dk)) return 'off';
      const cal = calByDate.get(dk) || 0;
      if (!cal) return 'off';
      return cal <= T.calMax ? 'done' : 'miss';
    }
    if (habit === 'steps'){
      const v = (log[dk] || {}).__steps;
      if (v === undefined) return 'off';
      if (v === true) return 'done';
      return v >= T.stepsGoal ? 'done' : 'miss';
    }
    const ids = stepsForDow(dow).filter(s => s.habit === habit).map(s => s.id);
    if (!ids.length) return 'off';
    const checked = ids.filter(id => isChecked(dk, id)).length;
    const rule = HABIT_RULE[habit] || 'all';
    const complete = rule === 'any' ? checked > 0
      : rule === 'most' ? checked >= Math.ceil(ids.length * 0.75)
      : checked === ids.length;
    return complete ? 'done' : 'miss';
  }

  const days = lastDates(14);
  return {
    letters: days.map(d => 'SMTWTFS'[d.getDay()]),
    rows: HABITS.map(([label, habit]) => ({
      label, habit, cells: days.map(d => status(dateKey(d), d.getDay(), habit)),
    })),
  };
}

// --- data ------------------------------------------------------------------
const parseJSON = s => { try { return JSON.parse(s); } catch (e) { return null; } };

async function loadAll(){
  const token = await getToken();
  const today = dateKey(new Date());
  const since = dateKey(lastDates(14)[0]);
  const [entries, prefs] = await Promise.all([
    rest(token, `food_log_entries?date=gte.${since}&select=date,calories,protein_g,fiber_g,iron_mg`),
    rest(token, 'user_preferences?select=key,value'),
  ]);
  if (!Array.isArray(entries) || !Array.isArray(prefs))
    throw new Error((entries && entries.message) || (prefs && prefs.message) || 'could not load data');

  const raw = k => (prefs.find(p => p.key === k) || {}).value;
  const num = k => { const v = parseFloat(raw(k)); return isNaN(v) ? DEFAULTS[k] : v; };
  const T = { calMin: num('LogCalMin'), calMax: num('LogCalMax'), proteinMin: num('LogProteinMin'),
              fiber: num('LogFiberTarget'), iron: num('LogIronTarget'), stepsGoal: num('LogStepsGoal') };

  const calByDate = new Map();
  const t = { cal: 0, protein: 0, fiber: 0, iron: 0 };
  for (const e of entries){
    const k = (e.date || '').slice(0, 10);
    calByDate.set(k, (calByDate.get(k) || 0) + (+e.calories || 0));
    if (k !== today) continue;
    t.cal += +e.calories || 0; t.protein += +e.protein_g || 0;
    t.fiber += +e.fiber_g || 0; t.iron += +e.iron_mg || 0;
  }

  const log = parseJSON(raw('RoutinesLog')) || {};
  const plan = parseJSON(raw('RoutinePlan'));
  const routines = plan && Array.isArray(plan.routines) ? plan.routines : SEED_ROUTINES;
  const skip = new Set((raw('LogSkipDates') || '').split(',').filter(Boolean));

  const day = log[today] || {};
  const todos = (day.__todo || []).map(x => ({ t: x.t, done: !!day[x.id] }));

  return {
    T, eaten: t.cal,
    rem: { cal: T.calMax - t.cal, protein: T.proteinMin - t.protein,
           fiber: T.fiber - t.fiber, iron: T.iron - t.iron },
    habits: habitTracker(log, routines, calByDate, skip, T),
    todos,
  };
}

// --- widget ----------------------------------------------------------------
// palette echoes the app: paper / ink / per-macro accents
const C = {
  bg: Color.dynamic(new Color('#F8F9F2'), new Color('#1E221C')),
  ink: Color.dynamic(new Color('#232921'), new Color('#E8EAE0')),
  soft: Color.dynamic(new Color('#5B6355'), new Color('#9AA192')),
  rule: Color.dynamic(new Color('#D5D9CB'), new Color('#3A4036')),
  cal: new Color('#8A7B3D'), protein: new Color('#3A4F73'),
  fiber: new Color('#4F7358'), iron: new Color('#A6512F'), gold: new Color('#C9A227'),
};
// habit row accents, as in the app's tracker (app.css .habitRow.h-*)
const HABIT_COLOR = { vitamins: C.gold, devotions: C.soft, practice: C.iron, calories: C.cal,
                      steps: C.protein, workout: C.protein, cleaning: C.fiber };
const HABIT_LABEL = { vitamins: C.cal, practice: C.iron, calories: C.cal, steps: C.protein,
                      workout: C.protein, cleaning: C.fiber };

function text(stack, s, font, color){
  const t = stack.addText(s);
  t.font = font; t.textColor = color;
  return t;
}
function heading(w, s){
  text(w, s, Font.mediumSystemFont(9), C.soft);
}

// small: the original four "left today" numbers
function cell(stack, value, unit, label, color, dp){
  const col = stack.addStack();
  col.layoutVertically();
  const done = value <= 0;
  const v = text(col, done ? '✓' : (dp ? value.toFixed(1) : String(Math.round(value))) + unit,
    Font.semiboldMonospacedSystemFont(15), done ? C.fiber : color);
  v.lineLimit = 1; v.minimumScaleFactor = 0.6;
  text(col, label, Font.systemFont(8), C.soft);
}
function macrosBlock(w, rem){
  const r1 = w.addStack(); r1.spacing = 8;
  cell(r1, rem.cal, '', 'cal', C.cal);
  r1.addSpacer();
  cell(r1, rem.protein, 'g', 'protein', C.protein);
  w.addSpacer(8);
  const r2 = w.addStack(); r2.spacing = 8;
  cell(r2, rem.fiber, 'g', 'fiber', C.fiber, 1);
  r2.addSpacer();
  cell(r2, rem.iron, 'mg', 'iron', C.iron, 1);
}

// medium/large: one calories line — big number left, what's eaten beside it
function caloriesBlock(w, d){
  const row = w.addStack();
  row.centerAlignContent();
  const left = Math.round(d.rem.cal);
  const big = text(row, left > 0 ? left.toLocaleString() : left === 0 ? '0' : `+${(-left).toLocaleString()}`,
    Font.semiboldMonospacedSystemFont(22), left >= 0 ? C.cal : C.iron);
  big.lineLimit = 1;
  row.addSpacer(6);
  const col = row.addStack();
  col.layoutVertically();
  text(col, left >= 0 ? 'cal left' : 'cal over', Font.mediumSystemFont(10), C.ink);
  text(col, `${Math.round(d.eaten).toLocaleString()} eaten · range ${d.T.calMin}–${d.T.calMax}`,
    Font.systemFont(8), C.soft);
  row.addSpacer();
}

function habitsBlock(w, h){
  const SIZE = 10, GAP = 3, LABEL_W = 66;
  heading(w, 'HABITS · LAST 14 DAYS');
  w.addSpacer(4);

  const head = w.addStack();
  head.addSpacer(LABEL_W);
  h.letters.forEach((l, i) => {
    const s = head.addStack();
    s.size = new Size(SIZE, 9);
    s.centerAlignContent();
    text(s, l, Font.systemFont(7), i === h.letters.length - 1 ? C.ink : C.soft);
    if (i < h.letters.length - 1) head.addSpacer(GAP);
  });
  w.addSpacer(2);

  for (const r of h.rows){
    const row = w.addStack();
    row.centerAlignContent();
    const lab = row.addStack();
    lab.size = new Size(LABEL_W, SIZE + 2);
    const t = text(lab, r.label, Font.systemFont(9), HABIT_LABEL[r.habit] || C.ink);
    t.lineLimit = 1;
    lab.addSpacer();
    r.cells.forEach((st, i) => {
      const c = row.addStack();
      c.size = new Size(SIZE, SIZE);
      c.cornerRadius = 2.5;
      c.borderWidth = 1;
      if (st === 'done'){ c.backgroundColor = HABIT_COLOR[r.habit] || C.soft; c.borderColor = HABIT_COLOR[r.habit] || C.soft; }
      else if (st === 'miss') c.borderColor = C.iron;
      else c.borderColor = C.rule;
      if (i < r.cells.length - 1) row.addSpacer(GAP);
    });
    w.addSpacer(3);
  }
}

function todosBlock(w, todos, max){
  const open = todos.filter(x => !x.done), done = todos.filter(x => x.done);
  heading(w, todos.length ? `TO-DO · ${done.length} / ${todos.length} DONE` : 'TO-DO');
  w.addSpacer(4);
  if (!todos.length){
    text(w, 'nothing for today', Font.systemFont(10), C.soft);
    return;
  }
  const shown = open.concat(done).slice(0, max);   // unfinished first
  for (const x of shown){
    const row = w.addStack();
    row.centerAlignContent();
    text(row, x.done ? '☑' : '☐', Font.systemFont(11), x.done ? C.fiber : C.ink);
    row.addSpacer(5);
    const t = text(row, x.t, Font.systemFont(11), x.done ? C.soft : C.ink);
    t.lineLimit = 1;
    row.addSpacer();
    w.addSpacer(2);
  }
  if (todos.length > shown.length)
    text(w, `+ ${todos.length - shown.length} more`, Font.systemFont(9), C.soft);
}

function footer(w){
  w.addSpacer();
  const df = new DateFormatter(); df.useShortTimeStyle();
  text(w, 'as of ' + df.string(new Date()), Font.systemFont(7), C.soft);
}

function buildWidget(family, d, err){
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  if (CONFIG.OPEN_URL) w.url = CONFIG.OPEN_URL;
  w.setPadding(12, 14, 10, 14);

  if (err){
    heading(w, 'MEALPREP');
    w.addSpacer(6);
    const e = text(w, err, Font.systemFont(10), C.iron);
    e.minimumScaleFactor = 0.6;
    return w;
  }

  if (family === 'small'){
    heading(w, 'LEFT TODAY');
    w.addSpacer(6);
    macrosBlock(w, d.rem);
  } else if (family === 'medium'){
    caloriesBlock(w, d);
    w.addSpacer(8);
    todosBlock(w, d.todos, 3);
  } else {
    caloriesBlock(w, d);
    w.addSpacer(10);
    habitsBlock(w, d.habits);
    w.addSpacer(8);
    todosBlock(w, d.todos, 5);
  }
  footer(w);
  return w;
}

const family = config.widgetFamily || 'large';   // run in the app → preview the large one
let widget;
try {
  widget = buildWidget(family, await loadAll(), null);
} catch (e) {
  widget = buildWidget(family, null, String(e.message || e));
}

if (config.runsInWidget) Script.setWidget(widget);
else if (family === 'small') await widget.presentSmall();
else if (family === 'medium') await widget.presentMedium();
else await widget.presentLarge();
Script.complete();
