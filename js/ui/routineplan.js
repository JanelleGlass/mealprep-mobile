/* The editable definition of the Routines tab: which routines exist, what steps
   each one holds, and which weekdays it lands on.

   Stored as one JSON blob synced through user_preferences:

     { v: 1, routines: [
         { id: 'daily', title: 'Daily', days: [0,1,2,3,4,5,6],
           hue: 'vitamins',            // tints the section, matches a habit row
           note: '', numbered: false,  // numbered: render steps as "1. …"
           slot: null,                 // 'cook' | 'prep' — cook-plan recipes attach here
           habit: '',                  // habit tag given to newly added steps
           tips: [],
           steps: [{ id: 'dev', t: 'Devotions', d: '', habit: 'devotions' }] } ] }

   Step ids are load-bearing: routines.log keys completion history by date + step
   id, so the seeded ids below must never change. New steps get a fresh 'u…' id,
   which can't collide with the seeded ids or the reserved '__steps', 'sh:' and
   'rc:' prefixes the log also uses. */
import { createSyncedBlob } from '../syncblob.js';

const blob = createSyncedBlob({
  prefKey: 'RoutinePlan', localKey: 'routines.plan', dirtyKey: 'routines.plandirty',
});

/* The habit tracker's meaning shouldn't drift when content is edited, so the
   bar each habit clears stays in code: 'all' every tagged step, 'any' at least
   one, 'most' three quarters of them. */
export const HABIT_RULE = { vitamins: 'all', devotions: 'all', practice: 'any',
                            workout: 'any', cleaning: 'most' };
