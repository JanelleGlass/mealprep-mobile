/* Tasks tab: the whole to-do backlog, one row per task in the tasks table.
   Three views: This week (inbox, overdue, today, the next 7 days, and anything
   marked This week with no date), Everything (open tasks by area) and Done.

   Claude in claude.ai reads and writes the same table for the morning brief and
   the Friday review, so the list is pulled fresh whenever the tab opens or the
   app comes back to the front. Adds and edits go through the outbox
   (store.js) as patches of just the fields that changed. The Routines tab's
   To-Do list is another view of these rows: whatever is due on the day shown. */
import { esc, collapsibleSection, openSheet, closeSheet, allTasks } from './common.js';
import { S, refresh, cached, queueTask, queueTaskPatch, deleteTask } from '../store.js';
import { keyOf, todayKey, isKey, daysBetween, dowOf, isRestDay, restDayAlternatives } from '../taskdates.js';

/* key, then display name, in display order. Anything unknown shows under Inbox. */
export const AREAS = [
  ['inbox', 'Inbox'],
  ['students', 'Students and families'],
  ['curriculum', 'Curriculum and teaching'],
  ['online', 'Online teaching business'],
  ['music', 'My playing and arrangements'],
  ['ensembles', 'ETSO and community'],
  ['gigs', 'Weddings and gigs'],
  ['home', 'Home and land'],
  ['health', 'Health'],
  ['faith', 'Faith and reading'],
  ['people', 'People'],
  ['projects', 'Personal projects'],
  ['admin', 'Admin and money'],
];
const AREA_NAME = Object.fromEntries(AREAS);
export const areaOf = t => AREA_NAME[t.area] ? t.area : 'inbox';
export const BUCKETS = [['now', 'This week'], ['next', 'Soon'], ['later', 'Someday'], ['paused', 'Paused']];
const BUCKET_NAME = Object.fromEntries(BUCKETS);
const BUCKET_ORDER = Object.fromEntries(BUCKETS.map(([b], i) => [b, i]));

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = key => `${MONTHS[+key.slice(5, 7) - 1]} ${+key.slice(8, 10)}`;
export const dayName = key => DAY_NAMES[dowOf(key)];
const doneKey = t => t.done_at ? keyOf(new Date(t.done_at)) : null;

/* a row is addressed by id once synced, by client_id while it's still in the
   outbox; the 'c:' prefix keeps the two apart */
export const taskKey = t => t.id != null ? String(t.id) : 'c:' + t.client_id;
export const findTask = key => allTasks().find(t => taskKey(t) === key) || null;

/* how a due date reads on a row */
export function dueLabel(due){
  if (!isKey(due)) return null;
  const n = daysBetween(todayKey(), due);
  if (n < 0) return { text: 'overdue · ' + shortDate(due), cls: 'late' };
  if (n === 0) return { text: 'today', cls: 'today' };
  if (n === 1) return { text: 'tomorrow', cls: '' };
  if (n < 7) return { text: dayName(due), cls: '' };
  return { text: shortDate(due), cls: '' };
}

/* done_at goes along so a tick made offline keeps the time it was made, not
   the time it synced; the database fills it in for anyone who leaves it out */
export function toggleTask(t){
  const done = !t.done;
  queueTaskPatch(t, { done, done_at: done ? new Date().toISOString() : null });
}

