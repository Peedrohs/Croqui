// Texturas vistas de cima, geradas proceduralmente em metros e recortadas pelo polígono.
// Cada preenchimento: { texture, pattern?, color?, scale, rotation }
import { rng, hashStr, f3, esc } from './util.js';
import { bbox, centroid } from './geometry.js';

export const PAVER_PATTERNS = [
  { key: 'herringbone45', name: 'Espinha de peixe 45°' },
  { key: 'herringbone90', name: 'Espinha de peixe 90°' },
  { key: 'running', name: 'Fileira corrida' },
  { key: 'stack', name: 'Paralelo (stack bond)' },
  { key: 'basket', name: 'Cesta (basketweave)' },
  { key: 'circular', name: 'Circular' },
];

export const PAVER_COLORS = [
  { key: 'gray', name: 'Cinza', shades: ['#a9a8a3', '#b5b3ad', '#9d9b95'], joint: '#6f6d68' },
  { key: 'tan', name: 'Areia', shades: ['#d2b48c', '#c9a97d', '#dcc29f'], joint: '#8f7654' },
  { key: 'red', name: 'Terracota', shades: ['#b5563b', '#a84d34', '#c0654a'], joint: '#6e2f20' },
  { key: 'charcoal', name: 'Grafite', shades: ['#5b5d61', '#66686c', '#505256'], joint: '#2e2f31' },
];

export const DECK_COLORS = [
  { key: 'teak', name: 'Teca', shades: ['#b07a45', '#a56f3c', '#bb8650', '#9c6835'], joint: '#4f3219' },
  { key: 'gray', name: 'Cinza', shades: ['#9a948c', '#8f8981', '#a59f97', '#858078'], joint: '#4a4640' },
  { key: 'cedar', name: 'Cedro', shades: ['#c98a5a', '#bf7f4f', '#d39766', '#b47446'], joint: '#5c3218' },
];

export const TEXTURES = [
  { key: 'water', name: 'Água' },
  { key: 'concrete', name: 'Concreto' },
  { key: 'grass', name: 'Grama' },
  { key: 'asphalt', name: 'Asfalto' },
  { key: 'gravel', name: 'Terra / brita' },
  { key: 'deck', name: 'Deck de madeira' },
  ...PAVER_PATTERNS.map((p) => ({ key: 'pavers', pattern: p.key, name: 'Paver · ' + p.name })),
];

export function textureName(fill) {
  if (!fill) return 'Sem textura';
  if (fill.texture === 'pavers') return 'Paver · ' + (PAVER_PATTERNS.find((p) => p.key === fill.pattern)?.name ?? '');
  return TEXTURES.find((t) => t.key === fill.texture)?.name ?? fill.texture;
}

export function defaultFill(texture, pattern) {
  return { texture, pattern: pattern ?? null, color: null, scale: 1, rotation: pattern === 'herringbone45' ? 45 : 0 };
}

const MAX_ITEMS = 30000;

const rectPath = (x, y, w, h) => `M${f3(x)} ${f3(y)}h${f3(w)}v${f3(h)}h${f3(-w)}z`;
const circlePath = (x, y, r) => `M${f3(x - r)} ${f3(y)}a${f3(r)} ${f3(r)} 0 1 0 ${f3(2 * r)} 0a${f3(r)} ${f3(r)} 0 1 0 ${f3(-2 * r)} 0`;

// Quadro local: origem no centróide, girado por `rotation`. Devolve bbox local.
function localFrame(poly, rotDeg) {
  const O = centroid(poly);
  const a = (-rotDeg * Math.PI) / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const loc = poly.map((p) => {
    const x = p.x - O.x, y = p.y - O.y;
    return { x: x * ca - y * sa, y: x * sa + y * ca };
  });
  const b = bbox(loc);
  const pad = 0.5;
  return { O, box: { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad } };
}