export const WEEK_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/* ---------- the shipped starting point ---------- */
const WARMUP_DESC = 'Raise → dynamic → activate → ramp to jumps (6–8 min).';
const WORKOUTS = [
  { id: 'wk-sun', dow: 0, focus: 'Upper + Core', note: 'no jumps — recovery day', primer: [], lifts: [
    'Arnold Press – 3×10',
    'Push-Ups (knee or full) – 3×10',
    'Renegade Rows – 3×10',
    'Plank Shoulder Taps – 3×20 (keep breathing)',
    'Core: Farmer Carry – 3×40 steps',
    'Core: Bird Dog or Bear Hold – 3×20–30 sec',
    'Core: Russian Twists – light/bodyweight (or swap for extra Pallof Press)',
  ]},
  { id: 'wk-mon', dow: 1, focus: 'Lower — Glutes & Legs', note: '+ jumps', primer: [
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
  { id: 'wk-wed', dow: 3, focus: 'Upper — Arms, Shoulders, Back', note: '+ jumps', primer: [
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
  { id: 'wk-fri', dow: 5, focus: 'Lower — Legs & Core', note: '+ jumps', primer: [
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
];
const CLEAN_TIPS = [
  'Laundry first — it’s the longest hands-off task, so it runs while you clean.',
  'Spray, then walk away — give cleaners 5–10 min before you scrub.',
  'Top to bottom — dust and wipe high before you touch the floors.',
  'Floors last, backing out — vacuum then mop, working toward the door.',
];
const CLEAN_STEPS = [
  { id: 'c1',    t: 'Strip the beds & start laundry', d: 'Sheets and towels in the first load. Keep loads moving all afternoon.' },
  { id: 'cook',  t: '🍳 Cook for Sabbath',            d: 'Start the Sabbath meals early so they cook while you clean.' },
  { id: 'c3',    t: 'Kitchen',                        d: 'Top down: backsplash → counters, stovetop, sink → appliance fronts. Run the dishwasher. Leave the floor.' },
  { id: 'c4',    t: 'Bathrooms & showers',            d: 'Top down: mirror → sink & counter → scrub the shower/tub → toilet. Leave the floor.' },
  { id: 'trash', t: 'Take out trash and compost',     d: 'Empty the kitchen and bathroom bins; take the trash and compost out.' },
  { id: 'c5',    t: 'The window',                     d: 'Glass and sill now, before vacuuming — any drips land on the floor you clean next.' },
  { id: 'c6',    t: 'Dust & tidy',                    d: 'Every room, high to low. Put clutter away. Rotate the laundry.' },
  { id: 'c7',    t: 'Remake the bed',                 d: 'Fresh sheets from the wash or a clean set.' },
  { id: 'c8',    t: 'Vacuum',                         d: 'Every room, working from the far room back toward the door.' },
  { id: 'c9',    t: 'Mop',                            d: 'Hard floors last, backing out of each room so you never walk on wet floor.' },
  { id: 'c10',   t: 'Finish laundry',                 d: 'Fold and put away the last loads.' },
];

function seed(){
  const routines = [
    { id: 'daily', title: 'Daily', days: [...EVERY_DAY], hue: 'vitamins', steps: [
      { id: 'dev', t: 'Devotions', habit: 'devotions' },
      { id: 'vit', t: 'Take Supplements', habit: 'vitamins' },
    ]},
    { id: 'practice', title: 'Practice', days: [...EVERY_DAY], hue: 'practice', habit: 'practice', steps: [
      { id: 'scales', t: 'Scales', habit: 'practice' },
      { id: 'repertoire', t: 'Repertoire', habit: 'practice' },
    ]},
    { id: 'errands', title: 'Errands', days: [4], steps: [{ id: 'gas', t: '⛽ Gas in the car' }] },
    ...WORKOUTS.map(w => ({
      id: w.id, title: `Workout — ${w.focus}`, days: [w.dow], hue: 'workout',
      note: w.note, habit: 'workout',
      steps: [
        { id: 'warmup', t: 'Warm-up', d: WARMUP_DESC, habit: 'workout' },
        ...(w.primer.length ? [{ id: 'jumps', t: 'Jumps', d: w.primer.join(' · '), habit: 'workout' }] : []),
        { id: 'lifts', t: 'Lifts', d: w.lifts.join(' · '), habit: 'workout' },
      ],
    })),
    { id: 'prep', title: 'Meal prep — cook, portion & freeze', days: [1], slot: 'prep', steps: [
      { id: 'mp-rice', t: 'Rice' },
      { id: 'mp-soup', t: 'Soup or entrée' },
      { id: 'mp-chia', t: 'Chia pudding' },
      { id: 'mp-salad', t: 'Salad' },
      { id: 'mp-snacks', t: 'Snacks' },
    ]},
    { id: 'cleaning', title: 'Cleaning — in order', days: [5], hue: 'cleaning', slot: 'cook',
      numbered: true, habit: 'cleaning', tips: [...CLEAN_TIPS],
      steps: CLEAN_STEPS.map(s => ({ ...s, habit: 'cleaning' })) },
  ];
  return { v: 1, routines };
}

/* Seeding writes locally but never pushes: a fresh device must not overwrite the
   customised copy sitting in user_preferences before it has pulled it. */
function ensure(){
  const d = blob.get();
  if (!Array.isArray(d.routines)) blob.set(seed());
  return blob.get();
}

/* ---------- read ---------- */
export const allRoutines = () => ensure().routines;
export const routineById = id => allRoutines().find(r => r.id === id) || null;
export const routinesForDow = dow => allRoutines().filter(r => (r.days || []).includes(dow));
/* every step scheduled on a weekday, flattened — what the habit tracker counts */
export const stepsForDow = dow => routinesForDow(dow).flatMap(r => r.steps || []);

/* ---------- write ---------- */
function uid(prefix){
  const taken = new Set(allRoutines().flatMap(r => [r.id, ...(r.steps || []).map(s => s.id)]));
  let id;
  do { id = prefix + Math.random().toString(36).slice(2, 7); } while (taken.has(id));
  return id;
}

export function addRoutine({ title, days, note }){
  const r = { id: uid('r'), title, days: [...days], note: note || '', steps: [] };
  allRoutines().push(r);
  blob.save();
  return r;
}
export function updateRoutine(id, patch){
  const r = routineById(id);
  if (!r) return;
  Object.assign(r, patch);
  blob.save();
}
export function deleteRoutine(id){
  const rs = allRoutines();
  const i = rs.findIndex(r => r.id === id);
  if (i < 0) return;
  rs.splice(i, 1);
  blob.save();
}

export function addStep(routineId, { t, d }){
  const r = routineById(routineId);
  if (!r) return null;
  const step = { id: uid('u'), t, d: d || '', habit: r.habit || '' };
  (r.steps || (r.steps = [])).push(step);
  blob.save();
  return step;
}
export function updateStep(routineId, stepId, patch){
  const s = (routineById(routineId)?.steps || []).find(x => x.id === stepId);
  if (!s) return;
  Object.assign(s, patch);
  blob.save();
}
export function moveStep(routineId, stepId, dir){
  const steps = routineById(routineId)?.steps || [];
  const i = steps.findIndex(s => s.id === stepId), j = i + dir;
  if (i < 0 || j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  blob.save();
}

/* Reordering is done against one day's list, so a routine swaps with the
   nearest one that also lands on that weekday. Swapping the two array slots
   leaves every routine scheduled elsewhere exactly where it was. */
export function moveRoutine(id, dir, dow){
  const rs = allRoutines();
  const visible = rs.filter(r => (r.days || []).includes(dow));
  const vi = visible.findIndex(r => r.id === id);
  const target = vi < 0 ? null : visible[vi + dir];
  if (!target) return;
  const i = rs.indexOf(visible[vi]), j = rs.indexOf(target);
  [rs[i], rs[j]] = [rs[j], rs[i]];
  blob.save();
}

export function deleteStep(routineId, stepId){
  const r = routineById(routineId);
  if (!r) return;
  r.steps = (r.steps || []).filter(s => s.id !== stepId);
  blob.save();
}

/* ---------- sync surface for routines.js ---------- */
export function routinePlanReconcile(){ const adopted = blob.reconcile(); ensure(); return adopted; }
export const routinePlanChangedRemotely = () => blob.changedRemotely();
export const routinePlanPush = () => blob.push();
export const routinePlanIsDirty = () => blob.isDirty();
