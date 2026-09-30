// Preferências locais + tela de Configurações no padrão dos Ajustes do iOS:
// folha modal que sobe de baixo (com alça e arrastar-para-fechar), grupos com título em
// maiúsculas, linhas com ícone em quadrado colorido, controles à direita e submenus com "›".
import { getThemePref, setThemePref } from './theme.js';
import { onFastTap, spring, haptic } from './motion.js';
import { setPrecision } from './units.js';
import { esc } from './util.js';

const KEY = 'croqui-settings';
const DEFAULTS = {
  pencilOnly: false, penSeen: false, library: false, libraryTab: 'textures', defaultUnit: 'ft',
  ftDen: 4, mDec: 2, showGrid: true, dimPx: 14, showArea: true, netArea: true,
  snap: true, snapPx: 15, simplifyTol: 4, exportLogo: true, exportMarkup: true,
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
  setPrecision(s);
}

export function updateSettings(patch) {
  const s = { ...getSettings(), ...patch };
  saveSettings(s);
  return s;
}

setPrecision(getSettings());

// ---------- Ícones (SF Symbols-like) em quadrados coloridos ----------
const G = {
  theme: '<circle cx="12" cy="12" r="5"/><path d="M12 7a5 5 0 000 10z" fill="#fff"/>',
  grid: '<circle cx="7" cy="7" r="1.3"/><circle cx="12" cy="7" r="1.3"/><circle cx="17" cy="7" r="1.3"/><circle cx="7" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17" cy="12" r="1.3"/><circle cx="7" cy="17" r="1.3"/><circle cx="12" cy="17" r="1.3"/><circle cx="17" cy="17" r="1.3"/>',
  text: '<path d="M6 7V5.5h12V7M12 5.5v13M9.5 18.5h5"/>',
  ruler: '<path d="M4 15.5L15.5 4l4.5 4.5L8.5 20z"/><path d="M8 11.5l1.6 1.6M11 8.5l1.6 1.6M14 5.5l1.6 1.6"/>',
  prec: '<path d="M5 18h14M8 18V9M12 18V6M16 18v-6"/>',
  area: '<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><circle cx="15" cy="15" r="2" fill="#fff"/>',
  magnet: '<path d="M6 4v7a6 6 0 0012 0V4h-4v7a2 2 0 01-4 0V4z"/>',
  simplify: '<path d="M4 17l5-5 3 3 8-8"/>',
  pencil: '<path d="M5 19l1.2-4L16 5.2a1.8 1.8 0 012.6 2.6L8.8 17.6z"/>',
  logo: '<path d="M6 4h10l3 3v13H6z"/><path d="M9 11h6M9 15h6"/>',
  layers: '<path d="M12 4l8 4.5-8 4.5-8-4.5z"/><path d="M4 13l8 4.5 8-4.5"/>',
  data: '<ellipse cx="12" cy="6.5" rx="7" ry="2.5"/><path d="M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
};
const tile = (k, bg) => `<span class="st-ico" style="background:${bg}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${G[k]}</svg></span>`;
const chev = '<svg class="st-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
const seg = (name, value, opts) => `<div class="ios-seg" data-name="${name}">${opts.map(([v, l]) => `<button class="${String(v) === String(value) ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}<i class="ios-seg-thumb"></i></div>`;
const sw = (name, on) => `<input type="checkbox" switch class="ios-switch" data-name="${name}" ${on ? 'checked' : ''} aria-label="${name}">`;

const FT_PREC = [[2, '1/2"'], [4, '1/4"'], [8, '1/8"'], [16, '1/16"']];
const M_PREC = [[0, '0 (1 m)'], [1, '1 (0,1 m)'], [2, '2 (0,01 m)'], [3, '3 (0,001 m)']];

