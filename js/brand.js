// Identidade visual Paving Crew Group (tokens vindos do repositório PC-Inventory:
// web/src/styles.css e PC Inventory/DesignSystem.swift).
export const BRAND = {
  name: 'Paving Crew Group',
  black: '#0f0f10',
  bronze: '#b08d57',        // acento único — preenchimentos, indicadores, botão primário (texto preto: 6,2:1)
  bronzeText: '#8d7146',    // bronze escurecido p/ texto no tema claro (4,58:1 sobre branco; original = 3,09)
  bronzeTextDark: '#c0a479', // variante p/ texto no tema escuro (7,15:1 sobre #1c1c1e)
  cream: '#f5f3ee',
  charcoal: '#4d4d4d',
};

export const LOGO = {
  onLight: 'brand/logo-on-light.png', // texto preto — fundos claros
  onDark: 'brand/logo-on-dark.png',   // texto branco — fundos escuros
  shield: 'brand/shield.png',
};

let cache = null;
// Logo (versão para fundo claro) como data URL, para embutir no SVG exportado.
export async function logoForExport() {
  if (cache) return cache;
  try {
    const blob = await (await fetch(LOGO.onLight)).blob();
    const src = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    const img = new Image(); img.src = src; await img.decode();
    cache = { src, w: img.naturalWidth, h: img.naturalHeight };
  } catch { cache = null; }
  return cache;
}
