'use strict';

/**
 * Sacar artista y titulo de un video de YouTube.
 *
 * Spotify da los dos campos por separado. YouTube da una sola cadena escrita
 * por quien subio el video, y ahi cabe cualquier cosa:
 *
 *   Bad Bunny - Tití Me Preguntó (Video Oficial)
 *   ROSALÍA - DESPECHÁ [Official Music Video]
 *   Tití Me Preguntó
 *   【Artista】Cancion / Album
 *
 * De lo bien que se parta esa cadena depende que el emparejado acierte, asi
 * que hay dos caminos y el bueno se intenta primero.
 */

/**
 * Coletillas de YouTube. Van dentro de parentesis o corchetes casi siempre, y
 * son ruido puro: no distinguen una grabacion de otra.
 *
 * OJO con lo que NO esta: "(Live)", "(Remix)", "(Acoustic)" y las versiones
 * con otro artista se conservan, igual que en el emparejador de Spotify. Son
 * grabaciones distintas, y borrarlas haria que el directo casara con el
 * estudio.
 */
const RUIDO = new RegExp(
  '[([]\\s*(' + [
    '(official\\s+)?(music\\s+)?video(\\s+oficial)?',
    'video\\s+oficial', 'videoclip(\\s+oficial)?',
    'official\\s+(audio|visualizer|lyric\\s+video|lyrics)',
    'audio(\\s+oficial)?', 'lyrics?(\\s+video)?', 'letra(s)?',
    'visualizer', 'hd|hq|4k|1080p|720p',
    'full\\s+album', 'con\\s+letra',
  ].join('|') + ')\\s*[)\\]]',
  'gi',
);

/** Las mismas coletillas pero sueltas al final, sin parentesis. */
const RUIDO_SUELTO = new RegExp(
  '\\s*[-–—|]\\s*(' + [
    '(official\\s+)?(music\\s+)?video(\\s+oficial)?',
    'video\\s+oficial', 'official\\s+audio', 'lyrics?(\\s+video)?',
    'hd|hq|4k',
  ].join('|') + ')\\s*$',
  'i',
);

/** Lo que se le cuelga al nombre de un canal y no es el nombre del artista. */
const SUFIJOS_CANAL = /\s*-\s*(topic|tema)\s*$/i;
/**
 * Canales cuyo nombre no sirve como artista.
 *
 * Los de VEVO entran aunque sean del artista ("BadBunnyVEVO"): el nombre va
 * pegado y sin espacios, asi que usarlo no casaria nunca con un archivo
 * etiquetado "Bad Bunny", y quitarle el sufijo deja "BadBunny", que tampoco.
 * Como el emparejador EXIGE que el artista coincida, un artista equivocado no
 * es un dato de menos: es lo que impide encontrar la cancion. En estos videos
 * el titulo suele traer "Artista - Tema" igualmente, que es de donde sale.
 */
const CANAL_GENERICO = /^(various artists|varios artistas|.*vevo|.*(music|musica|records|recordings|entertainment)\s*)$/i;

/**
 * Guiones que separan artista de titulo.
 *
 * Se acepta el guion normal, el medio y el largo. NO se acepta el guion sin
 * espacios alrededor: "Mac-Gyver" o "Jay-Z" no son "Mac" cantando "Gyver".
 */
const SEPARADOR = /\s+[-–—]\s+/;

/**
 * Un canal de YouTube Music termina en " - Topic".
 *
 * Esos canales los genera YouTube solo, uno por artista, para las pistas que
 * vienen de las discograficas. Cuando el video sale de ahi, el artista viene
 * limpio y no hay que adivinar nada: es con diferencia la señal mas fiable de
 * todas, y es justo la que van a traer las listas de YouTube Music.
 */
function esCanalDeMusica(canal) {
  return SUFIJOS_CANAL.test(String(canal ?? ''));
}

