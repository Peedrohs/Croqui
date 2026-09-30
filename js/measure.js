// Entrada de medidas, isolada do resto do editor.
//
// • MeasurePad: campos de pés/polegadas ou metros + teclado numérico grande (sem teclado do sistema).
// • measurementBus: canal para fontes EXTERNAS de medida. Hoje não há nenhuma (o Safari do iPadOS
//   não tem Web Bluetooth); uma futura versão nativa com a trena Bosch GLM só precisa chamar
//   `window.croquiMeasure(metros)` ou `measurementBus.publish(metros)` — o editor aplica a medida
//   no lado selecionado e avança para o próximo, igual ao botão "Aplicar e próximo".
import { feetInchesToM, mToFeetInches, parseNumber } from './units.js';
import { onFastTap } from './motion.js';
import { esc } from './util.js';

const subs = new Set();
export const measurementBus = {
  publish(meters, meta = {}) { if (meters > 0 && isFinite(meters)) subs.forEach((fn) => fn(meters, meta)); },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};
if (typeof window !== 'undefined') window.croquiMeasure = (m) => measurementBus.publish(+m, { source: 'external' });

const fmtM = (v) => String(Math.round(v * 1000) / 1000).replace('.', ',');

/**
 * fields: [{ key, label, valueM }]; unit: 'ft'|'m'
 * onApply({ [key]: meters|NaN }, { next }) ; onUnit(unit)
 */
export class MeasurePad {
  constructor(el, { fields, unit, onApply, onUnit, focus = true }) {
    this.el = el;
    this.fields = fields;
    this.unit = unit;
    this.onApply = onApply;
    this.onUnit = onUnit;
    this.parts = {};
    for (const f of fields) {
      if (unit === 'ft') {
        const fi = f.valueM != null ? mToFeetInches(f.valueM) : null;
        this.parts[f.key + ':ft'] = fi ? String(fi.ft) : '';
        this.parts[f.key + ':in'] = fi && fi.inch ? String(fi.inch) : '';
      } else this.parts[f.key + ':m'] = f.valueM != null ? fmtM(f.valueM) : '';
    }
    this.active = fields[0].key + (unit === 'ft' ? ':ft' : ':m');
    this.fresh = true; // primeira tecla substitui o valor antigo (como selecionar tudo)
    this.render();
    onFastTap(el, 'button', (b) => this.press(b));
    this.onKey = (e) => {
      if (!el.isConnected) return document.removeEventListener('keydown', this.onKey);
      if (e.target.closest?.('input, textarea')) return;
      if (/^[0-9]$/.test(e.key)) this.type(e.key);
      else if (e.key === '.' || e.key === ',') this.type('.');
      else if (e.key === 'Backspace') this.back();
      else if (e.key === 'Enter') this.apply(true);
      else if (e.key === 'Tab') { e.preventDefault(); this.cycle(); }
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', this.onKey);
    void focus;
  }

  partKeys() { return this.fields.flatMap((f) => (this.unit === 'ft' ? [f.key + ':ft', f.key + ':in'] : [f.key + ':m'])); }

  render() {
    const u = this.unit;
    const row = (f) => (u === 'ft'
      ? `<button class="mp-field ${this.active === f.key + ':ft' ? 'on' : ''}" data-p="${f.key}:ft"><span>${esc(this.parts[f.key + ':ft'] || '0')}</span><em>ft</em></button>
         <button class="mp-field ${this.active === f.key + ':in' ? 'on' : ''}" data-p="${f.key}:in"><span>${esc(this.parts[f.key + ':in'] || '0')}</span><em>in</em></button>`
      : `<button class="mp-field wide ${this.active === f.key + ':m' ? 'on' : ''}" data-p="${f.key}:m"><span>${esc(this.parts[f.key + ':m'] || '0')}</span><em>m</em></button>`);
    const keys = u === 'ft'
      ? ['7', '8', '9', '⌫', '4', '5', '6', '½', '1', '2', '3', '¼', '0', '.', '→', '¾']
      : ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '→', '0', ',', '00', ''];
    this.el.innerHTML = `
      ${this.fields.map((f) => `<label class="mp-label">${esc(f.label)}</label><div class="mp-row">${row(f)}</div>`).join('')}
      <div class="mp-units"><button class="chip ${u === 'ft' ? 'on' : ''}" data-u="ft">pés / pol</button><button class="chip ${u === 'm' ? 'on' : ''}" data-u="m">metros</button></div>
      <div class="mp-keys">${keys.map((k) => (k ? `<button class="mp-key ${/[0-9]/.test(k) && k.length === 1 ? '' : 'fn'}" data-k="${k}" aria-label="${k === '⌫' ? 'Apagar' : k === '→' ? 'Próximo campo' : k}">${k}</button>` : '<span></span>')).join('')}</div>
      <div class="row"><button class="btn primary big" data-x="apply">Aplicar</button><button class="btn big" data-x="next">Aplicar e próximo →</button></div>`;
  }

