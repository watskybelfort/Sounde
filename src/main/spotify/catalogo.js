'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const api = require('./api');
const cred = require('./credenciales');
const { JsonStore } = require('../store');
const { mapPool } = require('../library');
const protocols = require('../protocols');

/**
 * El catalogo de Spotify del usuario, traido y guardado en disco.
 *
 * Se persiste entero para que al abrir Sounde las listas esten ahi sin
 * esperar a la red. Una sincronizacion tarda segundos con una cuenta grande,
 * y arrancar mostrando una pantalla vacia que se rellena sola a los diez
 * segundos hace parecer que se ha perdido todo.
 */

const VERSION = 1;

/** Caratulas a la vez. Mas no baja el tiempo: el cuello es el ancho de banda. */
const PARALELO_ARTE = 6;

/** Tamaño de lote de los endpoints que aceptan varios ids. */
const LOTE_TRACKS = 50;

let store = null;

function abrir() {
  if (!store) {
    store = new JsonStore(path.join(app.getPath('userData'), 'spotify-catalogo.json'), {
      version: VERSION,
      sincronizado: 0,
      playlists: [],
      guardadas: [],
      pistas: {},
    });
  }
  return store;
}

// --- Normalizacion de lo que devuelve Spotify -----------------------------

/**
 * Pasa una pista de Spotify a la forma que usa el resto de Sounde.
 *
 * Devuelve null para todo lo que no es una cancion con identidad propia, y
 * eso hay que filtrarlo si o si porque llega de verdad en listas reales:
 *
 *   - `null` a secas: la cancion se retiro del catalogo pero sigue ocupando
 *     su hueco en la lista.
 *   - episodios de podcast, que caben en cualquier lista junto a la musica.
 *   - archivos locales del usuario subidos a Spotify (`is_local`), que no
 *     tienen id ni se pueden pedir a la API.
 */
function normalizarPista(track) {
  if (!track || typeof track !== 'object') return null;
  if (track.type && track.type !== 'track') return null;
  if (track.is_local) return null;
  if (!track.id) return null;

  return {
    id: track.id,
    uri: track.uri ?? `spotify:track:${track.id}`,
    title: track.name ?? '',
    artists: (track.artists ?? []).map((a) => a?.name).filter(Boolean),
    album: track.album?.name ?? '',
    albumId: track.album?.id ?? null,
    duration: Number.isFinite(track.duration_ms) ? track.duration_ms / 1000 : 0,
    year: anoDe(track.album?.release_date),
    trackNo: track.track_number ?? null,
    discNo: track.disc_number ?? null,
    // Se guarda la URL de la caratula pequeña; el archivo se descarga aparte.
    artRemota: imagenMasCercana(track.album?.images, 300),
    art: null,
  };
}

