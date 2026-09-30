// Inicialização, rotas (#/f/<pasta>/<croqui>), tela inicial de pastas e import/export JSON.
import { db, requestPersistence } from './db.js';
import { uid, esc } from './util.js';
import { newContent } from './model.js';
import { Editor } from './editor.js';
import { ask, confirmDialog, menu, toast, saveFile, pickFile } from './ui.js';
import { safeName } from './export.js';
import { installTapReliability } from './motion.js';

installTapReliability();

const root = document.getElementById('app');
let editor = null;

const newSketchRecord = (folderId, name = 'Croqui 1', unit = 'ft') => ({
  id: uid(), folderId, name, createdAt: Date.now(), updatedAt: Date.now(), content: newContent(unit), view: null, thumb: '',
});

function setHash(h) { if (location.hash !== h) history.replaceState(null, '', h || location.pathname); }

// ---------------- Tela inicial ----------------
async function showHome() {
  if (editor) { editor.destroy(); editor = null; }
  setHash('');
  const folders = await db.listFolders();
  const rows = await Promise.all(folders.map(async (f) => {
    const sk = await db.listSketches(f.id);
    const last = sk.find((s) => s.id === f.lastSketchId) || sk[sk.length - 1];
    return { f, count: sk.length, thumb: last?.thumb || '' };
  }));
  root.innerHTML = `
  <div class="home">
    <header class="home-head">
      <div><h1>Croquis</h1><p>Plantas e medições de campo · tudo salvo neste aparelho</p></div>
      <div class="home-actions">
        <button class="btn" data-a="import">Importar JSON</button>
        <button class="btn" data-a="backup" ${folders.length ? '' : 'disabled'}>Backup completo</button>
        <button class="btn primary big" data-a="new">+ Nova pasta</button>
      </div>
    </header>
    ${folders.length ? `<div class="folder-grid">${rows.map(({ f, count, thumb }) => `
      <div class="folder-card" data-id="${f.id}">
        <div class="thumb">${thumb || '<span class="empty">vazio</span>'}</div>
        <div class="fc-body"><div><b>${esc(f.name)}</b><small>${count} croqui${count === 1 ? '' : 's'} · ${new Date(f.updatedAt).toLocaleDateString('pt-BR')}</small></div>
        <button class="ib" data-more="${f.id}" aria-label="Opções">⋯</button></div>
      </div>`).join('')}</div>`
      : `<div class="empty-state"><div class="es-icon">📐</div><h2>Nenhuma pasta ainda</h2><p>Crie uma pasta para cada obra/cliente. Dentro dela ficam os croquis.</p><button class="btn primary big" data-a="new">+ Criar primeira pasta</button></div>`}
  </div>`;
  root.onclick = async (e) => {
    const more = e.target.closest('[data-more]');
    if (more) { e.stopPropagation(); return folderMenu(more.dataset.more); }
    const card = e.target.closest('.folder-card');
    if (card) return openFolder(card.dataset.id);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'new') {
      const name = await ask('Nome da pasta (obra / cliente)', '', { placeholder: 'ex.: Residência Silva — piscina' });
      if (!name) return;
      const f = { id: uid(), name, createdAt: Date.now(), updatedAt: Date.now(), lastSketchId: null };
      await db.putFolder(f);
      const s = newSketchRecord(f.id);
      await db.putSketch(s);
      openFolder(f.id, s.id);
    } else if (a === 'import') importJSON();
    else if (a === 'backup') {
      const all = await db.listFolders();
      const data = { app: 'croqui', version: 1, exportedAt: new Date().toISOString(), folders: await Promise.all(all.map(async (f) => ({ folder: f, sketches: await db.listSketches(f.id) }))) };
      saveFile(new Blob([JSON.stringify(data)], { type: 'application/json' }), `croquis-backup-${new Date().toISOString().slice(0, 10)}.json`);
    }
  };
}

async function folderMenu(id) {
  const f = await db.getFolder(id);
  const v = await menu(f.name, [
    { label: 'Abrir', value: 'open' },
    { label: 'Renomear', value: 'rename' },
    { label: 'Exportar JSON', value: 'export' },
    { label: 'Excluir pasta', value: 'delete', danger: true },
  ]);
  if (v === 'open') openFolder(id);
  else if (v === 'rename') {
    const name = await ask('Renomear pasta', f.name);
    if (name) { f.name = name; await db.putFolder(f); showHome(); }
  } else if (v === 'export') exportFolder(id);
  else if (v === 'delete') {
    if (await confirmDialog('Excluir pasta?', `"${f.name}" e todos os croquis dela serão apagados deste aparelho.`, { okLabel: 'Excluir', danger: true })) {
      await db.deleteFolder(id); showHome();
    }
  }
}

async function exportFolder(id) {
  const folder = await db.getFolder(id);
  const sketches = await db.listSketches(id);
  const data = { app: 'croqui', version: 1, exportedAt: new Date().toISOString(), folders: [{ folder, sketches }] };
  await saveFile(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), safeName(folder.name) + '.croqui.json');
}

async function importJSON() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'croqui' || !Array.isArray(data.folders)) throw new Error('arquivo não é um projeto de croqui');
    const existing = new Set((await db.listFolders()).map((f) => f.name));
    let n = 0;
    for (const { folder, sketches } of data.folders) {
      const f = { ...folder, id: uid(), updatedAt: Date.now() };
      if (existing.has(f.name)) f.name += ' (importado)';
      const ids = {};
      for (const s of sketches || []) {
        const ns = { ...s, id: uid(), folderId: f.id };
        ids[s.id] = ns.id;
        await db.putSketch(ns);
      }
      f.lastSketchId = ids[folder.lastSketchId] ?? null;
      await db.putFolder(f);
      n++;
    }
    toast(`${n} pasta(s) importada(s)`);
    showHome();
  } catch (e) { toast('Não consegui importar: ' + e.message, 3500); }
}

// ---------------- Editor ----------------
async function openFolder(folderId, sketchId) {
  const folder = await db.getFolder(folderId);
  if (!folder) return showHome();
  let sketches = await db.listSketches(folderId);
  if (!sketches.length) { const s = newSketchRecord(folderId); await db.putSketch(s); sketches = [s]; }
  const sketch = sketches.find((s) => s.id === (sketchId || folder.lastSketchId)) || sketches[sketches.length - 1];
  sketch.content ??= newContent();
  sketch.content.texts ??= [];
  if (editor) editor.destroy();
  root.onclick = null;
  setHash(`#/f/${folderId}/${sketch.id}`);
  editor = new Editor(root, {
    folder, sketch, sketches,
    onBack: () => showHome(),
    onSwitch: (id) => openFolder(folderId, id),
    onNewSketch: async () => {
      const s = newSketchRecord(folderId, `Croqui ${sketches.length + 1}`, sketch.content.unit);
      await db.putSketch(s);
      openFolder(folderId, s.id);
    },
    onRenameSketch: () => {},
    onDeleteSketch: async (id) => { await db.deleteSketch(id); folder.lastSketchId = null; await db.putFolder(folder); openFolder(folderId); },
    onExportFolder: () => exportFolder(folderId),
  });
}

function route() {
  const m = location.hash.match(/^#\/f\/([^/]+)(?:\/([^/]+))?/);
  if (m) openFolder(m[1], m[2]); else showHome();
}

// Salva ao ir para o fundo (iPad pode matar a aba a qualquer momento).
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && editor) editor.save(); });
// Bloqueia o zoom de página do Safari (usamos pinça no canvas).
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
}
requestPersistence();
route();