function artistaDeCanal(canal) {
  const limpio = String(canal ?? '').replace(SUFIJOS_CANAL, '').trim();
  if (!limpio || CANAL_GENERICO.test(limpio)) return '';
  return limpio;
}

function quitarRuido(texto) {
  let t = String(texto ?? '').replace(RUIDO, ' ');
  let previo;
  do {
    previo = t;
    t = t.replace(RUIDO_SUELTO, '');
  } while (t !== previo);
  // Los parentesis que se quedan vacios al quitar lo de dentro.
  return t.replace(/[([]\s*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Devuelve { title, artists, fiabilidad }.
 *
 * `fiabilidad` dice de donde salio el artista, y no es adorno: el emparejador
 * exige que el artista coincida, asi que cuando se ha adivinado partiendo una
 * cadena conviene poder ser mas prudente que cuando lo dijo YouTube.
 *
 *   'canal'   el video viene de un canal "- Topic": el artista es de fiar.
 *   'guion'   se partio "Artista - Titulo": suele acertar, pero no siempre.
 *   'ninguna' no se pudo separar; se deja el titulo entero y sin artista.
 */
function partir(video) {
  const bruto = String(video?.title ?? '').trim();
  const canal = String(video?.channel ?? '').trim();
  if (!bruto) return { title: '', artists: [], fiabilidad: 'ninguna' };

  const limpio = quitarRuido(bruto);

  // --- Camino bueno: canal de YouTube Music -------------------------------
  if (esCanalDeMusica(canal)) {
    const artista = artistaDeCanal(canal);
    if (artista) {
      /*
       * Aun viniendo de un canal de musica, el titulo puede traer el artista
       * delante ("Bad Bunny - Moscow Mule"). Si el trozo de la izquierda es
       * justo el artista del canal, sobra.
       */
      const partes = limpio.split(SEPARADOR);
      const titulo = (partes.length > 1 && igual(partes[0], artista))
        ? partes.slice(1).join(' - ').trim()
        : limpio;
      return { title: titulo || limpio, artists: [artista], fiabilidad: 'canal' };
    }
  }

  // --- Camino de adivinar: partir por el guion ----------------------------
  const partes = limpio.split(SEPARADOR);
  if (partes.length >= 2) {
    const izquierda = partes[0].trim();
    const derecha = partes.slice(1).join(' - ').trim();
    /*
     * Se descarta la particion si uno de los dos lados queda vacio o si la
     * izquierda es larguisima: "Cancion que dura mucho - en directo" partiria
     * mal, y dejar el titulo entero es mejor que inventarse un artista que no
     * existe. Un artista que no coincide impide el emparejado, asi que
     * equivocarse aqui es peor que no partir.
     */
    if (izquierda && derecha && izquierda.length <= 60) {
      return { title: derecha, artists: [izquierda], fiabilidad: 'guion' };
    }
  }

  // --- Sin artista ---------------------------------------------------------
  // Como ultimo recurso, el nombre del canal si no es generico. Un canal de
  // artista sin "- Topic" sigue siendo una pista razonable.
  const delCanal = artistaDeCanal(canal);
  return {
    title: limpio || bruto,
    artists: delCanal ? [delCanal] : [],
    fiabilidad: delCanal ? 'guion' : 'ninguna',
  };
}

function igual(a, b) {
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return norm(a) === norm(b);
}

/**
 * ISO 8601 de YouTube a segundos. 'PT3M32S' -> 212.
 *
 * La duracion es lo que impide que un directo de doce minutos case con la
 * version de estudio, asi que sin ella el emparejado pierde su mejor filtro.
 * Y no viene en la lista: hay que pedirla aparte con videos.list.
 */
function duracionISO(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(iso ?? ''));
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (Number(d || 0) * 86400) + (Number(h || 0) * 3600) + (Number(min || 0) * 60) + Number(s || 0);
}

module.exports = { partir, duracionISO, quitarRuido, esCanalDeMusica, artistaDeCanal };
