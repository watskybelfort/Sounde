'use strict';

const { glifo, distintivo } = require('./iconos');

/**
 * Lo que Sounde pone en la barra de tareas de Windows.
 *
 *   - Botones sobre la miniatura de la ventana (anterior / play / siguiente),
 *     que salen al posar el raton sobre el icono.
 *   - La barra de progreso pintada sobre el propio icono.
 *   - Un distintivo con el estado, en la esquina del icono.
 *
 * Todo esto se refresca desde el renderer, que es quien sabe lo que suena. Va
 * por `send` y no por `invoke`: son avisos, no preguntas, y llegan varias
 * veces por minuto.
 */

/** Los NativeImage se crean tarde: nativeImage no existe antes de app.ready. */
let iconos = null;

function cargarIconos() {
  if (iconos) return iconos;
  iconos = {
    anterior: glifo('anterior'),
    reproducir: glifo('reproducir'),
    pausa: glifo('pausa'),
    siguiente: glifo('siguiente'),
    marcaSonando: distintivo('reproducir'),
    marcaPausa: distintivo('pausa'),
  };
  return iconos;
}

/**
 * Lo ultimo aplicado, para no repetir llamadas.
 *
 * setThumbarButtons rehace la barra entera cada vez y parpadea si se llama en
 * cada tick; setProgressBar cruza a la shell de Windows. Con la posicion
 * llegando cuatro veces por segundo, filtrar aqui no es optimizar de mas.
 */
let ultimo = { firma: null, progreso: null, marca: null };

function reiniciar() {
  ultimo = { firma: null, progreso: null, marca: null };
}

/**
 * `estado` viene del renderer:
 *   { hayPista, sonando, hayPrev, hayNext, posicion, duracion }
 */
function aplicarEstado(win, estado, alMandar) {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return;

  const hayPista = !!estado?.hayPista;
  const sonando = !!estado?.sonando;

  botones(win, { hayPista, sonando, hayPrev: !!estado?.hayPrev, hayNext: !!estado?.hayNext }, alMandar);
  progreso(win, { hayPista, sonando, posicion: estado?.posicion, duracion: estado?.duracion });
  marca(win, { hayPista, sonando });
}

function botones(win, { hayPista, sonando, hayPrev, hayNext }, alMandar) {
  const firma = `${hayPista}|${sonando}|${hayPrev}|${hayNext}`;
  if (firma === ultimo.firma) return;
  ultimo.firma = firma;

  const ico = cargarIconos();
  // Un boton apagado se pinta en gris pero sigue ocupando su sitio. Quitarlo
  // seria peor: los tres se correrian y el play cambiaria de posicion cada vez
  // que se llega al final de la cola.
  const apagado = (puede) => (puede ? [] : ['disabled']);

  win.setThumbarButtons([
    {
      tooltip: 'Anterior',
      icon: ico.anterior,
      flags: apagado(hayPrev),
      click: () => alMandar('prev'),
    },
    {
      tooltip: sonando ? 'Pausar' : 'Reproducir',
      icon: sonando ? ico.pausa : ico.reproducir,
      flags: apagado(hayPista),
      click: () => alMandar('toggle'),
    },
    {
      tooltip: 'Siguiente',
      icon: ico.siguiente,
      flags: apagado(hayNext),
      click: () => alMandar('next'),
    },
  ]);
}

function progreso(win, { hayPista, sonando, posicion, duracion }) {
  // -1 apaga la barra. Dejar un 0 pintaria un rectangulo vacio sobre el icono,
  // que se lee como "descargando algo y atascado".
  if (!hayPista || !Number.isFinite(duracion) || duracion <= 0) {
    if (ultimo.progreso !== 'apagada') {
      ultimo.progreso = 'apagada';
      win.setProgressBar(-1);
    }
    return;
  }

  const fraccion = Math.min(1, Math.max(0, (posicion || 0) / duracion));
  const modo = sonando ? 'normal' : 'paused';
  // Se compara por porcentaje entero: la barra del icono mide 40 pixeles, asi
  // que refrescarla mas fino no cambia un solo pixel.
  const clave = `${Math.round(fraccion * 100)}|${modo}`;
  if (clave === ultimo.progreso) return;
  ultimo.progreso = clave;
  win.setProgressBar(fraccion, { mode: modo });
}

function marca(win, { hayPista, sonando }) {
  const cual = !hayPista ? null : sonando ? 'sonando' : 'pausa';
  if (cual === ultimo.marca) return;
  ultimo.marca = cual;

  if (!cual) {
    win.setOverlayIcon(null, '');
    return;
  }
  const ico = cargarIconos();
  win.setOverlayIcon(
    cual === 'sonando' ? ico.marcaSonando : ico.marcaPausa,
    cual === 'sonando' ? 'Sonando' : 'En pausa',
  );
}

/** Al cerrar hay que limpiar o Windows deja la barra verde pegada al icono. */
function limpiar(win) {
  if (!win || win.isDestroyed() || process.platform !== 'win32') return;
  try {
    win.setProgressBar(-1);
    win.setOverlayIcon(null, '');
    win.setThumbarButtons([]);
  } catch { /* la ventana se estaba yendo */ }
  reiniciar();
}

module.exports = { aplicarEstado, limpiar, reiniciar };
