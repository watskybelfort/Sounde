/**
 * Sesion de medios del sistema.
 *
 * En Windows 11 esto es lo que alimenta los SMTC: el panel que sale al pulsar
 * una tecla multimedia, con caratula, titulo y botones. Y es tambien lo que
 * hace que esas teclas lleguen aqui.
 *
 * La alternativa habria sido `globalShortcut` en el proceso principal, que
 * secuestra las teclas a nivel de sistema: con eso Sounde se quedaria el
 * play/pausa aunque quien este sonando sea otro programa, y ademas Windows no
 * tendria nada que pintar en el panel. La sesion de medios es justo lo
 * contrario: Windows sabe quien suena y le manda la tecla a ese.
 *
 * `setPositionState` es la que dibuja la barra de progreso del panel del
 * sistema; sin ella el panel sale sin barra y arrastrar desde ahi no existe.
 */

const SIN_SESION = { actualizar() {}, setActivo() {}, disponible: false };

export function initSesionMedios(motor, { activo = true } = {}) {
  if (!('mediaSession' in navigator)) return SIN_SESION;

  const ms = navigator.mediaSession;
  const { player, queue } = motor;

  // --- Lo que Windows pinta ---------------------------------------------------

  function pintarMetadatos(track) {
    if (!track) {
      ms.metadata = null;
      return;
    }
    const base = {
      title: track.title || 'Sin titulo',
      artist: track.artist || 'Artista desconocido',
      album: track.album || '',
    };
    // El texto va ya, sin esperar a la caratula: cambiar de cancion tiene que
    // verse en el panel del sistema en el acto.
    ms.metadata = new MediaMetadata({ ...base, artwork: [] });
    if (!track.artUrl) return;

    urlDeArte(track.artUrl).then((arte) => {
      // La caratula llega tarde a proposito. Si mientras tanto ha entrado
      // otra pista, esta ya no pinta nada.
      if (!arte || player.track?.id !== track.id) return;
      ms.metadata = new MediaMetadata({
        ...base,
        artwork: [{ src: arte.url, type: arte.tipo }],
      });
    }).catch(() => { /* sin caratula en el panel, el resto sigue */ });
  }

  function pintarEstado() {
    ms.playbackState = !player.track ? 'none' : player.playing ? 'playing' : 'paused';
  }

  function pintarPosicion() {
    const duration = player.duration;
    // El navegador tira TypeError si la posicion se pasa de la duracion o si
    // la duracion no es finita, y eso pasa de verdad: un mp3 VBR sin cabecera
    // Xing informa Infinity hasta que acaba de descargarse.
    if (!Number.isFinite(duration) || duration <= 0) return;
    const position = Math.min(Math.max(player.currentTime, 0), duration);
    try {
      ms.setPositionState({ duration, position, playbackRate: player.rate || 1 });
    } catch { /* la pista cambio entre la lectura y la escritura */ }
  }

  const actualizar = () => {
    pintarEstado();
    pintarPosicion();
  };

  // --- Lo que Windows manda ---------------------------------------------------

  const ACCIONES = {
    play: () => {
      // Sin nada cargado, el play del sistema arranca la cola por el principio,
      // igual que el boton de la ventana.
      if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
      else player.play();
    },
    pause: () => player.pause(),
    stop: () => {
      player.pause();
      player.seek(0);
    },
    previoustrack: () => queue.prev(),
    nexttrack: () => queue.next(),
    seekto: (d) => {
      if (typeof d.seekTime === 'number') player.seek(d.seekTime);
    },
    seekbackward: (d) => player.seek(player.currentTime - (d.seekOffset || 10)),
    seekforward: (d) => player.seek(player.currentTime + (d.seekOffset || 10)),
  };

  /**
   * Engancha o suelta los mandos del sistema.
   *
   * Soltarlos es lo que hace de verdad el ajuste "teclas multimedia": la ficha
   * con la caratula se sigue publicando, porque eso no molesta a nadie, pero
   * las teclas dejan de mandar sobre Sounde.
   */
  function setActivo(activo) {
    for (const [nombre, fn] of Object.entries(ACCIONES)) {
      try {
        // Un handler que tira una excepcion deja ese boton del panel muerto
        // hasta recargar la pagina, y sin ningun aviso: van todos envueltos.
        ms.setActionHandler(nombre, !activo ? null : (detalles) => {
          try {
            fn(detalles || {});
          } catch (err) {
            console.warn('[sesion] la accion', nombre, 'fallo:', err.message);
          }
        });
      } catch {
        // Chromium rechaza las acciones que no conoce. No es un fallo: la
        // sesion sigue viva con las demas.
      }
    }
  }

  // --- Cableado ---------------------------------------------------------------

  player.on('trackchange', ({ track }) => {
    pintarMetadatos(track);
    actualizar();
  });
  player.on('state', actualizar);
  player.on('duration', pintarPosicion);
  // 'time' llega unas cuatro veces por segundo. Refrescar la posicion en cada
  // uno seria gratis para la barra de la ventana, pero esto cruza a otro
  // proceso: se manda una vez por segundo, que es lo que el panel refresca.
  let ultimo = 0;
  player.on('time', () => {
    const ahora = performance.now();
    if (ahora - ultimo < 1000) return;
    ultimo = ahora;
    pintarPosicion();
  });

  setActivo(activo);
  pintarMetadatos(player.track);
  actualizar();

  return { actualizar, setActivo, disponible: true };
}

/**
 * Caratula en forma de blob.
 *
 * MediaImage solo admite http, https, data y blob: pasarle la URL de
 * `sounde-art://` la rechaza en consola y el panel del sistema sale con el
 * cuadradito gris de siempre. Se descarga por fetch (la CSP ya deja
 * connect-src a ese esquema) y se convierte en un blob:, que si acepta.
 *
 * Se cachean unas cuantas porque un album entero comparte caratula y crear
 * una URL de objeto por cancion filtra memoria: las URL de objeto no se
 * liberan solas, hay que revocarlas.
 */
const cacheArte = new Map();
const MAX_ARTE = 24;

async function urlDeArte(artUrl) {
  const guardada = cacheArte.get(artUrl);
  if (guardada) return guardada;

  const res = await fetch(artUrl);
  if (!res.ok) return null;
  const blob = await res.blob();
  const arte = { url: URL.createObjectURL(blob), tipo: blob.type || 'image/jpeg' };

  cacheArte.set(artUrl, arte);
  if (cacheArte.size > MAX_ARTE) {
    const [clave, vieja] = cacheArte.entries().next().value;
    cacheArte.delete(clave);
    URL.revokeObjectURL(vieja.url);
  }
  return arte;
}
