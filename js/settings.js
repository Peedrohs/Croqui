// Preferências locais (localStorage) + tela de Configurações em estilo iOS.
import { getThemePref, setThemePref } from './theme.js';
import { onFastTap, spring } from './motion.js';

const KEY = 'croqui-settings';
const DEFAULTS = {
  pencilOnly: false, penSeen: false, library: false, defaultUnit: 'ft',
  pencil: { instrument: 'pen', tools: {}, pos: null, collapsed: false },
};

export function getSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    s.pencil = { ...DEFAULTS.pencil, ...(s.pencil || {}) };
    s.pencil.tools ??= {};
    return s;
  } catch { return structuredClone(DEFAULTS); }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function updateSettings(patch) {
  const s = { ...getSettings(), ...patch };
  saveSettings(s);
  return s;
}

const seg = (name, value, opts) => `<div class="ios-seg" data-name="${name}">${opts.map(([v, l]) => `<button class="${v === value ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}<i class="ios-seg-thumb"></i></div>`;

// Folha de configurações. onChange(settings) avisa quem estiver aberto (o editor).
export function openSettings({ onChange } = {}) {
  const s = getSettings();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop sheet-backdrop';
  wrap.innerHTML = `
    <div class="sheet" role="dialog" aria-label="Configurações">
      <div class="sheet-head"><span></span><h3>Configurações</h3><button class="btn link" data-x="done">OK</button></div>
      <div class="ios-group-title">Aparência</div>
      <div class="ios-group"><div class="ios-row">${seg('theme', getThemePref(), [['light', 'Claro'], ['dark', 'Escuro'], ['auto', 'Automático']])}</div></div>
      <div class="ios-foot">Automático segue o modo claro/escuro do iPad. PNG e PDF saem sempre no tema claro.</div>
      <div class="ios-group-title">Medidas</div>
      <div class="ios-group"><div class="ios-row"><span>Unidade padrão</span>${seg('unit', s.defaultUnit, [['ft', 'Pés / pol'], ['m', 'Metros']])}</div></div>
      <div class="ios-foot">Vale para croquis novos. Cada croqui pode trocar a unidade pelo menu “…”.</div>
      <div class="ios-group-title">Apple Pencil</div>
      <div class="ios-group">
        <label class="ios-row"><span>Só a Apple Pencil desenha</span><input type="checkbox" switch class="ios-switch" data-name="pencilOnly" ${s.pencilOnly ? 'checked' : ''}></label>
      </div>
      <div class="ios-foot">Rejeição de palma: com a opção ligada, o dedo só move e dá zoom. Liga sozinha quando a Pencil é usada pela primeira vez.</div>
      <div class="ios-group-title">Sobre</div>
      <div class="ios-group"><div class="ios-row"><span>Dados</span><span class="muted">Ficam só neste iPad</span></div></div>
    </div>`;
  document.body.appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  spring({ from: 0, to: 1, stiffness: 420, damping: 34, onUpdate: (k) => { sheet.style.transform = `translateY(${(1 - k) * 40}px) scale(${0.96 + 0.04 * k})`; sheet.style.opacity = Math.min(1, k * 1.4); wrap.style.opacity = Math.min(1, k * 1.6); } });
  const placeThumbs = () => wrap.querySelectorAll('.ios-seg').forEach((g) => {
    const on = g.querySelector('button.on'), th = g.querySelector('.ios-seg-thumb');
    if (on) { th.style.width = on.offsetWidth + 'px'; th.style.transform = `translateX(${on.offsetLeft - 2}px)`; }
  });
  requestAnimationFrame(placeThumbs);
  const close = () => {
    spring({ from: 1, to: 0, stiffness: 520, damping: 40, onUpdate: (k) => { sheet.style.transform = `translateY(${(1 - k) * 40}px) scale(${0.96 + 0.04 * k})`; sheet.style.opacity = k; wrap.style.opacity = k; }, onDone: () => wrap.remove() });
  };
  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  onFastTap(wrap, 'button', (b) => {
    if (b.dataset.x === 'done') return close();
    const g = b.closest('.ios-seg');
    if (!g) return;
    g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    placeThumbs();
    const v = b.dataset.v;
    if (g.dataset.name === 'theme') setThemePref(v);
    else if (g.dataset.name === 'unit') onChange?.(updateSettings({ defaultUnit: v }));
  });
  wrap.addEventListener('change', (e) => {
    if (e.target.dataset.name === 'pencilOnly') onChange?.(updateSettings({ pencilOnly: e.target.checked, penSeen: true }));
  });
}
