// Editor de croqui: ferramentas, gestos, painéis, histórico e salvamento automático.
import { db } from './db.js';
import { uid, clamp, debounce, esc, vertexLabel, deepClone } from './util.js';
import { dist, sub, add, mul, dot, segInfo, segmentCount, polygonize, interiorAngleDeg, signedArea, filletInfo } from './geometry.js';
import { formatLength, formatArea, parseNumber } from './units.js';
import { solveShape } from './solver.js';
import { recognizeStroke } from './freehand.js';
import {
  newShape, newSegment, solveInContent, findShape, shapeAt, stats, deleteVertex, moveShape, hasMeasures,
  splitSegment, splitSegmentN, segmentParamAt, removeVertex, mergeWithNext, mergeWithPrev, simplifyShape, closeShape,
  mergeVertices, looseVertices, contentBounds, joinClusters, joinCluster, joinAll, deleteSegment, reverseShape,
} from './model.js';
import { OBJECT_TYPES, newObject, objectAt, objectType, objectPreviewSVG } from './objects.js';
import { showContextMenu, hideContextMenu } from './ctxmenu.js';
import { labelPoint, norm, distToSegment } from './geometry.js';
import { lengthTolerance } from './solver.js';
import { buildFills, buildGrid, buildOverlay, buildThumb, buildImages } from './render.js';
import { TEXTURES, PAVER_PATTERNS, PAVER_COLORS, DECK_COLORS, previewSVG, defaultFill, textureName } from './textures.js';
import { exportPNG, exportPDF, safeName } from './export.js';
import { toast, confirmDialog, menu, saveFile, ask, pickFile } from './ui.js';
import { onFastTap, spring, haptic } from './motion.js';
import { PencilPalette } from './palette.js';
import { MeasurePad, measurementBus } from './measure.js';
import { getSettings, saveSettings, openSettings } from './settings.js';
import { canvasPalette, onThemeChange } from './theme.js';
import {
  ensureMarkup, markupSVG, strokeSVG, strokeHit, markupPoints, strokesInLasso, strokesBBox, INSTRUMENTS, DRAW_INSTRUMENTS,
} from './markup.js';

// Ícones em traço fino, estilo SF Symbols.
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  measure: '<path d="M3.5 16.5L16.5 3.5l4 4-13 13z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
  point: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M6.6 16.6l10.8-9.2"/>',
  free: '<path d="M3 17c3-6 5 2 8-3s4-8 7-6 1 7 3 8"/>',
  pen: '<path d="M4 20l1.4-4.6L16 4.8a2 2 0 012.9 0l.3.3a2 2 0 010 2.9L8.6 18.6z"/><path d="M14 6.8l3.2 3.2"/>',
  text: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  shapes: '<rect x="3.5" y="11.5" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="7.5" r="4.5"/>',
  textures: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M3.5 12h17M12 3.5v17M3.5 7.8h8.5M12 16.2h8.5"/>',
  attach: '<path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.5-8.5a3.3 3.3 0 014.7 4.7l-8.5 8.5a1.7 1.7 0 01-2.4-2.4l7.8-7.8"/>',
  objects: '<ellipse cx="8" cy="7" rx="3.5" ry="1.6"/><path d="M4.5 7v10c0 .9 1.6 1.6 3.5 1.6s3.5-.7 3.5-1.6V7"/><rect x="14" y="5.5" width="6" height="13" rx="1"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  share: '<path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M6 11H5v9h14v-9h-1"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
};
const icon = (k, s = 22) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const TOOLS = [
  { id: 'markup', label: 'Desenho', icon: 'pen' },
  { id: 'point', label: 'Ponto a ponto', icon: 'point' },
  { id: 'free', label: 'Mão livre', icon: 'free' },
  { id: 'select', label: 'Medida', icon: 'measure' },
  { id: 'text', label: 'Texto', icon: 'text' },
];
const ACTIONS_CENTER = [
  { a: 'shapes', label: 'Formas', icon: 'shapes' },
  { a: 'library', label: 'Texturas', icon: 'textures' },
  { a: 'objects', label: 'Objetos', icon: 'objects' },
];

export class Editor {
  constructor(root, { folder, sketch, sketches, onBack, onSwitch, onNewSketch, onRenameSketch, onDeleteSketch, onDuplicateSketch, onExportFolder }) {
    this.root = root;
    this.folder = folder;
    this.sketch = sketch;
    this.sketches = sketches;
    this.cb = { onBack, onSwitch, onNewSketch, onRenameSketch, onDeleteSketch, onDuplicateSketch, onExportFolder };
    this.content = sketch.content;
    ensureMarkup(this.content);
    this.content.images ??= [];
    this.content.objects ??= [];
    this.settings = getSettings();
    this.snap = null;        // estado do encaixe em andamento (anel, guias)
    this.pendingMerge = null; // "Unir com…": aguardando o 2º vértice
    this.pal = canvasPalette();
    this.markupDirty = true;
    this.imagesDirty = true;
    this.liveStroke = null;
    this.eraserPos = null;
    this.lasso = null;
    this.markSel = [];
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
    // Fonte externa de medida (futura trena Bluetooth): aplica no lado selecionado e avança.
    this.unsubMeasure = measurementBus.subscribe((m) => this.applyExternalMeasure(m));
    this.unsubTheme = onThemeChange(() => { this.pal = canvasPalette(); this.fillsDirty = true; this.markupDirty = true; this.render(); });
  }

