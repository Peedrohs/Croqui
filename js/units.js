// Unidades: internamente tudo é em METROS.
export const M_PER_FT = 0.3048;
export const M_PER_IN = 0.0254;
export const M2_PER_FT2 = M_PER_FT * M_PER_FT;

// Precisão de exibição (Configurações → Medidas). Os valores guardados não mudam.
const PREC = { ftDen: 4, mDec: 2 };
export function setPrecision({ ftDen, mDec } = {}) {
  if ([2, 4, 8, 16].includes(+ftDen)) PREC.ftDen = +ftDen;
  if ([0, 1, 2, 3].includes(+mDec)) PREC.mDec = +mDec;
}
export const getPrecision = () => ({ ...PREC });

const GLYPH = { '1/2': '½', '1/4': '¼', '3/4': '¾', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞' };
function fracText(num, den) {
  if (!num) return '';
  let g = gcd(num, den);
  const k = `${num / g}/${den / g}`;
  return GLYPH[k] ?? ' ' + k;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export function formatLength(m, unit) {
  if (m == null || !isFinite(m)) return '?';
  if (unit === 'ft') {
    const neg = m < 0;
    const D = PREC.ftDen;
    const q = Math.round((Math.abs(m) / M_PER_IN) * D) / D;
    let ft = Math.floor(q / 12 + 1e-9);
    let inch = q - ft * 12;
    if (inch >= 12 - 1e-9) { ft += 1; inch = 0; }
    const whole = Math.floor(inch + 1e-9);
    const frac = fracText(Math.round((inch - whole) * D), D);
    let s;
    if (ft === 0) s = `${whole}${frac}"`;
    else if (whole === 0 && !frac) s = `${ft}'`;
    else s = `${ft}' ${whole}${frac}"`;
    return (neg ? '−' : '') + s;
  }
  return m.toLocaleString('pt-BR', { minimumFractionDigits: PREC.mDec, maximumFractionDigits: PREC.mDec }) + ' m';
}

export function formatArea(m2, unit) {
  if (unit === 'ft') {
    return (m2 / M2_PER_FT2).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' ft²';
  }
  return m2.toLocaleString('pt-BR', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' m²';
}

// Aceita "6", "6.5", "6,5", "6 1/2", "1/2".
export function parseNumber(str) {
  if (str == null) return NaN;
  const s = String(str).trim().replace(',', '.');
  if (!s) return NaN;
  const m = s.match(/^(-?\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?$/);
  if (!m || (!m[1] && !m[2])) return NaN;
  let v = m[1] ? parseFloat(m[1]) : 0;
  if (m[2]) v += parseInt(m[2], 10) / parseInt(m[3], 10);
  return v;
}

// Pés + polegadas → metros. Campos vazios contam como 0; ambos vazios → NaN.
export function feetInchesToM(ftStr, inStr) {
  const hasFt = String(ftStr ?? '').trim() !== '';
  const hasIn = String(inStr ?? '').trim() !== '';
  if (!hasFt && !hasIn) return NaN;
  const ft = hasFt ? parseNumber(ftStr) : 0;
  const inch = hasIn ? parseNumber(inStr) : 0;
  if (!isFinite(ft) || !isFinite(inch)) return NaN;
  return ft * M_PER_FT + inch * M_PER_IN;
}

export function mToFeetInches(m) {
  const totalIn = Math.round((m / M_PER_IN) * 4) / 4;
  let ft = Math.floor(totalIn / 12 + 1e-9);
  let inch = Math.round((totalIn - ft * 12) * 100) / 100;
  if (inch >= 12) { ft += 1; inch -= 12; }
  return { ft, inch };
}

// Texto livre: 12' 6", 12'6, 12 6, 12.5', 150", 3,45m, 345cm
export function parseLengthText(str, unit) {
  const s = String(str).trim().toLowerCase().replace(/,/g, '.').replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  let m;
  if ((m = s.match(/^(-?[\d.]+)\s*cm$/))) return parseFloat(m[1]) / 100;
  if ((m = s.match(/^(-?[\d.]+)\s*m$/))) return parseFloat(m[1]);
  if ((m = s.match(/^([\d.]+)\s*'\s*(?:([\d.\s/]+)\s*"?)?$/))) return feetInchesToM(m[1], m[2] ?? '');
  if ((m = s.match(/^([\d.\s/]+)\s*"$/))) return feetInchesToM('', m[1]);
  if (unit === 'ft' && (m = s.match(/^([\d.]+)\s+([\d.\s/]+)$/))) return feetInchesToM(m[1], m[2]);
  const v = parseNumber(s);
  if (!isFinite(v)) return NaN;
  return unit === 'ft' ? v * M_PER_FT : v;
}
