// Exportação PNG / PDF (PDF escrito à mão: 1 página com a imagem JPEG — sem dependências).
import { buildExportSVG } from './render.js';

async function renderCanvas(content, meta) {
  const { svg, width, height } = buildExportSVG(content, meta);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  // iOS limita canvas a ~16 MP.
  const scale = Math.min(1, Math.sqrt(16e6 / (width * height)));
  const c = document.createElement('canvas');
  c.width = Math.round(width * scale);
  c.height = Math.round(height * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

const toBlob = (c, type, q) => new Promise((r) => c.toBlob(r, type, q));

export async function exportPNG(content, meta) {
  return toBlob(await renderCanvas(content, meta), 'image/png');
}

export async function exportPDF(content, meta) {
  const c = await renderCanvas(content, meta);
  const jpeg = new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
  const landscape = c.width >= c.height;
  const PW = landscape ? 792 : 612, PH = landscape ? 612 : 792; // Carta (pt)
  const m = 24;
  const s = Math.min((PW - 2 * m) / c.width, (PH - 2 * m) / c.height);
  const w = c.width * s, h = c.height * s;
  const x = (PW - w) / 2, y = (PH - h) / 2;
  const content_ = `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im0 Do Q`;

  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (d) => { const b = typeof d === 'string' ? enc.encode(d) : d; chunks.push(b); offset += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const obj = (n, body) => { offsets[n] = offset; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${c.width} /Height ${c.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream');
  });
  obj(5, () => push(`<< /Length ${content_.length} >>\nstream\n${content_}\nendstream`));
  const xref = offset;
  let x_ = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) x_ += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x_ + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: 'application/pdf' });
}

export const safeName = (s) => (s || 'croqui').replace(/[\\/:*?"<>|]+/g, '-').trim();
