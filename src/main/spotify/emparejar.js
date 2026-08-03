'use strict';

/**
 * Empareja lo que hay en Spotify con lo que hay en el disco.
 *
 * Esto es lo que decide si una cancion de una lista sale como "ya la tienes"
 * o como "te falta", asi que los dos errores se ven en pantalla y ninguno es
 * gratis: un falso positivo hace que al pulsar suene otra cancion, y un falso
 * negativo manda al usuario a buscar algo que ya tenia.
 *
 * Ante la duda, NO se empareja. Que sobre una cancion en la lista de lo que
 * falta se arregla solo cuando el usuario la ve; que suene la version en
 * directo de doce minutos en vez de la del disco, no.
 */

/**
 * Coletillas que Spotify pone en el titulo y las etiquetas de un archivo no
 * suelen llevar. Sin quitarlas, "Song - Remastered 2011" nunca casa con
 * "Song", que es exactamente el mismo audio.
 */
const COLETILLAS = new RegExp(
  '\\s*[-–—]\\s*(' + [
    '(\\d{4}\\s+)?remaster(ed)?(\\s+\\d{4})?',
    'radio\\s+edit', 'single\\s+version', 'album\\s+version', 'original\\s+mix',
    'mono|stereo', 'deluxe(\\s+edition)?', 'bonus\\s+track',
    'explicit|clean', 'edit', 'version\\s+remasterizada',
  ].join('|') + ')\\s*$',
  'i',
);

/**
 * Lo que va entre parentesis o corchetes y es ruido de catalogo.
 *
 * OJO con lo que NO esta aqui: "(Live)", "(Acoustic)", "(Remix)" y las
 * versiones con otro artista se dejan tal cual a proposito. Son grabaciones
 * distintas, no la misma con otro nombre, y borrarlas del titulo haria que el
 * directo casara con el estudio.
 */
const PARENTESIS_RUIDO = /[([]\s*(feat\.?|ft\.?|con|with)\s[^)\]]*[)\]]/gi;
const PARENTESIS_EDICION = /[([]\s*((\d{4}\s+)?remaster(ed)?(\s+\d{4})?|deluxe(\s+edition)?|bonus\s+track|explicit|official\s+(music\s+)?video|audio|lyrics?\s+video)\s*[)\]]/gi;

/** Separadores con los que un archivo puede listar varios artistas. */
const SEPARADORES = /\s*(?:,|;|\/|\+|&|\band\b|\by\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bcon\b|\bx\b)\s*/gi;

/** Margen de duracion. Dos codificaciones del mismo master no dan lo mismo al segundo. */
const MARGEN_S = 4;

// --- Normalizacion --------------------------------------------------------

