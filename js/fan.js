// Menu radial flutuante no estilo Freeform/Apple Pencil: botão arrastável que abre um leque
// em dois anéis, com molas e cascata de ~30ms entre os ícones.
import { spring, haptic, onFastTap, reducedMotion } from './motion.js';
import { clamp } from './util.js';

// Longe dos cantos: leque largo. Num canto só ~90° apontam para dentro da tela, então o leque
// fica mais estreito e com raios maiores, para os ícones não se sobreporem.
const RINGS_OPEN = [{ R: 94, span: 150 }, { R: 164, span: 140 }];
const RINGS_CORNER = [{ R: 140, span: 96 }, { R: 222, span: 88 }];
const FAB = 64;
const ITEM = 54;
const STAGGER = 30;

export class RadialMenu {
  /**
   * items: [{ id, label, icon (svg), ring: 0|1, kind: 'tool'|'toggle'|'action' }]
   * isActive(id) → bool; onSelect(id); pos: {x,y} salvo; onMove(pos) para persistir.
   */
  constructor(host, { items, isActive, onSelect, pos, onMove }) {
    this.host = host;
    this.items = items;
    this.isActive = isActive;
    this.onSelect = onSelect;
    this.onMoveCb = onMove;
    this.isOpen = false;
    this.anims = [];
    this.progress = items.map(() => 0);
    this.vel = items.map(() => 0);

    const layer = document.createElement('div');
    layer.className = 'fab-layer';
    layer.innerHTML = `
      <div class="fan-backdrop"></div>
      ${items.map((it, i) => `<button class="fan-item" data-i="${i}" aria-label="${it.label}">${it.icon}<span>${it.label}</span></button>`).join('')}
      <button class="fab" aria-label="Ferramentas" aria-expanded="false"><span class="fab-icon"></span><em class="fab-name"></em></button>`;
    host.appendChild(layer);
    this.layer = layer;
    this.fab = layer.querySelector('.fab');
    this.fabIcon = layer.querySelector('.fab-icon');
    this.fabName = layer.querySelector('.fab-name');
    this.backdrop = layer.querySelector('.fan-backdrop');
    this.els = [...layer.querySelectorAll('.fan-item')];

    this.pos = pos && isFinite(pos.x) ? { ...pos } : null;
    requestAnimationFrame(() => this.placeFab());
    this.onResize = () => this.placeFab();
    window.addEventListener('resize', this.onResize);

    this.bindFab();
    this.backdrop.addEventListener('pointerdown', (e) => { e.preventDefault(); this.close(); });
    onFastTap(layer, '.fan-item', (el) => {
      const it = this.items[+el.dataset.i];
      this.onSelect(it.id);
      if (it.kind === 'action') this.refresh();
      else this.close();
    });
  }

  destroy() { window.removeEventListener('resize', this.onResize); this.layer.remove(); }

  hostSize() { const b = this.host.getBoundingClientRect(); return { w: b.width, h: b.height, left: b.left, top: b.top }; }

  placeFab() {
    const { w, h } = this.hostSize();
    if (!w) return;
    if (!this.pos) this.pos = { x: w - 64, y: h - 110 };
    const m = FAB / 2 + 8;
    this.pos.x = clamp(this.pos.x, m, w - m);
    this.pos.y = clamp(this.pos.y, m, h - m - 18); // espaço para o selo com o nome da ferramenta
    this.fab.style.left = this.pos.x + 'px';
    this.fab.style.top = this.pos.y + 'px';
    if (this.isOpen) this.layout(true);
  }

