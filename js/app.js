/* Boot: tabs, sync line, initial load. */
import { cfg, currentUser, onAuthChange } from './supa.js';
import { S, refreshAll } from './store.js';
import { renderLog, wireLogTab } from './ui/log.js';
import { renderPlan, wirePlanTab } from './ui/plan.js';
import { renderRecipes } from './ui/recipes.js';
import { renderPantry, wirePantryTab } from './ui/pantry.js';
import { renderSettings, openConnectOverlay, openSignInOverlay, wireOverlays } from './ui/settings.js';
import { closeSheet } from './ui/common.js';

let activeTab = 'log';

function renderActive(){
  if (activeTab === 'log') renderLog();
  else if (activeTab === 'plan') renderPlan();
  else if (activeTab === 'recipes') renderRecipes();
  else if (activeTab === 'pantry') renderPantry();
  else if (activeTab === 'settings') renderSettings();
}

S.onChange = renderActive;
S.onSync = (msg, isErr) => {
  const el = document.getElementById('syncline');
  el.textContent = msg || '';
  el.classList.toggle('err', !!isErr);
};

document.querySelectorAll('.tabBtn').forEach(b => b.addEventListener('click', () => {
  activeTab = b.getAttribute('data-tab');
  document.querySelectorAll('.tabBtn').forEach(x => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.id === 'tab-' + activeTab));
  renderActive();
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
