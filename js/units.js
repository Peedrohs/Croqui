// Unidades: internamente tudo é em METROS.
export const M_PER_FT = 0.3048;
export const M_PER_IN = 0.0254;
export const M2_PER_FT2 = M_PER_FT * M_PER_FT;

const FRACS = { 0: '', 0.25: '¼', 0.5: '½', 0.75: '¾' };

export function formatLength(m, unit) {
  if (m == null || !isFinite(m)) return '?';
  if (unit === 'ft') {
    const neg = m < 0;
    const q = Math.round((Math.abs(m) / M_PER_IN) * 4) / 4; // 1/4"
    let ft = Math.floor(q / 12 + 1e-9);
    let inch = q - ft * 12;
    if (inch >= 12 - 1e-9) { ft += 1; inch = 0; }
    const whole = Math.floor(inch + 1e-9);
    const frac = FRACS[Math.round((inch - whole) * 4) / 4] ?? '';
    let s;
    if (ft === 0) s = `${whole}${frac}"`;
    else if (whole === 0 && !frac) s = `${ft}'`;
    else s = `${ft}' ${whole}${frac}"`;
    return (neg ? '−' : '') + s;
  }
  return m.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m';
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
