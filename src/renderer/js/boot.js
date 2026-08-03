/**
 * Arranque del renderer: ajustes al DOM, motor de audio y estructura.
 */

import { initTitlebar } from './titlebar.js';
import { crearMotor } from './engine.js';
import { initShell } from './shell.js';
import { initTransporte } from './transport.js';
import { crearCola } from './cola.js';
import { crearPaleta } from './paleta.js';
import { $, pintarGlifo } from './dom.js';

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
  engancharCola(motor, ajustes);
  engancharPaleta(motor, ajustes);

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

function engancharPaleta(motor, ajustes) {
  const paleta = crearPaleta({ ajustes });
  const boton = $('#btn-paleta');

  const pintar = () => {
    const fijado = !paleta.adaptativo;
    pintarGlifo(boton, fijado ? 'soltar' : 'fijar');
    boton.setAttribute('aria-pressed', String(fijado));
    boton.title = fijado
      ? 'Color fijado: volver a seguir la caratula'
      : 'Fijar este color y dejar de seguir la caratula';
  };

  boton.addEventListener('click', () => {
    if (paleta.adaptativo) {
      // Fijar guarda el color que hay ahora mismo, no el de por defecto: la
      // gracia es quedarse con el que acaba de gustar.
      const hex = paleta.fijar();
      window.sounde.settings.set({ adaptiveColor: false, accentFallback: hex });
    } else {
      paleta.soltar(motor.player.track);
      window.sounde.settings.set({ adaptiveColor: true });
    }
    pintar();
  });

  motor.player.on('trackchange', ({ track }) => paleta.aplicar(track));
  pintar();
  paleta.aplicar(motor.player.track);
  return paleta;
}

function engancharCola(motor, ajustes) {
  const cola = crearCola(motor.queue, motor.player);
  // Va dentro de .app porque ocupa una columna de la rejilla: colgado del
  // body quedaria fuera del reparto y taparia el transporte.
  document.querySelector('.app').append(cola.nodo);

  const boton = $('#btn-cola');
  pintarGlifo(boton, 'cola');

  const pintar = (abierta) => {
    raiz.dataset.cola = abierta ? 'abierta' : 'cerrada';
    boton.setAttribute('aria-pressed', String(abierta));
    boton.title = abierta ? 'Ocultar la cola' : 'Cola de reproduccion';
  };

  boton.addEventListener('click', () => {
    const abierta = raiz.dataset.cola !== 'abierta';
    pintar(abierta);
    window.sounde.settings.set({ queueOpen: abierta });
    // Al abrirla interesa ver donde va la reproduccion, no el principio de
    // una cola de dos mil canciones.
    if (abierta) requestAnimationFrame(() => cola.irAActual());
  });

  pintar(!!ajustes.queueOpen);
  return cola;
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
  // Con el color adaptativo encendido manda la caratula: escribir aqui el
  // tinte o el acento guardados los pisaria a media transicion y el vidrio
  // daria un salto de color en mitad de la cancion.
  if (ajustes.adaptiveColor !== undefined) adaptativo = !!ajustes.adaptiveColor;

  if (ajustes.backdropTint !== undefined && !adaptativo) {
    raiz.style.setProperty('--tinte', hexARgb(ajustes.backdropTint));
  }
  if (ajustes.accentFallback !== undefined && !adaptativo) {
    raiz.style.setProperty('--acento', hexARgb(ajustes.accentFallback));
  }
}

let adaptativo = true;

/** '#7AA2F7' -> '122 162 247', que es el formato que quieren las variables. */
export function hexARgb(hex) {
  const h = String(hex).replace('#', '').trim();
  if (h.length !== 6) return '122 162 247';
  const n = Number.parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