  press(b) {
    if (b.dataset.p) { this.active = b.dataset.p; this.fresh = true; return this.render(); }
    if (b.dataset.u) { if (b.dataset.u !== this.unit) this.switchUnit(b.dataset.u); return; }
    if (b.dataset.x) return this.apply(b.dataset.x === 'next');
    const k = b.dataset.k;
    if (k === '⌫') this.back();
    else if (k === '→') this.cycle();
    else if (k === 'C') { this.parts[this.active] = ''; this.render(); }
    else if (k === '½' || k === '¼' || k === '¾') this.fraction(k);
    else this.type(k === ',' ? '.' : k);
  }

  type(ch) {
    let v = this.fresh ? '' : this.parts[this.active];
    this.fresh = false;
    if (ch === '.' && v.includes('.')) return;
    if (ch === '.' && !v) v = '0';
    if (v.length >= 7) return;
    this.parts[this.active] = v + ch;
    this.render();
  }

  back() { this.fresh = false; this.parts[this.active] = this.parts[this.active].slice(0, -1); this.render(); }

  // Frações entram nas polegadas: "6" + ½ → 6,5.
  fraction(k) {
    const key = this.active.replace(':ft', ':in');
    this.active = key;
    const base = Math.floor(parseNumber(this.fresh ? '' : this.parts[key]) || 0);
    this.parts[key] = String(base + { '¼': 0.25, '½': 0.5, '¾': 0.75 }[k]);
    this.fresh = false;
    this.render();
  }

  cycle() {
    const ks = this.partKeys();
    this.active = ks[(ks.indexOf(this.active) + 1) % ks.length];
    this.fresh = true;
    this.render();
  }

  values() {
    const out = {};
    for (const f of this.fields) {
      out[f.key] = this.unit === 'ft'
        ? feetInchesToM(this.parts[f.key + ':ft'], this.parts[f.key + ':in'])
        : parseNumber(this.parts[f.key + ':m']);
    }
    return out;
  }

  switchUnit(u) {
    const vals = this.values();
    this.unit = u;
    this.fields = this.fields.map((f) => ({ ...f, valueM: isFinite(vals[f.key]) && vals[f.key] > 0 ? vals[f.key] : null }));
    this.parts = {};
    for (const f of this.fields) {
      if (u === 'ft') {
        const fi = f.valueM != null ? mToFeetInches(f.valueM) : null;
        this.parts[f.key + ':ft'] = fi ? String(fi.ft) : '';
        this.parts[f.key + ':in'] = fi && fi.inch ? String(fi.inch) : '';
      } else this.parts[f.key + ':m'] = f.valueM != null ? fmtM(f.valueM) : '';
    }
    this.active = this.fields[0].key + (u === 'ft' ? ':ft' : ':m');
    this.render();
    this.onUnit?.(u);
  }

  apply(next) { this.onApply(this.values(), { next }); }
}