// Distribui tijolos em 3 tons (caminhos separados) com rejunte.
function bricksOut(rects, col, jw) {
  const paths = col.shades.map(() => []);
  const r = rng(rects.length * 7 + 11);
  for (const q of rects) paths[Math.floor(r() * paths.length)].push(rectPath(...q));
  return paths
    .map((p, i) => (p.length ? `<path d="${p.join('')}" fill="${col.shades[i]}" stroke="${col.joint}" stroke-width="${f3(jw)}"/>` : ''))
    .join('');
}

export function paverBricks(pattern, box, u) {
  const out = [];
  const L = 2 * u;
  const push = (x, y, w, h) => { if (out.length < MAX_ITEMS && x < box.x1 && x + w > box.x0 && y < box.y1 && y + h > box.y0) out.push([x, y, w, h]); };
  if (pattern === 'herringbone45' || pattern === 'herringbone90') {
    // Faixas diagonais: H_k=[k,k+2]×[k,k+1], V_k=[k,k+1]×[k+1,k+3], transladadas por j·(2,−2) (unidades u).
    const X0 = box.x0 / u, X1 = box.x1 / u, Y0 = box.y0 / u, Y1 = box.y1 / u;
    const jMin = Math.floor(-(Y1 - X0) / 4) - 1, jMax = Math.ceil(-(Y0 - X1) / 4) + 1;
    for (let j = jMin; j <= jMax; j++) {
      const kMin = Math.floor(Math.max(X0 - 3 - 2 * j, Y0 - 3 + 2 * j));
      const kMax = Math.ceil(Math.min(X1 + 1 - 2 * j, Y1 + 1 + 2 * j));
      for (let k = kMin; k <= kMax; k++) {
        const ox = k + 2 * j, oy = k - 2 * j;
        push(ox * u, oy * u, L, u);
        push(ox * u, (oy + 1) * u, u, L);
      }
    }
  } else if (pattern === 'running' || pattern === 'stack') {
    const r0 = Math.floor(box.y0 / u), r1 = Math.ceil(box.y1 / u);
    for (let row = r0; row <= r1; row++) {
      const off = pattern === 'running' && row % 2 ? u : 0;
      const c0 = Math.floor((box.x0 - off) / L) - 1, c1 = Math.ceil((box.x1 - off) / L);
      for (let c = c0; c <= c1; c++) push(c * L + off, row * u, L, u);
    }
  } else if (pattern === 'basket') {
    const B = L;
    const i0 = Math.floor(box.x0 / B), i1 = Math.ceil(box.x1 / B);
    const j0 = Math.floor(box.y0 / B), j1 = Math.ceil(box.y1 / B);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const x = i * B, y = j * B;
        if ((i + j) % 2 === 0) { push(x, y, L, u); push(x, y + u, L, u); }
        else { push(x, y, u, L); push(x + u, y, u, L); }
      }
  }
  return out;
}

function circularPavers(box, u, col, jw) {
  const R = Math.max(Math.hypot(box.x0, box.y0), Math.hypot(box.x1, box.y0), Math.hypot(box.x0, box.y1), Math.hypot(box.x1, box.y1));
  const rw = 2 * u;
  const rings = Math.ceil(R / rw);
  let d = circlePath(0, 0, rw);
  let count = 0;
  for (let k = 1; k <= rings && count < MAX_ITEMS; k++) {
    const r0 = k * rw, r1 = (k + 1) * rw;
    d += circlePath(0, 0, r1);
    const nSeg = Math.max(8, Math.round((2 * Math.PI * (r0 + rw / 2)) / (u * 1.1)));
    const off = (k % 2) * (Math.PI / nSeg);
    for (let s = 0; s < nSeg; s++, count++) {
      const a = (s * 2 * Math.PI) / nSeg + off;
      const c = Math.cos(a), sn = Math.sin(a);
      d += `M${f3(r0 * c)} ${f3(r0 * sn)}L${f3(r1 * c)} ${f3(r1 * sn)}`;
    }
  }
  // cruz no miolo
  d += `M${f3(-rw)} 0L${f3(rw)} 0M0 ${f3(-rw)}L0 ${f3(rw)}`;
  return `<rect x="${f3(box.x0)}" y="${f3(box.y0)}" width="${f3(box.x1 - box.x0)}" height="${f3(box.y1 - box.y0)}" fill="${col.shades[0]}"/>` +
    `<path d="${d}" fill="none" stroke="${col.joint}" stroke-width="${f3(jw)}"/>`;
}

