'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');

const api = require('./api');
const cred = require('./credenciales');
const titulos = require('./titulos');
const { JsonStore } = require('../store');
const { mapPool } = require('../library');
const protocols = require('../protocols');

/**
 * El catalogo de YouTube del usuario, traido y guardado en disco.
 *
 * Mismo planteamiento que el de Spotify: se persiste entero para que al abrir
 * Sounde las listas ya esten sin esperar a la red.
 */

const VERSION = 1;
const PARALELO_ARTE = 6;

let store = null;

function abrir() {
  if (!store) {
    store = new JsonStore(path.join(app.getPath('userData'), 'youtube-catalogo.json'), {
      version: VERSION,
      sincronizado: 0,
      playlists: [],
      pistas: {},
    });
  }
  return store;
}

// --- Normalizacion --------------------------------------------------------

/**
 * Videos que ocupan sitio en una lista pero no son nada.
 *
 * Cuando un video se borra o se hace privado, YouTube NO lo saca de las
 * listas: sigue ahi con el titulo cambiado a esto y sin canal ni miniatura.
 * Es el equivalente a las pistas retiradas de Spotify, y en una lista vieja
 * hay unos cuantos.
 */
const FANTASMAS = new Set([
  'private video', 'deleted video', 'video privado', 'video eliminado',
  'video no disponible', 'unavailable video',
]);

function esFantasma(snippet) {
  const t = String(snippet?.title ?? '').trim().toLowerCase();
  if (!t || FANTASMAS.has(t)) return true;
  // Un video privado tampoco trae canal: sin eso no hay nada que emparejar.
  return !snippet?.videoOwnerChannelTitle && !snippet?.channelTitle;
}

/** Un elemento de playlistItems a la forma que usa el resto de Sounde. */
function normalizarItem(item) {
  const snippet = item?.snippet;
  const videoId = snippet?.resourceId?.videoId ?? item?.contentDetails?.videoId;
  if (!videoId || esFantasma(snippet)) return null;

  const { title, artists, fiabilidad } = titulos.partir({
    title: snippet.title,
    channel: snippet.videoOwnerChannelTitle ?? snippet.channelTitle,
  });

  return {
    id: videoId,
    uri: `https://www.youtube.com/watch?v=${videoId}`,
    title,
    artists,
    // De donde salio el artista, para poder ser mas prudente con lo adivinado.
    fiabilidad,
    album: '',
    // La duracion no viene en playlistItems: se rellena despues.
    duration: 0,
    artRemota: miniatura(snippet.thumbnails),
    art: null,
  };
}

/**
 * La miniatura mas pequeña que se vea bien en una fila de 40 px.
 *
 * 'default' son 120x90 y 'medium' 320x180. Se coge la mediana: la de 120 se
 * ve borrosa en pantallas con escalado, y las grandes pesan de mas para lo
 * que se pinta.
 */
function miniatura(thumbs) {
  return thumbs?.medium?.url ?? thumbs?.default?.url ?? thumbs?.high?.url ?? null;
}

// --- Caratulas ------------------------------------------------------------

async function traerMiniatura(url) {
  if (!url) return null;
  const dir = protocols.getArtDir();
  if (!dir) return null;

  const nombre = `yt-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 20)}.jpg`;
  const destino = path.join(dir, nombre);

  try {
    await fsp.access(destino);
    return nombre;
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
      try { await fsp.unlink(tmp); } catch { /* ya no estaba */ }
    }
    return nombre;
  } catch (err) {
    console.warn('[youtube] no pude traer una miniatura:', err.message);
    return null;
  }
}

let tmpSeq = 0;

// --- Sincronizacion -------------------------------------------------------

