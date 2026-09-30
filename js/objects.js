// Objetos independentes do contorno (colunas; depois degraus, ralos, canteiros, postes…).
// Cada tipo é uma entrada do registro OBJECT_TYPES — para criar um tipo novo basta descrever
// tamanho padrão, contorno em planta, campos de dimensão e cotas.
//
// Objeto = { id, type, x, y (centro, m), rot (graus), size: {d} | {w, h}, fill, showDims, subtract }
import { uid, f3 } from './util.js';
import { M_PER_FT } from './units.js';
import { pointInPolygon, signedArea } from './geometry.js';
import { renderFill } from './textures.js';

const ftOrM = (unit, ft, m) => (unit === 'ft' ? ft * M_PER_FT : m);

export const OBJECT_TYPES = {
  'column-round': {
    name: 'Coluna redonda',
    category: 'Colunas',
    defaults: (unit) => ({ size: { d: ftOrM(unit, 1, 0.3) } }),
    fields: [{ key: 'd', label: 'Diâmetro' }],
    rotatable: false,
    outline(o, steps = 48) {
      const r = o.size.d / 2;
      return Array.from({ length: steps }, (_, i) => {
        const a = (i / steps) * Math.PI * 2;
        return { x: o.x + r * Math.cos(a), y: o.y + r * Math.sin(a) };
      });
    },
    half: (o) => ({ w: o.size.d / 2, h: o.size.d / 2 }),
  },
  'column-square': {
    name: 'Coluna quadrada',
    category: 'Colunas',
    defaults: (unit) => ({ size: { w: ftOrM(unit, 1, 0.3), h: ftOrM(unit, 1, 0.3) } }),
    fields: [{ key: 'w', label: 'Largura' }, { key: 'h', label: 'Profundidade' }],
    rotatable: true,
    outline: rectOutline,
    half: (o) => ({ w: o.size.w / 2, h: o.size.h / 2 }),
  },
  'column-rect': {
    name: 'Coluna retangular',
    category: 'Colunas',
    defaults: (unit) => ({ size: { w: ftOrM(unit, 1, 0.3), h: ftOrM(unit, 2, 0.6) } }),
    fields: [{ key: 'w', label: 'Largura' }, { key: 'h', label: 'Profundidade' }],
    rotatable: true,
    outline: rectOutline,
    half: (o) => ({ w: o.size.w / 2, h: o.size.h / 2 }),
  },
};

function rectOutline(o) {
  const a = ((o.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const hw = o.size.w / 2, hh = o.size.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => ({ x: o.x + x * c - y * s, y: o.y + x * s + y * c }));
}

export const objectType = (o) => OBJECT_TYPES[o.type];
export const objectOutline = (o) => OBJECT_TYPES[o.type].outline(o);
export const objectArea = (o) => Math.abs(signedArea(objectOutline(o)));

export function newObject(type, p, unit) {
  return {
    id: uid(), type, x: p.x, y: p.y, rot: 0, ...OBJECT_TYPES[type].defaults(unit),
    fill: { texture: 'concrete', pattern: null, color: null, scale: 0.5, rotation: 0, joints: false }, showDims: true, subtract: true,
  };
}

export function objectAt(content, p) {
  const list = content.objects || [];
  for (let i = list.length - 1; i >= 0; i--) if (pointInPolygon(p, objectOutline(list[i]))) return list[i];
  return null;
}

// Preenchimento em coordenadas do mundo (acima das áreas).
export function buildObjectFills(content) {
  return (content.objects || []).map((o) => {
    const poly = objectOutline(o);
    return o.fill ? renderFill(poly, o.fill, 'ob' + o.id) : `<path d="M${poly.map((q) => `${f3(q.x)} ${f3(q.y)}`).join('L')}Z" fill="#cfccc5"/>`;
  }).join('');
}

// Miniatura para a aba Objetos.
export function objectPreviewSVG(type, size = 64) {
  const o = { ...newObject(type, { x: 0, y: 0 }, 'm') };
  const poly = objectOutline(o);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of poly) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const pad = 0.12, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad, m = Math.max(w, h);
  const vb = `${f3(x0 - pad - (m - w) / 2)} ${f3(y0 - pad - (m - h) / 2)} ${f3(m)} ${f3(m)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${vb}">${renderFill(poly, o.fill, 'opv' + type)}` +
    `<path d="M${poly.map((q) => `${f3(q.x)} ${f3(q.y)}`).join('L')}Z" fill="none" stroke="#1c2533" stroke-width="${f3(m / 40)}"/></svg>`;
}
