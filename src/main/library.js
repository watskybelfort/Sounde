'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { AUDIO_EXTENSIONS } = require('./defaults');
const protocols = require('./protocols');

const EXTS = new Set(AUDIO_EXTENSIONS);
const LIBRARY_VERSION = 1;

// Cuantos archivos se parsean a la vez. Mas alto no acelera: el cuello es el
// disco leyendo cabeceras, y pasado ~8 solo se acumulan lecturas en cola.
const PARALELO = 8;

/**
 * music-metadata v11 es solo ESM y el proceso principal es CommonJS, asi que
 * entra por import() dinamico. Se cachea porque la primera carga cuesta.
 */
let _parseFile = null;
async function getParseFile() {
  if (!_parseFile) {
    const mod = await import('music-metadata');
    _parseFile = mod.parseFile;
  }
  return _parseFile;
}

class Library {
  constructor(store) {
    this.store = store;
    this.tracks = new Map();
    this.scanning = false;
    this._cancel = false;

    const guardado = store.get('tracks', []);
    if (Array.isArray(guardado)) {
      for (const t of guardado) this.tracks.set(t.id, t);
    }
  }

  all() {
    return [...this.tracks.values()];
  }

  get(id) {
    return this.tracks.get(id) ?? null;
  }

  byPath(file) {
    return this.tracks.get(idDe(file)) ?? null;
  }

  size() {
    return this.tracks.size;
  }

  persist() {
    this.store.merge({ version: LIBRARY_VERSION, tracks: this.all() });
    this.store.save();
  }

  cancel() {
    this._cancel = true;
  }

  /**
   * Escaneo incremental.
   *
   * Solo se reparsean los archivos cuyo mtime o tamano cambiaron. Sin esto,
   * cada arranque volveria a leer las cabeceras de toda la biblioteca y una
   * coleccion mediana tarda minutos en estar lista.
   */
  async scan(folders, onProgress = () => {}) {
    if (this.scanning) return { ok: false, reason: 'ya-escaneando' };
    this.scanning = true;
    this._cancel = false;

    const t0 = Date.now();
    try {
      onProgress({ phase: 'walk', done: 0, total: 0 });

      const encontrados = [];
      for (const carpeta of folders) {
        if (this._cancel) break;
        protocols.allowRoot(carpeta);
        await walk(carpeta, encontrados, () => this._cancel, (n) => {
          onProgress({ phase: 'walk', done: n, total: 0 });
        });
      }

      if (this._cancel) return { ok: false, reason: 'cancelado' };

      const vistos = new Set();
      const pendientes = [];

      for (const { file, stat } of encontrados) {
        const id = idDe(file);
        vistos.add(id);
        const previo = this.tracks.get(id);
        if (previo && previo.mtimeMs === stat.mtimeMs && previo.size === stat.size) continue;
        pendientes.push({ id, file, stat, addedAt: previo?.addedAt ?? Date.now() });
      }

      // Lo que ya no esta en disco sale de la biblioteca, o la lista se
      // llena de pistas fantasma que al pulsarlas dan error.
      let eliminados = 0;
      for (const id of [...this.tracks.keys()]) {
        if (!vistos.has(id)) {
          this.tracks.delete(id);
          eliminados++;
        }
      }

      let hechos = 0;
      const total = pendientes.length;
      onProgress({ phase: 'parse', done: 0, total });

      await mapPool(pendientes, PARALELO, async (item) => {
        if (this._cancel) return;
        const track = await leerPista(item);
        if (track) this.tracks.set(track.id, track);
        hechos++;
        if (hechos % 5 === 0 || hechos === total) {
          onProgress({ phase: 'parse', done: hechos, total, current: path.basename(item.file) });
        }
      });

      this.persist();

      return {
        ok: true,
        cancelado: this._cancel,
        nuevos: total,
        eliminados,
        total: this.tracks.size,
        ms: Date.now() - t0,
      };
    } finally {
      this.scanning = false;
    }
  }

  /** Anade archivos sueltos (Abrir con..., arrastrar y soltar). */
  async addFiles(files) {
    const nuevos = [];
    for (const file of files) {
      if (!EXTS.has(path.extname(file).toLowerCase())) continue;
      protocols.allowFile(file);
      const id = idDe(file);
      const previo = this.tracks.get(id);
      let stat;
      try {
        stat = await fsp.stat(file);
      } catch {
        continue;
      }
      if (previo && previo.mtimeMs === stat.mtimeMs && previo.size === stat.size) {
        nuevos.push(previo);
        continue;
      }
      const track = await leerPista({ id, file, stat, addedAt: previo?.addedAt ?? Date.now() });
      if (track) {
        this.tracks.set(track.id, track);
        nuevos.push(track);
      }
    }
    if (nuevos.length) this.persist();
    return nuevos;
  }
}

// --- Lectura de una pista -------------------------------------------------