async function sincronizar({ onProgress = () => {}, senal } = {}) {
  const s = abrir();

  onProgress({ fase: 'perfil' });
  const canal = await api.pedir('/channels', { part: 'snippet', mine: 'true' }, { senal });
  const mio = canal?.items?.[0];
  cred.setPerfil({
    id: mio?.id ?? null,
    nombre: mio?.snippet?.title ?? 'Tu cuenta',
    imagen: mio?.snippet?.thumbnails?.default?.url ?? null,
  });

  // --- Listas -------------------------------------------------------------
  onProgress({ fase: 'listas' });
  const { items: listasCrudas } = await api.paginar('/playlists', {
    part: 'snippet,contentDetails',
    mine: 'true',
  }, {
    senal,
    onLote: (p) => onProgress({ fase: 'listas', hechos: p.recibidos, total: p.total }),
  });

  const pistas = {};
  const playlists = [];

  for (let i = 0; i < listasCrudas.length; i++) {
    if (senal?.aborted) throw new api.ErrorYouTube('Cancelado');
    const lista = listasCrudas[i];
    if (!lista?.id) continue;

    onProgress({
      fase: 'canciones',
      hechos: i,
      total: listasCrudas.length,
      detalle: lista.snippet?.title ?? '',
    });

    const { items, completo } = await api.paginar('/playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: lista.id,
    }, { senal });

    const ids = [];
    let descartadas = 0;
    for (const item of items) {
      const pista = normalizarItem(item);
      if (!pista) {
        descartadas++;
        continue;
      }
      pistas[pista.id] = pista;
      ids.push(pista.id);
    }

    playlists.push({
      id: lista.id,
      name: lista.snippet?.title ?? 'Lista sin nombre',
      description: lista.snippet?.description ?? '',
      owner: lista.snippet?.channelTitle ?? '',
      propia: true,
      uri: `https://www.youtube.com/playlist?list=${lista.id}`,
      artRemota: miniatura(lista.snippet?.thumbnails),
      art: null,
      tracks: ids,
      descartadas,
      completo,
      sinAcceso: false,
    });
  }

  // --- Duraciones ---------------------------------------------------------
  await traerDuraciones(pistas, { onProgress, senal });

  // --- Miniaturas ---------------------------------------------------------
  await traerMiniaturas({ pistas, playlists, onProgress, senal });

  s.merge({ version: VERSION, sincronizado: Date.now(), playlists, pistas });
  s.save();

  return resumen();
}

/**
 * Rellena las duraciones con videos.list.
 *
 * Este paso no es opcional. `playlistItems` no devuelve la duracion, y el
 * emparejador la usa para descartar: sin ella, un directo de doce minutos
 * casaria con la version de estudio por tener el mismo titulo y artista.
 *
 * Cuesta una unidad de cuota por cada 50 videos, asi que una biblioteca de
 * mil canciones son veinte unidades de las diez mil del dia.
 */
async function traerDuraciones(pistas, { onProgress, senal }) {
  const ids = Object.keys(pistas);
  if (!ids.length) return;

  onProgress({ fase: 'duraciones', hechos: 0, total: ids.length });
  const videos = await api.porLotes(ids, '/videos', { part: 'contentDetails' }, { senal });

  for (const video of videos) {
    const pista = pistas[video?.id];
    if (!pista) continue;
    pista.duration = titulos.duracionISO(video.contentDetails?.duration);
  }
  onProgress({ fase: 'duraciones', hechos: ids.length, total: ids.length });
}

async function traerMiniaturas({ pistas, playlists, onProgress, senal }) {
  const porUrl = new Map();
  const anotar = (x) => {
    if (!x.artRemota) return;
    if (!porUrl.has(x.artRemota)) porUrl.set(x.artRemota, []);
    porUrl.get(x.artRemota).push(x);
  };
  for (const pista of Object.values(pistas)) anotar(pista);
  for (const lista of playlists) anotar(lista);

  const urls = [...porUrl.keys()];
  let hechos = 0;
  await mapPool(urls, PARALELO_ARTE, async (url) => {
    if (senal?.aborted) return;
    const nombre = await traerMiniatura(url);
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
    guardadas: [],
    pistas: s.get('pistas', {}),
  };
}

function resumen() {
  const d = todo();
  return {
    sincronizado: d.sincronizado,
    listas: d.playlists.length,
    guardadas: 0,
    pistas: Object.keys(d.pistas).length,
  };
}

function limpiar() {
  const s = abrir();
  s.merge({ sincronizado: 0, playlists: [], pistas: {} });
  s.save();
}

module.exports = { sincronizar, todo, resumen, limpiar, normalizarItem, miniatura, esFantasma };
