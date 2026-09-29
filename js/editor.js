// Editor de croqui: ferramentas, gestos, painéis, histórico e salvamento automático.
import { db } from './db.js';
import { uid, clamp, debounce, esc, vertexLabel, deepClone } from './util.js';
import { dist, sub, add, mul, dot, segInfo, segmentCount, polygonize, interiorAngleDeg, signedArea } from './geometry.js';
import { formatLength, formatArea, feetInchesToM, mToFeetInches, parseNumber } from './units.js';
import { solveShape } from './solver.js';
import { recognizeStroke } from './freehand.js';
import {
  newShape, newSegment, solveInContent, findShape, shapeAt, stats, insertVertex, deleteVertex, moveShape, hasMeasures,
} from './model.js';
import { buildFills, buildGrid, buildOverlay, buildThumb } from './render.js';
import { TEXTURES, PAVER_PATTERNS, PAVER_COLORS, DECK_COLORS, previewSVG, defaultFill, textureName } from './textures.js';
import { exportPNG, exportPDF, safeName } from './export.js';
import { toast, confirmDialog, menu, saveFile, ask } from './ui.js';
import { onFastTap } from './motion.js';
import { RadialMenu } from './fan.js';
import { ensureMarkup, markupSVG, strokeSVG, strokeHit, markupPoints, MARK_COLORS, MARK_WIDTHS } from './markup.js';

const MARK_TOOLS = ['pen', 'arrow', 'eraser'];

const SETTINGS_KEY = 'croqui-settings';
const DEFAULT_SETTINGS = { pencilOnly: false, penSeen: false, library: false, markColor: '#e0392b', markWidth: 4, fabPos: null };
const loadSettings = () => { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; } };
const saveSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ } };

const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  select: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
  point: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M6.5 16.5l11-9"/>',
  arc: '<path d="M4 18C4 9 10 5 20 5"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="5" r="1.6"/>',
  free: '<path d="M3 17c3-6 5 2 8-3s4-8 7-6 1 7 3 8"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  pen: '<path d="M4 20l1.5-5L16 4.5a2.1 2.1 0 013 3L8.5 18z"/><path d="M13.5 7l3 3"/><path d="M4 20l4.5-1.5"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
  eraser: '<path d="M8 20h12"/><path d="M5.5 14.5l8-8a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 18H8.5z"/><path d="M9.5 10.5l5 5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.7 10.7 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a10 10 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  measure: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  textures: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
};

// Itens do leque: anel interno = geometria; anel externo = anotação e ações.
const FAN_ITEMS = [
  { id: 'select', label: 'Medir', icon: 'measure', ring: 0, kind: 'tool' },
  { id: 'point', label: 'Pontos', icon: 'point', ring: 0, kind: 'tool' },
  { id: 'arc', label: 'Arco', icon: 'arc', ring: 0, kind: 'toggle' },
  { id: 'free', label: 'Mão livre', icon: 'free', ring: 0, kind: 'tool' },
  { id: 'text', label: 'Texto', icon: 'text', ring: 0, kind: 'tool' },
  { id: 'pen', label: 'Caneta', icon: 'pen', ring: 1, kind: 'tool' },
  { id: 'arrow', label: 'Seta', icon: 'arrow', ring: 1, kind: 'tool' },
  { id: 'eraser', label: 'Borracha', icon: 'eraser', ring: 1, kind: 'tool' },
  { id: 'library', label: 'Texturas', icon: 'textures', ring: 1, kind: 'toggle' },
  { id: 'undo', label: 'Desfazer', icon: 'undo', ring: 1, kind: 'action' },
];
const TOOL_ICON = { select: 'measure', point: 'point', free: 'free', text: 'text', pen: 'pen', arrow: 'arrow', eraser: 'eraser' };
const TOOL_LABEL = { select: 'Medir', point: 'Pontos', free: 'Mão livre', text: 'Texto', pen: 'Caneta', arrow: 'Seta', eraser: 'Borracha' };
const icon = (k) => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;

export class Editor {
  constructor(root, { folder, sketch, sketches, onBack, onSwitch, onNewSketch, onRenameSketch, onDeleteSketch, onExportFolder }) {
    this.root = root;
    this.folder = folder;
    this.sketch = sketch;
    this.sketches = sketches;
    this.cb = { onBack, onSwitch, onNewSketch, onRenameSketch, onDeleteSketch, onExportFolder };
    this.content = sketch.content;
    ensureMarkup(this.content);
    this.markupDirty = true;
    this.liveStroke = null;
    this.eraserPos = null;
    this.settings = loadSettings();
    this.tool = 'point';
    this.arcMode = false;
    this.sel = null;
    this.drawing = null;
    this.freehand = null;
    this.pointers = new Map();
    this.gesture = null;
    this.penActive = false;
    this.fillsDirty = true;
    this.undoStack = [];
    this.redoStack = [];
    this.reports = {};
    this.recomputeReports();
    this.lastSnap = JSON.stringify(this.content);
    this.saveSoon = debounce(() => this.save(), 400);
    this.mount();
    this.view = sketch.view && sketch.view.k ? { ...sketch.view } : null;
    requestAnimationFrame(() => {
      if (!this.view) this.fit();
      this.render();
    });
    if (this.content.shapes.length) this.setTool('select');
  }

  // ---------------- DOM ----------------
  mount() {
    const r = this.root;
    r.innerHTML = `
    <div class="editor">
      <header class="topbar">
        <button class="ib" data-a="back" aria-label="Voltar">${icon('back')}</button>
        <button class="title-btn" data-a="sketchMenu"><span class="t-folder">${esc(this.folder.name)}</span><span class="t-sketch">${esc(this.sketch.name)} ▾</span></button>
        <div class="spacer"></div>
        <button class="ib" data-a="markupVis" aria-label="Mostrar/ocultar anotações"></button>
        <button class="ib" data-a="undo" aria-label="Desfazer">${icon('undo')}</button>
        <button class="ib" data-a="redo" aria-label="Refazer">${icon('redo')}</button>
        <button class="unit-btn" data-a="unit"></button>
        <button class="ib" data-a="fit" aria-label="Ajustar à tela">${icon('fit')}</button>
        <button class="ib" data-a="export" aria-label="Exportar">${icon('share')}</button>
        <button class="ib" data-a="library" aria-label="Texturas">${icon('layers')}</button>
      </header>
      <div class="stage">
        <svg class="canvas" xmlns="http://www.w3.org/2000/svg">
          <g class="grid"></g><g class="fills"></g><g class="overlay"></g><g class="markup"></g><g class="markup-live"></g>
        </svg>
        <div class="drawbar hidden"></div>
        <div class="markbar hidden"></div>
        <aside class="inspector hidden"></aside>
        <aside class="library ${this.settings.library ? 'open' : ''}">
          <div class="lib-head"><b>Texturas</b><span>Arraste para dentro de uma área</span></div>
          <div class="lib-grid">${TEXTURES.map((t, i) => `<div class="lib-item" data-tex="${i}">${previewSVG(t, 64)}<span>${esc(t.name.replace('Paver · ', ''))}</span>${t.key === 'pavers' ? '<em>paver</em>' : ''}</div>`).join('')}</div>
        </aside>
        <div class="statusbar"><span class="hint"></span><span class="totals"></span></div>
      </div>
    </div>`;
    this.svg = r.querySelector('svg.canvas');
    this.gGrid = r.querySelector('g.grid');
    this.gFills = r.querySelector('g.fills');
    this.gOverlay = r.querySelector('g.overlay');
    this.gMarkup = r.querySelector('g.markup');
    this.gLive = r.querySelector('g.markup-live');
    this.elMarkbar = r.querySelector('.markbar');
    this.elInspector = r.querySelector('.inspector');
    this.elDrawbar = r.querySelector('.drawbar');
    this.elLibrary = r.querySelector('.library');
    this.elHint = r.querySelector('.hint');
    this.elTotals = r.querySelector('.totals');

    // Toque instantâneo (pointerdown) em vez de click: sem atraso e sem perder toques com micro-movimento.
    onFastTap(r.querySelector('.topbar'), 'button', (b) => this.action(b.dataset.a));
    onFastTap(this.elDrawbar, 'button', (b) => {
      const d = b.dataset.d;
      if (d === 'close') this.closeDrawing();
      else if (d === 'finish') this.finishDrawing();
      else if (d === 'undo') this.undo();
      else if (d === 'cancel') this.cancelDrawing();
    });
    onFastTap(this.elMarkbar, 'button', (b) => this.markbarAction(b.dataset));
    this.fan = new RadialMenu(r.querySelector('.stage'), {
      items: FAN_ITEMS.map((it) => ({ ...it, icon: icon(it.icon) })),
      pos: this.settings.fabPos,
      onMove: (pos) => { this.settings.fabPos = pos; saveSettings(this.settings); },
      isActive: (id) => (id === 'arc' ? this.arcMode : id === 'library' ? this.elLibrary.classList.contains('open') : this.tool === id),
      onSelect: (id) => {
        if (id === 'arc') this.action('arc');
        else if (id === 'library') this.action('library');
        else if (id === 'undo') this.undo();
        else this.setTool(id);
      },
    });
    this.svg.addEventListener('pointerdown', (e) => this.onDown(e));
    this.svg.addEventListener('pointermove', (e) => this.onMove(e));
    this.svg.addEventListener('pointerup', (e) => this.onUp(e));
    this.svg.addEventListener('pointercancel', (e) => this.onUp(e, true));
    // Se a captura se perde sem pointerup (sistema, alerta, gesto do iPadOS), limpa o ponteiro —
    // senão ele fica "fantasma" e o próximo toque vira pinça.
    this.svg.addEventListener('lostpointercapture', (e) => { if (this.pointers.has(e.pointerId)) this.onUp(e, true); });
    this.svg.addEventListener('pointerleave', (e) => { if (!this.gesture && this.drawing) { this.drawing.preview = null; this.render(); } void e; });
    this.svg.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
    this.onKey = (e) => this.handleKey(e);
    window.addEventListener('keydown', this.onKey);
    this.onResize = () => this.render();
    window.addEventListener('resize', this.onResize);
    this.bindLibrary();
    this.updateToolbar();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
    this.fan?.destroy();
    this.save();
  }