function scatter(box, density, r, fn) {
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  const n = Math.min(MAX_ITEMS / 2, Math.round(area * density));
  for (let i = 0; i < n; i++) fn(box.x0 + r() * (box.x1 - box.x0), box.y0 + r() * (box.y1 - box.y0), i);
}

function baseRect(box, fill) {
  return `<rect x="${f3(box.x0)}" y="${f3(box.y0)}" width="${f3(box.x1 - box.x0)}" height="${f3(box.y1 - box.y0)}" fill="${fill}"/>`;
}

function body(fill, box, seed, gid) {
  const s = Math.max(0.1, fill.scale || 1);
  const r = rng(seed);
  switch (fill.texture) {
    case 'water': {
      let d = '';
      scatter(box, 1.2 / (s * s), r, (x, y) => {
        const w = (0.4 + r() * 0.8) * s, h = (0.05 + r() * 0.08) * s;
        d += `M${f3(x)} ${f3(y)}q${f3(w / 2)} ${f3(-h)} ${f3(w)} 0t${f3(w)} 0`;
      });
      return `<defs><linearGradient id="${gid}w" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fdcf5"/><stop offset="1" stop-color="#2f97d4"/></linearGradient></defs>` +
        `<rect x="${f3(box.x0)}" y="${f3(box.y0)}" width="${f3(box.x1 - box.x0)}" height="${f3(box.y1 - box.y0)}" fill="url(#${gid}w)"/>` +
        `<path d="${d}" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="${f3(0.025 * s)}" stroke-linecap="round"/>`;
    }
    case 'concrete': {
      const dots = ['', ''];
      scatter(box, 160 / (s * s), r, (x, y, i) => { dots[i % 2] += circlePath(x, y, (0.004 + r() * 0.008) * s); });
      let j = '';
      const g = fill.joints === false ? Infinity : 1.5 * s;
      if (isFinite(g)) {
        for (let x = Math.floor(box.x0 / g) * g; x <= box.x1; x += g) j += `M${f3(x)} ${f3(box.y0)}V${f3(box.y1)}`;
        for (let y = Math.floor(box.y0 / g) * g; y <= box.y1; y += g) j += `M${f3(box.x0)} ${f3(y)}H${f3(box.x1)}`;
      }
      return baseRect(box, '#cfccc5') + `<path d="${dots[0]}" fill="#a9a59d" fill-opacity=".6"/><path d="${dots[1]}" fill="#eceae5" fill-opacity=".8"/>` +
        `<path d="${j}" stroke="#9b978f" stroke-width="${f3(0.012 * s)}"/>`;
    }
    case 'asphalt': {
      const dots = ['', ''];
      scatter(box, 320 / (s * s), r, (x, y, i) => { dots[i % 2] += circlePath(x, y, (0.003 + r() * 0.006) * s); });
      return baseRect(box, '#3e4043') + `<path d="${dots[0]}" fill="#6b6e72"/><path d="${dots[1]}" fill="#26282a"/>`;
    }
    case 'grass': {
      const cols = ['#4f8f3a', '#79b85a', '#3f7a2e'];
      const d = ['', '', ''];
      let patches = '';
      scatter(box, 0.6, r, (x, y) => { patches += circlePath(x, y, (0.3 + r() * 0.6) * s); });
      scatter(box, 260 / (s * s), r, (x, y, i) => {
        const l = (0.04 + r() * 0.05) * s, a = -Math.PI / 2 + (r() - 0.5) * 0.9;
        d[i % 3] += `M${f3(x)} ${f3(y)}l${f3(Math.cos(a) * l)} ${f3(Math.sin(a) * l)}`;
      });
      return baseRect(box, '#63a348') + `<path d="${patches}" fill="#5a9a40" fill-opacity=".6"/>` +
        d.map((p, i) => `<path d="${p}" stroke="${cols[i]}" stroke-width="${f3(0.012 * s)}" stroke-linecap="round"/>`).join('');
    }
    case 'gravel': {
      const cols = ['#8c7358', '#cbb89c', '#a38a6c', '#6f5b45'];
      const d = ['', '', '', ''];
      scatter(box, 420 / (s * s), r, (x, y, i) => { d[i % 4] += circlePath(x, y, (0.008 + r() * 0.02) * s); });
      return baseRect(box, '#b39a7b') + d.map((p, i) => `<path d="${p}" fill="${cols[i]}"/>`).join('');
    }
    case 'deck': {
      const col = DECK_COLORS.find((c) => c.key === fill.color) ?? DECK_COLORS[0];
      const pw = 0.14 * s;
      const paths = col.shades.map(() => '');
      let grain = '';
      let n = 0;
      for (let y = Math.floor(box.y0 / pw) * pw; y < box.y1 && n < MAX_ITEMS; y += pw) {
        let x = box.x0 - r() * 2 * s;
        while (x < box.x1 && n < MAX_ITEMS) {
          const l = (1.2 + r() * 2.4) * s;
          paths[Math.floor(r() * paths.length)] += rectPath(x, y, l, pw);
          grain += `M${f3(x + 0.1 * s)} ${f3(y + pw * (0.3 + r() * 0.4))}h${f3(l * (0.3 + r() * 0.5))}`;
          x += l; n++;
        }
      }
      return paths.map((p, i) => `<path d="${p}" fill="${col.shades[i]}" stroke="${col.joint}" stroke-width="${f3(0.008 * s)}"/>`).join('') +
        `<path d="${grain}" stroke="#000" stroke-opacity=".12" stroke-width="${f3(0.006 * s)}"/>`;
    }
    case 'pavers': {
      const col = PAVER_COLORS.find((c) => c.key === fill.color) ?? PAVER_COLORS[0];
      const u = 0.1 * s;
      const jw = 0.008 * s;
      if (fill.pattern === 'circular') return circularPavers(box, u, col, jw);
      const pattern = fill.pattern || 'running';
      return baseRect(box, col.joint) + bricksOut(paverBricks(pattern, box, u), col, jw);
    }
  }
  return '';
}