function mainPage(s) {
  const themeLbl = { light: 'Claro', dark: 'Escuro', auto: 'Automático' };
  void themeLbl;
  return `
  <div class="st-title">Configurações</div>
  <div class="ios-group-title">Aparência</div>
  <div class="ios-group">
    <div class="ios-row col">${tile('theme', '#5e5ce6')}<span class="st-label">Tema</span></div>
    <div class="ios-row pad">${seg('theme', getThemePref(), [['light', 'Claro'], ['dark', 'Escuro'], ['auto', 'Automático']])}</div>
    <label class="ios-row">${tile('grid', '#8e8e93')}<span class="st-label">Grade de pontos</span>${sw('showGrid', s.showGrid)}</label>
    <div class="ios-row">${tile('text', '#0a84ff')}<span class="st-label">Tamanho das cotas</span><span class="st-val" data-out="dimPx">${s.dimPx} pt</span></div>
    <div class="ios-row pad slider"><span class="st-a small">A</span><input type="range" min="11" max="22" step="1" value="${s.dimPx}" data-name="dimPx" aria-label="Tamanho das cotas"><span class="st-a big">A</span></div>
  </div>
  <div class="ios-foot">Automático segue o iPad. PNG e PDF saem sempre no tema claro.</div>

  <div class="ios-group-title">Medidas</div>
  <div class="ios-group">
    <div class="ios-row">${tile('ruler', '#ff9500')}<span class="st-label">Unidade padrão</span>${seg('defaultUnit', s.defaultUnit, [['ft', 'Pés/pol'], ['m', 'Metros']])}</div>
    <button class="ios-row link" data-page="precision">${tile('prec', '#34c759')}<span class="st-label">Precisão exibida</span><span class="st-val">${FT_PREC.find((x) => x[0] === s.ftDen)?.[1]} · ${s.mDec} casas</span>${chev}</button>
    <label class="ios-row">${tile('area', '#30b0c7')}<span class="st-label">Mostrar área e perímetro</span>${sw('showArea', s.showArea)}</label>
    <label class="ios-row">${tile('area', '#a2845e')}<span class="st-label">Descontar colunas da área</span>${sw('netArea', s.netArea)}</label>
  </div>
  <div class="ios-foot">A unidade padrão vale para croquis novos; cada croqui troca a sua pelo menu “…”. Com o desconto ligado, a área total mostra a área líquida.</div>

  <div class="ios-group-title">Desenho</div>
  <div class="ios-group">
    <label class="ios-row">${tile('magnet', '#ff3b30')}<span class="st-label">Encaixe automático</span>${sw('snap', s.snap)}</label>
    <button class="ios-row link" data-page="snap">${tile('magnet', '#ff9f0a')}<span class="st-label">Tolerâncias</span><span class="st-val">${s.snapPx} px · ${s.simplifyTol}°</span>${chev}</button>
    <label class="ios-row">${tile('pencil', '#636366')}<span class="st-label">Só a Apple Pencil desenha</span>${sw('pencilOnly', s.pencilOnly)}</label>
  </div>
  <div class="ios-foot">Encaixe: pontos, ângulos retos, alinhamento e extensão de paredes. Rejeição de palma: com a Pencil só ela desenha e o dedo move/zoom.</div>

  <div class="ios-group-title">Exportação</div>
  <div class="ios-group">
    <label class="ios-row">${tile('logo', '#b08d57')}<span class="st-label">Logo no rodapé</span>${sw('exportLogo', s.exportLogo)}</label>
    <label class="ios-row">${tile('layers', '#af52de')}<span class="st-label">Incluir anotações</span>${sw('exportMarkup', s.exportMarkup)}</label>
  </div>

  <div class="ios-group-title">Sobre</div>
  <div class="ios-group">
    <div class="ios-row">${tile('data', '#8e8e93')}<span class="st-label">Dados</span><span class="st-val">Só neste iPad</span></div>
    <div class="ios-row">${tile('info', '#8e8e93')}<span class="st-label">Versão</span><span class="st-val">Croqui 2 · Paving Crew</span></div>
  </div>`;
}

function precisionPage(s) {
  const list = (name, opts, val) => opts.map(([v, l], i) => `<button class="ios-row link check" data-pick="${name}" data-v="${v}"><span class="st-label">${esc(l)}</span>${String(v) === String(val) ? '<span class="st-check">✓</span>' : ''}</button>${i < opts.length - 1 ? '' : ''}`).join('');
  return `
  <div class="st-title">Precisão exibida</div>
  <div class="ios-group-title">Pés e polegadas — arredondar para</div>
  <div class="ios-group">${list('ftDen', FT_PREC, s.ftDen)}</div>
  <div class="ios-group-title">Metros — casas decimais</div>
  <div class="ios-group">${list('mDec', M_PREC, s.mDec)}</div>
  <div class="ios-foot">Só muda como as medidas aparecem; o valor digitado é guardado inteiro.</div>`;
}

function snapPage(s) {
  return `
  <div class="st-title">Tolerâncias</div>
  <div class="ios-group-title">Encaixe de pontos</div>
  <div class="ios-group">
    <div class="ios-row"><span class="st-label">Raio de encaixe</span><span class="st-val" data-out="snapPx">${s.snapPx} px</span></div>
    <div class="ios-row pad slider"><input type="range" min="8" max="30" step="1" value="${s.snapPx}" data-name="snapPx" aria-label="Raio de encaixe"></div>
  </div>
  <div class="ios-foot">Distância na tela (independe do zoom) para dois pontos virarem um só.</div>
  <div class="ios-group-title">Simplificar contorno</div>
  <div class="ios-group">
    <div class="ios-row"><span class="st-label">Ângulo máximo</span><span class="st-val" data-out="simplifyTol">${s.simplifyTol}°</span></div>
    <div class="ios-row pad slider"><input type="range" min="1" max="15" step="1" value="${s.simplifyTol}" data-name="simplifyTol" aria-label="Ângulo máximo"></div>
  </div>
  <div class="ios-foot">Vértices com desvio menor que isso (quase em linha reta) são removidos por “Simplificar contorno”.</div>`;
}

const PAGES = { main: mainPage, precision: precisionPage, snap: snapPage };