  // ---------------- Coordenadas ----------------
  size() { const b = this.svg.getBoundingClientRect(); return { w: b.width, h: b.height, left: b.left, top: b.top }; }
  local(e) { const s = this.size(); return { x: e.clientX - s.left, y: e.clientY - s.top }; }
  toWorld(p) { return { x: (p.x - this.view.x) / this.view.k, y: (p.y - this.view.y) / this.view.k }; }
  toScreen(p) { return { x: p.x * this.view.k + this.view.x, y: p.y * this.view.k + this.view.y }; }

  fit() {
    const { w, h } = this.size();
    const pts = [];
    for (const s of this.content.shapes) pts.push(...polygonize(s));
    for (const t of this.content.texts) pts.push({ x: t.x, y: t.y }, { x: t.x + t.w, y: t.y + t.size * 3 });
    pts.push(...markupPoints(this.content.markup));
    if (pts.length < 2) {
      const k = this.view?.k || 60;
      this.view = { k, x: w / 2, y: h / 2 };
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const padR = this.elLibrary.classList.contains('open') ? 250 : 0;
    const pad = 90;
    const k = clamp(Math.min((w - padR - 2 * pad) / Math.max(x1 - x0, 1e-3), (h - 2 * pad - 40) / Math.max(y1 - y0, 1e-3)), 2, 3000);
    this.view = { k, x: (w - padR) / 2 - ((x0 + x1) / 2) * k, y: (h - 40) / 2 - ((y0 + y1) / 2) * k };
  }

  // ---------------- Render ----------------
  render() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.renderNow(); });
  }

  renderNow() {
    if (!this.view) return;
    const { w, h } = this.size();
    const v = this.view;
    this.gGrid.innerHTML = buildGrid(v, w, h, this.content.unit);
    if (this.fillsDirty) { this.gFills.innerHTML = buildFills(this.content); this.fillsDirty = false; }
    this.gFills.setAttribute('transform', `matrix(${v.k} 0 0 ${v.k} ${v.x} ${v.y})`);
    this.gOverlay.innerHTML = buildOverlay(this.content, v, {
      sel: this.sel, tool: this.tool, reports: this.reports, drawing: this.drawing ? { ...this.drawing, arc: this.arcMode } : null,
      freehand: this.freehand,
    });
    const M = `matrix(${v.k} 0 0 ${v.k} ${v.x} ${v.y})`;
    if (this.markupDirty) { this.gMarkup.innerHTML = markupSVG(this.content.markup); this.markupDirty = false; }
    this.gMarkup.setAttribute('transform', M);
    this.gLive.setAttribute('transform', M);
    this.gLive.innerHTML = (this.liveStroke ? strokeSVG(this.liveStroke) : '') +
      (this.eraserPos ? `<circle cx="${this.eraserPos.x}" cy="${this.eraserPos.y}" r="${14 / v.k}" fill="#fff" fill-opacity=".5" stroke="#64748b" stroke-width="${1.5 / v.k}"/>` : '');
    this.updateStatus();
  }

  updateStatus() {
    const st = stats(this.content);
    const u = this.content.unit;
    const hints = {
      select: 'Toque numa cota ou lado para medir · arraste vértices · dois dedos: mover/zoom',
      point: this.drawing ? 'Toque para o próximo ponto · toque no 1º ponto para fechar' : 'Toque para marcar o ponto A',
      free: 'Desenhe o contorno com a Pencil — reconheço retas, arcos e cantos',
      text: 'Toque onde quer a anotação',
      pen: 'Caneta: risque por cima do croqui — não altera medidas nem geometria',
      arrow: 'Seta: arraste do ponto inicial até onde a seta deve apontar',
      eraser: 'Borracha: passe sobre os traços da caneta/setas para apagar',
    };
    let hint = hints[this.tool];
    if (!this.content.calibrated && this.content.shapes.some((s) => s.vertices.length > 1) && this.tool === 'select') hint = 'Esboço sem escala — toque em um lado e digite a medida real';
    this.elHint.textContent = hint;
    const selShape = this.sel?.shapeId && findShape(this.content, this.sel.shapeId);
    if (!this.content.calibrated) { this.elTotals.textContent = ''; return; }
    if (selShape) {
      const p = st.per[selShape.id];
      this.elTotals.innerHTML = `<b>${esc(selShape.name || 'Forma')}</b> · ${selShape.closed ? `Área ${formatArea(p.net, u)} · ` : ''}Perímetro ${formatLength(p.perimeter, u)}`;
    } else {
      this.elTotals.innerHTML = `Área total <b>${formatArea(st.area, u)}</b> · Perímetro <b>${formatLength(st.perimeter, u)}</b>`;
    }
  }

  updateToolbar() {
    const iconKey = this.tool === 'point' && this.arcMode ? 'arc' : TOOL_ICON[this.tool];
    this.fan?.setIcon(icon(iconKey), TOOL_LABEL[this.tool]);
    this.fan?.refresh();
    const vis = this.content.markup.visible !== false;
    const mv = this.root.querySelector('[data-a=markupVis]');
    mv.innerHTML = icon(vis ? 'eye' : 'eyeOff');
    mv.classList.toggle('off', !vis);
    this.updateMarkbar();
    this.root.querySelector('[data-a=unit]').textContent = this.content.unit === 'ft' ? 'ft·in' : 'm';
    this.root.querySelector('[data-a=undo]').disabled = !this.undoStack.length;
    this.root.querySelector('[data-a=redo]').disabled = !this.redoStack.length;
    this.root.querySelector('[data-a=library]').classList.toggle('active', this.elLibrary.classList.contains('open'));
    this.updateDrawbar();
  }

  updateDrawbar() {
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    if (!s) { this.elDrawbar.classList.add('hidden'); return; }
    const n = s.vertices.length;
    this.elDrawbar.classList.remove('hidden');
    this.elDrawbar.innerHTML = `
      <span class="db-count">${n} ponto${n > 1 ? 's' : ''}</span>
      <button class="btn primary" data-d="close" ${n < 3 ? 'disabled' : ''}>Fechar forma</button>
      <button class="btn" data-d="finish" ${n < 2 ? 'disabled' : ''}>Concluir aberta</button>
      <button class="btn" data-d="undo">Desfazer ponto</button>
      <button class="btn danger" data-d="cancel">Cancelar</button>`;
  }

  // Paleta da caneta/seta/borracha: cor, espessura, visibilidade da camada.
  updateMarkbar() {
    const el = this.elMarkbar;
    if (!MARK_TOOLS.includes(this.tool)) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const st = this.settings;
    const vis = this.content.markup.visible !== false;
    const n = this.content.markup.strokes.length;
    el.innerHTML = (this.tool !== 'eraser'
      ? MARK_COLORS.map((c) => `<button class="mk-color ${st.markColor === c.key ? 'on' : ''}" data-mc="${c.key}" aria-label="${c.name}" style="--c:${c.key}"></button>`).join('') +
        '<span class="mk-sep"></span>' +
        MARK_WIDTHS.map((w) => `<button class="mk-width ${st.markWidth === w.key ? 'on' : ''}" data-mw="${w.key}" aria-label="${w.name}"><i style="width:${w.key + 4}px;height:${w.key + 4}px;background:${st.markColor}"></i></button>`).join('') +
        '<span class="mk-sep"></span>'
      : `<span class="mk-label">${n} traço${n === 1 ? '' : 's'}</span>`) +
      `<button class="mk-btn" data-mv="1" aria-label="Mostrar/ocultar anotações">${icon(vis ? 'eye' : 'eyeOff')}</button>` +
      `<button class="mk-btn danger" data-mclear="1" ${n ? '' : 'disabled'}>Limpar</button>`;
  }

  async markbarAction(d) {
    if (d.mc) { this.settings.markColor = d.mc; saveSettings(this.settings); this.updateMarkbar(); }
    else if (d.mw) { this.settings.markWidth = +d.mw; saveSettings(this.settings); this.updateMarkbar(); }
    else if (d.mv) this.action('markupVis');
    else if (d.mclear) {
      if (!(await confirmDialog('Apagar todas as anotações?', 'Só os traços da caneta e as setas. O croqui e as medidas não mudam.', { okLabel: 'Apagar', danger: true }))) return;
      this.content.markup.strokes = [];
      this.commit();
    }
  }

  eraseAt(w) {
    const r = 14 / this.view.k;
    const m = this.content.markup;
    const before = m.strokes.length;
    m.strokes = m.strokes.filter((s) => !strokeHit(s, w, r));
    if (m.strokes.length !== before) { this.gesture.removed += before - m.strokes.length; this.markupDirty = true; }
    this.eraserPos = w;
    this.render();
  }

  // ---------------- Histórico / salvar ----------------
  commit() {
    const snap = JSON.stringify(this.content);
    if (snap === this.lastSnap) return;
    this.undoStack.push(this.lastSnap);
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
    this.lastSnap = snap;
    this.fillsDirty = true;
    this.markupDirty = true;
    this.saveSoon();
    this.updateToolbar();
    this.render();
  }

  restore(snap) {
    this.content = JSON.parse(snap);
    ensureMarkup(this.content);
    this.lastSnap = snap;
    this.fillsDirty = true;
    this.markupDirty = true;
    this.recomputeReports();
    if (this.drawing) {
      const s = findShape(this.content, this.drawing.shapeId);
      if (!s || s.closed) this.drawing = null;
    }
    if (this.sel && !this.selectionValid()) this.sel = null;
    this.updateInspector();
    this.updateToolbar();
    this.saveSoon();
    this.render();
  }

  undo() { if (this.undoStack.length) { this.redoStack.push(this.lastSnap); this.restore(this.undoStack.pop()); } }
  redo() { if (this.redoStack.length) { this.undoStack.push(this.lastSnap); this.restore(this.redoStack.pop()); } }

  selectionValid() {
    const s = this.sel;
    if (s.kind === 'text') return this.content.texts.some((t) => t.id === s.id);
    const sh = findShape(this.content, s.shapeId);
    if (!sh) return false;
    if (s.kind === 'seg') return s.i < segmentCount(sh);
    if (s.kind === 'vertex') return s.i < sh.vertices.length;
    return true;
  }

  recomputeReports() {
    this.reports = {};
    for (const s of this.content.shapes) if (hasMeasures(s)) this.reports[s.id] = solveShape(s).report;
  }

  solve(shape) {
    this.reports[shape.id] = solveInContent(this.content, shape);
    const r = this.reports[shape.id];
    if (r.badSegments.length || r.badVertices.length) toast('Medidas não fecham: erro distribuído — lados/cantos em vermelho');
  }

  async save() {
    this.sketch.content = this.content;
    this.sketch.view = this.view;
    this.sketch.updatedAt = Date.now();
    this.sketch.thumb = buildThumb(this.content);
    this.folder.updatedAt = Date.now();
    this.folder.lastSketchId = this.sketch.id;
    try { await db.putSketch(deepClone(this.sketch)); await db.putFolder({ ...this.folder }); }
    catch (e) { console.error(e); toast('Erro ao salvar localmente'); }
  }

  // ---------------- Ações ----------------
  setTool(t) {
    if (this.drawing && t !== 'point') this.finishDrawing(true);
    this.tool = t;
    if (MARK_TOOLS.includes(t) && this.content.markup.visible === false) {
      this.content.markup.visible = true;
      this.commit();
      toast('Camada de anotações visível');
    }
    if (MARK_TOOLS.includes(t)) { this.sel = null; this.updateInspector(); }
    if (t !== 'select' && this.sel?.kind !== 'shape') { this.sel = null; this.updateInspector(); }
    this.updateToolbar();
    this.render();
  }

  async action(a) {
    switch (a) {
      case 'back': this.save(); this.cb.onBack(); break;
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'arc': this.arcMode = !this.arcMode; if (this.tool !== 'point') this.setTool('point'); this.updateToolbar(); this.render(); break;
      case 'unit': this.content.unit = this.content.unit === 'ft' ? 'm' : 'ft'; this.inputUnit = this.content.unit; this.commit(); this.updateInspector(); break;
      case 'fit': this.fit(); this.render(); this.saveSoon(); break;
      case 'markupVis': {
        const m = this.content.markup;
        m.visible = m.visible === false;
        this.commit();
        toast(m.visible ? 'Anotações visíveis' : 'Anotações ocultas (também na exportação)');
        break;
      }
      case 'library':
        this.elLibrary.classList.toggle('open');
        this.settings.library = this.elLibrary.classList.contains('open');
        saveSettings(this.settings);
        this.updateToolbar();
        break;
      case 'export': return this.exportMenu();
      case 'sketchMenu': return this.sketchMenu();
    }
  }

  async sketchMenu() {
    const items = this.sketches.map((s) => ({ label: (s.id === this.sketch.id ? '● ' : '') + s.name, value: 'open:' + s.id }));
    items.push({ label: '+ Novo croqui nesta pasta', value: 'new' }, { label: 'Renomear croqui', value: 'rename' });
    if (this.sketches.length > 1) items.push({ label: 'Excluir este croqui', value: 'delete', danger: true });
    const v = await menu(this.folder.name, items);
    if (!v) return;
    await this.save();
    if (v.startsWith('open:')) { if (v.slice(5) !== this.sketch.id) this.cb.onSwitch(v.slice(5)); }
    else if (v === 'new') this.cb.onNewSketch();
    else if (v === 'rename') {
      const name = await ask('Nome do croqui', this.sketch.name);
      if (name) { this.sketch.name = name; await this.save(); this.root.querySelector('.t-sketch').textContent = name + ' ▾'; this.cb.onRenameSketch(); }
    } else if (v === 'delete') {
      if (await confirmDialog('Excluir croqui?', `"${this.sketch.name}" será apagado deste aparelho.`, { okLabel: 'Excluir', danger: true })) this.cb.onDeleteSketch(this.sketch.id);
    }
  }

  async exportMenu() {
    const v = await menu('Exportar / Opções', [
      { label: 'Imagem PNG', value: 'png' },
      { label: 'Documento PDF', value: 'pdf' },
      { label: 'Projeto (pasta) em JSON', value: 'json' },
      { label: (this.settings.pencilOnly ? '✓ ' : '') + 'Só a Apple Pencil desenha (dedo navega)', value: 'pencil' },
    ]);
    if (!v) return;
    const meta = {
      title: this.folder.name + (this.sketches.length > 1 ? ' — ' + this.sketch.name : ''),
      subtitle: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) + (this.content.calibrated ? '' : ' · esboço sem escala'),
    };
    const base = safeName(this.folder.name + '-' + this.sketch.name);
    try {
      if (v === 'png') { toast('Gerando PNG…'); await saveFile(await exportPNG(this.content, meta), base + '.png'); }
      else if (v === 'pdf') { toast('Gerando PDF…'); await saveFile(await exportPDF(this.content, meta), base + '.pdf'); }
      else if (v === 'json') { await this.save(); this.cb.onExportFolder(); }
      else if (v === 'pencil') {
        this.settings.pencilOnly = !this.settings.pencilOnly;
        saveSettings(this.settings);
        toast(this.settings.pencilOnly ? 'Só a Pencil desenha — dedo move e dá zoom' : 'Dedo também desenha');
      }
    } catch (e) { console.error(e); toast('Falha ao exportar: ' + e.message); }
  }

  handleKey(e) {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (e.metaKey || e.ctrlKey) return;
    if (k === 'escape') { if (this.drawing) this.finishDrawing(); else { this.sel = null; this.updateInspector(); this.render(); } }
    else if (k === 'enter' && this.drawing) this.finishDrawing();
    else if (k === 'v') this.setTool('select');
    else if (k === 'p') this.setTool('point');
    else if (k === 'f') this.setTool('free');
    else if (k === 't') this.setTool('text');
    else if (k === 'a') this.action('arc');
    else if (k === 'm') this.setTool('pen');
    else if (k === 'e') this.setTool('eraser');
    else if ((k === 'delete' || k === 'backspace') && this.sel) this.deleteSelection();
  }

  deleteSelection() {
    const s = this.sel;
    if (!s) return;
    if (s.kind === 'text') this.content.texts = this.content.texts.filter((t) => t.id !== s.id);
    else if (s.kind === 'vertex') { const sh = findShape(this.content, s.shapeId); deleteVertex(this.content, sh, s.i); if (findShape(this.content, sh.id)) this.solve(sh); }
    else this.content.shapes = this.content.shapes.filter((x) => x.id !== s.shapeId);
    this.sel = null;
    this.updateInspector();
    this.commit();
  }

  // ---------------- Desenho ponto a ponto ----------------
  snapPoint(p) {
    let w = this.toWorld(p);
    const k = this.view.k;
    const res = { w, snap: false, closeHint: false, guide: null };
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    if (s && s.vertices.length >= 3 && dist(w, s.vertices[0]) < 24 / k) return { ...res, w: { ...s.vertices[0] }, snap: true, closeHint: true };
    for (const o of this.content.shapes) {
      for (let i = 0; i < o.vertices.length; i++) {
        if (o === s && i === o.vertices.length - 1) continue;
        if (dist(w, o.vertices[i]) < 16 / k) return { ...res, w: { x: o.vertices[i].x, y: o.vertices[i].y }, snap: true };
      }
    }
    if (s && s.vertices.length) {
      const last = s.vertices[s.vertices.length - 1];
      const d = sub(w, last);
      const L = Math.hypot(d.x, d.y);
      if (L > 1e-9) {
        const ang = Math.atan2(d.y, d.x);
        const cands = [];
        for (let j = 0; j < 8; j++) cands.push((j * Math.PI) / 4);
        if (s.vertices.length >= 2) {
          const pv = s.vertices[s.vertices.length - 2];
          const pa = Math.atan2(last.y - pv.y, last.x - pv.x);
          for (let j = 0; j < 4; j++) cands.push(pa + (j * Math.PI) / 2);
        }
        let best = null, bd = (4 * Math.PI) / 180;
        for (const c of cands) {
          const df = Math.abs(Math.atan2(Math.sin(ang - c), Math.cos(ang - c)));
          if (df < bd) { bd = df; best = c; }
        }
        if (best != null) {
          const dir = { x: Math.cos(best), y: Math.sin(best) };
          w = add(last, mul(dir, dot(d, dir)));
          res.snap = true;
        }
        // guia de alinhamento com o primeiro ponto (fecha retângulos)
        const f = s.vertices[0];
        if (s.vertices.length >= 2) {
          if (Math.abs(w.x - f.x) < 10 / k) { w = { x: f.x, y: w.y }; res.guide = [f]; res.snap = true; }
          else if (Math.abs(w.y - f.y) < 10 / k) { w = { x: w.x, y: f.y }; res.guide = [f]; res.snap = true; }
        }
      }
    }
    res.w = w;
    return res;
  }

  updatePlace(p) {
    if (!this.drawing) this.drawing = { shapeId: null };
    const r = this.snapPoint(p);
    Object.assign(this.drawing, { preview: r.w, snap: r.snap, closeHint: r.closeHint, guide: r.guide });
    this.render();
  }

  placePoint() {
    const d = this.drawing;
    if (!d || !d.preview) return;
    const w = d.preview;
    let s = d.shapeId && findShape(this.content, d.shapeId);
    if (!s) {
      s = newShape(w);
      this.content.shapes.push(s);
      this.drawing = { shapeId: s.id };
      this.sel = { kind: 'shape', shapeId: s.id };
    } else if (d.closeHint) {
      this.closeDrawing();
      return;
    } else {
      const last = s.vertices[s.vertices.length - 1];
      if (dist(last, w) * this.view.k < 6) return;
      s.vertices.push({ x: w.x, y: w.y, angleMode: 'auto' });
      s.segments.push({ ...newSegment(this.arcMode ? 'arc' : 'line'), ...(this.arcMode ? { autoBulge: true } : {}) });
      this.drawing = { shapeId: s.id };
    }
    this.commit();
  }

  closeDrawing() {
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    if (!s || s.vertices.length < 3) return;
    s.segments.push(newSegment(this.arcMode ? 'arc' : 'line'));
    s.closed = true;
    // Arcos desenhados no modo Arco: por padrão abaulam para FORA da forma.
    const orient = signedArea(polygonize({ ...s, segments: s.segments.map((g) => ({ ...g, type: 'line' })) })) >= 0 ? 1 : -1;
    for (const g of s.segments) if (g.type === 'arc' && g.autoBulge) { g.bulge = -orient * Math.abs(g.bulge); delete g.autoBulge; }
    this.drawing = null;
    this.sel = { kind: 'shape', shapeId: s.id };
    if (hasMeasures(s)) this.solve(s);
    this.commit();
    this.setTool('select');
    this.updateInspector();
    toast('Forma fechada — toque nos lados para inserir as medidas');
  }

  finishDrawing(silent) {
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    this.drawing = null;
    if (s && s.vertices.length < 2) {
      this.content.shapes = this.content.shapes.filter((x) => x !== s);
      this.sel = null;
    }
    this.commit();
    if (!silent) this.setTool('select');
    this.updateToolbar();
    this.render();
  }

  cancelDrawing() {
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    this.drawing = null;
    if (s) this.content.shapes = this.content.shapes.filter((x) => x !== s);
    this.sel = null;
    this.commit();
    this.updateToolbar();
    this.render();
  }

  // ---------------- Ponteiros ----------------
  isDrawInput(e) { return e.pointerType !== 'touch' || !this.settings.pencilOnly; }

  hitTest(e, w) {
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-hit]');
    if (el) return { kind: el.dataset.hit, shapeId: el.dataset.s, i: el.dataset.i != null ? +el.dataset.i : null, textId: el.dataset.t };
    const s = shapeAt(this.content, w);
    return s ? { kind: 'shape', shapeId: s.id } : null;
  }

  touches() { return [...this.pointers.values()].filter((q) => q.type === 'touch'); }

  onDown(e) {
    e.preventDefault();
    if (e.pointerType === 'pen') {
      this.penActive = true;
      clearTimeout(this.penTimer);
      if (!this.settings.penSeen) {
        this.settings.penSeen = true; this.settings.pencilOnly = true; saveSettings(this.settings);
        toast('Apple Pencil detectada: a Pencil desenha, o dedo move e dá zoom');
      }
    }
    if (e.pointerType === 'touch' && this.penActive) return; // rejeição de palma
    // Novo gesto de toque (1º dedo): descarta ponteiros de toque que ficaram presos no mapa.
    if (e.pointerType === 'touch' && e.isPrimary) {
      for (const [id, q] of this.pointers) if (q.type === 'touch') this.pointers.delete(id);
      if (this.gesture && !this.pointers.has(this.gesture.id)) this.abortGesture();
    }
    try { this.svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.local(e);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });
    const touches = this.touches();
    if (touches.length >= 2) { this.startPinch(); return; }
    if (this.gesture) return;
    const w = this.toWorld(p);
    const base = { id: e.pointerId, start: p, last: p, moved: false, pointerType: e.pointerType };
    const drawInput = this.isDrawInput(e);
    if (this.tool === 'point') {
      if (drawInput) { this.gesture = { ...base, type: 'place' }; this.updatePlace(p); }
      else this.gesture = { ...base, type: 'pan' };
    } else if (this.tool === 'free') {
      if (drawInput) { this.gesture = { ...base, type: 'free' }; this.freehand = [w]; }
      else this.gesture = { ...base, type: 'pan' };
    } else if (MARK_TOOLS.includes(this.tool)) {
      if (!drawInput) this.gesture = { ...base, type: 'pan' };
      else if (this.tool === 'eraser') { this.gesture = { ...base, type: 'erase', removed: 0 }; this.eraseAt(w); }
      else {
        this.liveStroke = {
          id: uid(), type: this.tool, color: this.settings.markColor, width: this.settings.markWidth / this.view.k,
          pressure: this.tool === 'pen' && e.pointerType === 'pen',
          pts: this.tool === 'arrow' ? [w, { ...w }] : [{ x: w.x, y: w.y, p: e.pressure || 0.5 }],
        };
        this.gesture = { ...base, type: 'mark' };
        this.render();
      }
    } else if (this.tool === 'text') {
      this.gesture = { ...base, type: 'press', target: { kind: 'newtext', w } };
    } else {
      this.gesture = { ...base, type: 'press', target: this.hitTest(e, w), w0: w };
    }
  }

  // Cancela o gesto em andamento sem aplicar nada.
  abortGesture() {
    const g = this.gesture;
    this.gesture = null;
    this.liveStroke = null;
    this.eraserPos = null;
    if (g?.type === 'free') this.freehand = null;
    if (g?.type === 'place' && this.drawing) this.drawing.preview = null;
    if (g && (['dragVertex', 'dragBulge', 'dragShape', 'dragText', 'resizeText'].includes(g.type) || (g.type === 'erase' && g.removed))) this.restore(this.lastSnap);
    this.render();
  }

  startPinch() {
    if (this.gesture?.type === 'mark') this.liveStroke = null;
    if (this.gesture?.type === 'erase') { this.eraserPos = null; if (this.gesture.removed) this.restore(this.lastSnap); }
    if (this.gesture?.type === 'place' && this.drawing) this.drawing.preview = null;
    if (this.gesture?.type === 'free') this.freehand = null;
    if (this.gesture && ['dragVertex', 'dragBulge', 'dragShape', 'dragText', 'resizeText'].includes(this.gesture.type)) this.restore(this.lastSnap);
    const [a, b] = this.touches();
    this.gesture = {
      type: 'pinch', view0: { ...this.view },
      c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, d0: Math.max(10, dist(a, b)),
    };
  }

  onMove(e) {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { ...this.pointers.get(e.pointerId), x: p.x, y: p.y });
    const g = this.gesture;
    if (!g) {
      if (this.tool === 'point' && e.pointerType !== 'touch' && this.isDrawInput(e)) this.updatePlace(p); // hover da Pencil
      return;
    }
    if (g.type === 'pinch') {
      const t = this.touches();
      if (t.length < 2) return;
      const [a, b] = t;
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const k = clamp(g.view0.k * (dist(a, b) / g.d0), 2, 4000);
      const wc = { x: (g.c0.x - g.view0.x) / g.view0.k, y: (g.c0.y - g.view0.y) / g.view0.k };
      this.view = { k, x: c.x - wc.x * k, y: c.y - wc.y * k };
      this.render();
      return;
    }
    if (e.pointerId !== g.id) return;
    const moved = dist(p, g.start) > 8;
    const w = this.toWorld(p);
    switch (g.type) {
      case 'place': this.updatePlace(p); break;
      case 'mark': {
        const s = this.liveStroke;
        if (s.type === 'arrow') s.pts[1] = w;
        else {
          const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
          for (const ce of coalesced) {
            const q = this.toWorld(this.local(ce));
            const last = s.pts[s.pts.length - 1];
            if (dist(q, last) * this.view.k > 1.2) s.pts.push({ x: q.x, y: q.y, p: ce.pressure || 0.5 });
          }
        }
        this.render();
        break;
      }
      case 'erase': {
        const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of coalesced) this.eraseAt(this.toWorld(this.local(ce)));
        break;
      }
      case 'free': {
        const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ce of coalesced) {
          const q = this.toWorld(this.local(ce));
          if (dist(q, this.freehand[this.freehand.length - 1]) * this.view.k > 1.5) this.freehand.push(q);
        }
        this.render();
        break;
      }
      case 'pan':
        this.view.x += p.x - g.last.x; this.view.y += p.y - g.last.y;
        g.moved ||= moved;
        this.render();
        break;
      case 'press': {
        if (!moved) break;
        const t = g.target;
        const selShape = this.sel?.shapeId;
        if (t?.kind === 'vertex') { g.type = 'dragVertex'; this.sel = { kind: 'vertex', shapeId: t.shapeId, i: t.i }; this.updateInspector(); }
        else if (t?.kind === 'bulge') g.type = 'dragBulge';
        else if (t?.kind === 'text') { g.type = 'dragText'; this.sel = { kind: 'text', id: t.textId }; this.updateInspector(); g.w0 = w; }
        else if (t?.kind === 'textresize') g.type = 'resizeText';
        else if ((t?.kind === 'shape' || t?.kind === 'seg' || t?.kind === 'dim') && t.shapeId === selShape) { g.type = 'dragShape'; g.w0 = this.toWorld(g.last); }
        else { g.type = 'pan'; g.moved = true; }
        this.onMove(e);
        return;
      }
      case 'dragVertex': {
        const s = findShape(this.content, g.target.shapeId);
        const v = s.vertices[g.target.i];
        v.x = w.x; v.y = w.y;
        this.fillsDirty = true;
        this.render();
        break;
      }
      case 'dragBulge': {
        const s = findShape(this.content, g.target.shapeId);
        const info = segInfo(s, g.target.i);
        const d = sub(info.p1, info.p0);
        const c = Math.hypot(d.x, d.y);
        const nrm = { x: -d.y / c, y: d.x / c };
        const sag = dot(sub(w, add(info.p0, mul(d, 0.5))), nrm);
        const seg = s.segments[g.target.i];
        seg.bulge = clamp((2 * sag) / c, -3, 3);
        if (Math.abs(seg.bulge) < 0.01) seg.bulge = 0.01 * Math.sign(seg.bulge || 1);
        seg.sagitta = null;
        this.fillsDirty = true;
        this.render();
        break;
      }
      case 'dragShape': {
        const s = findShape(this.content, g.target.shapeId);
        moveShape(s, sub(w, g.w0));
        g.w0 = w;
        this.fillsDirty = true;
        this.render();
        break;
      }
      case 'dragText': {
        const t = this.content.texts.find((x) => x.id === g.target.textId);
        t.x += w.x - g.w0.x; t.y += w.y - g.w0.y; g.w0 = w;
        this.render();
        break;
      }
      case 'resizeText': {
        const t = this.content.texts.find((x) => x.id === g.target.textId);
        t.w = Math.max(60 / this.view.k, w.x - t.x);
        this.render();
        break;
      }
    }
    g.last = p;
  }

  onUp(e, cancelled) {
    if (e.pointerType === 'pen') { clearTimeout(this.penTimer); this.penTimer = setTimeout(() => (this.penActive = false), 350); }
    const had = this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g || !had) return;
    if (g.type === 'pinch') {
      if (this.touches().length < 2) { this.gesture = null; this.saveSoon(); }
      return;
    }
    if (e.pointerId !== g.id) return;
    this.gesture = null;
    if (cancelled) { this.gesture = g; this.abortGesture(); return; }
    switch (g.type) {
      case 'place': this.placePoint(); if (e.pointerType === 'touch' && this.drawing) this.drawing.preview = null; this.updateToolbar(); this.render(); break;
      case 'free': this.finishFreehand(); break;
      case 'mark': {
        const s = this.liveStroke;
        this.liveStroke = null;
        const ok = s.type === 'arrow' ? dist(s.pts[0], s.pts[1]) * this.view.k > 10 : s.pts.length >= 1;
        if (ok) { this.content.markup.strokes.push(s); this.commit(); } else this.render();
        break;
      }
      case 'erase': this.eraserPos = null; if (g.removed) this.commit(); else this.render(); break;
      case 'pan': this.saveSoon(); break;
      case 'press': this.tap(g.target); break;
      case 'dragVertex': case 'dragBulge': {
        const s = findShape(this.content, g.target.shapeId);
        if (hasMeasures(s)) this.solve(s);
        this.commit(); this.updateInspector();
        break;
      }
      case 'dragShape': case 'dragText': case 'resizeText': this.commit(); break;
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.local(e);
    if (e.ctrlKey || e.metaKey || e.deltaMode === 1 || Math.abs(e.deltaY) > 50 && !e.deltaX) {
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      const k = clamp(this.view.k * f, 2, 4000);
      const w = this.toWorld(p);
      this.view = { k, x: p.x - w.x * k, y: p.y - w.y * k };
    } else { this.view.x -= e.deltaX; this.view.y -= e.deltaY; }
    this.render();
    this.saveSoon();
  }

  tap(t) {
    if (this.tool === 'text') {
      const k = this.view.k;
      const txt = { id: uid(), x: t.w.x, y: t.w.y, w: 220 / k, size: 16 / k, text: 'Anotação' };
      this.content.texts.push(txt);
      this.sel = { kind: 'text', id: txt.id };
      this.commit();
      this.setTool('select');
      this.updateInspector({ focus: true });
      return;
    }
    if (!t) this.sel = null;
    else if (t.kind === 'vertex') this.sel = { kind: 'vertex', shapeId: t.shapeId, i: t.i };
    else if (t.kind === 'seg' || t.kind === 'dim' || t.kind === 'bulge') this.sel = { kind: 'seg', shapeId: t.shapeId, i: t.i };
    else if (t.kind === 'text' || t.kind === 'textresize') this.sel = { kind: 'text', id: t.textId };
    else if (t.kind === 'shape') this.sel = { kind: 'shape', shapeId: t.shapeId };
    this.updateInspector({ focus: this.sel?.kind === 'seg' });
    this.ensureVisible();
    this.render();
  }

  // Desloca a vista se o item selecionado ficou atrás do painel lateral esquerdo.
  ensureVisible() {
    if (!this.sel || this.elInspector.classList.contains('hidden')) return;
    const s = this.sel.shapeId && findShape(this.content, this.sel.shapeId);
    if (!s) return;
    let p;
    if (this.sel.kind === 'seg') p = segInfo(s, this.sel.i).mid;
    else if (this.sel.kind === 'vertex') p = s.vertices[this.sel.i];
    else return;
    const q = this.toScreen(p);
    const ib = this.elInspector.getBoundingClientRect();
    const sz = this.size();
    const right = ib.right - sz.left + 40;
    if (q.x < right && q.y < ib.bottom - sz.top + 20) {
      this.view.x += right - q.x + 20;
      this.saveSoon();
    }
  }

  finishFreehand() {
    const pts = this.freehand;
    this.freehand = null;
    if (!pts || pts.length < 4) { this.render(); return; }
    const r = recognizeStroke(pts, 1 / this.view.k);
    if (!r) { toast('Traço muito curto'); this.render(); return; }
    const s = newShape(r.vertices[0]);
    s.vertices = r.vertices.map((v) => ({ x: v.x, y: v.y, angleMode: 'auto' }));
    s.segments = r.segments.map((g) => ({ ...newSegment(g.type, g.bulge), bulge: g.type === 'arc' ? g.bulge : 0 }));
    s.closed = r.closed;
    // Esquadrejar: ângulos quase retos viram retos, lados quase paralelos ficam paralelos.
    const tidy = solveShape(s, { force: true });
    s.vertices = tidy.vertices;
    this.content.shapes.push(s);
    this.sel = { kind: 'shape', shapeId: s.id };
    this.commit();
    this.updateInspector();
    const nArc = s.segments.filter((x) => x.type === 'arc').length;
    toast(`Reconhecido: ${s.segments.length - nArc} reta(s)${nArc ? `, ${nArc} arco(s)` : ''}${s.closed ? ', forma fechada' : ''}`);
  }

  // ---------------- Biblioteca de texturas (arrastar e soltar) ----------------
  bindLibrary() {
    this.elLibrary.querySelectorAll('.lib-item').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const tex = TEXTURES[+el.dataset.tex];
        const ghost = el.cloneNode(true);
        ghost.classList.add('ghost');
        document.body.appendChild(ghost);
        const start = { x: e.clientX, y: e.clientY };
        let moved = false;
        const pos = (ev) => { ghost.style.left = ev.clientX - 40 + 'px'; ghost.style.top = ev.clientY - 40 + 'px'; };
        pos(e);
        el.setPointerCapture(e.pointerId);
        const move = (ev) => { if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 6) moved = true; pos(ev); ghost.style.opacity = moved ? 1 : 0; };
        const up = (ev) => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
          ghost.remove();
          if (ev.type === 'pointercancel') return;
          let target = null;
          if (moved) {
            const s = this.size();
            const p = { x: ev.clientX - s.left, y: ev.clientY - s.top };
            const over = document.elementFromPoint(ev.clientX, ev.clientY);
            if (over && this.svg.contains(over)) target = shapeAt(this.content, this.toWorld(p));
            if (!target) { toast('Solte dentro de uma área fechada'); return; }
          } else {
            target = this.sel?.shapeId && findShape(this.content, this.sel.shapeId);
            if (!target || !target.closed) { toast('Arraste a textura para dentro de uma área fechada'); return; }
          }
          const prev = target.fill;
          target.fill = { ...defaultFill(tex.key, tex.pattern), color: prev?.texture === tex.key ? prev.color : null };
          this.sel = { kind: 'shape', shapeId: target.id };
          this.commit();
          this.updateInspector();
          toast(`${textureName(target.fill)} aplicado`);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      });
    });
  }

  // ---------------- Painel de propriedades ----------------
  updateInspector(opts = {}) {
    const el = this.elInspector;
    const s = this.sel;
    if (!s || (this.tool !== 'select' && s.kind !== 'shape') || (s.kind === 'shape' && this.drawing)) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    if (s.kind === 'seg') this.inspectSegment(el, opts);
    else if (s.kind === 'vertex') this.inspectVertex(el);
    else if (s.kind === 'shape') this.inspectShape(el);
    else if (s.kind === 'text') this.inspectText(el, opts);
    el.querySelector('[data-x=close]')?.addEventListener('click', () => { this.sel = null; this.updateInspector(); this.render(); });
  }

  measureWidget(id, valueM, unitMode) {
    if (unitMode === 'ft') {
      const fi = valueM != null ? mToFeetInches(valueM) : null;
      return `<div class="measure"><input id="${id}-ft" inputmode="decimal" enterkeyhint="done" placeholder="0" value="${fi ? fi.ft : ''}"><span>ft</span>
        <input id="${id}-in" inputmode="decimal" enterkeyhint="done" placeholder="0" value="${fi && fi.inch ? fi.inch : ''}"><span>in</span></div>`;
    }
    return `<div class="measure"><input id="${id}-m" class="wide" inputmode="decimal" enterkeyhint="done" placeholder="0,00" value="${valueM != null ? String(Math.round(valueM * 1000) / 1000).replace('.', ',') : ''}"><span>m</span></div>`;
  }

  readMeasure(el, id, unitMode) {
    if (unitMode === 'ft') return feetInchesToM(el.querySelector(`#${id}-ft`).value, el.querySelector(`#${id}-in`).value);
    const v = parseNumber(el.querySelector(`#${id}-m`).value);
    return v;
  }

  inspectSegment(el, opts) {
    const shape = findShape(this.content, this.sel.shapeId);
    const i = this.sel.i;
    const seg = shape.segments[i];
    const info = segInfo(shape, i);
    const n = shape.vertices.length;
    const u = this.content.unit;
    this.inputUnit ??= u;
    const iu = this.inputUnit;
    const report = this.reports[shape.id];
    const err = report?.segErr?.[i];
    const bad = report?.badSegments?.includes(i);
    const name = `${vertexLabel(i)}–${vertexLabel((i + 1) % n)}`;
    const cur = this.content.calibrated ? formatLength(info.chord, u) : 'sem escala';
    el.innerHTML = `
      <div class="insp-head"><b>Lado ${name}</b><button class="ib sm" data-x="close">${icon('close')}</button></div>
      <div class="seg-toggle"><button class="chip ${seg.type === 'line' ? 'on' : ''}" data-t="line">Reta</button><button class="chip ${seg.type === 'arc' ? 'on' : ''}" data-t="arc">Arco</button></div>
      <label>${seg.type === 'arc' ? 'Corda (reta entre as pontas)' : 'Medida real'}</label>
      ${this.measureWidget('len', seg.length, iu)}
      ${seg.type === 'arc' ? `<label>Flecha (maior afastamento do arco à corda)</label>${this.measureWidget('sag', seg.sagitta != null ? Math.abs(seg.sagitta) : null, iu)}` : ''}
      <div class="unit-switch"><button class="chip ${iu === 'ft' ? 'on' : ''}" data-u="ft">pés/pol</button><button class="chip ${iu === 'm' ? 'on' : ''}" data-u="m">metros</button></div>
      <div class="row"><button class="btn primary" data-x="apply">Aplicar</button><button class="btn" data-x="next">Aplicar e próximo →</button></div>
      <div class="info">Desenho atual: ${cur}${seg.length != null && err != null && this.content.calibrated ? ` · diferença ${err >= 0 ? '+' : ''}${formatLength(err, u)}` : ''}
      ${seg.type === 'arc' && info.arc && this.content.calibrated ? `<br>Raio ≈ ${formatLength(info.arc.r, u)} · comprimento do arco ≈ ${formatLength(info.arc.length, u)}` : ''}</div>
      ${bad ? '<div class="warn">⚠ Esta medida não fecha com as outras. O erro foi distribuído; confira a medida ou libere um ângulo.</div>' : ''}
      <div class="row"><button class="btn" data-x="clear" ${seg.length == null && seg.sagitta == null ? 'disabled' : ''}>Limpar medida</button><button class="btn" data-x="split">Inserir ponto</button></div>
      ${seg.type === 'arc' ? '<div class="row"><button class="btn" data-x="flip">Inverter arco (para dentro/fora)</button></div>' : ''}`;
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
      seg.type = b.dataset.t;
      seg.bulge = seg.type === 'arc' ? (seg.bulge || 0.35) : 0;
      if (seg.type === 'line') seg.sagitta = null;
      if (hasMeasures(shape)) this.solve(shape);
      this.commit(); this.updateInspector();
    }));
    el.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => { this.inputUnit = b.dataset.u; this.updateInspector({ focus: true }); }));
    const apply = (next) => {
      const L = this.readMeasure(el, 'len', iu);
      const hasLenInput = el.querySelector('.measure input').value.trim() !== '' || (iu === 'ft' && el.querySelector('#len-in').value.trim() !== '');
      if (hasLenInput) {
        if (!(L > 0)) { toast('Medida inválida'); return; }
        seg.length = L;
      }
      if (seg.type === 'arc') {
        const sg = this.readMeasure(el, 'sag', iu);
        if (isFinite(sg) && sg > 0) seg.sagitta = sg * Math.sign(seg.bulge || 1);
      }
      this.solve(shape);
      this.commit();
      if (next) {
        const m = segmentCount(shape);
        let j = (i + 1) % m;
        for (let k = 0; k < m; k++) { if (shape.segments[(i + 1 + k) % m].length == null) { j = (i + 1 + k) % m; break; } }
        this.sel = { kind: 'seg', shapeId: shape.id, i: j };
      }
      this.updateInspector({ focus: next });
      this.ensureVisible();
      this.render();
    };
    el.querySelector('[data-x=apply]').onclick = () => apply(false);
    el.querySelector('[data-x=next]').onclick = () => apply(true);
    el.querySelectorAll('.measure input').forEach((inp) => (inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(true); } }));
    el.querySelector('[data-x=clear]').onclick = () => {
      seg.length = null; seg.sagitta = null;
      if (hasMeasures(shape)) this.solve(shape); else delete this.reports[shape.id];
      this.commit(); this.updateInspector();
    };
    el.querySelector('[data-x=flip]')?.addEventListener('click', () => {
      seg.bulge = -seg.bulge;
      if (seg.sagitta != null) seg.sagitta = -seg.sagitta;
      this.commit(); this.updateInspector();
    });
    el.querySelector('[data-x=split]').onclick = () => {
      insertVertex(shape, i);
      this.sel = { kind: 'vertex', shapeId: shape.id, i: i + 1 };
      this.recomputeReports();
      this.commit(); this.updateInspector();
    };
    if (opts.focus) {
      const f = el.querySelector('.measure input');
      f.focus({ preventScroll: true }); f.select();
    }
  }

  inspectVertex(el) {
    const shape = findShape(this.content, this.sel.shapeId);
    const i = this.sel.i;
    const v = shape.vertices[i];
    const ang = interiorAngleDeg(shape, i);
    const mode = v.angleMode || 'auto';
    const bad = this.reports[shape.id]?.badVertices?.includes(i);
    el.innerHTML = `
      <div class="insp-head"><b>Vértice ${vertexLabel(i)}</b><button class="ib sm" data-x="close">${icon('close')}</button></div>
      ${ang != null ? `<div class="big">${ang.toFixed(1)}°</div><label>Restrição de ângulo</label>
      <div class="seg-toggle four">
        <button class="chip ${mode === 'auto' ? 'on' : ''}" data-m="auto">Auto</button>
        <button class="chip ${mode === 'right' ? 'on' : ''}" data-m="right">90°</button>
        <button class="chip ${mode === 'fixed' ? 'on' : ''}" data-m="fixed">Fixo</button>
        <button class="chip ${mode === 'free' ? 'on' : ''}" data-m="free">Livre</button>
      </div>
      <div class="measure ${mode === 'fixed' ? '' : 'hidden'}"><input id="ang" class="wide" inputmode="decimal" value="${v.angle ?? (ang != null ? ang.toFixed(1) : '')}"><span>°</span><button class="btn primary" data-x="ang">OK</button></div>
      <div class="info">Auto: ângulos perto de 90°, 45°, 135° e 180° são endireitados; os demais mantêm o esboço.</div>
      ${bad ? '<div class="warn">⚠ Este ângulo não fecha com as medidas.</div>' : ''}` : '<div class="info">Ponta de linha aberta.</div>'}
      <div class="row"><button class="btn danger" data-x="del">Excluir vértice</button></div>`;
    el.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => {
      v.angleMode = b.dataset.m;
      if (v.angleMode === 'fixed') { v.angle = v.angle ?? Math.round(ang * 10) / 10; }
      this.solve(shape); this.commit(); this.updateInspector();
    }));
    const angBtn = el.querySelector('[data-x=ang]');
    if (angBtn) {
      const go = () => {
        const a = parseNumber(el.querySelector('#ang').value);
        if (!(a > 0 && a < 360)) { toast('Ângulo inválido'); return; }
        v.angleMode = 'fixed'; v.angle = a;
        this.solve(shape); this.commit(); this.updateInspector();
      };
      angBtn.onclick = go;
      el.querySelector('#ang').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    }
    el.querySelector('[data-x=del]').onclick = () => this.deleteSelection();
  }

  inspectShape(el) {
    const shape = findShape(this.content, this.sel.shapeId);
    const st = stats(this.content).per[shape.id];
    const u = this.content.unit;
    const f = shape.fill;
    const cal = this.content.calibrated;
    let fillHtml = '<div class="info">Arraste uma textura da biblioteca (à direita) para dentro desta área, ou toque numa textura com a área selecionada.</div>';
    if (f) {
      const colors = f.texture === 'pavers' ? PAVER_COLORS : f.texture === 'deck' ? DECK_COLORS : null;
      fillHtml = `<div class="fill-name">${esc(textureName(f))}</div>
        ${f.texture === 'pavers' ? `<label>Padrão</label><select id="pat">${PAVER_PATTERNS.map((p) => `<option value="${p.key}" ${p.key === f.pattern ? 'selected' : ''}>${p.name}</option>`).join('')}</select>` : ''}
        ${colors ? `<label>Cor</label><div class="swatches">${colors.map((c) => `<button class="sw ${(f.color ?? colors[0].key) === c.key ? 'on' : ''}" data-c="${c.key}" title="${c.name}" style="background:${c.shades[0]}"></button>`).join('')}</div>` : ''}
        <label>Escala <span id="scv">${(f.scale || 1).toFixed(2)}×</span></label><input type="range" id="sc" min="-2" max="2" step="0.05" value="${Math.log2(f.scale || 1)}">
        <label>Rotação <span id="rov">${Math.round(f.rotation || 0)}°</span></label><input type="range" id="ro" min="0" max="180" step="1" value="${f.rotation || 0}">
        <div class="row"><button class="btn" data-x="nofill">Remover textura</button></div>`;
    }
    el.innerHTML = `
      <div class="insp-head"><b>Área</b><button class="ib sm" data-x="close">${icon('close')}</button></div>
      <label>Nome</label><input id="nm" class="field" placeholder="ex.: Piscina, Pátio, Calçada" value="${esc(shape.name || '')}">
      ${cal ? `<div class="stats">${shape.closed ? `<div><span>Área</span><b>${formatArea(st.net, u)}</b>${st.net !== st.area ? `<em>bruta ${formatArea(st.area, u)}</em>` : ''}</div>` : ''}<div><span>Perímetro</span><b>${formatLength(st.perimeter, u)}</b></div></div>` : '<div class="info">Sem escala ainda: toque em um lado e informe a medida real.</div>'}
      ${shape.closed ? `<label>Acabamento</label>${fillHtml}` : ''}
      <div class="row">
        <button class="btn" data-x="square">Esquadrejar</button>
        ${!shape.closed && shape.vertices.length >= 3 ? '<button class="btn" data-x="closeShape">Fechar forma</button>' : ''}
        <button class="btn danger" data-x="del">Excluir</button>
      </div>`;
    const nm = el.querySelector('#nm');
    nm.onchange = () => { shape.name = nm.value.trim(); this.commit(); };
    nm.onkeydown = (e) => { if (e.key === 'Enter') nm.blur(); };
    if (f) {
      el.querySelector('#pat')?.addEventListener('change', (e) => { f.pattern = e.target.value; this.commit(); });
      el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { f.color = b.dataset.c; this.commit(); this.updateInspector(); }));
      const sc = el.querySelector('#sc'), ro = el.querySelector('#ro');
      sc.oninput = () => { f.scale = Math.pow(2, +sc.value); el.querySelector('#scv').textContent = f.scale.toFixed(2) + '×'; this.fillsDirty = true; this.render(); };
      ro.oninput = () => { f.rotation = +ro.value; el.querySelector('#rov').textContent = f.rotation + '°'; this.fillsDirty = true; this.render(); };
      sc.onchange = ro.onchange = () => this.commit();
      el.querySelector('[data-x=nofill]').onclick = () => { shape.fill = null; this.commit(); this.updateInspector(); };
    }
    el.querySelector('[data-x=square]').onclick = () => {
      if (hasMeasures(shape)) this.solve(shape);
      else { const r = solveShape(shape, { force: true }); shape.vertices = r.vertices; }
      this.commit(); toast('Ângulos e paralelos ajustados');
    };
    el.querySelector('[data-x=closeShape]')?.addEventListener('click', () => {
      shape.segments.push(newSegment('line')); shape.closed = true;
      if (hasMeasures(shape)) this.solve(shape);
      this.commit(); this.updateInspector();
    });
    el.querySelector('[data-x=del]').onclick = async () => {
      if (await confirmDialog('Excluir esta área?', '', { okLabel: 'Excluir', danger: true })) this.deleteSelection();
    };
  }

  inspectText(el, opts) {
    const t = this.content.texts.find((x) => x.id === this.sel.id);
    el.innerHTML = `
      <div class="insp-head"><b>Texto</b><button class="ib sm" data-x="close">${icon('close')}</button></div>
      <textarea id="tx" rows="4" class="field">${esc(t.text)}</textarea>
      <label>Tamanho da fonte</label>
      <div class="row"><button class="btn" data-x="smaller">A−</button><button class="btn" data-x="bigger">A+</button><button class="btn danger" data-x="del">Excluir</button></div>
      <div class="info">Arraste a caixa para mover; puxe o quadradinho azul para mudar a largura.</div>`;
    const tx = el.querySelector('#tx');
    const commitSoon = debounce(() => this.commit(), 600);
    tx.oninput = () => { t.text = tx.value; this.render(); commitSoon(); };
    el.querySelector('[data-x=smaller]').onclick = () => { t.size /= 1.15; this.commit(); };
    el.querySelector('[data-x=bigger]').onclick = () => { t.size *= 1.15; this.commit(); };
    el.querySelector('[data-x=del]').onclick = () => this.deleteSelection();
    if (opts.focus) { tx.focus(); tx.select(); }
  }
}

