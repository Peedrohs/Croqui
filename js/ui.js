// Diálogos e avisos simples (window.prompt é limitado no modo standalone do iOS).
import { esc } from './util.js';

export function toast(msg, ms = 2200) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, ms);
}

function modal(html, onMount) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog">${html}</div>`;
    document.body.appendChild(wrap);
    const close = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(null); });
    onMount(wrap.querySelector('.modal'), close);
  });
}

export function ask(title, value = '', { okLabel = 'OK', placeholder = '' } = {}) {
  return modal(
    `<h3>${esc(title)}</h3><input class="field" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
     <div class="modal-actions"><button class="btn" data-a="cancel">Cancelar</button><button class="btn primary" data-a="ok">${esc(okLabel)}</button></div>`,
    (m, close) => {
      const input = m.querySelector('input');
      setTimeout(() => { input.focus(); input.select(); }, 50);
      m.querySelector('[data-a=cancel]').onclick = () => close(null);
      m.querySelector('[data-a=ok]').onclick = () => close(input.value.trim() || null);
      input.onkeydown = (e) => { if (e.key === 'Enter') close(input.value.trim() || null); };
    },
  );
}

export function confirmDialog(title, text = '', { okLabel = 'Confirmar', danger = false } = {}) {
  return modal(
    `<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
     <div class="modal-actions"><button class="btn" data-a="cancel">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="ok">${esc(okLabel)}</button></div>`,
    (m, close) => {
      m.querySelector('[data-a=cancel]').onclick = () => close(false);
      m.querySelector('[data-a=ok]').onclick = () => close(true);
    },
  );
}

// Menu de ações: items = [{label, value, danger}]
export function menu(title, items) {
  return modal(
    `<h3>${esc(title)}</h3><div class="menu-list">${items
      .map((it, i) => `<button class="btn menu-item ${it.danger ? 'danger' : ''}" data-i="${i}">${esc(it.label)}</button>`)
      .join('')}</div><div class="modal-actions"><button class="btn" data-a="cancel">Fechar</button></div>`,
    (m, close) => {
      m.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => close(items[+b.dataset.i].value)));
      m.querySelector('[data-a=cancel]').onclick = () => close(null);
    },
  );
}

// Salva/compartilha um arquivo (no iPad abre a planilha de compartilhamento → "Salvar em Arquivos").
export async function saveFile(blob, filename) {
  // App nativo: planilha de compartilhar do iOS (Salvar em Arquivos, AirDrop, Mail, Fotos…).
  const nb = window.webkit?.messageHandlers?.share;
  if (window.__CROQUI_NATIVE__ && nb) {
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
    nb.postMessage({ name: filename, mime: blob.type, base64: b64 });
    return;
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}
