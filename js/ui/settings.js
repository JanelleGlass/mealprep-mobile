/* Settings overlay: connection + sign-in, targets, quick-add manager, backup. */
import { cfg, saveConfig, signIn, signOut, currentUser, demoMode } from '../supa.js';
import { refreshAll, setPreference, upsertRow, deleteRow, cached } from '../store.js';
import { targets, esc } from './common.js';
import { getPat, setPat, lastBackupAt, runBackup } from '../backup.js';

export async function renderSettings(){
  const root = document.getElementById('settingsBody');
  const user = await currentUser();

  const T = targets();
  const quick = (cached('quick_add_items') || []).slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  root.innerHTML = `
    <div class="sectionTitle">Connection</div>
    <div class="card">
      <div class="cSub">${cfg ? (demoMode() ? 'demo mode (local sample data)' : esc(cfg.url)) : 'not configured'}</div>
      <div class="cSub">${user ? 'signed in as ' + esc(user.email) : 'not signed in'}</div>
      <div class="quickRow" style="margin-top:8px;">
        <button class="quickChip" id="stConfigure">${cfg ? 'change connection' : 'connect'}</button>
        ${user && !demoMode() ? '<button class="quickChip" id="stSignOut">sign out</button>' : ''}
        ${cfg && !user && !demoMode() ? '<button class="quickChip" id="stSignIn">sign in</button>' : ''}
      </div>
      <div class="cSub" style="margin-top:8px;">If the app ever says "project paused": open supabase.com, open your project, click Restore. Takes ~30 seconds; nothing is lost.</div>
    </div>

    <div class="sectionTitle">Daily targets</div>
    <div class="card" id="stTargets">
      ${[['LogCalMin', 'calories min', T.calMin], ['LogCalMax', 'calories max', T.calMax],
         ['LogProteinMin', 'protein min (g)', T.proteinMin], ['LogProteinMax', 'protein max (g)', T.proteinMax],
         ['LogFiberTarget', 'fiber target (g)', T.fiber], ['LogIronTarget', 'iron target (mg)', T.iron],
         ['LogLowIntakeFloor', 'low-intake floor (cal)', T.lowFloor], ['LogHeightIn', 'height (in)', T.heightIn]]
        .map(([k, label, v]) => `<div class="listRow"><span>${label}</span><span class="qty"><input type="number" class="tgtIn" data-k="${k}" step="0.5" value="${v}"></span></div>`).join('')}
      <div class="cSub" id="stTgtMsg" style="margin-top:6px;">changes save automatically</div>
    </div>

    <div class="sectionTitle">Quick-add items</div>
    <div class="card" id="stQuick">
      ${quick.map((q, i) => `
        <div class="listRow"><span>${esc(q.name)} <span class="qty">${Math.round(q.calories)} cal · ${(+q.protein_g).toFixed(1)}g P${q.is_plant ? ' · 🌱' : ''}</span></span>
        <span class="qty">
          <button class="del" data-up="${q.id}" ${i === 0 ? 'disabled' : ''} style="color:var(--ink-soft);">↑</button>
          <button class="del" data-qedit="${q.id}" style="color:var(--ink-soft);">✎</button>
          <button class="del" data-qdel="${q.id}">✕</button>
        </span></div>`).join('') || '<div class="empty">No quick items</div>'}
      <div class="quickRow" style="margin-top:8px;"><button class="quickChip" id="stQuickAdd">+ new quick item</button></div>
      <div id="stQuickForm"></div>
    </div>

    <div class="sectionTitle">Backup</div>
    <div class="card">
      <div class="cSub">Copies everything to your private GitHub repo. Weekly is plenty — your data lives in Supabase; this is a spare copy.</div>
      <span class="miniLabel" style="margin-top:8px;">github token (fine-grained, mealprep-data, contents r/w)</span>
      <input type="password" id="stPat" value="${esc(getPat())}" placeholder="github_pat_...">
      <div class="quickRow" style="margin-top:8px;"><button class="quickChip" id="stBackup">backup now</button></div>
      <div class="cSub" id="stBackupMsg" style="margin-top:6px;">${lastBackupAt() ? 'last backup: ' + new Date(lastBackupAt()).toLocaleString() : 'never backed up yet'}</div>
    </div>`;

  root.querySelector('#stConfigure').addEventListener('click', () => openConnectOverlay());
  root.querySelector('#stSignOut')?.addEventListener('click', async () => { await signOut(); renderSettings(); });
  root.querySelector('#stSignIn')?.addEventListener('click', () => openSignInOverlay());

  root.querySelectorAll('.tgtIn').forEach(inp => inp.addEventListener('change', async () => {
    try {
      await setPreference(inp.getAttribute('data-k'), parseFloat(inp.value) || 0);
      document.getElementById('stTgtMsg').textContent = 'saved ✓';
    } catch (err) {
      document.getElementById('stTgtMsg').textContent = 'save failed: ' + err.message;
    }
  }));

  const quickForm = (q) => {
    const f = root.querySelector('#stQuickForm');
    f.innerHTML = `
      <div style="margin-top:10px;">
      <input type="text" id="qfName" placeholder="name" value="${esc(q?.name ?? '')}">
      <div class="row grid4" style="margin-top:6px;">
        <input type="number" id="qfCal" placeholder="cal" value="${q?.calories ?? ''}">
        <input type="number" id="qfP" placeholder="protein" step="0.1" value="${q?.protein_g ?? ''}">
        <input type="number" id="qfF" placeholder="fiber" step="0.1" value="${q?.fiber_g ?? ''}">
        <input type="number" id="qfFe" placeholder="iron" step="0.1" value="${q?.iron_mg ?? ''}">
      </div>
      <label class="plantCheck"><input type="checkbox" id="qfPlant" ${q?.is_plant ? 'checked' : ''}> plant item</label>
      <button class="addBtn" id="qfSave">${q ? 'save' : '+ add'}</button></div>`;
    f.querySelector('#qfSave').addEventListener('click', async () => {
      const name = f.querySelector('#qfName').value.trim();
      if (!name) return;
      const maxSort = Math.max(0, ...quick.map(x => x.sort_order ?? 0));
      await upsertRow('quick_add_items', {
        ...(q ? { id: q.id, sort_order: q.sort_order } : { sort_order: maxSort + 1 }),
        name,
        calories: parseFloat(f.querySelector('#qfCal').value) || 0,
        protein_g: parseFloat(f.querySelector('#qfP').value) || 0,
        fiber_g: parseFloat(f.querySelector('#qfF').value) || 0,
        iron_mg: parseFloat(f.querySelector('#qfFe').value) || 0,
        is_plant: f.querySelector('#qfPlant').checked,
      });
      renderSettings();
    });
  };
  root.querySelector('#stQuickAdd').addEventListener('click', () => quickForm(null));
  root.querySelectorAll('[data-qedit]').forEach(b => b.addEventListener('click', () =>
    quickForm(quick.find(q => q.id === +b.getAttribute('data-qedit')))));
  root.querySelectorAll('[data-qdel]').forEach(b => b.addEventListener('click', async () => {
    await deleteRow('quick_add_items', +b.getAttribute('data-qdel')); renderSettings();
  }));
  root.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', async () => {
    const id = +b.getAttribute('data-up');
    const i = quick.findIndex(q => q.id === id);
    if (i <= 0) return;
    await upsertRow('quick_add_items', { id: quick[i].id, sort_order: quick[i - 1].sort_order ?? 0 });
    await upsertRow('quick_add_items', { id: quick[i - 1].id, sort_order: (quick[i].sort_order ?? 0) });
    renderSettings();
  }));

  root.querySelector('#stPat').addEventListener('change', e => setPat(e.target.value));
  root.querySelector('#stBackup').addEventListener('click', async () => {
    const msg = document.getElementById('stBackupMsg');
    try {
      const counts = await runBackup(p => msg.textContent = p);
      msg.textContent = `backed up ✓ (${Object.values(counts).reduce((a, b) => a + b, 0)} rows)`;
    } catch (err) {
      msg.textContent = 'backup failed: ' + err.message;
    }
  });
}

