// Menu contextual flutuante (estilo menu de edição do iOS): cápsula escura com ações,
// submenus substituem o conteúdo no lugar, com "‹" para voltar. Abre com mola a partir do toque.
import { onFastTap, spring, haptic } from './motion.js';
import { esc, clamp } from './util.js';

let current = null;

export function hideContextMenu() {
  if (!current) return;
  const { el, off } = current;
  current = null;
  off();
  spring({ from: 1, to: 0, stiffness: 600, damping: 40, onUpdate: (k) => { el.style.opacity = k; el.style.transform = `translate(-50%, 0) scale(${0.85 + 0.15 * k})`; }, onDone: () => el.remove() });
}

/**
 * items: [{ label, run?, danger?, sub?: items, disabled? }]
 * (x, y) em coordenadas da janela: o menu aparece acima do ponto (ou abaixo, se não couber).
 */
export function showContextMenu(x, y, items, { title } = {}) {
  hideContextMenu();
  const el = document.createElement('div');
  el.className = 'ctx';
  el.setAttribute('role', 'menu');
  document.body.appendChild(el);
  const stack = [items];
  const draw = () => {
    const list = stack[stack.length - 1];
    el.innerHTML = (stack.length > 1 ? '<button class="ctx-b back" data-back="1" aria-label="Voltar">‹</button>' : title ? `<span class="ctx-t">${esc(title)}</span>` : '') +
      list.map((it, i) => `<button class="ctx-b ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''} role="menuitem">${esc(it.label)}${it.sub ? ' ›' : ''}</button>`).join('');
    place();
  };
  const place = () => {
    const r = el.getBoundingClientRect();
    const above = y - 64 > 70;
    el.style.left = clamp(x, r.width / 2 + 8, innerWidth - r.width / 2 - 8) + 'px';
    el.style.top = (above ? y - 64 : y + 28) + 'px';
  };
  draw();
  spring({ from: 0, to: 1, stiffness: 560, damping: 30, onUpdate: (k) => { el.style.opacity = Math.min(1, k * 1.4); el.style.transform = `translate(-50%, 0) scale(${0.8 + 0.2 * k})`; } });
  onFastTap(el, 'button', (b) => {
    if (b.dataset.back) { stack.pop(); draw(); return; }
    const it = stack[stack.length - 1][+b.dataset.i];
    if (!it) return;
    if (it.sub) { stack.push(it.sub); draw(); haptic(); return; }
    hideContextMenu();
    it.run?.();
  });
  const away = (e) => { if (!el.contains(e.target)) hideContextMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
  current = { el, off: () => document.removeEventListener('pointerdown', away, true) };
}