/**
 * Baja un texto a su forma comparable.
 *
 * Los acentos se quitan porque las etiquetas de un archivo los llevan a
 * capricho de quien lo rasgo: "Cancion" y "Canción" son la misma.
 */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[''´`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** El titulo sin coletillas de edicion, listo para comparar. */
function tituloClave(titulo) {
  let t = String(titulo ?? '');
  t = t.replace(PARENTESIS_RUIDO, ' ').replace(PARENTESIS_EDICION, ' ');
  // En bucle: "Song - Remastered - Radio Edit" lleva dos pegadas.
  let previo;
  do {
    previo = t;
    t = t.replace(COLETILLAS, '');
  } while (t !== previo);
  return normalizar(t);
}

/** El conjunto de artistas de una cadena o de una lista. */
function artistasDe(valor) {
  const bruto = Array.isArray(valor) ? valor.join(',') : String(valor ?? '');
  const partes = bruto.split(SEPARADORES).map(normalizar).filter(Boolean);
  return new Set(partes);
}

// --- Indice de la biblioteca ---------------------------------------------

/**
 * Agrupa la biblioteca por titulo normalizado.
 *
 * Sin indice habria que recorrer la biblioteca entera por cada cancion de
 * Spotify: una lista de 2000 contra una biblioteca de 5000 son diez millones
 * de comparaciones de texto, y la sincronizacion se sentiria colgada. Con el
 * indice, cada cancion mira solo las que ya comparten titulo.
 */
function construirIndice(tracks) {
  const porTitulo = new Map();
  for (const track of tracks ?? []) {
    const clave = tituloClave(track.title);
    if (!clave) continue;
    let cubo = porTitulo.get(clave);
    if (!cubo) porTitulo.set(clave, (cubo = []));
    cubo.push({
      track,
      artistas: artistasDe(track.artist),
      albumArtistas: artistasDe(track.albumArtist),
      album: tituloClave(track.album),
      duracion: Number(track.duration) || 0,
    });
  }
  return { porTitulo, tamano: tracks?.length ?? 0 };
}

// --- Emparejado -----------------------------------------------------------

/**
 * Busca en la biblioteca la cancion que corresponde a una de Spotify.
 *
 * Devuelve `{ track, confianza, puntos }` o `null`. `confianza` es 'exacta'
 * cuando ademas cuadran la duracion y el album, y 'probable' cuando solo
 * cuadran titulo y artista: la interfaz puede tratarlas distinto, pero las
 * dos se consideran encontradas.
 */
function emparejar(remota, indice) {
  const clave = tituloClave(remota.title);
  if (!clave) return null;

  const candidatos = indice.porTitulo.get(clave);
  if (!candidatos?.length) return null;

  const artistasRemotos = artistasDe(remota.artists ?? remota.artist);
  const albumRemoto = tituloClave(remota.album);
  const duracionRemota = Number(remota.duration) || 0;

  let mejor = null;
  for (const cand of candidatos) {
    /*
     * El artista es obligatorio. Hay demasiada cancion distinta con el mismo
     * titulo ("Intro", "Hold On", "Alone") como para dar por buena una
     * coincidencia solo de nombre.
     */
    const coincideArtista = solapan(artistasRemotos, cand.artistas)
      || solapan(artistasRemotos, cand.albumArtistas);
    if (!coincideArtista) continue;

    let puntos = 2;
    const dif = Math.abs(cand.duracion - duracionRemota);
    const duracionConocida = cand.duracion > 0 && duracionRemota > 0;

    /*
     * Una duracion que se sale del margen descarta, no resta.
     *
     * Mismo titulo y mismo artista con dos minutos de diferencia no es una
     * etiqueta mal puesta: es otra grabacion — un directo, un remix largo, o
     * la version extendida. Enlazarlas hace que al pulsar suene algo que no
     * es lo que pone en la lista.
     */
    if (duracionConocida) {
      if (dif > MARGEN_S) continue;
      puntos += 2 - dif / MARGEN_S;
    }
    if (albumRemoto && cand.album === albumRemoto) puntos += 1;

    if (!mejor || puntos > mejor.puntos) {
      mejor = { track: cand.track, puntos, dif: duracionConocida ? dif : null, album: cand.album === albumRemoto };
    }
  }

  if (!mejor) return null;
  const exacta = mejor.dif !== null && mejor.dif <= 1 && mejor.album;
  return { track: mejor.track, confianza: exacta ? 'exacta' : 'probable', puntos: mejor.puntos };
}

function solapan(a, b) {
  if (!a.size || !b.size) return false;
  for (const x of a) if (b.has(x)) return true;
  return false;
}

/**
 * Empareja una lista entera contra la biblioteca.
 *
 * Devuelve las canciones en el MISMO orden que traia la lista, cada una con
 * su `local` puesto o en null. Conservar el orden importa: una lista de
 * Spotify tiene el orden que le puso quien la hizo, y reordenarla por "lo que
 * tienes primero" la convierte en otra lista.
 */
function emparejarLista(remotas, indice) {
  let encontradas = 0;
  const items = (remotas ?? []).map((remota) => {
    const hallazgo = emparejar(remota, indice);
    if (hallazgo) encontradas++;
    return {
      ...remota,
      local: hallazgo?.track?.id ?? null,
      confianza: hallazgo?.confianza ?? null,
    };
  });
  return { items, encontradas, faltan: items.length - encontradas };
}

module.exports = {
  construirIndice,
  emparejar,
  emparejarLista,
  normalizar,
  tituloClave,
  artistasDe,
  MARGEN_S,
};