export function openConnectOverlay(){
  const ov = document.getElementById('connectOverlay');
  if (cfg){
    document.getElementById('cnUrl').value = demoMode() ? '' : cfg.url;
    document.getElementById('cnKey').value = demoMode() ? '' : cfg.anonKey;
  }
  ov.classList.add('show');
}

export function openSignInOverlay(){
  document.getElementById('signinOverlay').classList.add('show');
}

export function wireOverlays(afterAuth){
  document.getElementById('cnCancel').addEventListener('click', () =>
    document.getElementById('connectOverlay').classList.remove('show'));
  document.getElementById('cnSave').addEventListener('click', () => {
    const url = document.getElementById('cnUrl').value.trim();
    const key = document.getElementById('cnKey').value.trim();
    if (!url || (!key && url !== 'demo')) return;
    saveConfig(url, key);
    document.getElementById('connectOverlay').classList.remove('show');
    if (url === 'demo') afterAuth();
    else openSignInOverlay();
  });
  document.getElementById('siCancel').addEventListener('click', () =>
    document.getElementById('signinOverlay').classList.remove('show'));
  document.getElementById('siGo').addEventListener('click', async () => {
    const msg = document.getElementById('siMsg');
    try {
      msg.textContent = 'signing in…';
      await signIn(document.getElementById('siEmail').value.trim(), document.getElementById('siPass').value);
      document.getElementById('signinOverlay').classList.remove('show');
      msg.textContent = '';
      afterAuth();
    } catch (err) {
      msg.textContent = err.message;
    }
  });
}
