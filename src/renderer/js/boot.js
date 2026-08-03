/**
 * Arranque del renderer: ajustes al DOM, motor de audio y estructura.
 */

import { initTitlebar } from './titlebar.js';
import { crearMotor } from './engine.js';
import { initShell } from './shell.js';
import { initTransporte } from './transport.js';
import { $ } from './dom.js';

const raiz = document.documentElement;

boot();

async function boot() {
  initTitlebar();

  const ajustes = await window.sounde.settings.all();
  aplicarAjustes(ajustes);

  // Windows apaga el acrilico del sistema al perder el foco. La UI compensa
  // subiendo su propia veladura; sin esto el contraste se cae y parece que
  // el tema se rompio.
  window.sounde.window.onFocus(({ focused }) => {
    raiz.dataset.focused = String(focused);
  });

  window.sounde.settings.onChange((patch) => aplicarAjustes(patch));

  const motor = await crearMotor(ajustes);
  const shell = initShell(motor, ajustes);
  initTransporte(motor);

  motor.queue.on('track', ({ track }) => {
    const titulo = track ? `${track.artist} — ${track.title}` : 'Sounde';
    $('#titulo-ahora').textContent = titulo;
    document.title = track ? `${track.title} · Sounde` : 'Sounde';
  });

  motor.queue.on('skip', ({ track, message }) => {
    console.warn('[cola] me salto', track?.title, '-', message);
  });

  window.sounde.app.onOpenFiles((tracks) => {
    if (tracks?.length) motor.queue.setContext(tracks, { startIndex: 0 });
  });

  await shell.refrescar();
}

export function aplicarAjustes(ajustes) {
  if (!ajustes) return;

  if (ajustes.backdrop !== undefined) raiz.dataset.backdrop = ajustes.backdrop;
  if (ajustes.miniPlayer !== undefined) raiz.dataset.mini = String(ajustes.miniPlayer);
  if (ajustes.sidebarCollapsed !== undefined) {
    raiz.dataset.lateral = ajustes.sidebarCollapsed ? 'plegado' : 'abierto';
  }
  if (ajustes.glassOpacity !== undefined) {
    raiz.style.setProperty('--transparencia', String(ajustes.glassOpacity));
  }
  if (ajustes.backdropTint !== undefined) {
    raiz.style.setProperty('--tinte', hexARgb(ajustes.backdropTint));
  }
  if (ajustes.accentFallback !== undefined && !ajustes.adaptiveColor) {
    raiz.style.setProperty('--acento', hexARgb(ajustes.accentFallback));
  }
}

/** '#7AA2F7' -> '122 162 247', que es el formato que quieren las variables. */
export function hexARgb(hex) {
  const h = String(hex).replace('#', '').trim();
  if (h.length !== 6) return '122 162 247';
  const n = Number.parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
