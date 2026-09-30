// Tema claro/escuro/automático + paletas do canvas.
// A exportação usa SEMPRE a paleta clara (documento da empresa), independente da interface.

const KEY = 'croqui-theme';
const listeners = new Set();
const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function getThemePref() {
  try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
}

export function resolvedTheme(pref = getThemePref()) {
  if (pref === 'light' || pref === 'dark') return pref;
  return mq && mq.matches ? 'dark' : 'light';
}

function apply(animate) {
  const root = document.documentElement;
  const t = resolvedTheme();
  if (animate) {
    root.classList.add('theme-anim');
    clearTimeout(apply.timer);
    apply.timer = setTimeout(() => root.classList.remove('theme-anim'), 350);
  }
  root.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#1c1c1e' : '#f2f2f4');
  listeners.forEach((fn) => fn(t));
}

export function setThemePref(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  apply(true);
}

export function onThemeChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function initTheme() {
  apply(false);
  mq?.addEventListener?.('change', () => { if (getThemePref() === 'auto') apply(true); });
}

// ---------- Paleta do desenho (SVG) ----------
// Marca Paving Crew: bronze #b08d57 é acento; no claro o texto usa um bronze escurecido (AA 4,5:1).
export const CANVAS_LIGHT = {
  name: 'light',
  bg: '#fbfbfa', dot: '#d4d4d8', dotMajor: '#b4b4bb',
  ink: '#1c2533', accent: '#8d7146', accentFill: '#b08d57', measured: '#111827', approx: '#6b7280', bad: '#d92d20',
  labelBg: '#ffffff', labelSoft: '#ffffffd9', emptyFill: '#ffffff', areaInk: '#334155',
  noteBg: '#fffef5', noteBorder: '#d9d3b8', handle: '#ffffff', halo: '#ffffff',
  guide: '#f59e0b',
};
export const CANVAS_DARK = {
  name: 'dark',
  bg: '#1c1c1e', dot: '#3a3a3e', dotMajor: '#54545a',
  ink: '#e8e8ed', accent: '#c0a479', accentFill: '#b08d57', measured: '#f5f5f7', approx: '#a1a1aa', bad: '#ff6b5e',
  labelBg: '#2c2c2e', labelSoft: '#2c2c2ee0', emptyFill: '#232326', areaInk: '#d4d4d8',
  noteBg: '#34332c', noteBorder: '#57533f', handle: '#2c2c2e', halo: '#1c1c1e',
  guide: '#fbbf24',
};
export const canvasPalette = () => (resolvedTheme() === 'dark' ? CANVAS_DARK : CANVAS_LIGHT);
