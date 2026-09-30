// Paleta flutuante da Apple Pencil, no estilo Freeform: painel vertical arrastável, desfazer/refazer
// no topo, instrumentos ilustrados (o selecionado desliza para fora), grade de cores 2×3 e "…".
// Neutra de propósito — a marca não entra aqui.
import { spring, haptic, onFastTap } from './motion.js';
import { clamp, esc } from './util.js';
import { INSTRUMENTS, QUICK_COLORS, MORE_COLORS, DRAW_INSTRUMENTS } from './markup.js';

let gid = 0;
// Ilustrações em vista lateral, ponta à esquerda (x=0). 96×28.
function art(id, color) {
  const g = 'pp' + gid++;
  const body = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${g}b)" stroke="#b9b9bf" stroke-width=".6"/>`;
  const defs = `<defs><linearGradient id="${g}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f0f0f3"/><stop offset="1" stop-color="#c9c9cf"/></linearGradient>` +
    `<linearGradient id="${g}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5f5f7"/><stop offset=".5" stop-color="#b8b8be"/><stop offset="1" stop-color="#7c7c83"/></linearGradient>` +
    `<linearGradient id="${g}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".75"/><stop offset=".5" stop-color="${color}"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>`;
  const shade = `<rect x="24" y="15" width="70" height="4" rx="2" fill="#000" opacity=".05"/>`;
  let s = '';
  switch (id) {
    case 'pen':
      s = body(24, 6, 70, 16, 8) + shade + `<path d="M24.5 6.3L8 12.6Q6 14 8 15.4L24.5 21.7Z" fill="#ebebef" stroke="#b9b9bf" stroke-width=".6"/>` +
        `<path d="M8 12.6L1.5 14L8 15.4Z" fill="${color}"/><rect x="38" y="6" width="5" height="16" fill="${color}"/>`;
      break;
    case 'pencil':
      s = `<rect x="30" y="9" width="64" height="10" rx="2" fill="url(#${g}m)" stroke="#8e8e93" stroke-width=".5"/>` +
        `<path d="M30 9L18 12.4V15.6L30 19Z" fill="#2c2c2e"/><rect x="5" y="13.3" width="13" height="1.4" fill="#9a9aa0"/>` +
        `<rect x="1" y="13.6" width="4" height=".8" fill="${color}"/><rect x="44" y="9" width="4" height="10" fill="${color}"/><rect x="80" y="9" width="2" height="10" fill="#fff" opacity=".6"/>`;
      break;
    case 'marker':
      s = body(20, 3, 74, 22, 5) + shade + `<path d="M20 7L9 8.5L5.5 19.5L20 21Z" fill="#e7e7ea" stroke="#b9b9bf" stroke-width=".6"/>` +
        `<path d="M9 8.5L2 10.5L1 17.5L5.5 19.5Z" fill="${color}"/><rect x="82" y="3" width="12" height="22" rx="4" fill="url(#${g}c)"/>`;
      break;
    case 'crayon':
      s = `<rect x="26" y="6" width="68" height="16" rx="3" fill="url(#${g}c)"/>` +
        `<rect x="40" y="6" width="54" height="16" rx="2" fill="#fbfaf6" opacity=".92"/>` +
        `<path d="M44 6v16M50 6v16M86 6v16" stroke="${color}" stroke-width="1.4" opacity=".55"/>` +
        `<path d="M26 6.5L10 11Q6 14 10 17L26 21.5Z" fill="url(#${g}c)"/>`;
      break;
    case 'eraser':
      s = body(26, 6, 68, 16, 8) + shade + `<rect x="26" y="6" width="10" height="16" fill="#d8d8de"/>` +
        `<path d="M26 6.5H12Q4 6.5 4 14Q4 21.5 12 21.5H26Z" fill="#f2a5b5" stroke="#d98b9c" stroke-width=".6"/>`;
      break;
    case 'ruler': {
      let t = '';
      for (let x = 6; x <= 90; x += 6) t += `M${x} 6v${x % 30 === 0 ? 7 : 4}`;
      s = `<rect x="2" y="5" width="92" height="18" rx="3" fill="#f8f8fa" fill-opacity=".92" stroke="#a1a1a8" stroke-width=".8"/><path d="${t}" stroke="#6e6e75" stroke-width=".8"/>` +
        `<path d="M8 18H40" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
      break;
    }
    case 'lasso':
      s = body(30, 7, 64, 14, 7) + shade + `<path d="M30.5 7.3L16 12.8Q14 14 16 15.2L30.5 20.7Z" fill="#ebebef" stroke="#b9b9bf" stroke-width=".6"/>` +
        `<path d="M16 12.8L10 14L16 15.2Z" fill="#8e8e93"/><ellipse cx="7" cy="14" rx="6" ry="9" fill="none" stroke="#636366" stroke-width="1.3" stroke-dasharray="2.5 2"/>`;
      break;
  }
  return `<svg viewBox="0 0 96 28" width="96" height="28" aria-hidden="true">${defs}${s}</svg>`;
}

const ICONS = {
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  collapse: '<path d="M8 4v4H4M16 4v4h4M8 20v-4H4M16 20v-4h4"/>',
};
const ico = (k) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

export class PencilPalette {
  /**
   * state: { instrument, tools: {id: {color, width, opacity, arrow}} , pos, collapsed }
   * cb: onChange(state), onUndo, onRedo, canUndo(), canRedo(), getVisible(), onToggleVisible(), onClear()
   */
  constructor(host, state, cb) {
    this.host = host;
    this.state = state;
    this.cb = cb;
    this.slide = {};
    this.el = document.createElement('div');
    this.el.className = 'pp';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', 'Paleta da Apple Pencil');
    host.appendChild(this.el);
    this.render();
    this.bind();
    requestAnimationFrame(() => this.place());
    this.onResize = () => this.place();
    window.addEventListener('resize', this.onResize);
  }

  destroy() { window.removeEventListener('resize', this.onResize); this.el.remove(); this.pop?.remove(); }

  tool(id = this.state.instrument) {
    const def = INSTRUMENTS.find((i) => i.id === id);
    this.state.tools[id] ??= { color: def.color, width: def.width, opacity: def.opacity, arrow: def.arrow };
    return this.state.tools[id];
  }

  get side() {
    const hb = this.host.getBoundingClientRect();
    return (this.state.pos?.x ?? hb.width) > hb.width / 2 ? 'right' : 'left';
  }

  render() {
    const st = this.state;
    const cur = st.instrument;
    const t = DRAW_INSTRUMENTS.includes(cur) ? this.tool(cur) : null;
    if (st.collapsed) {
      this.el.classList.add('collapsed');
      this.el.innerHTML = `<button class="pp-mini" aria-label="Abrir paleta">${art(cur, t?.color ?? '#8e8e93')}</button>`;
      return;
    }
    this.el.classList.remove('collapsed');
    const colorOn = (c) => t && t.color.toLowerCase() === c.toLowerCase();
    const custom = t && ![...QUICK_COLORS].some((c) => colorOn(c));
    this.el.innerHTML = `
      <div class="pp-grip" aria-hidden="true"><i></i></div>
      <div class="pp-top">
        <button class="pp-circ" data-a="undo" aria-label="Desfazer" ${this.cb.canUndo() ? '' : 'disabled'}>${ico('undo')}</button>
        <button class="pp-circ" data-a="redo" aria-label="Refazer" ${this.cb.canRedo() ? '' : 'disabled'}>${ico('redo')}</button>
      </div>
      <div class="pp-tools">${INSTRUMENTS.map((i) => `<button class="pp-inst ${i.id === cur ? 'on' : ''}" data-i="${i.id}" aria-label="${esc(i.name)}" aria-pressed="${i.id === cur}">${art(i.id, DRAW_INSTRUMENTS.includes(i.id) ? this.tool(i.id).color : '#8e8e93')}</button>`).join('')}</div>
      <div class="pp-colors ${t ? '' : 'off'}">
        ${QUICK_COLORS.map((c) => `<button class="pp-color ${colorOn(c) ? 'on' : ''}" data-c="${c}" style="--c:${c}" aria-label="Cor ${c}"></button>`).join('')}
        <label class="pp-color rainbow ${custom ? 'on' : ''}" style="${custom ? `--c:${t.color}` : ''}" aria-label="Outra cor"><input type="color" value="${t ? t.color : '#000000'}"></label>
      </div>
      <div class="pp-foot">
        <button class="pp-circ" data-a="more" aria-label="Espessura, opacidade e mais cores">${ico('more')}</button>
        <button class="pp-circ" data-a="collapse" aria-label="Recolher paleta">${ico('collapse')}</button>
      </div>`;
    this.el.classList.toggle('left', this.side === 'left');
    this.applySlide(true);
  }

  // O instrumento selecionado desliza para fora do painel (mola), os outros voltam.
  applySlide(snap) {
    const dir = this.side === 'left' ? 1 : -1;
    this.el.querySelectorAll('.pp-inst').forEach((b) => {
      const id = b.dataset.i;
      const on = id === this.state.instrument;
      const target = on ? 1 : 0;
      const svg = b.firstElementChild;
      const set = (t) => { this.slide[id] = t; svg.style.transform = `translateX(${dir * 18 * t}px) scale(${1 + 0.07 * t}) ${dir > 0 ? 'scaleX(-1)' : ''}`; };
      if (snap) { set(this.slide[id] ?? target); if ((this.slide[id] ?? target) !== target) spring({ from: this.slide[id], to: target, stiffness: 520, damping: 32, onUpdate: set }); }
      else spring({ from: this.slide[id] ?? 0, to: target, stiffness: 520, damping: 32, onUpdate: set });
    });
  }

  refresh() {
    const prev = this.el.querySelector('.pp-tools')?.scrollTop;
    this.render();
    if (prev) this.el.querySelector('.pp-tools').scrollTop = prev;
  }

  select(id) {
    if (id === this.state.instrument) return;
    this.state.instrument = id;
    this.cb.onChange(this.state);
    const old = { ...this.slide };
    this.render();
    this.slide = old;
    this.applySlide(false);
  }

  bind() {
    onFastTap(this.el, 'button', (b) => {
      if (b.classList.contains('pp-mini')) { this.state.collapsed = false; this.cb.onChange(this.state); this.render(); this.pulse(); return; }
      if (b.dataset.i) return this.select(b.dataset.i);
      if (b.dataset.c) { this.tool().color = b.dataset.c; this.cb.onChange(this.state); this.refresh(); return; }
      const a = b.dataset.a;
      if (a === 'undo') this.cb.onUndo();
      else if (a === 'redo') this.cb.onRedo();
      else if (a === 'collapse') { this.closePop(); this.state.collapsed = true; this.cb.onChange(this.state); this.render(); this.place(); }
      else if (a === 'more') this.togglePop(b);
    });
    this.el.addEventListener('input', (e) => {
      if (e.target.type === 'color') { this.tool().color = e.target.value; this.cb.onChange(this.state); }
    });
    this.el.addEventListener('change', (e) => { if (e.target.type === 'color') this.refresh(); });
    // Arrastar pela alça (ou pelo ícone recolhido).
    this.el.addEventListener('pointerdown', (e) => {
      const grip = e.target.closest('.pp-grip, .pp-mini');
      if (!grip) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY }, origin = { ...this.pos() };
      let moved = false;
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < 6) return;
        moved = true;
        this.state.pos = { x: origin.x + dx, y: origin.y + dy };
        this.place();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (moved) { this.cb.onChange(this.state); this.render(); this.snapToEdge(); }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  pos() {
    const hb = this.host.getBoundingClientRect();
    return this.state.pos ?? { x: hb.width - 60, y: 92 + (hb.height - 184) / 2 };
  }

  place() {
    const hb = this.host.getBoundingClientRect();
    if (!hb.width) return;
    const r = this.el.getBoundingClientRect();
    const p = this.pos();
    const x = clamp(p.x, r.width / 2 + 8, hb.width - r.width / 2 - 8);
    const y = clamp(p.y, r.height / 2 + 72, hb.height - r.height / 2 - 12);
    this.el.style.left = x - r.width / 2 + 'px';
    this.el.style.top = y - r.height / 2 + 'px';
    this.cur = { x, y };
  }

  // Ao soltar, a paleta "gruda" suavemente na borda mais próxima (como no iPadOS).
  snapToEdge() {
    const hb = this.host.getBoundingClientRect();
    const r = this.el.getBoundingClientRect();
    const fromX = this.cur.x;
    const toX = fromX > hb.width / 2 ? hb.width - r.width / 2 - 12 : r.width / 2 + 12;
    spring({
      from: fromX, to: toX, stiffness: 420, damping: 34,
      onUpdate: (x) => { this.state.pos = { x, y: this.cur.y }; this.place(); },
      onDone: () => { this.cb.onChange(this.state); this.render(); },
    });
  }

  pulse() {
    spring({ from: 0.85, to: 1, stiffness: 520, damping: 22, onUpdate: (s) => { this.el.style.transform = `scale(${s})`; } });
  }

  closePop() { this.pop?.remove(); this.pop = null; document.removeEventListener('pointerdown', this.popAway, true); }

  togglePop(anchor) {
    if (this.pop) return this.closePop();
    const t = DRAW_INSTRUMENTS.includes(this.state.instrument) ? this.tool() : null;
    const pop = document.createElement('div');
    pop.className = 'pp-pop';
    const vis = this.cb.getVisible();
    pop.innerHTML = `
      ${t ? `<label>Espessura <b>${t.width.toFixed(1)}</b></label><input type="range" data-k="width" min="0.6" max="40" step="0.2" value="${t.width}">
      <label>Opacidade <b>${Math.round(t.opacity * 100)}%</b></label><input type="range" data-k="opacity" min="0.1" max="1" step="0.05" value="${t.opacity}">
      <div class="pp-more">${MORE_COLORS.map((c) => `<button class="pp-color sm" data-c="${c}" style="--c:${c}" aria-label="Cor ${c}"></button>`).join('')}</div>
      ${this.state.instrument === 'ruler' ? `<label class="pp-sw"><span>Ponta de seta</span><input type="checkbox" switch data-k="arrow" ${t.arrow ? 'checked' : ''}></label>` : ''}` : '<p class="pp-note">Escolha um instrumento de desenho para ajustar espessura e cor.</p>'}
      <label class="pp-sw"><span>Mostrar anotações</span><input type="checkbox" switch data-k="visible" ${vis ? 'checked' : ''}></label>
      <button class="btn danger pp-clear" data-a="clear">Apagar todas as anotações</button>`;
    document.body.appendChild(pop);
    const ar = anchor.getBoundingClientRect();
    const pw = 264;
    const left = this.side === 'right' ? ar.left - pw - 14 : ar.right + 14;
    pop.style.left = clamp(left, 8, innerWidth - pw - 8) + 'px';
    pop.style.top = clamp(ar.bottom - 330, 70, innerHeight - 350) + 'px';
    spring({ from: 0, to: 1, stiffness: 520, damping: 30, onUpdate: (k) => { pop.style.opacity = Math.min(1, k * 1.3); pop.style.transform = `scale(${0.85 + 0.15 * k})`; } });
    pop.addEventListener('input', (e) => {
      const k = e.target.dataset.k;
      if (!t || !k || k === 'visible' || k === 'arrow') return;
      t[k] = +e.target.value;
      e.target.previousElementSibling.querySelector('b').textContent = k === 'opacity' ? Math.round(t.opacity * 100) + '%' : t.width.toFixed(1);
      this.cb.onChange(this.state);
    });
    pop.addEventListener('change', (e) => {
      const k = e.target.dataset.k;
      if (k === 'visible') this.cb.onToggleVisible();
      else if (k === 'arrow') { t.arrow = e.target.checked; this.cb.onChange(this.state); }
      else this.refresh();
    });
    onFastTap(pop, 'button', (b) => {
      if (b.dataset.c && t) { t.color = b.dataset.c; this.cb.onChange(this.state); this.refresh(); }
      else if (b.dataset.a === 'clear') { this.closePop(); this.cb.onClear(); }
    });
    this.pop = pop;
    this.popAway = (e) => { if (!pop.contains(e.target) && !e.target.closest('[data-a=more]')) this.closePop(); };
    setTimeout(() => document.addEventListener('pointerdown', this.popAway, true), 0);
    haptic();
  }
}