  // ---------------- DOM ----------------
  mount() {
    const r = this.root;
    r.innerHTML = `
    <div class="editor">
      <div class="stage">
        <svg class="canvas" xmlns="http://www.w3.org/2000/svg">
          <g class="grid"></g><g class="images"></g><g class="fills"></g><g class="overlay"></g><g class="markup"></g><g class="markup-live"></g>
        </svg>
        <header class="fbar">
          <div class="cap cap-left">
            <button class="ib" data-a="back" aria-label="Voltar">${icon('back')}</button>
            <button class="title-btn" data-a="sketchMenu" aria-label="Opções do croqui"><span class="t-sketch">${esc(this.sketch.name)}</span>${icon('chevron', 16)}</button>
          </div>
          <div class="cap cap-center" role="toolbar" aria-label="Ferramentas">
            ${TOOLS.map((t) => `<button class="ib tool" data-tool="${t.id}" aria-label="${t.label}" title="${t.label}">${icon(t.icon)}</button>`).join('')}
            <span class="cap-sep"></span>
            ${ACTIONS_CENTER.map((t) => `<button class="ib" data-a="${t.a}" aria-label="${t.label}" title="${t.label}">${icon(t.icon)}</button>`).join('')}
          </div>
          <div class="cap cap-right">
            <button class="ib" data-a="undo" aria-label="Desfazer">${icon('undo')}</button>
            <button class="ib" data-a="export" aria-label="Compartilhar / exportar">${icon('share')}</button>
            <button class="ib" data-a="more" aria-label="Mais opções">${icon('more')}</button>
          </div>
        </header>
        <div class="drawbar hidden"></div>
        <div class="lasso-bar hidden"><button class="btn" data-l="dup">Duplicar</button><button class="btn danger" data-l="del">Apagar</button></div>
        <aside class="inspector hidden"></aside>
        <aside class="library ${this.settings.library ? 'open' : ''}" data-tab="${this.settings.libraryTab || 'textures'}">
          <div class="lib-head"><div class="seg2 lib-tabs"><button data-lt="textures">Texturas</button><button data-lt="objects">Objetos</button></div>
            <span class="lib-sub"></span></div>
          <div class="lib-grid tex">${TEXTURES.map((t, i) => `<div class="lib-item" data-tex="${i}">${previewSVG(t, 64)}<span>${esc(t.name.replace('Paver · ', ''))}</span>${t.key === 'pavers' ? '<em>paver</em>' : ''}</div>`).join('')}</div>
          <div class="lib-grid obj">${Object.entries(OBJECT_TYPES).map(([k, t]) => `<div class="lib-item" data-obj="${k}">${objectPreviewSVG(k, 64)}<span>${esc(t.name)}</span><em>${esc(t.category)}</em></div>`).join('')}</div>
        </aside>
        <div class="statusbar"><span class="left"><button class="shape-state hidden" data-ss="1"></button><span class="hint"></span></span><span class="totals"></span></div>
      </div>
    </div>`;
    this.stage = r.querySelector('.stage');
    this.svg = r.querySelector('svg.canvas');
    this.gGrid = r.querySelector('g.grid');
    this.gImages = r.querySelector('g.images');
    this.gFills = r.querySelector('g.fills');
    this.gOverlay = r.querySelector('g.overlay');
    this.gMarkup = r.querySelector('g.markup');
    this.gLive = r.querySelector('g.markup-live');
    this.elInspector = r.querySelector('.inspector');
    this.elDrawbar = r.querySelector('.drawbar');
    this.elLasso = r.querySelector('.lasso-bar');
    this.elLibrary = r.querySelector('.library');
    this.elHint = r.querySelector('.hint');
    this.elState = r.querySelector('.shape-state');
    onFastTap(this.elState.parentElement, '.shape-state', () => this.stateAction());
    onFastTap(r.querySelector('.lib-tabs'), 'button', (b) => this.setLibraryTab(b.dataset.lt));
    this.setLibraryTab(this.settings.libraryTab || 'textures', true);
    this.elTotals = r.querySelector('.totals');

    // Toque instantâneo (pointerdown): sem atraso e sem perder toques com micro-movimento.
    onFastTap(r.querySelector('.fbar'), 'button', (b) => (b.dataset.tool ? this.setTool(b.dataset.tool) : this.action(b.dataset.a, b)));
    onFastTap(this.elDrawbar, 'button', (b) => {
      const d = b.dataset.d;
      if (d === 'line' || d === 'arc') { this.arcMode = d === 'arc'; this.updateToolbar(); this.render(); }
      else if (d === 'close') this.closeDrawing();
      else if (d === 'finish') this.finishDrawing();
      else if (d === 'undo') this.undo();
      else if (d === 'cancel') this.cancelDrawing();
    });
    onFastTap(this.elLasso, 'button', (b) => this.lassoAction(b.dataset.l));

    const ps = this.settings.pencil;
    this.palette = new PencilPalette(this.stage, ps, {
      onChange: () => { saveSettings(this.settings); this.updateStatus(); },
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      canUndo: () => this.undoStack.length > 0,
      canRedo: () => this.redoStack.length > 0,
      getVisible: () => this.content.markup.visible !== false,
      onToggleVisible: () => this.action('markupVis'),
      onClear: () => this.clearMarkup(),
    });
    this.palette.el.classList.add('hidden');

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
    this.palette?.destroy();
    this.unsubMeasure?.();
    this.unsubTheme?.();
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
    for (const im of this.content.images) pts.push({ x: im.x, y: im.y }, { x: im.x + im.w, y: im.y + im.h });
    pts.push(...markupPoints(this.content.markup));
    if (pts.length < 2) {
      const k = this.view?.k || 60;
      this.view = { k, x: w / 2, y: h / 2 };
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const padR = this.elLibrary.classList.contains('open') ? 250 : 0;
    const pad = 90, top = 70;
    const k = clamp(Math.min((w - padR - 2 * pad) / Math.max(x1 - x0, 1e-3), (h - top - 2 * pad - 40) / Math.max(y1 - y0, 1e-3)), 2, 3000);
    this.view = { k, x: (w - padR) / 2 - ((x0 + x1) / 2) * k, y: top + (h - top - 40) / 2 - ((y0 + y1) / 2) * k };
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
    const P = this.pal;
    const M = `matrix(${v.k} 0 0 ${v.k} ${v.x} ${v.y})`;
    this.gGrid.innerHTML = this.settings.showGrid === false ? '' : buildGrid(v, w, h, this.content.unit, P);
    this.loose = this.tool === 'markup' ? null : this.looseState();
    if (this.imagesDirty) { this.gImages.innerHTML = buildImages(this.content); this.imagesDirty = false; }
    this.gImages.setAttribute('transform', M);
    if (this.fillsDirty) { this.gFills.innerHTML = buildFills(this.content, P); this.fillsDirty = false; }
    this.gFills.setAttribute('transform', M);
    this.gOverlay.innerHTML = this.imageOverlay() + buildOverlay(this.content, v, {
      sel: this.sel, tool: this.tool, reports: this.reports, drawing: this.drawing ? { ...this.drawing, arc: this.arcMode } : null,
      freehand: this.freehand, loose: this.loose, guides: this.snap?.guides, snapRing: this.snap?.ring, live: this.live,
    }, { palette: P, dimPx: this.settings.dimPx, showArea: this.settings.showArea, netArea: this.settings.netArea });
    const dark = P.name === 'dark';
    if (this.markupDirty) { this.gMarkup.innerHTML = markupSVG(this.content.markup, { dark }); this.markupDirty = false; }
    this.gMarkup.setAttribute('transform', M);
    this.gLive.setAttribute('transform', M);
    this.gLive.innerHTML = (this.liveStroke ? strokeSVG(this.liveStroke, { dark }) : '') + this.markupOverlay(v);
    this.updateStatus();
  }

  // Moldura + alça do anexo selecionado (coordenadas de tela).
  imageOverlay() {
    if (this.sel?.kind !== 'image') return '';
    const im = this.content.images.find((x) => x.id === this.sel.id);
    if (!im) return '';
    const a = this.toScreen({ x: im.x, y: im.y }), b = this.toScreen({ x: im.x + im.w, y: im.y + im.h });
    return `<rect x="${a.x}" y="${a.y}" width="${b.x - a.x}" height="${b.y - a.y}" fill="none" stroke="${this.pal.accent}" stroke-width="2" stroke-dasharray="6 4"/>` +
      `<g data-hit="imgresize" data-t="${im.id}"><circle cx="${b.x}" cy="${b.y}" r="20" fill="transparent"/><rect x="${b.x - 8}" y="${b.y - 8}" width="16" height="16" rx="4" fill="${this.pal.accent}" stroke="${this.pal.handle}" stroke-width="2"/></g>`;
  }

  // Borracha, laço em andamento e seleção do laço (coordenadas do mundo).
  markupOverlay(v) {
    let o = '';
    if (this.eraserPos) o += `<circle cx="${this.eraserPos.x}" cy="${this.eraserPos.y}" r="${14 / v.k}" fill="${this.pal.handle}" fill-opacity=".5" stroke="#8e8e93" stroke-width="${1.5 / v.k}"/>`;
    if (this.lasso?.length > 1) o += `<path d="M${this.lasso.map((p) => `${p.x} ${p.y}`).join('L')}" fill="#8e8e93" fill-opacity=".08" stroke="#8e8e93" stroke-width="${1.5 / v.k}" stroke-dasharray="${6 / v.k} ${4 / v.k}"/>`;
    const sel = this.selectedStrokes();
    if (sel.length) {
      const b = strokesBBox(sel), p = 6 / v.k;
      o += `<rect x="${b.x0 - p}" y="${b.y0 - p}" width="${b.x1 - b.x0 + 2 * p}" height="${b.y1 - b.y0 + 2 * p}" rx="${6 / v.k}" fill="#0a84ff" fill-opacity=".06" stroke="#0a84ff" stroke-width="${1.5 / v.k}" stroke-dasharray="${6 / v.k} ${4 / v.k}"/>`;
    }
    return o;
  }

  selectedStrokes() { return this.markSel.length ? this.content.markup.strokes.filter((s) => this.markSel.includes(s.id)) : []; }

  updateStatus() {
    const st = stats(this.content);
    const u = this.content.unit;
    const inst = INSTRUMENTS.find((i) => i.id === this.settings.pencil.instrument);
    const hints = {
      select: 'Toque numa cota ou lado para medir · arraste vértices · dois dedos: mover/zoom',
      point: this.drawing ? 'Toque para o próximo ponto · toque no 1º ponto para fechar' : 'Toque para marcar o ponto A',
      free: 'Desenhe o contorno com a Pencil — reconheço retas, arcos e cantos',
      text: 'Toque onde quer a anotação',
      markup: {
        eraser: 'Borracha: passe sobre as anotações para apagar — o croqui não é afetado',
        lasso: 'Laço: contorne anotações para mover, duplicar ou apagar',
        ruler: 'Régua: arraste para traçar uma linha reta' + (this.palette?.tool('ruler').arrow ? ' com seta' : ''),
      }[inst?.id] ?? `${inst?.name ?? 'Caneta'}: anote por cima — não altera medidas nem geometria`,
    };
    let hint = hints[this.tool];
    if (!this.content.calibrated && this.content.shapes.some((s) => s.vertices.length > 1) && this.tool === 'select') hint = 'Esboço sem escala — toque em um lado e digite a medida real';
    this.elHint.textContent = hint;
    const selShape = this.sel?.shapeId && findShape(this.content, this.sel.shapeId);
    this.updateShapeState(selShape);
    if (!this.content.calibrated || this.settings.showArea === false) { this.elTotals.textContent = ''; return; }
    const net = this.settings.netArea !== false;
    if (selShape) {
      const p = st.per[selShape.id];
      const a = net ? p.net : p.net + (p.objArea || 0);
      this.elTotals.innerHTML = `<b>${esc(selShape.name || 'Forma')}</b> · ${selShape.closed ? `Área ${formatArea(a, u)}${p.objArea && net ? ' líq.' : ''} · ` : ''}Perímetro ${formatLength(p.perimeter, u)}`;
    } else {
      const a = net ? st.areaNet : st.area;
      this.elTotals.innerHTML = `Área total <b>${formatArea(a, u)}</b>${st.objArea && net ? ` líq. <span class="muted">(bruta ${formatArea(st.area, u)})</span>` : ''} · Perímetro <b>${formatLength(st.perimeter, u)}</b>`;
    }
  }

  updateToolbar() {
    this.root.querySelectorAll('.fbar [data-tool]').forEach((b) => {
      const on = b.dataset.tool === this.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    const libOpen = this.elLibrary.classList.contains('open');
    this.root.querySelector('.fbar [data-a=library]').classList.toggle('on', libOpen && this.elLibrary.dataset.tab === 'textures');
    this.root.querySelector('.fbar [data-a=objects]').classList.toggle('on', libOpen && this.elLibrary.dataset.tab === 'objects');
    this.root.querySelector('.fbar [data-a=undo]').disabled = !this.undoStack.length;
    this.showPalette(this.tool === 'markup');
    if (this.tool === 'markup') this.palette.refresh();
    this.elLasso.classList.toggle('hidden', !(this.tool === 'markup' && this.markSel.length));
    this.updateDrawbar();
  }

  // Painéis abrem/fecham com escala + opacidade juntas (mola), a partir da ferramenta tocada.
  showPalette(show) {
    const el = this.palette.el;
    const visible = !el.classList.contains('hidden');
    if (show === visible && !this.paletteAnim) return;
    this.paletteAnim?.stop();
    if (show) { el.classList.remove('hidden'); this.palette.place(); }
    const from = this.paletteK ?? (show ? 0 : 1);
    this.paletteAnim = spring({
      from, to: show ? 1 : 0, stiffness: 480, damping: 34,
      onUpdate: (k) => { this.paletteK = k; el.style.opacity = clamp(k * 1.3, 0, 1); el.style.transform = `scale(${0.82 + 0.18 * k})`; },
      onDone: () => { this.paletteAnim = null; if (!show) el.classList.add('hidden'); },
    });
  }

  updateDrawbar() {
    if (this.tool !== 'point') { this.elDrawbar.classList.add('hidden'); return; }
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    const n = s ? s.vertices.length : 0;
    this.elDrawbar.classList.remove('hidden');
    this.elDrawbar.innerHTML = `
      <div class="seg2"><button class="${this.arcMode ? '' : 'on'}" data-d="line">Reta</button><button class="${this.arcMode ? 'on' : ''}" data-d="arc">Arco</button></div>
      ${s ? `<span class="db-count">${n} ponto${n > 1 ? 's' : ''}</span>
      <button class="btn primary" data-d="close" ${n < 3 ? 'disabled' : ''}>Fechar forma</button>
      <button class="btn" data-d="finish" ${n < 2 ? 'disabled' : ''}>Concluir aberta</button>
      <button class="btn" data-d="undo">Desfazer ponto</button>
      <button class="btn danger" data-d="cancel">Cancelar</button>` : '<span class="db-count">Toque no canvas para marcar o ponto A</span>'}`;
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

  async clearMarkup() {
    if (!this.content.markup.strokes.length) { toast('Não há anotações'); return; }
    if (!(await confirmDialog('Apagar todas as anotações?', 'Só a camada de desenho por cima. O croqui e as medidas não mudam.', { okLabel: 'Apagar', danger: true }))) return;
    this.content.markup.strokes = [];
    this.markSel = [];
    this.commit();
  }

  lassoAction(a) {
    const ids = new Set(this.markSel);
    const m = this.content.markup;
    if (a === 'del') { m.strokes = m.strokes.filter((s) => !ids.has(s.id)); this.markSel = []; }
    else if (a === 'dup') {
      const off = 20 / this.view.k;
      const copies = m.strokes.filter((s) => ids.has(s.id)).map((s) => ({ ...s, id: uid(), pts: s.pts.map((p) => ({ ...p, x: p.x + off, y: p.y + off })) }));
      m.strokes.push(...copies);
      this.markSel = copies.map((s) => s.id);
    }
    this.commit();
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
    this.imagesDirty = true;
    this.saveSoon();
    this.updateToolbar();
    this.render();
  }

  restore(snap) {
    this.content = JSON.parse(snap);
    ensureMarkup(this.content);
    this.content.images ??= [];
    this.content.objects ??= [];
    this.lastSnap = snap;
    this.fillsDirty = true;
    this.markupDirty = true;
    this.imagesDirty = true;
    this.markSel = this.markSel.filter((id) => this.content.markup.strokes.some((s) => s.id === id));
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

  undo() { if (this.undoStack.length) { this.redoStack.push(this.lastSnap); this.keepVisualSize(() => this.restore(this.undoStack.pop())); } }
  redo() { if (this.redoStack.length) { this.undoStack.push(this.lastSnap); this.keepVisualSize(() => this.restore(this.redoStack.pop())); } }

  // 1.3 — Escala real ≠ zoom da tela. Quando uma medida reescala/redesenha o croqui, o zoom
  // compensa na mesma hora: o desenho fica do MESMO tamanho e no MESMO lugar na tela.
  drawingBox() {
    const pts = contentBounds(this.content);
    for (const o of this.content.objects || []) pts.push({ x: o.x, y: o.y });
    if (pts.length < 2) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const size = Math.hypot(x1 - x0, y1 - y0);
    return size > 1e-6 ? { c: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, size } : null;
  }

  keepVisualSize(fn) {
    const b0 = this.view && this.drawingBox();
    const r = fn();
    const b1 = b0 && this.drawingBox();
    if (!b0 || !b1) return r;
    const v = this.view;
    const k = clamp(v.k * (b0.size / b1.size), 2, 4000);
    const sc = { x: b0.c.x * v.k + v.x, y: b0.c.y * v.k + v.y }; // centro do desenho na tela (antes)
    this.view = { k, x: sc.x - b1.c.x * k, y: sc.y - b1.c.y * k };
    this.render();
    return r;
  }

  selectionValid() {
    const s = this.sel;
    if (s.kind === 'text') return this.content.texts.some((t) => t.id === s.id);
    if (s.kind === 'image') return this.content.images.some((t) => t.id === s.id);
    if (s.kind === 'obj') return this.content.objects.some((t) => t.id === s.id);
    const sh = findShape(this.content, s.shapeId);
    if (!sh) return false;
    if (s.kind === 'seg') return s.i < segmentCount(sh);
    if (s.kind === 'vertex') return s.i < sh.vertices.length;
    if (s.kind === 'fillet') return !!filletInfo(sh, s.i);
    return true;
  }

  recomputeReports() {
    this.reports = {};
    for (const s of this.content.shapes) if (hasMeasures(s)) this.reports[s.id] = solveShape(s).report;
  }

  // fit: a mudança veio de uma MEDIDA digitada → o zoom compensa (1.3). Arrastes não compensam.
  solve(shape, fit = false) {
    const run = () => solveInContent(this.content, shape);
    this.reports[shape.id] = fit ? this.keepVisualSize(run) : run();
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
    if (t !== 'markup') this.markSel = [];
    this.tool = t;
    if (t === 'markup' && this.content.markup.visible === false) {
      this.content.markup.visible = true;
      this.commit();
      toast('Camada de anotações visível');
    }
    if (t === 'markup') { this.sel = null; this.updateInspector(); }
    if (t !== 'select' && this.sel?.kind !== 'shape') { this.sel = null; this.updateInspector(); }
    this.updateToolbar();
    this.render();
  }

  async action(a, btn) {
    switch (a) {
      case 'back': this.save(); this.cb.onBack(); break;
      case 'undo': this.undo(); break;
      case 'redo': this.redo(); break;
      case 'unit': this.content.unit = this.content.unit === 'ft' ? 'm' : 'ft'; this.commit(); this.updateInspector(); toast(this.content.unit === 'ft' ? 'Unidade: pés e polegadas' : 'Unidade: metros'); break;
      case 'fit': this.fit(); this.render(); this.saveSoon(); break;
      case 'markupVis': {
        const m = this.content.markup;
        m.visible = m.visible === false;
        this.commit();
        toast(m.visible ? 'Anotações visíveis' : 'Anotações ocultas (também na exportação)');
        break;
      }
      case 'library': case 'objects': {
        const tab = a === 'objects' ? 'objects' : 'textures';
        const open = this.elLibrary.classList.contains('open');
        if (open && this.elLibrary.dataset.tab === tab) this.elLibrary.classList.remove('open');
        else { this.elLibrary.classList.add('open'); this.setLibraryTab(tab); }
        this.settings.library = this.elLibrary.classList.contains('open');
        saveSettings(this.settings);
        this.updateToolbar();
        break;
      }
      case 'shapes': return this.shapesMenu();
      case 'attach': return this.attachImage();
      case 'export': return this.exportMenu();
      case 'more': return this.moreMenu();
      case 'settings':
        return openSettings({ onChange: (s) => {
          const { pencil, library, libraryTab, ...rest } = s;
          void pencil; void library; void libraryTab;
          Object.assign(this.settings, rest);
          this.fillsDirty = true;
          this.render();
          this.updateInspector();
        } });
      case 'sketchMenu': return this.sketchMenu();
    }
    void btn;
  }

  async moreMenu() {
    const vis = this.content.markup.visible !== false;
    const v = await menu('Mais opções', [
      { label: 'Configurações…', value: 'settings' },
      { label: 'Anexar foto de referência…', value: 'attach' },
      { label: `Unidade deste croqui: ${this.content.unit === 'ft' ? 'pés/pol → trocar para metros' : 'metros → trocar para pés/pol'}`, value: 'unit' },
      { label: 'Ajustar desenho à tela', value: 'fit' },
      { label: vis ? 'Ocultar anotações' : 'Mostrar anotações', value: 'markupVis' },
      { label: 'Refazer', value: 'redo' },
    ]);
    if (v) this.action(v);
  }

  async sketchMenu() {
    const items = [
      { label: 'Renomear', value: 'rename' },
      { label: 'Duplicar', value: 'dup' },
      { label: 'Exportar…', value: 'export' },
      { label: '+ Novo croqui neste projeto', value: 'new' },
    ];
    if (this.sketches.length > 1) {
      for (const s of this.sketches) if (s.id !== this.sketch.id) items.push({ label: 'Abrir: ' + s.name, value: 'open:' + s.id });
      items.push({ label: 'Excluir este croqui', value: 'delete', danger: true });
    }
    const v = await menu(this.folder.name + ' · ' + this.sketch.name, items);
    if (!v) return;
    await this.save();
    if (v.startsWith('open:')) this.cb.onSwitch(v.slice(5));
    else if (v === 'new') this.cb.onNewSketch();
    else if (v === 'dup') this.cb.onDuplicateSketch(this.sketch);
    else if (v === 'export') this.exportMenu();
    else if (v === 'rename') {
      const name = await ask('Nome do croqui', this.sketch.name);
      if (name) { this.sketch.name = name; await this.save(); this.root.querySelector('.t-sketch').textContent = name; this.cb.onRenameSketch(); }
    } else if (v === 'delete') {
      if (await confirmDialog('Excluir croqui?', `"${this.sketch.name}" será apagado deste aparelho.`, { okLabel: 'Excluir', danger: true })) this.cb.onDeleteSketch(this.sketch.id);
    }
  }

  async exportMenu() {
    const v = await menu('Compartilhar', [
      { label: 'Imagem PNG', value: 'png' },
      { label: 'Documento PDF', value: 'pdf' },
      { label: 'Projeto em JSON (backup)', value: 'json' },
    ]);
    if (!v) return;
    const date = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const meta = {
      title: this.folder.name + (this.sketches.length > 1 ? ' — ' + this.sketch.name : ''),
      subtitle: this.content.calibrated ? '' : 'Esboço sem escala',
      project: this.folder.name + (this.sketches.length > 1 ? ' · ' + this.sketch.name : ''),
      date,
      useLogo: this.settings.exportLogo !== false,
      includeMarkup: this.settings.exportMarkup !== false,
      netArea: this.settings.netArea !== false,
    };
    const base = safeName(this.folder.name + '-' + this.sketch.name);
    try {
      if (v === 'png') { toast('Gerando PNG…'); await saveFile(await exportPNG(this.content, meta), base + '.png'); }
      else if (v === 'pdf') { toast('Gerando PDF…'); await saveFile(await exportPDF(this.content, meta), base + '.pdf'); }
      else if (v === 'json') { await this.save(); this.cb.onExportFolder(); }
    } catch (e) { console.error(e); toast('Falha ao exportar: ' + e.message); }
  }

  // Formas prontas: entram no centro da vista como esboço (sem escala), prontas para medir.
  async shapesMenu() {
    const v = await menu('Formas', [
      { label: 'Retângulo', value: 'rect' },
      { label: 'Quadrado', value: 'square' },
      { label: 'Círculo', value: 'circle' },
      { label: 'Piscina oval (retângulo com pontas redondas)', value: 'oval' },
      { label: 'Forma em L', value: 'L' },
    ]);
    if (!v) return;
    const { w, h } = this.size();
    const c = this.toWorld({ x: w / 2, y: h / 2 + 20 });
    const u = (Math.min(w, h) * 0.18) / this.view.k;
    const P = (pts) => pts.map(([x, y]) => ({ x: c.x + x * u, y: c.y + y * u, angleMode: 'auto' }));
    const s = newShape(c);
    s.closed = true;
    if (v === 'rect') { s.vertices = P([[-1.6, -1], [1.6, -1], [1.6, 1], [-1.6, 1]]); s.segments = [0, 1, 2, 3].map(() => newSegment('line')); }
    else if (v === 'square') { s.vertices = P([[-1, -1], [1, -1], [1, 1], [-1, 1]]); s.segments = [0, 1, 2, 3].map(() => newSegment('line')); }
    else if (v === 'circle') { s.vertices = P([[-1.2, 0], [1.2, 0]]); s.segments = [{ ...newSegment('arc'), bulge: 1 }, { ...newSegment('arc'), bulge: 1 }]; }
    else if (v === 'oval') {
      s.vertices = P([[-1.2, -1], [1.2, -1], [1.2, 1], [-1.2, 1]]);
      s.segments = [newSegment('line'), { ...newSegment('arc'), bulge: 1 }, newSegment('line'), { ...newSegment('arc'), bulge: 1 }];
    } else if (v === 'L') { s.vertices = P([[-1.6, -1.2], [1.6, -1.2], [1.6, 0], [0, 0], [0, 1.2], [-1.6, 1.2]]); s.segments = s.vertices.map(() => newSegment('line')); }
    // Arcos abaulam para fora.
    const orient = signedArea(polygonize({ ...s, segments: s.segments.map((g) => ({ ...g, type: 'line' })) })) >= 0 ? 1 : -1;
    for (const g of s.segments) if (g.type === 'arc') g.bulge = -orient * Math.abs(g.bulge);
    this.content.shapes.push(s);
    this.setTool('select');
    this.sel = { kind: 'shape', shapeId: s.id };
    this.commit();
    this.updateInspector();
    toast('Forma inserida — toque nos lados para medir');
  }

  // Anexo: foto de referência (ex.: do local) sob o desenho, para traçar por cima.
  async attachImage() {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = new Image(); img.src = url; await img.decode();
      const max = 1600, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const src = c.toDataURL('image/jpeg', 0.82);
      const { w, h } = this.size();
      const ww = (w * 0.5) / this.view.k, hh = (ww * c.height) / c.width;
      const ctr = this.toWorld({ x: w / 2, y: h / 2 });
      const im = { id: uid(), src, x: ctr.x - ww / 2, y: ctr.y - hh / 2, w: ww, h: hh, opacity: 0.8 };
      this.content.images.push(im);
      this.setTool('select');
      this.sel = { kind: 'image', id: im.id };
      this.commit();
      this.updateInspector();
      toast('Anexo inserido por baixo do desenho');
    } catch (e) { console.error(e); toast('Não consegui abrir a imagem'); }
  }

  imageAt(w) {
    for (let i = this.content.images.length - 1; i >= 0; i--) {
      const im = this.content.images[i];
      if (w.x >= im.x && w.x <= im.x + im.w && w.y >= im.y && w.y <= im.y + im.h) return im;
    }
    return null;
  }

  // Chega uma medida de fonte externa: aplica no lado selecionado, como "Aplicar e próximo".
  applyExternalMeasure(m) {
    if (this.sel?.kind !== 'seg') { toast('Selecione um lado para receber a medida'); return; }
    const shape = findShape(this.content, this.sel.shapeId);
    shape.segments[this.sel.i].length = m;
    this.solve(shape, true);
    this.commit();
    this.selectNextSegment(shape, this.sel.i);
    this.updateInspector();
    this.render();
  }

  selectNextSegment(shape, i) {
    const m = segmentCount(shape);
    let j = (i + 1) % m;
    for (let k = 0; k < m; k++) { if (shape.segments[(i + 1 + k) % m].length == null) { j = (i + 1 + k) % m; break; } }
    this.sel = { kind: 'seg', shapeId: shape.id, i: j };
    this.ensureVisible();
  }

  handleKey(e) {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (this.sel?.kind === 'seg' && /^[0-9.,]$|^Backspace$|^Tab$/.test(e.key)) return; // teclado da medida
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (e.metaKey || e.ctrlKey) return;
    if (k === 'escape') { if (this.drawing) this.finishDrawing(); else { this.sel = null; this.markSel = []; this.updateInspector(); this.updateToolbar(); this.render(); } }
    else if (k === 'enter' && this.drawing) this.finishDrawing();
    else if (k === 'v') this.setTool('select');
    else if (k === 'p') this.setTool('point');
    else if (k === 'f') this.setTool('free');
    else if (k === 't') this.setTool('text');
    else if (k === 'a') { this.arcMode = !this.arcMode; this.setTool('point'); }
    else if (k === 'm') this.setTool('markup');
    else if ((k === 'delete' || k === 'backspace') && this.markSel.length) this.lassoAction('del');
    else if ((k === 'delete' || k === 'backspace') && this.sel) this.deleteSelection();
  }

  deleteSelection() {
    const s = this.sel;
    if (!s) return;
    if (s.kind === 'text') this.content.texts = this.content.texts.filter((t) => t.id !== s.id);
    else if (s.kind === 'image') this.content.images = this.content.images.filter((t) => t.id !== s.id);
    else if (s.kind === 'obj') this.content.objects = this.content.objects.filter((t) => t.id !== s.id);
    else if (s.kind === 'vertex') { const sh = findShape(this.content, s.shapeId); deleteVertex(this.content, sh, s.i); if (findShape(this.content, sh.id)) this.solve(sh); }
    else this.content.shapes = this.content.shapes.filter((x) => x.id !== s.shapeId);
    this.sel = null;
    this.updateInspector();
    this.commit();
  }

  // ---------------- Desenho ponto a ponto ----------------
  // ---------------- Encaixe (snap) ----------------
  // Motor único para desenhar, arrastar vértices e posicionar colunas. Tolerâncias em px de tela.
  // opts: { exclude: Set("shapeId:i"), from, prev, allowClose: shape }
  snapWorld(w, opts = {}) {
    const k = this.view.k;
    const R = (this.settings.snapPx || 15) / k;
    const res = { w: { ...w }, target: null, close: false, guides: [], ring: null, kind: null };
    const cs = opts.allowClose;
    if (cs && cs.vertices.length >= 3 && dist(w, cs.vertices[0]) < R * 1.4) {
      return { ...res, w: { ...cs.vertices[0] }, close: true, ring: cs.vertices[0], kind: 'close', target: { shapeId: cs.id, i: 0 } };
    }
    if (this.settings.snap === false) return res;
    // 1) vértice existente
    let best = null, bd = R;
    for (const o of this.content.shapes) o.vertices.forEach((v, i) => {
      if (opts.exclude?.has(o.id + ':' + i)) return;
      const d = dist(w, v);
      if (d < bd) { bd = d; best = { shapeId: o.id, i, v }; }
    });
    if (best) return { ...res, w: { x: best.v.x, y: best.v.y }, target: { shapeId: best.shapeId, i: best.i }, ring: best.v, kind: 'vertex' };
    let p = { ...w };
    // 2) ângulo em relação ao ponto anterior (0/45/90 e perpendicular à parede anterior)
    let dir = null;
    if (opts.from) {
      const d = sub(p, opts.from), L = Math.hypot(d.x, d.y);
      if (L > 1e-9) {
        const ang = Math.atan2(d.y, d.x);
        const cands = [];
        for (let j = 0; j < 8; j++) cands.push((j * Math.PI) / 4);
        if (opts.prev) { const pa = Math.atan2(opts.from.y - opts.prev.y, opts.from.x - opts.prev.x); for (let j = 0; j < 4; j++) cands.push(pa + (j * Math.PI) / 2); }
        let bc = null, ba = (4 * Math.PI) / 180;
        for (const c of cands) { const df = Math.abs(Math.atan2(Math.sin(ang - c), Math.cos(ang - c))); if (df < ba) { ba = df; bc = c; } }
        if (bc != null) { dir = { x: Math.cos(bc), y: Math.sin(bc) }; p = add(opts.from, mul(dir, dot(d, dir))); res.kind = 'angle'; }
      }
    }
    // 3) alinhamento horizontal/vertical com vértices existentes (cruza com a direção travada, se houver)
    const A = 9 / k;
    let ax = null, ay = null;
    for (const o of this.content.shapes) o.vertices.forEach((v, i) => {
      if (opts.exclude?.has(o.id + ':' + i)) return;
      if (ax == null && Math.abs(p.x - v.x) < A) ax = v;
      if (ay == null && Math.abs(p.y - v.y) < A) ay = v;
    });
    const tryAlign = (axis, v) => {
      let q;
      if (!dir) q = axis === 'x' ? { x: v.x, y: p.y } : { x: p.x, y: v.y };
      else {
        const den = axis === 'x' ? dir.x : dir.y;
        if (Math.abs(den) < 1e-6) return false;
        const t = axis === 'x' ? (v.x - opts.from.x) / dir.x : (v.y - opts.from.y) / dir.y;
        q = add(opts.from, mul(dir, t));
      }
      if (dist(q, w) > 14 / k) return false;
      p = q; res.guides.push([v, q]); res.kind = res.kind || 'align';
      return true;
    };
    if (ax) tryAlign('x', ax);
    if (ay && !(dir && res.guides.length)) tryAlign('y', ay);
    // 4) extensão de paredes existentes
    if (!res.guides.length) {
      for (const o of this.content.shapes) {
        for (let i = 0, m = segmentCount(o); i < m; i++) {
          if (o.segments[i].type === 'arc') continue;
          const [a, b] = [o.vertices[i], o.vertices[(i + 1) % o.vertices.length]];
          if (opts.exclude?.has(o.id + ':' + i) || opts.exclude?.has(o.id + ':' + ((i + 1) % o.vertices.length))) continue;
          const u = norm(sub(b, a)), t = dot(sub(p, a), u), L = dist(a, b);
          if (t > -1e-9 && t < L) continue; // dentro da parede não é "extensão"
          const q = add(a, mul(u, t));
          if (dist(q, p) < 8 / k) { p = q; res.guides.push([t < 0 ? a : b, q]); res.kind = res.kind || 'ext'; break; }
        }
        if (res.guides.length) break;
      }
    }
    res.w = p;
    return res;
  }

  // Háptico só ao ENTRAR num encaixe (não a cada movimento).
  feelSnap(r) {
    const key = r.target ? r.target.shapeId + ':' + r.target.i : r.close ? 'close' : r.guides.length ? 'g' + r.kind : '';
    if (key && key !== this.lastSnapKey) haptic();
    this.lastSnapKey = key;
  }

  snapPoint(p) {
    const w = this.toWorld(p);
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    const n = s ? s.vertices.length : 0;
    const exclude = new Set(s ? [s.id + ':' + (n - 1)] : []);
    const r = this.snapWorld(w, { exclude, from: s?.vertices[n - 1], prev: n >= 2 ? s.vertices[n - 2] : null, allowClose: s });
    this.feelSnap(r);
    return { w: r.w, snap: !!(r.target || r.guides.length || r.kind), closeHint: r.close, guide: null, target: r.target, guides: r.guides, ring: r.ring };
  }

  updatePlace(p) {
    if (!this.drawing) this.drawing = { shapeId: null };
    const r = this.snapPoint(p);
    Object.assign(this.drawing, { preview: r.w, snap: r.snap, closeHint: r.closeHint, guide: null, target: r.target });
    this.snap = { guides: r.guides, ring: r.ring };
    this.render();
  }

  // Ponta de forma aberta? (para emendar formas ao desenhar)
  isOpenEnd(t) {
    const o = t && findShape(this.content, t.shapeId);
    return o && !o.closed && (t.i === 0 || t.i === o.vertices.length - 1);
  }

  placePoint() {
    const d = this.drawing;
    if (!d || !d.preview) return;
    const w = d.preview;
    let s = d.shapeId && findShape(this.content, d.shapeId);
    this.snap = null;
    if (!s) {
      // Começar em cima da ponta de uma forma aberta = continuar aquela forma.
      if (this.isOpenEnd(d.target)) {
        const o = findShape(this.content, d.target.shapeId);
        if (d.target.i === 0) reverseShape(o);
        this.drawing = { shapeId: o.id };
        this.sel = { kind: 'shape', shapeId: o.id };
        toast('Continuando o contorno existente');
        this.render();
        return;
      }
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
      // Soltou na ponta de OUTRA forma aberta: conecta as duas (vira um contorno só).
      if (d.target && d.target.shapeId !== s.id && this.isOpenEnd(d.target)) {
        const r = mergeVertices(this.content, d.target, { shapeId: s.id, i: s.vertices.length - 1 }, 'first');
        haptic();
        if (r.shape) {
          this.drawing = r.shape.closed ? null : { shapeId: r.shape.id };
          this.sel = { kind: 'shape', shapeId: r.shape.id };
          if (r.shape.closed) { this.commit(); this.setTool('select'); toast('Contornos unidos e fechados'); return; }
          toast('Conectado ao contorno existente');
        }
      }
    }
    this.commit();
  }

  closeDrawing() {
    const s = this.drawing && findShape(this.content, this.drawing.shapeId);
    if (!s || s.vertices.length < 3) return;
    s.segments.push({ ...newSegment(this.arcMode ? 'arc' : 'line'), ...(this.arcMode ? { autoBulge: true } : {}) });
    s.closed = true;
    this.snap = null;
    haptic();
    // Arcos desenhados no modo Arco: por padrão abaulam para FORA da forma.
    const orient = signedArea(polygonize({ ...s, segments: s.segments.map((g) => ({ ...g, type: 'line' })) })) >= 0 ? 1 : -1;
    for (const g of s.segments) if (g.type === 'arc' && g.autoBulge) { g.bulge = -orient * Math.abs(g.bulge); delete g.autoBulge; }
    this.drawing = null;
    this.sel = { kind: 'shape', shapeId: s.id };
    if (hasMeasures(s)) this.solve(s, true);
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
    const ob = objectAt(this.content, w);
    if (ob) return { kind: 'obj', textId: ob.id };
    const s = shapeAt(this.content, w);
    if (s) return { kind: 'shape', shapeId: s.id };
    const im = this.imageAt(w);
    return im ? { kind: 'image', textId: im.id } : null;
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
    // Anel de "pontos quase juntos": tocar nele une, em qualquer ferramenta de desenho.
    const pair = ((this.tool === 'point' && !this.drawing) || this.tool === 'free') && document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-hit=pair]');
    if (pair) { this.gesture = { ...base, type: 'press', target: { kind: 'pair', i: +pair.dataset.i }, w0: w }; return; }
    if (this.tool === 'point') {
      if (drawInput) { this.gesture = { ...base, type: 'place' }; this.updatePlace(p); }
      else this.gesture = { ...base, type: 'pan' };
    } else if (this.tool === 'free') {
      if (drawInput) { this.gesture = { ...base, type: 'free' }; this.freehand = [w]; }
      else this.gesture = { ...base, type: 'pan' };
    } else if (this.tool === 'markup') {
      const inst = this.settings.pencil.instrument;
      if (!drawInput) this.gesture = { ...base, type: 'pan' };
      else if (inst === 'eraser') { this.gesture = { ...base, type: 'erase', removed: 0 }; this.eraseAt(w); }
      else if (inst === 'lasso') {
        const sel = this.selectedStrokes();
        const b = sel.length && strokesBBox(sel), pad = 10 / this.view.k;
        if (b && w.x > b.x0 - pad && w.x < b.x1 + pad && w.y > b.y0 - pad && w.y < b.y1 + pad) this.gesture = { ...base, type: 'moveMarks', w0: w };
        else { this.markSel = []; this.lasso = [w]; this.gesture = { ...base, type: 'lasso' }; this.updateToolbar(); }
        this.render();
      } else {
        const t = this.palette.tool(inst);
        const def = INSTRUMENTS.find((i) => i.id === inst);
        const type = inst === 'ruler' ? (t.arrow ? 'arrow' : 'line') : inst;
        this.liveStroke = {
          id: uid(), type, color: t.color, width: t.width / this.view.k, opacity: t.opacity ?? 1,
          pressure: !!def.pressure && e.pointerType === 'pen',
          pts: inst === 'ruler' ? [w, { ...w }] : [{ x: w.x, y: w.y, p: e.pressure || 0.5 }],
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
    this.lasso = null;
    if (g?.type === 'free') this.freehand = null;
    if (g?.type === 'place' && this.drawing) this.drawing.preview = null;
    if (g && (['dragVertex', 'dragBulge', 'dragFillet', 'dragShape', 'dragText', 'resizeText', 'dragImage', 'resizeImage', 'moveMarks'].includes(g.type) || (g.type === 'erase' && g.removed))) this.restore(this.lastSnap);
    this.render();
  }

  startPinch() {
    if (this.gesture?.type === 'mark') this.liveStroke = null;
    if (this.gesture?.type === 'lasso') this.lasso = null;
    if (this.gesture?.type === 'moveMarks') this.restore(this.lastSnap);
    if (this.gesture?.type === 'erase') { this.eraserPos = null; if (this.gesture.removed) this.restore(this.lastSnap); }
    if (this.gesture?.type === 'place' && this.drawing) this.drawing.preview = null;
    if (this.gesture?.type === 'free') this.freehand = null;
    if (this.gesture && ['dragVertex', 'dragBulge', 'dragFillet', 'dragShape', 'dragText', 'resizeText', 'dragImage', 'resizeImage'].includes(this.gesture.type)) this.restore(this.lastSnap);
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
        if (s.type === 'arrow' || s.type === 'line') {
          // Régua: trava em múltiplos de 15° (como encostar a régua no ângulo certo).
          const a = s.pts[0], d = sub(w, a), L = Math.hypot(d.x, d.y);
          const ang = Math.atan2(d.y, d.x), snap = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
          s.pts[1] = Math.abs(ang - snap) < (3 * Math.PI) / 180 ? { x: a.x + Math.cos(snap) * L, y: a.y + Math.sin(snap) * L } : w;
        } else {
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
      case 'lasso':
        if (dist(w, this.lasso[this.lasso.length - 1]) * this.view.k > 3) this.lasso.push(w);
        this.render();
        break;
      case 'moveMarks': {
        const d = sub(w, g.w0);
        g.w0 = w;
        for (const st of this.selectedStrokes()) st.pts.forEach((q) => { q.x += d.x; q.y += d.y; });
        this.markupDirty = true;
        this.render();
        break;
      }
      case 'dragImage': {
        const im = this.content.images.find((x) => x.id === g.target.textId);
        im.x += w.x - g.w0.x; im.y += w.y - g.w0.y; g.w0 = w;
        this.imagesDirty = true;
        this.render();
        break;
      }
      case 'resizeImage': {
        const im = this.content.images.find((x) => x.id === g.target.textId);
        const ratio = im.h / im.w;
        im.w = Math.max(40 / this.view.k, w.x - im.x);
        im.h = im.w * ratio;
        this.imagesDirty = true;
        this.render();
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
        hideContextMenu();
        if (t?.kind === 'vertex') {
          g.type = 'dragVertex'; this.sel = { kind: 'vertex', shapeId: t.shapeId, i: t.i }; this.updateInspector();
          const sh = findShape(this.content, t.shapeId), n = sh.vertices.length;
          g.lockedBefore = this.adjacentLocked(sh, t.i);
          this.live = { shapeId: sh.id, segs: [sh.closed ? (t.i - 1 + n) % n : t.i - 1, t.i].filter((x) => x >= 0 && x < segmentCount(sh)) };
        }
        else if (t?.kind === 'seg') {
          // Arrastar a parede: move paralela, puxando os vizinhos.
          const sh = findShape(this.content, t.shapeId), n = sh.vertices.length;
          const [a, b] = [sh.vertices[t.i], sh.vertices[(t.i + 1) % n]];
          const u = norm(sub(b, a));
          g.type = 'dragWall'; g.w0 = this.toWorld(g.start); g.nrm = { x: -u.y, y: u.x };
          g.orig = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
          this.sel = { kind: 'seg', shapeId: t.shapeId, i: t.i };
          this.live = { shapeId: sh.id, segs: [sh.closed ? (t.i - 1 + n) % n : t.i - 1, t.i, (t.i + 1) % (sh.closed ? n : n + 1)].filter((x) => x >= 0 && x < segmentCount(sh)) };
          this.updateInspector();
        }
        else if (t?.kind === 'obj') { g.type = 'dragObj'; this.sel = { kind: 'obj', id: t.textId }; const o = this.content.objects.find((x) => x.id === t.textId); g.off = sub({ x: o.x, y: o.y }, this.toWorld(g.start)); this.updateInspector(); }
        else if (t?.kind === 'objrot') g.type = 'rotObj';
        else if (t?.kind === 'bulge') g.type = 'dragBulge';
        else if (t?.kind === 'fillet') { g.type = 'dragFillet'; this.sel = { kind: 'fillet', shapeId: t.shapeId, i: t.i }; this.updateInspector(); }
        else if (t?.kind === 'text') { g.type = 'dragText'; this.sel = { kind: 'text', id: t.textId }; this.updateInspector(); g.w0 = w; }
        else if (t?.kind === 'textresize') g.type = 'resizeText';
        else if (t?.kind === 'imgresize') g.type = 'resizeImage';
        else if (t?.kind === 'image' && this.sel?.kind === 'image' && this.sel.id === t.textId) { g.type = 'dragImage'; g.w0 = this.toWorld(g.last); }
        else if ((t?.kind === 'shape' || t?.kind === 'dim') && t.shapeId === selShape) { g.type = 'dragShape'; g.w0 = this.toWorld(g.last); }
        else { g.type = 'pan'; g.moved = true; }
        this.onMove(e);
        return;
      }
      case 'dragWall': {
        const s = findShape(this.content, g.target.shapeId), n = s.vertices.length;
        const off = dot(sub(w, g.w0), g.nrm);
        [s.vertices[g.target.i], s.vertices[(g.target.i + 1) % n]].forEach((v, k2) => { v.x = g.orig[k2].x + g.nrm.x * off; v.y = g.orig[k2].y + g.nrm.y * off; });
        this.fillsDirty = true;
        this.render();
        break;
      }
      case 'dragObj': {
        const o = this.content.objects.find((x) => x.id === g.target.textId);
        const r = this.snapObject(o, add(w, g.off));
        o.x = r.x; o.y = r.y; if (r.rot != null) o.rot = r.rot;
        this.snap = { guides: r.guides, ring: r.ring };
        this.fillsDirty = true;
        this.render();
        break;
      }
      case 'rotObj': {
        const o = this.content.objects.find((x) => x.id === g.target.textId);
        let a = (Math.atan2(w.y - o.y, w.x - o.x) * 180) / Math.PI + 90;
        const sn = Math.round(a / 15) * 15;
        if (Math.abs(a - sn) < 3) a = sn;
        o.rot = ((a % 180) + 180) % 180;
        this.fillsDirty = true;
        this.render();
        break;
      }
      case 'dragVertex': {
        const s = findShape(this.content, g.target.shapeId);
        const v = s.vertices[g.target.i];
        const n = s.vertices.length;
        const ex = new Set([s.id + ':' + g.target.i]);
        const r = this.snapWorld(w, { exclude: ex });
        this.feelSnap(r);
        g.snapTarget = r.target;
        this.snap = { guides: r.guides, ring: r.ring };
        v.x = r.w.x; v.y = r.w.y;
        void n;
        this.fillsDirty = true;
        this.render();
        break;
      }
      case 'dragFillet': {
        // Arrastar a alça do arco ao longo da bissetriz muda o raio.
        const s = findShape(this.content, g.target.shapeId);
        const vx = s.vertices[g.target.i];
        const f = filletInfo(s, g.target.i);
        if (!f) break;
        const dd = dot(sub(w, vx), f.bis);
        const k = 1 / Math.sin(f.alpha / 2) - 1;
        vx.fillet = clamp(dd / (k || 1e-9), f.rMax * 0.02, f.rMax);
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
        const ok = s.type === 'arrow' || s.type === 'line' ? dist(s.pts[0], s.pts[1]) * this.view.k > 10 : s.pts.length >= 1;
        if (ok) { this.content.markup.strokes.push(s); this.commit(); } else this.render();
        break;
      }
      case 'erase': this.eraserPos = null; if (g.removed) this.commit(); else this.render(); break;
      case 'lasso': {
        const poly = this.lasso;
        this.lasso = null;
        this.markSel = strokesInLasso(this.content.markup, poly);
        if (this.markSel.length) haptic();
        this.updateToolbar();
        this.render();
        break;
      }
      case 'moveMarks': this.commit(); break;
      case 'dragImage': case 'resizeImage': this.commit(); break;
      case 'pan': this.saveSoon(); break;
      case 'press': this.tap(g.target, g.w0, e); break;
      case 'dragVertex': this.dropVertex(g); break;
      case 'dragWall': {
        this.live = null;
        const s = findShape(this.content, g.target.shapeId);
        if (hasMeasures(s)) this.solve(s);
        this.commit(); this.updateInspector();
        break;
      }
      case 'dragFillet': this.commit(); this.updateInspector(); break;
      case 'dragBulge': {
        const s = findShape(this.content, g.target.shapeId);
        if (hasMeasures(s)) this.solve(s);
        this.commit(); this.updateInspector();
        break;
      }
      case 'dragObj': case 'rotObj': this.snap = null; this.commit(); this.updateInspector(); break;
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

  tap(t, w, ev) {
    this.tapWorld = w;
    this.tapClient = ev ? { x: ev.clientX, y: ev.clientY } : null;
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
    // "Unir com…": o toque seguinte num vértice completa a união.
    if (t?.kind === 'pair') { this.pendingMerge = null; return this.joinOne(t.i); }
    if (this.pendingMerge) {
      const A = this.pendingMerge;
      this.pendingMerge = null;
      if (t?.kind === 'vertex' && !(t.shapeId === A.shapeId && t.i === A.i)) return this.askMerge(A, { shapeId: t.shapeId, i: t.i });
      toast('União cancelada');
    }
    if (!t) this.sel = null;
    else if (t.kind === 'vertex') { this.sel = { kind: 'vertex', shapeId: t.shapeId, i: t.i }; this.render(); return this.vertexMenu(t); }
    else if (t.kind === 'seg') { this.sel = { kind: 'seg', shapeId: t.shapeId, i: t.i, menu: true }; this.render(); return this.wallMenu(t); }
    else if (t.kind === 'obj' || t.kind === 'objrot') this.sel = { kind: 'obj', id: t.textId };
    else if (t.kind === 'dim' || t.kind === 'bulge') this.sel = { kind: 'seg', shapeId: t.shapeId, i: t.i };
    else if (t.kind === 'fillet') this.sel = { kind: 'fillet', shapeId: t.shapeId, i: t.i };
    else if (t.kind === 'text' || t.kind === 'textresize') this.sel = { kind: 'text', id: t.textId };
    else if (t.kind === 'image' || t.kind === 'imgresize') this.sel = { kind: 'image', id: t.textId };
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
    const r = { l: ib.left - sz.left - 40, r: ib.right - sz.left + 40, t: ib.top - sz.top - 40, b: ib.bottom - sz.top + 40 };
    if (q.x < r.l || q.x > r.r || q.y < r.t || q.y > r.b) return;
    const bottomSheet = ib.width > sz.w * 0.7;
    if (bottomSheet) this.view.y -= q.y - Math.max(90, r.t - 10); // folha no rodapé: sobe o desenho
    else this.view.x += r.r - q.x + 20;                          // painel lateral: empurra para a direita
    this.saveSoon();
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
        const objType = el.dataset.obj;
        const tex = objType ? null : TEXTURES[+el.dataset.tex];
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
          if (objType) {
            const s = this.size();
            const over = document.elementFromPoint(ev.clientX, ev.clientY);
            const p = moved && over && this.svg.contains(over) ? { x: ev.clientX - s.left, y: ev.clientY - s.top } : { x: s.w / 2, y: s.h / 2 };
            if (moved && !(over && this.svg.contains(over))) { toast('Solte a coluna dentro do desenho'); return; }
            this.placeObject(objType, this.toWorld(p));
            return;
          }
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


  // ---------------- Edição de geometria ----------------
  menuAt(worldPt) {
    if (this.tapClient) return this.tapClient;
    const q = this.toScreen(worldPt), sz = this.size();
    return { x: q.x + sz.left, y: q.y + sz.top };
  }

  wallMenu(t) {
    const shape = findShape(this.content, t.shapeId);
    const i = t.i, n = shape.vertices.length, m = segmentCount(shape);
    const seg = shape.segments[i];
    const hasNext = shape.closed || i < m - 1, hasPrev = shape.closed || i > 0;
    const tParam = this.tapWorld ? segmentParamAt(shape, i, this.tapWorld) : 0.5;
    const name = `${vertexLabel(i)}–${vertexLabel((i + 1) % n)}`;
    const mid = segInfo(shape, i).mid;
    const at = this.menuAt(mid);
    showContextMenu(at.x, at.y, [
      { label: 'Medida', run: () => { this.sel = { kind: 'seg', shapeId: shape.id, i }; this.updateInspector(); this.ensureVisible(); this.render(); } },
      { label: 'Dividir', sub: [
        { label: 'Aqui', run: () => this.doSplit(shape, i, tParam) },
        { label: 'Ao meio', run: () => this.doSplit(shape, i, 0.5) },
        { label: 'Em N partes…', run: () => this.doSplitN(shape, i) },
      ] },
      { label: 'Mesclar', disabled: !(hasNext || hasPrev) || m < 2, sub: [
        { label: 'Com a parede seguinte', disabled: !hasNext, run: () => this.doMerge(shape, i, 'next') },
        { label: 'Com a parede anterior', disabled: !hasPrev, run: () => this.doMerge(shape, i, 'prev') },
      ] },
      { label: 'Arredondar canto', disabled: !this.canFillet(shape, i) && !this.canFillet(shape, (i + 1) % n), sub: [
        { label: `No canto ${vertexLabel(i)}`, disabled: !this.canFillet(shape, i), run: () => this.doFillet(shape, i) },
        { label: `No canto ${vertexLabel((i + 1) % n)}`, disabled: !this.canFillet(shape, (i + 1) % n), run: () => this.doFillet(shape, (i + 1) % n) },
      ] },
      { label: seg.type === 'arc' ? 'Tornar reta' : 'Tornar arco', run: () => {
        seg.type = seg.type === 'arc' ? 'line' : 'arc';
        seg.bulge = seg.type === 'arc' ? (seg.bulge || -0.35 * (signedArea(polygonize({ ...shape, segments: shape.segments.map((g) => ({ ...g, type: 'line' })) })) >= 0 ? 1 : -1)) : 0;
        if (seg.type === 'line') seg.sagitta = null;
        if (hasMeasures(shape)) this.solve(shape);
        this.commit();
      } },
      { label: 'Excluir', danger: true, run: () => {
        deleteSegment(this.content, shape, i);
        this.sel = null; this.recomputeReports(); this.commit(); this.updateInspector();
        toast(shape.closed ? 'Parede excluída' : 'Parede excluída — contorno aberto');
      } },
    ], { title: 'Parede ' + name });
  }

  vertexMenu(t) {
    const shape = findShape(this.content, t.shapeId);
    const n = shape.vertices.length;
    const isEnd = !shape.closed && (t.i === 0 || t.i === n - 1);
    const at = this.menuAt(shape.vertices[t.i]);
    showContextMenu(at.x, at.y, [
      { label: 'Ângulo…', disabled: interiorAngleDeg(shape, t.i) == null, run: () => { this.sel = { kind: 'vertex', shapeId: shape.id, i: t.i, panel: true }; this.updateInspector(); } },
      ...(shape.vertices[t.i].fillet > 0 && filletInfo(shape, t.i)
        ? [{ label: 'Raio do canto…', run: () => this.doFillet(shape, t.i) }, { label: 'Canto vivo', run: () => this.unFillet(shape, t.i) }]
        : [{ label: 'Arredondar canto', disabled: !this.canFillet(shape, t.i), run: () => this.doFillet(shape, t.i) }]),
      { label: 'Unir com…', run: () => { this.pendingMerge = { shapeId: shape.id, i: t.i }; toast('Toque no outro vértice para unir'); } },
      ...(isEnd && n >= 3 ? [{ label: 'Fechar contorno', run: () => this.doClose(shape) }] : []),
      { label: 'Remover vértice', danger: true, disabled: n <= 2, run: () => {
        removeVertex(this.content, shape, t.i);
        if (findShape(this.content, shape.id) && hasMeasures(shape)) this.solve(shape);
        this.sel = null; this.recomputeReports(); this.commit(); this.updateInspector();
      } },
    ], { title: 'Vértice ' + vertexLabel(t.i) });
  }

  // ---------- Arredondar canto (3.6) ----------
  canFillet(shape, i) {
    const v = shape.vertices[i];
    if (!v) return false;
    const old = v.fillet;
    v.fillet = 1e-6;
    const ok = !!filletInfo(shape, i);
    if (old === undefined) delete v.fillet; else v.fillet = old;
    return ok;
  }

  doFillet(shape, i) {
    if (!this.canFillet(shape, i)) { toast('Só dá para arredondar um canto entre duas paredes retas'); return; }
    const v = shape.vertices[i];
    if (!(v.fillet > 0)) {
      v.fillet = 1e9;
      const rMax = filletInfo(shape, i).rMax;
      const nice = this.content.unit === 'ft' ? 2 * 0.3048 : 0.5;
      v.fillet = this.content.calibrated ? Math.min(nice, rMax * 0.6) : rMax * 0.3;
      this.commit();
      haptic();
    }
    this.sel = { kind: 'fillet', shapeId: shape.id, i };
    this.updateInspector({ focus: true });
    this.ensureVisible();
    this.render();
  }

  unFillet(shape, i) {
    delete shape.vertices[i].fillet;
    this.sel = { kind: 'vertex', shapeId: shape.id, i };
    this.commit(); this.updateInspector();
    toast(`Canto ${vertexLabel(i)} voltou a ser vivo`);
  }

  inspectFillet(el) {
    const shape = findShape(this.content, this.sel.shapeId);
    const i = this.sel.i;
    const v = shape.vertices[i];
    const f = filletInfo(shape, i);
    const u = this.content.unit, cal = this.content.calibrated;
    el.innerHTML = `
      <div class="insp-head"><b>Canto ${vertexLabel(i)} arredondado</b><button class="ib sm" data-x="close" aria-label="Fechar">${icon('close')}</button></div>
      <div class="row"><button class="btn" data-x="sharp">Voltar a canto vivo</button></div>
      <div class="mpad"></div>
      <div class="info">${cal ? `Arco ≈ ${formatLength(f.length, u)} · cada parede encurta ${formatLength(f.t, u)}` : 'Meça as paredes para ver o raio real.'}<br>As medidas das paredes continuam de canto a canto (canto vivo pontilhado). Arraste a bolinha do arco para ajustar.</div>
      ${f.clamped ? `<div class="warn">⚠ Raio maior do que cabe nas paredes — limitado a ${formatLength(f.r, u)}.</div>` : ''}`;
    this.inputUnit ??= u;
    new MeasurePad(el.querySelector('.mpad'), {
      fields: [{ key: 'r', label: 'Raio', valueM: cal ? v.fillet : null }],
      unit: this.inputUnit, next: false,
      onUnit: (nu) => { this.inputUnit = nu; },
      onApply: (vals) => {
        if (!(vals.r > 0)) { toast('Digite o raio'); return; }
        v.fillet = vals.r;
        this.commit(); this.updateInspector();
      },
    });
    el.querySelector('[data-x=sharp]').onclick = () => this.unFillet(shape, i);
  }

  doSplit(shape, i, t) {
    const j = splitSegment(shape, i, t);
    if (hasMeasures(shape)) this.solve(shape);
    this.recomputeReports();
    this.sel = { kind: 'vertex', shapeId: shape.id, i: j };
    this.commit(); this.updateInspector();
    haptic();
    toast('Parede dividida — as duas partes herdaram a medida proporcional');
  }

  async doSplitN(shape, i) {
    const v = await ask('Dividir em quantas partes iguais?', '3');
    const n = Math.round(parseNumber(v));
    if (!(n >= 2 && n <= 50)) { if (v) toast('Número inválido'); return; }
    splitSegmentN(shape, i, n);
    if (hasMeasures(shape)) this.solve(shape);
    this.recomputeReports();
    this.sel = { kind: 'shape', shapeId: shape.id };
    this.commit(); this.updateInspector();
    toast(`Parede dividida em ${n} partes`);
  }

  doMerge(shape, i, dir) {
    const segs = shape.segments, m = segmentCount(shape);
    const j = dir === 'next' ? (i + 1) % m : (i - 1 + m) % m;
    const sum = segs[i].length != null && segs[j].length != null ? segs[i].length + segs[j].length : null;
    const ok = dir === 'next' ? mergeWithNext(this.content, shape, i, sum) : mergeWithPrev(this.content, shape, i, sum);
    if (!ok) { toast('Não há parede para mesclar desse lado'); return; }
    const k = dir === 'next' ? (shape.closed ? Math.min(i, segmentCount(shape) - 1) : i) : Math.max(0, i - 1);
    if (hasMeasures(shape)) this.solve(shape);
    this.recomputeReports();
    // Abre o teclado já com a soma: basta confirmar, ou digitar outro valor.
    this.sel = { kind: 'seg', shapeId: shape.id, i: Math.min(k, segmentCount(shape) - 1) };
    this.commit(); this.updateInspector();
    haptic();
    toast(sum != null ? `Mescladas: ${formatLength(sum, this.content.unit)} (soma)` : 'Paredes mescladas — informe a medida');
  }

  doClose(shape) {
    if (!closeShape(shape)) return;
    if (hasMeasures(shape)) this.solve(shape);
    this.recomputeReports();
    this.sel = { kind: 'shape', shapeId: shape.id };
    this.commit(); this.updateInspector();
    haptic();
    toast('Contorno fechado');
  }

  async askMerge(A, B) {
    const v = await menu('Unir vértices', [
      { label: 'Na posição média', value: 'avg' },
      { label: `Na posição de ${vertexLabel(A.i)} (o primeiro)`, value: 'first' },
    ]);
    if (!v) return;
    this.applyMerge(A, B, v);
  }

  applyMerge(A, B, mode) {
    const r = mergeVertices(this.content, A, B, mode);
    haptic();
    if (r.shape && hasMeasures(r.shape)) this.solve(r.shape);
    this.recomputeReports();
    this.sel = r.shape ? { kind: 'shape', shapeId: r.shape.id } : null;
    this.commit(); this.updateInspector();
    toast({ closed: 'Vértices unidos — contorno fechado', 'joined-closed': 'Contornos unidos e fechados', joined: 'Contornos unidos', merged: 'Vértices unidos' }[r.result] || 'Pontos sobrepostos (não são vizinhos no contorno)');
  }

  // Lados com medida travada que encostam no vértice: {i: comprimento} (para avisar o conflito).
  adjacentLocked(shape, vi) {
    const n = shape.vertices.length, out = {};
    for (const i of [shape.closed ? (vi - 1 + n) % n : vi - 1, vi]) {
      if (i < 0 || i >= segmentCount(shape)) continue;
      if (shape.segments[i].length != null) out[i] = shape.segments[i].length;
    }
    return out;
  }

  dropVertex(g) {
    this.live = null;
    this.snap = null;
    const s = findShape(this.content, g.target.shapeId);
    const t = g.snapTarget;
    // Soltou em cima de outro vértice: vira um só (fecha contorno / emenda formas).
    if (t) { this.applyMerge(t, { shapeId: s.id, i: g.target.i }, 'first'); return; }
    // Medida travada: o solver mantém o comprimento; avisa se o arraste tentou mudar.
    const n = s.vertices.length, conflicts = [];
    for (const [i, L] of Object.entries(g.lockedBefore || {})) {
      const c = dist(s.vertices[+i], s.vertices[(+i + 1) % n]);
      if (Math.abs(c - L) > lengthTolerance(L)) conflicts.push(`${vertexLabel(+i)}–${vertexLabel((+i + 1) % n)} (${formatLength(L, this.content.unit)})`);
    }
    if (hasMeasures(s)) this.solve(s);
    this.commit(); this.updateInspector();
    if (conflicts.length) toast(`Medida travada em ${conflicts.join(', ')}: o desenho respeitou a medida. Limpe-a para mudar o comprimento.`, 4200);
  }

  // Indicador permanente: contorno fechado/aberto e pontos soltos.
  // Tolerância de "quase junto" em pixels de tela (≈ 18 px), convertida para o mundo.
  joinTol() { return Math.max(18, (this.settings.snapPx || 15) * 1.2) / this.view.k; }

  looseState() {
    const clusters = joinClusters(this.content, this.joinTol());
    const inCl = new Set(clusters.flatMap((c) => c.members.map((m) => `${m.shapeId}:${m.i}`)));
    return { clusters, ends: looseVertices(this.content, 0).ends.filter((e) => !inCl.has(`${e.shapeId}:${e.i}`)) };
  }

  // Une só o grupo do anel tocado.
  joinOne(k) {
    const cl = joinClusters(this.content, this.joinTol())[k];
    if (!cl) return;
    const r = joinCluster(this.content, cl);
    this.afterJoin(r.shapes, 1);
  }

  afterJoin(ids, groups) {
    let closed = 0;
    for (const id of ids) {
      const sh = findShape(this.content, id);
      if (!sh) continue;
      if (sh.closed) closed++;
      if (hasMeasures(sh)) this.reports[sh.id] = this.keepVisualSize(() => solveInContent(this.content, sh));
    }
    this.recomputeReports();
    const one = [...ids].map((id) => findShape(this.content, id)).find((x) => x?.closed);
    this.sel = one ? { kind: 'shape', shapeId: one.id } : null;
    this.commit(); this.updateInspector();
    haptic('success');
    toast(`${groups} ${groups > 1 ? 'uniões feitas' : 'união feita'}${closed ? ` · ${closed > 1 ? `${closed} contornos fechados` : 'contorno fechado'}` : ''}`);
  }

  updateShapeState(selShape) {
    const el = this.elState;
    const L = this.loose || { ends: [], clusters: [] };
    const openShapes = this.content.shapes.filter((x) => !x.closed && x.vertices.length >= 2);
    let cls = '', txt = '';
    const nc = L.clusters.length;
    if (nc === 1) { cls = 'warn'; txt = `⚠ ${L.clusters[0].members.length} pontos quase juntos · Unir`; }
    else if (nc > 1) { cls = 'warn'; txt = `⚠ ${nc} uniões pendentes · Unir todas`; }
    else if (selShape) { cls = selShape.closed ? 'ok' : 'open'; txt = selShape.closed ? '● Fechado' : selShape.vertices.length >= 3 ? '○ Aberto · Fechar' : '○ Aberto'; }
    else if (openShapes.length) { cls = 'open'; txt = `○ ${openShapes.length} contorno${openShapes.length > 1 ? 's' : ''} aberto${openShapes.length > 1 ? 's' : ''}`; }
    else if (this.content.shapes.length) { cls = 'ok'; txt = '● Tudo fechado'; }
    el.className = 'shape-state ' + cls + (txt ? '' : ' hidden');
    el.textContent = txt;
  }

  stateAction() {
    // Mesma lista que o chip e os anéis mostram (recalculada agora, com a mesma tolerância).
    this.loose = this.looseState();
    if (this.loose.clusters.length) {
      const r = joinAll(this.content, this.joinTol());
      this.afterJoin(r.shapes, r.groups);
      return;
    }
    const sel = this.sel?.shapeId && findShape(this.content, this.sel.shapeId);
    const target = sel && !sel.closed ? sel : this.content.shapes.find((x) => !x.closed && x.vertices.length >= 3);
    if (target) this.doClose(target);
    else if (sel && !sel.closed) toast('Precisa de pelo menos 3 pontos para fechar');
  }

  setLibraryTab(tab, silent) {
    this.elLibrary.dataset.tab = tab;
    this.elLibrary.querySelectorAll('.lib-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.lt === tab));
    this.elLibrary.querySelector('.lib-sub').textContent = tab === 'objects' ? 'Arraste para dentro do desenho' : 'Arraste para dentro de uma área';
    // Itens entram em cascata (~30ms).
    this.elLibrary.querySelectorAll(`.lib-grid.${tab === 'objects' ? 'obj' : 'tex'} .lib-item`).forEach((it, i) => {
      spring({ from: 0, to: 1, delay: silent ? 0 : i * 30, stiffness: 520, damping: 30, onUpdate: (k) => { it.style.opacity = Math.min(1, k * 1.3); it.style.transform = `translateY(${(1 - k) * 10}px) scale(${0.94 + 0.06 * k})`; } });
    });
    if (!silent) { this.settings.libraryTab = tab; saveSettings(this.settings); this.updateToolbar(); }
  }

  // ---------------- Colunas / objetos ----------------
  placeObject(type, w) {
    const o = newObject(type, w, this.content.unit);
    const r = this.snapObject(o, w);
    o.x = r.x; o.y = r.y; if (r.rot != null) o.rot = r.rot;
    this.content.objects.push(o);
    this.setTool('select');
    this.sel = { kind: 'obj', id: o.id };
    this.commit(); this.updateInspector();
    toast(`${objectType(o).name} inserida — toque para definir as medidas`);
  }

  // Encaixe de colunas: centro de uma área, cantos, encostada em paredes, alinhada com outras.
  snapObject(o, w) {
    const out = { x: w.x, y: w.y, rot: null, guides: [], ring: null };
    if (this.settings.snap === false) return out;
    const R = ((this.settings.snapPx || 15) * 1.2) / this.view.k;
    const T = objectType(o);
    const half = T.half(o);
    const closed = this.content.shapes.filter((s) => s.closed && s.vertices.length >= 3);
    // cantos (por dentro)
    for (const s of closed) {
      const n = s.vertices.length;
      for (let i = 0; i < n; i++) {
        const v = s.vertices[i], a = s.vertices[(i - 1 + n) % n], b = s.vertices[(i + 1) % n];
        const u1 = norm(sub(a, v)), u2 = norm(sub(b, v));
        const c = add(add(v, mul(u1, T.rotatable ? half.h : half.w)), mul(u2, half.w));
        if (dist(c, w) < R) return { ...out, x: c.x, y: c.y, rot: T.rotatable ? (Math.atan2(u2.y, u2.x) * 180) / Math.PI : null, ring: v };
      }
    }
    // centro de uma área
    for (const s of closed) {
      const c = labelPoint(polygonize(s));
      if (dist(c, w) < R) return { ...out, x: c.x, y: c.y, ring: c };
    }
    let p = { ...w };
    // encostada em parede (pelo lado em que está)
    for (const s of this.content.shapes) {
      for (let i = 0, m = segmentCount(s); i < m; i++) {
        if (s.segments[i].type === 'arc') continue;
        const a = s.vertices[i], b = s.vertices[(i + 1) % s.vertices.length];
        const u = norm(sub(b, a)), nrm = { x: -u.y, y: u.x };
        const t = dot(sub(p, a), u);
        if (t < 0 || t > dist(a, b)) continue;
        const d = dot(sub(p, a), nrm), off = T.rotatable ? half.h : half.w;
        if (Math.abs(Math.abs(d) - off) < R) {
          const sg = Math.sign(d) || 1;
          p = add(add(a, mul(u, t)), mul(nrm, sg * off));
          out.rot = T.rotatable ? (Math.atan2(u.y, u.x) * 180) / Math.PI : null;
          out.guides.push([a, b]);
          break;
        }
      }
      if (out.guides.length) break;
    }
    // alinhada com outras colunas
    const A = 9 / this.view.k;
    for (const q of this.content.objects) {
      if (q.id === o.id) continue;
      if (Math.abs(p.x - q.x) < A) { p.x = q.x; out.guides.push([{ x: q.x, y: q.y }, { x: q.x, y: p.y }]); }
      if (Math.abs(p.y - q.y) < A) { p.y = q.y; out.guides.push([{ x: q.x, y: q.y }, { x: p.x, y: q.y }]); }
    }
    out.x = p.x; out.y = p.y;
    return out;
  }

  inspectObject(el) {
    const o = this.content.objects.find((x) => x.id === this.sel.id);
    const T = objectType(o);
    const u = this.content.unit;
    el.innerHTML = `
      <div class="insp-head"><b>${esc(T.name)}</b><button class="ib sm" data-x="close" aria-label="Fechar">${icon('close')}</button></div>
      <div class="mpad"></div>
      ${T.rotatable ? `<label>Rotação <span id="orv">${Math.round(o.rot || 0)}°</span></label><input type="range" id="oro" min="0" max="179" step="1" value="${Math.round(o.rot || 0)}">` : ''}
      <label class="ios-row plain"><span>Mostrar cotas</span><input type="checkbox" switch data-k="showDims" ${o.showDims ? 'checked' : ''}></label>
      <label class="ios-row plain"><span>Descontar da área</span><input type="checkbox" switch data-k="subtract" ${o.subtract ? 'checked' : ''}></label>
      <label>Preenchimento</label><select id="ofill">${TEXTURES.map((t, i) => `<option value="${i}" ${o.fill?.texture === t.key && (o.fill.pattern || null) === (t.pattern || null) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
      <div class="row"><button class="btn" data-x="dup">Duplicar</button><button class="btn danger" data-x="del">Excluir</button></div>
      <div class="info">Arraste para mover: encaixa em cantos, paredes, centro da área e alinhado com outras colunas.${T.rotatable ? ' Gire pela bolinha acima da coluna.' : ''}</div>`;
    this.inputUnit ??= u;
    new MeasurePad(el.querySelector('.mpad'), {
      fields: T.fields.map((f) => ({ key: f.key, label: f.label, valueM: o.size[f.key] })),
      unit: this.inputUnit, next: false,
      onUnit: (nu) => { this.inputUnit = nu; },
      onApply: (vals) => {
        let any = false;
        for (const f of T.fields) if (vals[f.key] > 0) { o.size[f.key] = vals[f.key]; any = true; }
        if (!any) { toast('Digite a medida'); return; }
        this.commit(); this.updateInspector();
        toast('Dimensões aplicadas');
      },
    });
    const ro = el.querySelector('#oro');
    if (ro) {
      ro.oninput = () => { o.rot = +ro.value; el.querySelector('#orv').textContent = o.rot + '°'; this.fillsDirty = true; this.render(); };
      ro.onchange = () => this.commit();
    }
    el.querySelectorAll('input[data-k]').forEach((c) => (c.onchange = () => { o[c.dataset.k] = c.checked; this.commit(); }));
    el.querySelector('#ofill').onchange = (e) => { const t = TEXTURES[+e.target.value]; o.fill = { ...defaultFill(t.key, t.pattern), scale: 0.5, joints: false }; this.commit(); };
    el.querySelector('[data-x=dup]').onclick = () => {
      const c = { ...structuredClone(o), id: uid(), x: o.x + (Math.max(o.size.w || o.size.d, o.size.h || 0) * 1.6) };
      this.content.objects.push(c);
      this.sel = { kind: 'obj', id: c.id };
      this.commit(); this.updateInspector();
    };
    el.querySelector('[data-x=del]').onclick = () => this.deleteSelection();
  }

  // ---------------- Painel de propriedades ----------------
  updateInspector(opts = {}) {
    const el = this.elInspector;
    const s = this.sel;
    if (!s || s.menu || (s.kind === 'vertex' && !s.panel) || (this.tool !== 'select' && s.kind !== 'shape') || (s.kind === 'shape' && this.drawing)) {
      if (!el.classList.contains('hidden')) this.animatePanel(el, false);
      return;
    }
    const wasHidden = el.classList.contains('hidden');
    el.classList.remove('hidden');
    if (s.kind === 'seg') this.inspectSegment(el, opts);
    else if (s.kind === 'vertex') this.inspectVertex(el);
    else if (s.kind === 'fillet') this.inspectFillet(el);
    else if (s.kind === 'shape') this.inspectShape(el);
    else if (s.kind === 'text') this.inspectText(el, opts);
    else if (s.kind === 'image') this.inspectImage(el);
    else if (s.kind === 'obj') this.inspectObject(el);
    el.querySelector('[data-x=close]')?.addEventListener('click', () => { this.sel = null; this.updateInspector(); this.render(); });
    if (wasHidden || el._anim || (el._k ?? 1) < 1) this.animatePanel(el, true); // reverte um fechamento em andamento
  }

  // Abre/fecha com escala + opacidade (mola), a partir do canto de origem.
  animatePanel(el, show) {
    el._anim?.stop();
    const from = el._k ?? (show ? 0 : 1);
    el._anim = spring({
      from, to: show ? 1 : 0, stiffness: 520, damping: 36,
      onUpdate: (k) => { el._k = k; el.style.opacity = clamp(k * 1.3, 0, 1); el.style.transform = `scale(${0.9 + 0.1 * k})`; },
      onDone: () => { el._anim = null; if (!show) { el.classList.add('hidden'); el.innerHTML = ''; } },
    });
  }

  inspectSegment(el) {
    const shape = findShape(this.content, this.sel.shapeId);
    const i = this.sel.i;
    const seg = shape.segments[i];
    const info = segInfo(shape, i);
    const n = shape.vertices.length;
    const u = this.content.unit;
    const report = this.reports[shape.id];
    const err = report?.segErr?.[i];
    const bad = report?.badSegments?.includes(i);
    const name = `${vertexLabel(i)}–${vertexLabel((i + 1) % n)}`;
    const cur = this.content.calibrated ? formatLength(info.chord, u) : 'sem escala';
    el.innerHTML = `
      <div class="insp-head"><b>Lado ${name}</b><button class="ib sm" data-x="close" aria-label="Fechar">${icon('close')}</button></div>
      <div class="seg-toggle"><button class="chip ${seg.type === 'line' ? 'on' : ''}" data-t="line">Reta</button><button class="chip ${seg.type === 'arc' ? 'on' : ''}" data-t="arc">Arco</button></div>
      <div class="mpad"></div>
      <div class="info">Desenho atual: ${cur}${seg.length != null && err != null && this.content.calibrated ? ` · diferença ${err >= 0 ? '+' : ''}${formatLength(err, u)}` : ''}
      ${seg.type === 'arc' && info.arc && this.content.calibrated ? `<br>Raio ≈ ${formatLength(info.arc.r, u)} · comprimento do arco ≈ ${formatLength(info.arc.length, u)}` : ''}</div>
      ${bad ? '<div class="warn">⚠ Esta medida não fecha com as outras. O erro foi distribuído; confira a medida ou libere um ângulo.</div>' : ''}
      <div class="row"><button class="btn" data-x="clear" ${seg.length == null && seg.sagitta == null ? 'disabled' : ''}>Limpar medida</button><button class="btn" data-x="split">Inserir ponto</button></div>
      ${seg.type === 'arc' ? '<div class="row"><button class="btn" data-x="flip">Inverter arco (para dentro/fora)</button></div>' : ''}`;
    const fields = [{ key: 'len', label: seg.type === 'arc' ? 'Corda (reta entre as pontas)' : 'Medida real', valueM: seg.length }];
    if (seg.type === 'arc') fields.push({ key: 'sag', label: 'Flecha (afastamento máximo do arco)', valueM: seg.sagitta != null ? Math.abs(seg.sagitta) : null });
    this.inputUnit ??= u;
    new MeasurePad(el.querySelector('.mpad'), {
      fields, unit: this.inputUnit,
      onUnit: (nu) => { this.inputUnit = nu; },
      onApply: (vals, { next }) => {
        const L = vals.len, S = vals.sag;
        if (!(L > 0) && !(S > 0)) { toast('Digite a medida'); return; }
        if (isFinite(L) && L > 0) seg.length = L;
        if (seg.type === 'arc' && isFinite(S) && S > 0) seg.sagitta = S * Math.sign(seg.bulge || 1);
        this.solve(shape, true);
        this.commit();
        if (next) this.selectNextSegment(shape, i);
        this.updateInspector();
        this.ensureVisible();
        this.render();
      },
    });
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
      seg.type = b.dataset.t;
      seg.bulge = seg.type === 'arc' ? (seg.bulge || 0.35) : 0;
      if (seg.type === 'line') seg.sagitta = null;
      if (hasMeasures(shape)) this.solve(shape);
      this.commit(); this.updateInspector();
    }));
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
    el.querySelector('[data-x=split]').onclick = () => this.doSplit(shape, i, 0.5);
  }

  inspectImage(el) {
    const im = this.content.images.find((x) => x.id === this.sel.id);
    el.innerHTML = `
      <div class="insp-head"><b>Anexo</b><button class="ib sm" data-x="close" aria-label="Fechar">${icon('close')}</button></div>
      <label>Opacidade <span id="imv">${Math.round((im.opacity ?? 0.8) * 100)}%</span></label><input type="range" id="imo" min="0.1" max="1" step="0.05" value="${im.opacity ?? 0.8}">
      <div class="info">Fica por baixo do desenho, para traçar por cima. Arraste para mover; puxe o quadrado do canto para redimensionar.</div>
      <div class="row"><button class="btn danger" data-x="del">Remover anexo</button></div>`;
    const o = el.querySelector('#imo');
    o.oninput = () => { im.opacity = +o.value; el.querySelector('#imv').textContent = Math.round(im.opacity * 100) + '%'; this.imagesDirty = true; this.render(); };
    o.onchange = () => this.commit();
    el.querySelector('[data-x=del]').onclick = () => this.deleteSelection();
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
      this.solve(shape, true); this.commit(); this.updateInspector();
    }));
    const angBtn = el.querySelector('[data-x=ang]');
    if (angBtn) {
      const go = () => {
        const a = parseNumber(el.querySelector('#ang').value);
        if (!(a > 0 && a < 360)) { toast('Ângulo inválido'); return; }
        v.angleMode = 'fixed'; v.angle = a;
        this.solve(shape, true); this.commit(); this.updateInspector();
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
      <div class="state-line ${shape.closed ? 'ok' : 'open'}">${shape.closed ? '● Contorno fechado' : '○ Contorno aberto — sem área nem textura'}</div>
      ${cal ? `<div class="stats">${shape.closed ? `<div><span>Área líquida</span><b>${formatArea(st.net, u)}</b></div><div><span>Área bruta</span><b>${formatArea(st.area, u)}</b>${st.objArea ? `<em>colunas −${formatArea(st.objArea, u)}</em>` : ''}</div>` : ''}<div><span>Perímetro</span><b>${formatLength(st.perimeter, u)}</b></div></div>` : '<div class="info">Sem escala ainda: toque em um lado e informe a medida real.</div>'}
      ${shape.closed ? `<label>Acabamento</label>${fillHtml}` : ''}
      <div class="row">
        <button class="btn" data-x="square">Esquadrejar</button>
        <button class="btn" data-x="simplify">Simplificar contorno</button>
        ${!shape.closed && shape.vertices.length >= 3 ? '<button class="btn primary" data-x="closeShape">Fechar contorno</button>' : ''}
        <button class="btn danger" data-x="del">Excluir</button>
      </div>
      <div class="info">Simplificar remove vértices quase em linha reta (tolerância ${this.settings.simplifyTol}°, ajustável em Configurações).</div>`;
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
    el.querySelector('[data-x=closeShape]')?.addEventListener('click', () => this.doClose(shape));
    el.querySelector('[data-x=simplify]').onclick = () => {
      const n = simplifyShape(this.content, shape, this.settings.simplifyTol || 4);
      if (hasMeasures(shape)) this.solve(shape);
      this.recomputeReports();
      this.commit(); this.updateInspector();
      toast(n ? `${n} vértice(s) removido(s)` : 'Nada a simplificar nessa tolerância');
    };
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

