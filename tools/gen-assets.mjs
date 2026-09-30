// Gera ícones do PWA e telas de abertura (splash) do iPad a partir dos logos em brand/.
// Uso: node tools/gen-assets.mjs   (requer Playwright/Chromium)
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BG = { dark: '#0f0f10', light: '#f5f3ee' };
// Tamanhos em pontos (retrato) dos iPads atuais; todos @2x.
const IPADS = [[744, 1133], [810, 1080], [820, 1180], [834, 1194], [834, 1210], [1024, 1366], [1032, 1376]];

const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });
const p = await b.newPage();
await p.goto('file://' + ROOT + '/brand/shield.png');

async function draw(job) {
  return p.evaluate(async ({ W, H, bg, img, frac, mode }) => {
    const load = async (src) => { const i = new Image(); i.src = src; await i.decode(); return i; };
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const im = await load(img);
    let w, h;
    if (mode === 'height') { h = Math.min(W, H) * frac; w = (h * im.width) / im.height; }
    else { w = Math.min(W, H) * frac; h = (w * im.height) / im.width; }
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
    return c.toDataURL('image/png');
  }, job);
}
const save = (rel, data) => { fs.writeFileSync(path.join(ROOT, rel), Buffer.from(data.split(',')[1], 'base64')); };
const shield = 'file://' + ROOT + '/brand/shield.png';

for (const [theme, suffix] of [['dark', ''], ['light', '-light']]) {
  for (const n of [192, 512]) save(`icons/icon-${n}${suffix}.png`, await draw({ W: n, H: n, bg: BG[theme], img: shield, frac: 0.62, mode: 'height' }));
}
save('icons/apple-touch-icon.png', await draw({ W: 180, H: 180, bg: BG.dark, img: shield, frac: 0.62, mode: 'height' }));
save('icons/maskable-512.png', await draw({ W: 512, H: 512, bg: BG.dark, img: shield, frac: 0.46, mode: 'height' }));

const links = [];
for (const [w, h] of IPADS) {
  for (const orient of ['portrait', 'landscape']) {
    const W = (orient === 'portrait' ? w : h) * 2, H = (orient === 'portrait' ? h : w) * 2;
    for (const theme of ['light', 'dark']) {
      const logo = 'file://' + ROOT + (theme === 'dark' ? '/brand/logo-on-dark.png' : '/brand/logo-on-light.png');
      const name = `splash/ipad-${w}x${h}-${orient}-${theme}.png`;
      save(name, await draw({ W, H, bg: BG[theme], img: logo, frac: 0.46, mode: 'width' }));
      links.push(`<link rel="apple-touch-startup-image" href="${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: 2) and (orientation: ${orient}) and (prefers-color-scheme: ${theme})">`);
    }
  }
}
const idx = path.join(ROOT, 'index.html');
const html = fs.readFileSync(idx, 'utf8').replace(/<!--STARTUP-->[\s\S]*?<!--\/STARTUP-->|<!--STARTUP-->/, `<!--STARTUP-->\n  ${links.join('\n  ')}\n  <!--/STARTUP-->`);
fs.writeFileSync(idx, html);
await b.close();
console.log('ok', links.length, 'splash screens');
