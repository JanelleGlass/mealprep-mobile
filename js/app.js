/* Boot: tabs, sync line, initial load. */
import { cfg, currentUser, onAuthChange } from './supa.js';
import { S, refreshAll } from './store.js';
import { renderLog, wireLogTab } from './ui/log.js';
import { renderPlan, wirePlanTab } from './ui/plan.js';
import { renderRecipes } from './ui/recipes.js';
import { renderPantry, wirePantryTab } from './ui/pantry.js';
import { renderRoutines, routinesFocusToday } from './ui/routines.js';
import { renderTasks, tasksOpen } from './ui/tasks.js';
import { renderSettings, openConnectOverlay, openSignInOverlay, wireOverlays } from './ui/settings.js';
import { closeSheet } from './ui/common.js';

let activeTab = 'log';

function renderActive(){
  if (activeTab === 'log') renderLog();
  else if (activeTab === 'plan') renderPlan();
  else if (activeTab === 'recipes') renderRecipes();
  else if (activeTab === 'routines') renderRoutines();
  else if (activeTab === 'tasks') renderTasks();
  else if (activeTab === 'pantry') renderPantry();
  else if (activeTab === 'settings') renderSettings();
}

/* A background repaint (a sync landing, a pull from Claude's edits) must not
   replace the add box you're typing in: that drops the iPhone keyboard and
   the half-typed text. Wait until you leave the box, then catch up. */
const TYPING_BOXES = '#todoIn, #tkAddIn';
let heldFor = null;
S.onChange = () => {
  const el = document.activeElement;
  if (el?.matches?.(TYPING_BOXES)){
    if (heldFor !== el){
      heldFor = el;
      el.addEventListener('blur', () => setTimeout(() => { if (heldFor === el) heldFor = null; S.onChange(); }, 0), { once: true });
    }
    return;
  }
  renderActive();
};
S.onSync = (msg, isErr) => {
  const el = document.getElementById('syncline');
  el.textContent = msg || '';
  el.classList.toggle('err', !!isErr);
};

document.querySelectorAll('.tabBtn').forEach(b => b.addEventListener('click', () => {
  activeTab = b.getAttribute('data-tab');
  if (activeTab === 'routines') routinesFocusToday();
  document.querySelectorAll('.tabBtn').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + activeTab));
  if (activeTab === 'tasks') tasksOpen();   // renders, then pulls whatever Claude changed
  else renderActive();
}));

document.getElementById('gearBtn').addEventListener('click', () => {
  activeTab = 'settings';
  document.querySelectorAll('.tabBtn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-settings'));
  renderSettings();
});

document.getElementById('sheetClose').addEventListener('click', closeSheet);

wireLogTab(renderActive);
wirePlanTab();
wirePantryTab();
wireOverlays(async () => { await refreshAll(); renderActive(); });

if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async () => {
  renderActive();
  if (!cfg){ openConnectOverlay(); return; }
  const user = await currentUser();
  if (!user){ openSignInOverlay(); return; }
  onAuthChange(u => { if (!u) openSignInOverlay(); });
  await refreshAll();
  renderActive();
})();
