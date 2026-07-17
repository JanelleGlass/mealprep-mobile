// MealPrep — "left today" iPhone widget (runs in the Scriptable app).
//
// Shows remaining calories / protein / fiber / iron for today, straight from
// your Supabase database. iOS doesn't allow web apps to provide home-screen
// widgets, so this script bridges the gap via Scriptable (free, App Store).
//
// SETUP
// 1. Install "Scriptable" from the App Store.
// 2. In Scriptable: + new script, paste this whole file, name it "MealPrep".
// 3. Fill in the four CONFIG values below (same URL + anon key you pasted
//    into the app's gear menu, same email + password you sign in with).
// 4. Run it once inside Scriptable — you should see the widget preview.
// 5. Long-press home screen -> + -> Scriptable -> small widget -> add,
//    then long-press the widget -> Edit Widget -> Script: MealPrep.
//
// iOS refreshes widgets on its own schedule (roughly every 15-60 min).
// Tapping the widget opens the MealPrep app if OPEN_URL is set.

const CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co', // gear menu -> project URL
  ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',
  EMAIL: 'you@example.com',
  PASSWORD: 'your-mealprep-login-password',
  OPEN_URL: '', // optional: URL where you host the app, e.g. 'https://you.github.io/mealprep-mobile/'
};

// Same defaults as the app (js/ui/common.js targets()); overridden by
// user_preferences rows when present.
const DEFAULTS = { LogCalMax: 1950, LogProteinMin: 130, LogFiberTarget: 30, LogIronTarget: 18 };

function todayKey(){
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

// --- data ------------------------------------------------------------------
async function loadRemaining(){
  const token = await getToken();
  const [entries, prefs] = await Promise.all([
    rest(token, `food_log_entries?date=eq.${todayKey()}&select=calories,protein_g,fiber_g,iron_mg`),
    rest(token, 'user_preferences?select=key,value'),
  ]);
  const pref = k => {
    const row = (prefs || []).find(p => p.key === k);
    const v = row ? parseFloat(row.value) : NaN;
    return isNaN(v) ? DEFAULTS[k] : v;
  };
  const t = (entries || []).reduce((a, e) => {
    a.cal += +e.calories || 0; a.protein += +e.protein_g || 0;
    a.fiber += +e.fiber_g || 0; a.iron += +e.iron_mg || 0; return a;
  }, { cal: 0, protein: 0, fiber: 0, iron: 0 });
  return {
    cal: pref('LogCalMax') - t.cal,
    protein: pref('LogProteinMin') - t.protein,
    fiber: pref('LogFiberTarget') - t.fiber,
    iron: pref('LogIronTarget') - t.iron,
  };
}

// --- widget ----------------------------------------------------------------
// palette echoes the app: paper / ink / per-macro accents
const C = {
  bg: Color.dynamic(new Color('#F8F9F2'), new Color('#1E221C')),
  ink: Color.dynamic(new Color('#232921'), new Color('#E8EAE0')),
  soft: Color.dynamic(new Color('#5B6355'), new Color('#9AA192')),
  cal: new Color('#8A7B3D'), protein: new Color('#3A4F73'),
  fiber: new Color('#4F7358'), iron: new Color('#A6512F'),
};

function cell(stack, value, unit, label, color, dp){
  const col = stack.addStack();
  col.layoutVertically();
  const done = value <= 0;
  const v = col.addText(done ? '✓' : (dp ? value.toFixed(1) : String(Math.round(value))) + unit);
  v.font = Font.semiboldMonospacedSystemFont(15);
  v.textColor = done ? C.fiber : color;
  v.lineLimit = 1; v.minimumScaleFactor = 0.6;
  const l = col.addText(label);
  l.font = Font.systemFont(8);
  l.textColor = C.soft;
}

function buildWidget(rem, err){
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  if (CONFIG.OPEN_URL) w.url = CONFIG.OPEN_URL;
  w.setPadding(12, 14, 10, 14);

  const title = w.addText('LEFT TODAY');
  title.font = Font.mediumSystemFont(9);
  title.textColor = C.soft;
  w.addSpacer(6);

  if (err){
    const e = w.addText(err);
    e.font = Font.systemFont(10);
    e.textColor = C.iron;
    e.minimumScaleFactor = 0.6;
    return w;
  }

  const r1 = w.addStack(); r1.spacing = 8;
  cell(r1, rem.cal, '', 'cal', C.cal);
  r1.addSpacer();
  cell(r1, rem.protein, 'g', 'protein', C.protein);
  w.addSpacer(8);
  const r2 = w.addStack(); r2.spacing = 8;
  cell(r2, rem.fiber, 'g', 'fiber', C.fiber, 1);
  r2.addSpacer();
  cell(r2, rem.iron, 'mg', 'iron', C.iron, 1);

  w.addSpacer();
  const df = new DateFormatter(); df.useShortTimeStyle();
  const foot = w.addText('as of ' + df.string(new Date()));
  foot.font = Font.systemFont(7);
  foot.textColor = C.soft;
  return w;
}

let widget;
try {
  widget = buildWidget(await loadRemaining(), null);
} catch (e) {
  widget = buildWidget(null, String(e.message || e));
}

if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentSmall();
Script.complete();