const cache = new Map();

/**
 * SVG (coordenadas do mundo) do preenchimento de uma forma.
 * poly: pontos do contorno; id: string única (para clipPath / gradiente).
 */
export function renderFill(poly, fill, id) {
  if (!fill || poly.length < 3) return '';
  const rot = fill.rotation || 0;
  const { O, box } = localFrame(poly, rot);
  const d = 'M' + poly.map((p) => `${f3(p.x)} ${f3(p.y)}`).join('L') + 'Z';
  const key = id + '|' + d + '|' + JSON.stringify(fill);
  if (cache.has(key)) return cache.get(key);
  const gid = 'f' + esc(id).replace(/[^a-z0-9]/gi, '');
  const inner = body(fill, box, hashStr(id), gid);
  const svg = `<clipPath id="${gid}c"><path d="${d}"/></clipPath>` +
    `<g clip-path="url(#${gid}c)"><g transform="translate(${f3(O.x)} ${f3(O.y)}) rotate(${f3(rot)})">${inner}</g></g>`;
  if (cache.size > 200) cache.clear();
  cache.set(key, svg);
  return svg;
}

// Miniatura para a biblioteca lateral.
export function previewSVG(t, size = 72) {
  const w = t.key === 'pavers' ? 1.0 : 1.6;
  const poly = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: w }, { x: 0, y: w }];
  const fill = defaultFill(t.key, t.pattern);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${w} ${w}">${renderFill(poly, fill, 'pv' + t.key + (t.pattern || ''))}</svg>`;
}