  bindFab() {
    let start = null, dragging = false, origin = null;
    this.fab.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.fab.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY };
      origin = { ...this.pos };
      dragging = false;
      this.fab.classList.add('pressed');
      this.bump(0.9);
    });
    this.fab.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) > 8) { dragging = true; if (this.isOpen) this.close(); }
      if (dragging) { this.pos = { x: origin.x + dx, y: origin.y + dy }; this.placeFab(); }
    });
    const end = (e) => {
      if (!start) return;
      start = null;
      this.fab.classList.remove('pressed');
      this.bump(1);
      if (e.type === 'pointercancel') return;
      if (dragging) { this.onMoveCb?.(this.pos); return; }
      haptic();
      this.toggle();
    };
    this.fab.addEventListener('pointerup', end);
    this.fab.addEventListener('pointercancel', end);
    this.fab.addEventListener('lostpointercapture', (e) => { if (start) end(e); });
  }

  // "Respiro" de escala do botão central (mola).
  bump(to) {
    this.bumpAnim?.stop();
    const cur = this.fabScale ?? 1;
    this.bumpAnim = spring({
      from: cur, to, stiffness: 600, damping: 26,
      onUpdate: (s) => { this.fabScale = s; this.fab.style.transform = `translate(-50%, -50%) scale(${s})`; },
    });
  }

  setIcon(svg, label) {
    if (this.fabIcon.innerHTML === svg) return;
    this.fabIcon.innerHTML = svg;
    this.fab.setAttribute('aria-label', 'Ferramentas — ' + label);
    this.fabName.textContent = label;
    this.fabScale = 0.82;
    this.bump(1);
  }

  refresh() {
    this.els.forEach((el, i) => el.classList.toggle('active', !!this.isActive(this.items[i].id)));
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  // Posições alvo: anéis centrados na direção do centro da tela, mantidos dentro da área visível.
  layout(snap) {
    const { w, h } = this.hostSize();
    const c = this.pos;
    const reach = RINGS_OPEN[1].R + ITEM / 2;
    const nearX = c.x < reach || c.x > w - reach;
    const nearY = c.y < reach || c.y > h - reach;
    const corner = nearX && nearY;
    const RINGS = corner ? RINGS_CORNER : RINGS_OPEN;
    // Direção: para o centro da tela; num canto, exatamente na diagonal para dentro.
    const dir = corner
      ? Math.atan2(c.y > h / 2 ? -1 : 1, c.x > w / 2 ? -1 : 1)
      : Math.atan2(h / 2 - c.y, w / 2 - c.x);
    const byRing = [[], []];
    this.items.forEach((it, i) => byRing[it.ring].push(i));
    this.targets = [];
    byRing.forEach((idxs, r) => {
      const { R, span } = RINGS[r];
      const n = idxs.length;
      const sp = (span * Math.PI) / 180;
      idxs.forEach((i, k) => {
        const a = n === 1 ? dir : dir - sp / 2 + (sp * k) / (n - 1);
        const m = ITEM / 2 + 6;
        const x = clamp(c.x + R * Math.cos(a), m, w - m);
        const y = clamp(c.y + R * Math.sin(a), m, h - m - 14);
        this.targets[i] = { dx: x - c.x, dy: y - c.y };
      });
    });
    if (snap) this.els.forEach((_, i) => this.apply(i, this.progress[i]));
  }

  apply(i, t) {
    const el = this.els[i];
    const tg = this.targets?.[i] ?? { dx: 0, dy: 0 };
    const s = 0.35 + 0.65 * t;
    el.style.left = this.pos.x + 'px';
    el.style.top = this.pos.y + 'px';
    el.style.transform = `translate(${tg.dx * t}px, ${tg.dy * t}px) scale(${Math.max(0, s)})`;
    el.style.opacity = clamp(t * 1.4, 0, 1);
  }

  animateTo(target) {
    this.anims.forEach((a, i) => { if (a) this.vel[i] = a.stop().v; });
    const order = this.items.map((_, i) => i);
    if (!target) order.reverse();
    this.anims = [];
    order.forEach((i, k) => {
      this.anims[i] = spring({
        from: this.progress[i], to: target, velocity: this.vel[i],
        stiffness: target ? 420 : 520, damping: target ? 30 : 38,
        delay: reducedMotion() ? 0 : k * (target ? STAGGER : STAGGER * 0.6),
        onUpdate: (t) => { this.progress[i] = t; this.apply(i, t); },
      });
    });
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.layer.classList.add('open');
    this.layer.style.setProperty('--fx', this.pos.x + 'px');
    this.layer.style.setProperty('--fy', this.pos.y + 'px');
    this.fab.setAttribute('aria-expanded', 'true');
    this.refresh();
    this.layout(false);
    this.animateTo(1);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.layer.classList.remove('open');
    this.fab.setAttribute('aria-expanded', 'false');
    this.animateTo(0);
  }
}
