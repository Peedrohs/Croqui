// Movimento e toque: mola física (estilo Apple), toque instantâneo e háptico.

export const reducedMotion = () => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

/**
 * Mola amortecida (massa-mola), integrada em passos fixos — interrompível:
 * quem chamar stop() recebe {x, v} para continuar de onde parou, sem salto.
 * stiffness/damping padrão ≈ razão de amortecimento 0,8 (pouco overshoot, sensação "tátil").
 */
export function spring({ from, to, velocity = 0, stiffness = 380, damping = 31, mass = 1, delay = 0, onUpdate, onDone }) {
  let x = from, v = velocity, raf = 0, stopped = false;
  if (reducedMotion()) {
    onUpdate(to);
    onDone?.();
    return { stop: () => ({ x: to, v: 0 }) };
  }
  const t0 = performance.now() + delay;
  let last = t0;
  const step = (now) => {
    if (stopped) return;
    if (now < t0) { raf = requestAnimationFrame(step); return; }
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    const h = 1 / 240;
    while (dt > 1e-6) {
      const s = Math.min(h, dt);
      const a = (-stiffness * (x - to) - damping * v) / mass;
      v += a * s;
      x += v * s;
      dt -= s;
    }
    if (Math.abs(v) < 0.002 && Math.abs(x - to) < 0.0008) {
      onUpdate(to);
      onDone?.();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { stop: () => { stopped = true; cancelAnimationFrame(raf); return { x, v }; } };
}

// ---------- Háptico ----------
// Android: navigator.vibrate. iOS 18+: alternar um <input switch> dispara o "tick" do Taptic Engine.
let hapticLabel = null;
export function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.display = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      hapticLabel.appendChild(input);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch { /* sem háptico disponível */ }
}

// ---------- Toque instantâneo ----------
// Dispara no pointerdown (sem os ~300ms nem o cancelamento do `click` por micro-movimento),
// e engole o `click` fantasma que o iOS gera ao soltar — senão ele cairia no que abriu embaixo do dedo.
let pressActive = 0;
let suppressUntil = 0;
document.addEventListener('click', (e) => {
  if (hapticLabel && hapticLabel.contains(e.target)) return;
  if (pressActive > 0 || performance.now() < suppressUntil) { e.preventDefault(); e.stopPropagation(); }
}, true);

export function onFastTap(container, selector, fn, { haptics = true } = {}) {
  container.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const el = e.target.closest(selector);
    if (!el || !container.contains(el) || el.disabled) return;
    e.preventDefault();
    el.classList.add('pressed');
    const t0 = performance.now();
    pressActive++;
    const release = () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      pressActive = Math.max(0, pressActive - 1);
      suppressUntil = performance.now() + 120;
      setTimeout(() => el.classList.remove('pressed'), Math.max(0, 110 - (performance.now() - t0)));
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    if (haptics) haptic();
    fn(el, e);
  });
}