/* which This week group a task falls in, or null for none */
function weekGroup(t, today){
  const n = isKey(t.due) ? daysBetween(today, t.due) : null;
  if (n !== null && n < 0) return 'late';
  if (n === 0) return 'today';
  if (n !== null && n <= 7) return 'soon';
  if (areaOf(t) === 'inbox') return 'inbox';
  if (t.bucket === 'now' && n === null) return 'anytime';
  return null;
}
const byDue = (a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1
  : (a.created_at || '') < (b.created_at || '') ? -1 : 1;

/* ---------- the tab ---------- */
const view = { seg: 'week' };

/* Everything's area sections, open or closed as you last left them. Local to
   this device, like the Routines tab's sections. */
const SEC_KEY = 'tasks.sections';
const loadSecState = () => { try { return JSON.parse(localStorage.getItem(SEC_KEY)) || {}; } catch { return {}; } };
function setSecOpen(key, open){
  const all = loadSecState();
  all[key] = open;
  try { localStorage.setItem(SEC_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

function row(t, { area = true, bucket = false } = {}){
  const k = esc(taskKey(t));
  const meta = [];
  if (area) meta.push(`<span>${esc(AREA_NAME[areaOf(t)])}</span>`);
  const due = !t.done && dueLabel(t.due);
  if (due) meta.push(`<span class="tkDue ${due.cls}">${esc(due.text)}</span>`);
  if (bucket && t.bucket !== 'now' && BUCKET_NAME[t.bucket]) meta.push(`<span class="tkTag">${esc(BUCKET_NAME[t.bucket])}</span>`);
  const dk = t.done && doneKey(t);
  if (dk) meta.push(`<span>done ${esc(shortDate(dk))}</span>`);
  return `<div class="tkRow${t.done ? ' done' : ''}">
    <button type="button" class="tkCheck" data-tick="${k}" aria-pressed="${!!t.done}"
      aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}"><span class="box"></span></button>
    <button type="button" class="tkBody" data-open="${k}">
      <span class="tTitle">${esc(t.title || 'Untitled task')}</span>
      ${meta.length ? `<span class="tkMeta">${meta.join('')}</span>` : ''}
      ${t.note ? `<span class="tkNote">${esc(t.note)}</span>` : ''}
    </button>
  </div>`;
}

/* counts are what's left to do: a group of just today's ticks shows none */
const openCount = items => items.filter(t => !t.done).length || '';

function group(title, items, opts = {}){
  if (!items.length) return '';
  return `<div class="sectionTitle${opts.late ? ' tkLate' : ''}">${esc(title)}<span class="rNote">${opts.all ? items.length : openCount(items)}</span></div>
    ${opts.lead ? `<div class="tkLead">${esc(opts.lead)}</div>` : ''}
    <div class="card taskList">${items.map(t => row(t, opts)).join('')}</div>`;
}

const empty = (head, text) => `<div class="card tkEmpty"><strong>${esc(head)}</strong>${esc(text)}</div>`;

export function renderTasks(){
  const root = document.getElementById('tasksRoot');
  if (!root) return;
  const today = todayKey();
  const all = allTasks();
  const open = all.filter(t => !t.done);
  const week = open.filter(t => weekGroup(t, today));
  const late = week.filter(t => weekGroup(t, today) === 'late').length;
  /* what you tick today stays in place, struck through, so a stray tap can be
     undone where it happened; the counts are open tasks only */
  const shown = all.filter(t => !t.done || doneKey(t) === today);
  const inbox = open.filter(t => areaOf(t) === 'inbox').length;
  const done = all.filter(t => t.done).sort((a, b) => (b.done_at || '') < (a.done_at || '') ? -1 : 1);

  const summary = [`${week.length} this week`];
  if (late) summary.push(`${late} overdue`);
  if (inbox) summary.push(`${inbox} in the inbox`);

  let html = `<form class="todoAdd" id="tkAddForm" autocomplete="off">
      <input type="text" id="tkAddIn" maxlength="200" placeholder="add a task — it lands in your inbox" enterkeyhint="done">
      <button type="submit" class="quickChip">＋ add</button>
    </form>
    <div class="dayProg">${esc(summary.join(' · '))}</div>
    <div class="segRow">${[['week', 'This week', week.length], ['all', 'Everything', open.length], ['done', 'Done', done.length]]
      .map(([s, label, n]) => `<button type="button" class="segBtn${view.seg === s ? ' active' : ''}" data-seg="${s}">${label} · ${n}</button>`).join('')}</div>`;

  const openState = new Map();
  if (cached('tasks') === null && !all.length){
    html += empty('Opening your list', 'Your tasks will appear here once they load.');
  } else if (view.seg === 'week'){
    const pick = g => shown.filter(t => weekGroup(t, today) === g).sort(byDue);
    html += week.length || shown.some(t => weekGroup(t, today))
      ? group('Inbox', pick('inbox'), { lead: 'New tasks land here. Tap one to give it an area and a day.' })
        + group('Overdue', pick('late'), { late: true })
        + group('Today', pick('today'))
        + group('Next 7 days', pick('soon'))
        + group('Anytime this week', pick('anytime'))
      : empty('Nothing due this week', 'Add a task above, or move something from Everything into This week.');
  } else if (view.seg === 'all'){
    const saved = loadSecState();
    html += shown.length ? AREAS.map(([a, name]) => {
      const items = shown.filter(t => areaOf(t) === a)
        .sort((x, y) => (BUCKET_ORDER[x.bucket] ?? 1) - (BUCKET_ORDER[y.bucket] ?? 1) || byDue(x, y));
      if (!items.length) return '';
      const isOpen = saved[a] ?? (a === 'inbox' || items.some(t => t.bucket === 'now'));
      openState.set(a, isOpen);
      return collapsibleSection(a, name, isOpen,
        `<div class="card taskList">${items.map(t => row(t, { area: false, bucket: true })).join('')}</div>`,
        { count: String(openCount(items)) });
    }).join('') : empty('All clear', 'Every task is done. Add the next one above.');
  } else {
    html += done.length ? group('Recently done', done.slice(0, 80), { all: true })
      : empty('Nothing checked off yet', 'Finished tasks collect here, newest first.');
  }

  root.innerHTML = html;

  root.querySelector('#tkAddForm').addEventListener('submit', e => {
    e.preventDefault();
    const input = root.querySelector('#tkAddIn');
    const title = input.value.trim();
    if (!title) return;
    input.value = '';
    queueTask({ title });
    renderTasks();
    document.getElementById('tkAddIn')?.focus();   // keep the keyboard up for the next one
  });
  root.querySelectorAll('[data-seg]').forEach(b => b.addEventListener('click', () => {
    view.seg = b.getAttribute('data-seg');
    renderTasks();
  }));
  root.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => {
    const y = window.scrollY;
    const k = b.getAttribute('data-sec');
    setSecOpen(k, !openState.get(k));
    renderTasks();
    window.scrollTo(0, y);
  }));
  root.querySelectorAll('[data-tick]').forEach(b => b.addEventListener('click', () => {
    const t = findTask(b.getAttribute('data-tick'));
    if (!t) return;
    const y = window.scrollY;
    toggleTask(t);
    window.scrollTo(0, y);
  }));
  root.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    const t = findTask(b.getAttribute('data-open'));
    if (t) openTaskSheet(t);
  }));
}