function anoDe(fecha) {
  const m = /^(\d{4})/.exec(String(fecha ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * Spotify da tres tamaños (640, 300, 64). Se coge el mas cercano al que se va
 * a pintar: la de 640 pesa cuatro veces mas para verse igual en una rejilla.
 */
function imagenMasCercana(imagenes, objetivo) {
  if (!Array.isArray(imagenes) || !imagenes.length) return null;
  let mejor = null;
  for (const img of imagenes) {
    if (!img?.url) continue;
    const dif = Math.abs((img.width ?? objetivo) - objetivo);
    if (!mejor || dif < mejor.dif) mejor = { url: img.url, dif };
  }
  return mejor?.url ?? null;
}

// --- Caratulas ------------------------------------------------------------

/**
 * Descarga una caratula a la cache y devuelve su nombre de archivo.
 *
 * Va a la misma carpeta que las de los archivos locales y se sirve por
 * `sounde-art://`, no por su URL de Spotify. Esto es lo que deja la CSP
 * intacta: si la pagina pintara `https://i.scdn.co/...` habria que abrirle
 * `img-src` a un dominio externo. De paso, las caratulas siguen viendose sin
 * conexion.
 *
 * El nombre sale del hash de la URL, no del contenido: asi se sabe si ya esta
 * descargada ANTES de bajarla. Las de los archivos locales usan el hash del
 * contenido porque ahi los bytes ya estaban en memoria.
 */
async function traerCaratula(url) {
  if (!url) return null;
  const dir = protocols.getArtDir();
  if (!dir) return null;

  const nombre = `sp-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 20)}.jpg`;
  const destino = path.join(dir, nombre);

  try {
    await fsp.access(destino);
    return nombre; // ya estaba
  } catch { /* hay que bajarla */ }

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length) return null;

    const tmp = `${destino}.${process.pid}.${tmpSeq++}.tmp`;
    try {
      await fsp.writeFile(tmp, bytes);
      await fsp.rename(tmp, destino);
    } finally {
      try { await fsp.unlink(tmp); } catch { /* ya no estaba, que es lo normal */ }
    }
    return nombre;
  } catch (err) {
    // Una caratula que no baja no puede tumbar la sincronizacion entera: la
    // lista se ve igual de bien con el hueco gris.
    console.warn('[spotify] no pude traer una caratula:', err.message);
    return null;
  }
}

let tmpSeq = 0;

// --- Sincronizacion -------------------------------------------------------

/**
 * Trae el perfil, las listas y las canciones guardadas.
 *
 * `onProgress` recibe { fase, hechos, total, detalle } para que la interfaz
 * pueda decir en que va. Una cuenta con cincuenta listas tarda lo suyo y una
 * barra parada es indistinguible de una app colgada.
 */
async function sincronizar({ onProgress = () => {}, senal } = {}) {
  const s = abrir();

  onProgress({ fase: 'perfil' });
  const perfil = await api.pedir('/me', { senal });
  cred.setPerfil({
    id: perfil.id,
    nombre: perfil.display_name || perfil.id,
    producto: perfil.product ?? null,
    pais: perfil.country ?? null,
    imagen: imagenMasCercana(perfil.images, 64),
  });

  // --- Listas -------------------------------------------------------------
  onProgress({ fase: 'listas' });
  const { items: listasCrudas } = await api.paginar('/me/playlists', {
    limite: 50,
    senal,
    onLote: (p) => onProgress({ fase: 'listas', hechos: p.recibidos, total: p.total }),
  });

  const pistas = {};
  const playlists = [];

  for (let i = 0; i < listasCrudas.length; i++) {
    if (senal?.aborted) throw new api.ErrorSpotify('Cancelado');
    const lista = listasCrudas[i];
    if (!lista?.id) continue;

    onProgress({
      fase: 'canciones',
      hechos: i,
      total: listasCrudas.length,
      detalle: lista.name ?? '',
    });

    const { items, completo } = await api.paginar(
      `/playlists/${lista.id}/tracks?fields=${CAMPOS_LISTA}`,
      { limite: 100, senal },
    );

    const ids = [];
    let descartadas = 0;
    for (const fila of items) {
      const pista = normalizarPista(fila?.track);
      if (!pista) {
        descartadas++;
        continue;
      }
      pistas[pista.id] = pista;
      ids.push(pista.id);
    }

    playlists.push({
      id: lista.id,
      name: lista.name ?? 'Lista sin nombre',
      description: lista.description ?? '',
      owner: lista.owner?.display_name ?? '',
      propia: lista.owner?.id === perfil.id,
      publica: !!lista.public,
      uri: lista.uri ?? `spotify:playlist:${lista.id}`,
      artRemota: imagenMasCercana(lista.images, 300),
      art: null,
      tracks: ids,
      // Se guarda cuantas se cayeron para poder decirlo en la ficha: si no,
      // una lista de 50 que aparece con 47 parece un fallo de Sounde.
      descartadas,
      completo,
    });
  }

  // --- Canciones guardadas ------------------------------------------------
  onProgress({ fase: 'guardadas' });
  const { items: guardadasCrudas } = await api.paginar('/me/tracks', {
    limite: 50,
    senal,
    onLote: (p) => onProgress({ fase: 'guardadas', hechos: p.recibidos, total: p.total }),
  });

  const guardadas = [];
  for (const fila of guardadasCrudas) {
    const pista = normalizarPista(fila?.track);
    if (!pista) continue;
    pistas[pista.id] = { ...pista, guardadaEn: fila.added_at ?? null };
    guardadas.push(pista.id);
  }

  // --- Caratulas ----------------------------------------------------------
  await traerCaratulas({ pistas, playlists, onProgress, senal });

  s.merge({
    version: VERSION,
    sincronizado: Date.now(),
    playlists,
    guardadas,
    pistas,
  });
  s.save();

  return resumen();
}

/**
 * `fields` recorta la respuesta a lo que se usa.
 *
 * Sin esto cada cancion viene con los mercados disponibles: doscientos
 * codigos de pais por pista, que en una lista de mil son megabytes de JSON
 * que se descargan y se tiran.
 */
const CAMPOS_LISTA = encodeURIComponent(
  'next,total,items(added_at,is_local,track(id,uri,type,name,duration_ms,track_number,disc_number,is_local,'
  + 'artists(name),album(id,name,release_date,images)))',
);

/** Baja las caratulas que falten, sin repetir las que comparten album. */
async function traerCaratulas({ pistas, playlists, onProgress, senal }) {
  const porUrl = new Map();
  for (const pista of Object.values(pistas)) {
    if (pista.artRemota && !porUrl.has(pista.artRemota)) porUrl.set(pista.artRemota, []);
    if (pista.artRemota) porUrl.get(pista.artRemota).push(pista);
  }
  for (const lista of playlists) {
    if (!lista.artRemota) continue;
    if (!porUrl.has(lista.artRemota)) porUrl.set(lista.artRemota, []);
    porUrl.get(lista.artRemota).push(lista);
  }

  const urls = [...porUrl.keys()];
  let hechos = 0;
  await mapPool(urls, PARALELO_ARTE, async (url) => {
    if (senal?.aborted) return;
    const nombre = await traerCaratula(url);
    for (const destinatario of porUrl.get(url)) destinatario.art = nombre;
    hechos++;
    if (hechos % 5 === 0 || hechos === urls.length) {
      onProgress({ fase: 'caratulas', hechos, total: urls.length });
    }
  });
}

// --- Lectura --------------------------------------------------------------

function todo() {
  const s = abrir();
  return {
    sincronizado: s.get('sincronizado', 0),
    playlists: s.get('playlists', []),
    guardadas: s.get('guardadas', []),
    pistas: s.get('pistas', {}),
  };
}

function resumen() {
  const d = todo();
  return {
    sincronizado: d.sincronizado,
    listas: d.playlists.length,
    guardadas: d.guardadas.length,
    pistas: Object.keys(d.pistas).length,
  };
}

/** Al desconectar la cuenta el catalogo se va con ella. */
function limpiar() {
  const s = abrir();
  s.merge({ sincronizado: 0, playlists: [], guardadas: [], pistas: {} });
  s.save();
}

module.exports = {
  sincronizar,
  todo,
  resumen,
  limpiar,
  normalizarPista,
  imagenMasCercana,
};