async function leerPista({ id, file, stat, addedAt }) {
  let meta = null;
  try {
    const parseFile = await getParseFile();
    meta = await parseFile(file, { duration: true, skipPostHeaders: true });
  } catch (err) {
    // Un archivo con cabecera rota no debe tumbar el escaneo entero: entra
    // en la biblioteca con lo que se pueda deducir del nombre.
    console.warn('[library] sin metadatos:', path.basename(file), '-', err.message);
  }

  const comun = meta?.common ?? {};
  const fmt = meta?.format ?? {};
  const carpeta = path.basename(path.dirname(file));

  const art = await guardarCaratula(comun.picture?.[0]);

  return {
    id,
    path: file,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    addedAt,

    // Sin titulo se usa el nombre del archivo: dejarlo vacio convierte la
    // lista en una columna de filas en blanco.
    title: limpio(comun.title) || path.basename(file, path.extname(file)),
    artist: limpio(comun.artist) || limpio(comun.albumartist) || 'Artista desconocido',
    albumArtist: limpio(comun.albumartist) || limpio(comun.artist) || 'Artista desconocido',
    album: limpio(comun.album) || carpeta || 'Album desconocido',
    genre: Array.isArray(comun.genre) ? comun.genre.filter(Boolean) : [],
    year: comun.year ?? null,
    trackNo: comun.track?.no ?? null,
    trackOf: comun.track?.of ?? null,
    discNo: comun.disk?.no ?? null,
    discOf: comun.disk?.of ?? null,

    duration: fmt.duration ?? 0,
    bitrate: fmt.bitrate ? Math.round(fmt.bitrate / 1000) : null,
    sampleRate: fmt.sampleRate ?? null,
    channels: fmt.numberOfChannels ?? null,
    codec: fmt.codec ?? path.extname(file).slice(1).toUpperCase(),
    lossless: !!fmt.lossless,

    art,
    // ReplayGain viene en dB. Se guarda crudo y lo aplica el motor de audio
    // como ganancia, solo si el usuario tiene la normalizacion encendida.
    gainTrackDb: numeroDb(comun.replaygain_track_gain),
    gainAlbumDb: numeroDb(comun.replaygain_album_gain),

    lyrics: extraerLetra(comun.lyrics),
  };
}

/**
 * Guarda la caratula en cache y devuelve su nombre de archivo.
 *
 * El nombre es el hash del contenido, asi que las doce pistas de un album
 * comparten un unico archivo en vez de escribir doce copias identicas.
 */
async function guardarCaratula(pic) {
  if (!pic?.data?.length) return null;
  const dir = protocols.getArtDir();
  if (!dir) return null;

  const bytes = Buffer.from(pic.data);
  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 20);
  const ext = extDeMime(pic.format);
  const nombre = `${hash}${ext}`;
  const destino = path.join(dir, nombre);

  try {
    await fsp.access(destino);
    return nombre; // ya estaba
  } catch { /* hay que escribirla */ }

  // El temporal lleva sufijo unico. Con un nombre fijo las pistas de un
  // mismo album, que comparten caratula y se parsean en paralelo, escriben
  // todas el mismo .tmp: la primera en renombrar se lo lleva y las demas
  // fallan con ENOENT y se quedan sin portada.
  const tmp = `${destino}.${process.pid}.${tmpSeq++}.tmp`;
  try {
    await fsp.writeFile(tmp, bytes);
    await fsp.rename(tmp, destino);
    return nombre;
  } catch (err) {
    // Si otra pista gano la carrera, el archivo final ya existe y vale.
    try {
      await fsp.access(destino);
      return nombre;
    } catch { /* de verdad fallo */ }
    console.warn('[library] no pude guardar caratula:', err.message);
    return null;
  } finally {
    try { await fsp.unlink(tmp); } catch { /* ya no estaba, que es lo normal */ }
  }
}

let tmpSeq = 0;

function extDeMime(mime = '') {
  const m = String(mime).toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('webp')) return '.webp';
  if (m.includes('gif')) return '.gif';
  if (m.includes('bmp')) return '.bmp';
  return '.jpg';
}

// --- Recorrido del disco --------------------------------------------------

/** Carpetas que nunca contienen musica y si mucho ruido. */
const IGNORAR = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information',
  'windows', 'appdata', '.cache',
]);

async function walk(dir, salida, cancelado, tick) {
  if (cancelado()) return;

  let entradas;
  try {
    entradas = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return; // sin permiso o desconectada: se ignora en silencio
  }

  for (const entrada of entradas) {
    if (cancelado()) return;
    const completo = path.join(dir, entrada.name);

    if (entrada.isDirectory()) {
      if (IGNORAR.has(entrada.name.toLowerCase())) continue;
      if (entrada.name.startsWith('.')) continue;
      await walk(completo, salida, cancelado, tick);
      continue;
    }

    if (!entrada.isFile()) continue;
    if (!EXTS.has(path.extname(entrada.name).toLowerCase())) continue;

    try {
      const stat = await fsp.stat(completo);
      salida.push({ file: completo, stat });
      if (salida.length % 25 === 0) tick(salida.length);
    } catch { /* desaparecio entre readdir y stat */ }
  }
}

// --- Utilidades -----------------------------------------------------------

/** Id estable: la ruta define la pista, asi sobrevive a reinicios. */
function idDe(file) {
  return crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 16);
}

function limpio(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\0/g, '').trim();
}

/** '-7.25 dB' -> -7.25 */
function numeroDb(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && typeof v.dB === 'number') return v.dB;
  const m = /-?\d+(\.\d+)?/.exec(String(v));
  return m ? Number(m[0]) : null;
}

function extraerLetra(lyrics) {
  if (!lyrics) return null;
  if (typeof lyrics === 'string') return lyrics;
  if (Array.isArray(lyrics)) {
    const primera = lyrics[0];
    if (typeof primera === 'string') return primera;
    if (primera?.text) return primera.text;
    if (Array.isArray(primera?.syncText)) {
      return primera.syncText.map((s) => s.text).join('\n');
    }
  }
  return null;
}

/** Ejecuta `fn` sobre `items` con como mucho `limit` en vuelo a la vez. */
async function mapPool(items, limit, fn) {
  let cursor = 0;
  const obreros = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  });
  await Promise.all(obreros);
}

module.exports = { Library, idDe, mapPool };