/* ---------- keeping up with Claude's writes ---------- */
const tasksActive = () => document.getElementById('tab-tasks')?.classList.contains('active');

/* pull the table and repaint if anything changed. S.onChange rather than a
   direct render, so a pull landing mid-typing waits for you to finish. */
export async function pullTasks(){
  if (!navigator.onLine) return false;
  const before = JSON.stringify(cached('tasks'));
  try { await refresh('tasks'); } catch { return false; }   // offline, or the table isn't there yet
  return JSON.stringify(cached('tasks')) !== before;
}

/* on tab open: show what's cached, then whatever is new */
export async function tasksOpen(){
  renderTasks();
  if (await pullTasks() && tasksActive()) S.onChange();
}
/* back to the app with the tab already showing (Claude may have added
   something while it was in the background) */
async function tasksResume(){
  if (!tasksActive() || document.visibilityState !== 'visible') return;
  const y = window.scrollY;
  if (await pullTasks() && tasksActive()){ S.onChange(); window.scrollTo(0, y); }
}
document.addEventListener('visibilitychange', tasksResume);
window.addEventListener('focus', tasksResume);

/* ---------- edit sheet ----------
   Shared with the Routines tab's To-Do list. Saves only the fields you changed,
   so it can't undo something Claude changed on the same task meanwhile. */
