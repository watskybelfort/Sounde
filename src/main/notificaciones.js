'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Notification } = require('electron');

const protocols = require('./protocols');

/**
 * Aviso al cambiar de cancion.
 *
 * Solo cuando la ventana no esta delante. Con Sounde a la vista el aviso no
 * cuenta nada que no se lea ya en el transporte, y a los cuarenta minutos de
 * escucha son cuarenta globos por nada.
 *
 * En Windows los avisos van firmados con el AppUserModelId, que main.js fija
 * al arrancar. Sin un acceso directo instalado con ese mismo identificador,
 * Windows los descarta en silencio: en desarrollo puede no salir ninguno y no
 * es un fallo del codigo. El instalador (electron-builder) crea ese acceso.
 */

/**
 * Ultima pista ya anunciada.
 *
 * Es "anunciada", no "vista", y la diferencia importa. El parte de una pista
 * nueva llega dos veces seguidas: la primera con `sonando` en falso, porque el
 * evento de cambio de pista se emite antes de que `audio.play()` resuelva, y
 * la segunda ya sonando. Apuntando la pista en la primera, la segunda la
 * encontraba repetida y no avisaba nunca nadie.
 */
let avisado = null;

/** El aviso vivo, para cerrarlo cuando llega el siguiente. */
let vivo = null;

function reiniciar() {
  avisado = null;
  cerrarVivo();
}

function cerrarVivo() {
  if (!vivo) return;
  try {
    vivo.close();
  } catch { /* ya se habia ido solo */ }
  vivo = null;
}

/**
 * `track` es la pista tal cual vive en la biblioteca (con `art` como nombre
 * de archivo de la cache), no la version que ve el renderer.
 */
function avisarDePista(win, track, { activo = true, sonando = true } = {}) {
  if (!track || !sonando) return false;
  if (track.id === avisado) return false;
  // Se da por anunciada aunque no llegue a salir el globo. Si no, apagar el
  // ajuste y volver a encenderlo, o cambiar de ventana a mitad de cancion,
  // soltaria el aviso de una que ya lleva tres minutos puesta.
  avisado = track.id;

  if (!activo) return false;
  if (!Notification.isSupported()) return false;
  if (win && !win.isDestroyed() && win.isFocused() && win.isVisible()) return false;

  const icono = rutaDeArte(track);
  const aviso = new Notification({
    title: track.title || 'Sin titulo',
    // Dos lineas: Windows le da al cuerpo mas sitio que al titulo y asi el
    // album no compite con el nombre de la cancion.
    body: [track.artist, track.album].filter(Boolean).join('\n') || 'Sounde',
    icon: icono || undefined,
    silent: true, // un pitido encima de la musica no lo quiere nadie
    urgency: 'low',
  });

  aviso.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  cerrarVivo();
  vivo = aviso;
  aviso.show();
  return true;
}

/** La caratula ya extraida. Si no esta, el aviso sale con el icono de la app. */
function rutaDeArte(track) {
  if (!track.art) return null;
  const dir = protocols.getArtDir();
  if (!dir) return null;
  const completa = path.join(dir, path.basename(track.art));
  return fs.existsSync(completa) ? completa : null;
}

module.exports = { avisarDePista, reiniciar, rutaDeArte };