// onChange(settings) avisa quem estiver aberto (o editor) para aplicar na hora.
export function openSettings({ onChange } = {}) {
  let s = getSettings();
  const stack = ['main'];
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Configurações">
      <div class="sheet-grab" aria-hidden="true"><i></i></div>
      <div class="sheet-nav"><button class="btn link st-back hidden" data-x="back">‹ Configurações</button><span></span><button class="btn link" data-x="done">OK</button></div>
      <div class="sheet-pages"><div class="sheet-page"></div></div>
    </div>`;
  document.body.appendChild(wrap);
  const sheet = wrap.querySelector('.sheet');
  const pages = wrap.querySelector('.sheet-pages');
  const back = wrap.querySelector('.st-back');

  const placeThumbs = (root) => root.querySelectorAll('.ios-seg').forEach((g) => {
    const on = g.querySelector('button.on'), th = g.querySelector('.ios-seg-thumb');
    if (on) { th.style.width = on.offsetWidth + 'px'; th.style.transform = `translateX(${on.offsetLeft - 2}px)`; }
  });
  const renderPage = (el, name) => { el.innerHTML = PAGES[name](s); requestAnimationFrame(() => placeThumbs(el)); };
  renderPage(pages.firstElementChild, 'main');

  // Folha sobe de baixo (mola).
  const setK = (k) => { sheet.style.transform = `translateY(${(1 - k) * 105}%)`; wrap.style.background = `rgba(0,0,0,${0.3 * Math.min(1, k)})`; };
  setK(0);
  spring({ from: 0, to: 1, stiffness: 380, damping: 36, onUpdate: setK });
  const close = () => spring({ from: 1, to: 0, stiffness: 420, damping: 40, onUpdate: setK, onDone: () => wrap.remove() });

  // Navegação entre páginas (empurra da direita, como no iOS).
  const push = (name) => {
    const cur = pages.lastElementChild;
    const next = document.createElement('div');
    next.className = 'sheet-page';
    renderPage(next, name);
    pages.appendChild(next);
    stack.push(name);
    back.classList.remove('hidden');
    spring({ from: 0, to: 1, stiffness: 420, damping: 38, onUpdate: (k) => { next.style.transform = `translateX(${(1 - k) * 100}%)`; cur.style.transform = `translateX(${-30 * k}%)`; cur.style.opacity = 1 - 0.6 * k; }, onDone: () => { cur.style.display = 'none'; } });
  };
  const pop = () => {
    if (stack.length < 2) return;
    const cur = pages.lastElementChild, prev = cur.previousElementSibling;
    stack.pop();
    prev.style.display = '';
    renderPage(prev, stack[stack.length - 1]);
    if (stack.length < 2) back.classList.add('hidden');
    spring({ from: 1, to: 0, stiffness: 420, damping: 38, onUpdate: (k) => { cur.style.transform = `translateX(${(1 - k) * 100}%)`; prev.style.transform = `translateX(${-30 * k}%)`; prev.style.opacity = 1 - 0.6 * k; }, onDone: () => cur.remove() });
  };

  const set = (patch) => { s = updateSettings(patch); onChange?.(s); };

  wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(); });
  onFastTap(wrap, 'button', (b) => {
    if (b.dataset.x === 'done') return close();
    if (b.dataset.x === 'back') return pop();
    if (b.dataset.page) return push(b.dataset.page);
    if (b.dataset.pick) {
      set({ [b.dataset.pick]: +b.dataset.v });
      renderPage(pages.lastElementChild, stack[stack.length - 1]);
      return;
    }
    const g = b.closest('.ios-seg');
    if (!g) return;
    g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    placeThumbs(g.parentElement);
    const v = b.dataset.v;
    if (g.dataset.name === 'theme') setThemePref(v);
    else set({ [g.dataset.name]: v });
  });
  wrap.addEventListener('input', (e) => {
    const n = e.target.dataset.name;
    if (e.target.type !== 'range' || !n) return;
    const v = +e.target.value;
    const out = wrap.querySelector(`[data-out=${n}]`);
    if (out) out.textContent = n === 'simplifyTol' ? v + '°' : n === 'snapPx' ? v + ' px' : v + ' pt';
    set({ [n]: v });
  });
  wrap.addEventListener('change', (e) => {
    const n = e.target.dataset.name;
    if (e.target.type === 'checkbox' && n) { haptic(); set({ [n]: e.target.checked, ...(n === 'pencilOnly' ? { penSeen: true } : {}) }); }
  });

  // Arrastar a alça para baixo fecha (como no iOS).
  const grab = wrap.querySelector('.sheet-grab');
  grab.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const y0 = e.clientY, h = sheet.offsetHeight;
    let k = 1;
    const mv = (ev) => { k = Math.min(1, 1 - Math.max(0, ev.clientY - y0) / h); setK(k); };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (k < 0.75) spring({ from: k, to: 0, stiffness: 420, damping: 40, onUpdate: setK, onDone: () => wrap.remove() });
      else spring({ from: k, to: 1, stiffness: 420, damping: 36, onUpdate: setK });
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  });
}
