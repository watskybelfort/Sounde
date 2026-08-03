/**
 * Arranque del renderer: ajustes al DOM, motor de audio y estructura.
 */

import { initTitlebar } from './titlebar.js';
import { crearMotor } from './engine.js';
import { initShell } from './shell.js';
import { initTransporte } from './transport.js';
import { crearCola } from './cola.js';
import { crearPaleta } from './paleta.js';
import { crearVisualizador } from './visualizador.js';
import { crearFavoritos } from './favoritos.js';
import { crearListas } from './listas.js';
import { crearAcciones } from './acciones.js';
import { initAtajos } from './atajos.js';
import { crearComandos } from './comandos.js';
import { initSesionMedios } from './mediasession.js';
import { initBarraTareas } from './barratareas.js';
import { crearTemporizador, formatoCuenta } from './temporizador.js';
import { crearAjustes } from './ajustes.js';
import { $, el, glifo, pintarGlifo } from './dom.js';

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
  const favoritos = await crearFavoritos();
  const listas = await crearListas();
  const shell = initShell(motor, ajustes, { favoritos, listas });
  initTransporte(motor, { favoritos });
  const cola = engancharCola(motor, ajustes);
  engancharPaleta(motor, ajustes);
  engancharVisualizador(motor, ajustes);
  engancharLetra(shell);
  initBarraTareas(motor);
  const sesion = initSesionMedios(motor, { activo: ajustes.mediaKeys !== false });
  window.sounde.settings.onChange((patch) => {
    if (patch.mediaKeys !== undefined) sesion.setActivo(patch.mediaKeys !== false);
  });

  const temporizador = engancharTemporizador(motor);
  const panelAjustes = crearAjustes({ motor, ajustes, shell });

  pintarGlifo($('#icono-ajustes'), 'ajustes');
  $('#btn-ajustes').addEventListener('click', () => panelAjustes.alternar());

  const acciones = crearAcciones({
    motor, shell, favoritos, cola, temporizador, ajustes: panelAjustes, raiz,
  });
  const comandos = crearComandos({ acciones, shell, motor, favoritos, listas });

  // La paleta se anade al catalogo despues de crearla porque necesita el
  // propio catalogo para buscar: sin este orden se referencia a si misma.
  acciones.unshift({
    id: 'comandos',
    texto: 'Abrir la paleta de comandos',
    icono: 'buscar',
    grupo: 'Ventana',
    tecla: { key: 'k', ctrl: true },
    atajo: 'Ctrl + K',
    siempre: true,
    ejecutar: () => comandos.alternar(),
  });

  initAtajos(acciones);

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

function engancharVisualizador(motor, ajustes) {
  const visual = crearVisualizador(motor.player, { modo: ajustes.visualizer ?? 'bars' });
  // Primer hijo del transporte: como esta posicionado en absoluto, el orden
  // no afecta al reparto de la rejilla, pero deja claro que va debajo.
  document.querySelector('.transporte').prepend(visual.nodo);
  visual.setModo(ajustes.visualizer ?? 'bars');

  window.sounde.settings.onChange((patch) => {
    if (patch.visualizer !== undefined) visual.setModo(patch.visualizer);
  });

  return visual;
}

/**
 * El temporizador se enseña solo cuando esta puesto.
 *
 * Un boton fijo mas en el transporte seria un boton apagado el 99% del tiempo
 * compitiendo por sitio con los que se usan siempre. Asi, cuando no hay
 * temporizador no ocupa nada, y cuando lo hay la cuenta atras se ve sin tener
 * que ir a buscarla.
 */
function engancharTemporizador(motor) {
  const temporizador = crearTemporizador(motor);

  const cuenta = el('span', { class: 'dormir__cuenta tabular' });
  const pastilla = el('button', {
    class: 'dormir',
    hidden: true,
    title: 'Temporizador puesto. Pulsa para quitarlo',
  }, [
    el('span', { class: 'dormir__icono', texto: glifo('temporizador') }),
    cuenta,
  ]);

  pastilla.addEventListener('click', () => temporizador.cancelar());
  document.querySelector('.extras').prepend(pastilla);

  temporizador.on('cambio', ({ activo, modo, restanteMs }) => {
    pastilla.hidden = !activo;
    if (!activo) return;
    cuenta.textContent = modo === 'pista' ? 'fin' : formatoCuenta(restanteMs);
    pastilla.setAttribute('aria-label',
      modo === 'pista'
        ? 'Se apagara al terminar esta cancion. Pulsa para quitarlo'
        : `Quedan ${formatoCuenta(restanteMs)}. Pulsa para quitar el temporizador`);
  });

  return temporizador;
}

function engancharLetra(shell) {
  const boton = $('#btn-letra');
  pintarGlifo(boton, 'letra');

  // El boton se marca cuando la vista esta abierta, y a la letra se llega
  // tambien por Ctrl+L, por la paleta o saliendo con el boton de volver: se
  // escucha al shell en vez de llevar aqui una bandera, que es justo lo que
  // acaba diciendo una cosa mientras la pantalla enseña otra.
  const pintar = (vista) => {
    boton.setAttribute('aria-pressed', String(vista?.tipo === 'letra'));
  };

  boton.addEventListener('click', () => shell.alternarLetra());
  shell.onVista(pintar);
  pintar(shell.vista);
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

  const alternar = () => {
    const abierta = raiz.dataset.cola !== 'abierta';
    pintar(abierta);
    window.sounde.settings.set({ queueOpen: abierta });
    // Al abrirla interesa ver donde va la reproduccion, no el principio de
    // una cola de dos mil canciones.
    if (abierta) requestAnimationFrame(() => cola.irAActual());
    return abierta;
  };

  boton.addEventListener('click', alternar);

  pintar(!!ajustes.queueOpen);
  return { ...cola, alternar };
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