export function openTaskSheet(task){
  const start = {
    title: task.title || '', area: areaOf(task),
    bucket: BUCKET_NAME[task.bucket] ? task.bucket : 'now',
    due: isKey(task.due) ? task.due : '', note: task.note || '',
  };
  const draft = { ...start };
  let confirming = false, busy = false;
  const body = openSheet('Edit task', '');

  /* a Saturday gets a note offering Sunday or Friday instead; it never blocks */
  function restNote(){
    if (!isRestDay(draft.due)) return '';
    const alt = restDayAlternatives(draft.due);
    return `<div class="tkRest">Saturday is your rest day. Move it?
      <button type="button" class="quickChip" data-setdue="${alt.sunday}">Sunday ${esc(shortDate(alt.sunday))}</button>
      <button type="button" class="quickChip" data-setdue="${alt.friday}">Friday ${esc(shortDate(alt.friday))}</button></div>`;
  }
  /* the date field is left alone while you use it: redrawing it would close
     the iPhone's date wheel */
  function drawRest(){
    const box = body.querySelector('#tkRestBox');
    box.innerHTML = restNote();
    box.querySelectorAll('[data-setdue]').forEach(b => b.addEventListener('click', () => {
      draft.due = b.getAttribute('data-setdue');
      body.querySelector('#tkDue').value = draft.due;
      drawRest();
    }));
  }

  function draw(msg){
    body.innerHTML = `
      <span class="miniLabel">task</span>
      <input type="text" id="tkTitle" maxlength="200" value="${esc(draft.title)}">
      <span class="miniLabel">area</span>
      <select id="tkArea">${AREAS.map(([a, name]) =>
        `<option value="${a}"${a === draft.area ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>
      <span class="miniLabel">when</span>
      <div class="quickRow dayChips">${BUCKETS.map(([b, name]) =>
        `<button type="button" class="quickChip${draft.bucket === b ? ' on' : ''}" data-bucket="${b}">${esc(name)}</button>`).join('')}</div>
      <span class="miniLabel">due date</span>
      <div class="tkDueRow">
        <input type="date" id="tkDue" value="${esc(draft.due)}">
        <button type="button" class="quickChip" id="tkNoDue">no date</button>
      </div>
      <div id="tkRestBox"></div>
      <span class="miniLabel">notes</span>
      <textarea id="tkNote" class="tkNoteIn" rows="3" maxlength="2000">${esc(draft.note)}</textarea>
      <div class="macros" id="tkMsg">${esc(msg || '')}</div>
      ${confirming ? `
      <div class="tkConfirm">Delete this task for good?</div>
      <div class="btnRow">
        <button class="cancel" id="tkKeep">keep it</button>
        <button class="save tkDanger" id="tkDelYes"${busy ? ' disabled' : ''}>${busy ? 'deleting…' : 'delete'}</button>
      </div>` : `
      <div class="btnRow">
        <button class="cancel" id="tkCancel">cancel</button>
        <button class="save" id="tkSave">save</button>
      </div>
      <div class="quickRow"><button type="button" class="quickChip tkDel" id="tkDel">✕ delete task</button></div>`}`;
    drawRest();

    body.querySelector('#tkTitle').addEventListener('input', e => draft.title = e.target.value);
    body.querySelector('#tkArea').addEventListener('change', e => draft.area = e.target.value);
    body.querySelector('#tkNote').addEventListener('input', e => draft.note = e.target.value);
    body.querySelectorAll('[data-bucket]').forEach(b => b.addEventListener('click', () => {
      draft.bucket = b.getAttribute('data-bucket');
      body.querySelectorAll('[data-bucket]').forEach(x => x.classList.toggle('on', x === b));
    }));
    const dueIn = body.querySelector('#tkDue');
    const onDue = () => { draft.due = isKey(dueIn.value) ? dueIn.value : ''; drawRest(); };
    dueIn.addEventListener('change', onDue);
    dueIn.addEventListener('input', onDue);
    body.querySelector('#tkNoDue').addEventListener('click', () => { dueIn.value = ''; onDue(); });

    if (confirming){
      body.querySelector('#tkKeep').addEventListener('click', () => { confirming = false; draw(); });
      body.querySelector('#tkDelYes').addEventListener('click', async () => {
        if (busy) return;
        busy = true; draw();
        try { await deleteTask(task); closeSheet(); }
        catch (e) { busy = false; confirming = false; draw('couldn’t delete — ' + (navigator.onLine ? e.message : 'you’re offline. Try again once you’re connected.')); }
      });
      return;
    }
    body.querySelector('#tkDel').addEventListener('click', () => { confirming = true; draw(); });
    body.querySelector('#tkCancel').addEventListener('click', closeSheet);
    body.querySelector('#tkSave').addEventListener('click', () => {
      const title = draft.title.trim();
      if (!title) return draw('give the task a name');
      const next = { title, area: draft.area, bucket: draft.bucket, due: draft.due, note: draft.note.trim() };
      const patch = {};
      for (const f of Object.keys(next)) if (next[f] !== start[f]) patch[f] = f === 'due' ? (next.due || null) : next[f];
      closeSheet();
      if (Object.keys(patch).length) queueTaskPatch(task, patch);
    });
  }
  draw();
}
