'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { protocol, app } = require('electron');

/**
 * Tres esquemas propios:
 *
 *   sounde://app/...        la propia UI. Hace falta un esquema estandar
 *                           porque sobre file:// Chromium bloquea los
 *                           modulos ES por CORS y la CSP con 'self' no casa.
 *   sounde-file://local/... audio del disco, con soporte de rangos para que
 *                           la barra de progreso pueda saltar.
 *   sounde-art://cache/...  caratulas ya extraidas a la cache.
 */

const RENDERER_DIR = path.join(__dirname, '..', 'renderer');

/** Raices autorizadas. Sin esto, cualquier ruta del disco seria servible. */
const allowedRoots = new Set();
/** Archivos sueltos autorizados (los que llegan por "Abrir con..."). */
const allowedFiles = new Set();

let artDir = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.weba': 'audio/webm',
  '.webm': 'audio/webm',
  '.mka': 'audio/x-matroska',
};

function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

/** Se llama ANTES de app.ready o Chromium ignora los privilegios. */
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'sounde',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      scheme: 'sounde-file',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
    {
      scheme: 'sounde-art',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
  ]);
}

/** Se llama despues de app.ready. */
function registerHandlers() {
  artDir = path.join(app.getPath('userData'), 'artcache');
  fs.mkdirSync(artDir, { recursive: true });

  protocol.handle('sounde', async (request) => {
    const url = new URL(request.url);
    // Cualquier ruta desconocida cae en index.html para que la navegacion
    // interna no rompa si algun dia se usa history.pushState.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const target = path.join(RENDERER_DIR, rel);
    if (!isInside(RENDERER_DIR, target)) return notFound();
    return serveFile(target, request);
  });

  protocol.handle('sounde-file', async (request) => {
    const target = decodeKey(new URL(request.url).pathname);
    if (!target) return badRequest();
    if (!isAuthorized(target)) return forbidden();
    return serveFile(target, request);
  });

  protocol.handle('sounde-art', async (request) => {
    const name = path.basename(decodeURIComponent(new URL(request.url).pathname));
    const target = path.join(artDir, name);
    if (!isInside(artDir, target)) return notFound();
    return serveFile(target, request);
  });
}

/**
 * Cabeceras CORS.
 *
 * La pagina vive en `sounde://app` y el audio en `sounde-file://local`: son
 * origenes distintos. Un <audio> normal sonaria igual, pero en cuanto entra
 * en Web Audio a traves de createMediaElementSource, Chromium considera la
 * fuente contaminada y el nodo saca silencio absoluto. Con `crossOrigin` en
 * el elemento y este permiso en la respuesta, la fuente es limpia y suena.
 *
 * Lo mismo aplica a las caratulas: leer sus pixeles con getImageData para
 * sacar el color dominante mancha el canvas si la imagen no es CORS-limpia.
 *
 * Abrir a `*` no afila nada: quien decide que se puede leer es isAuthorized,
 * y ningun origen externo puede alcanzar estos esquemas.
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

/**
 * Sirve un archivo con soporte de rangos.
 *
 * Los rangos no son opcionales: sin `206 Partial Content` el elemento
 * <audio> descarga el archivo entero antes de poder saltar, y arrastrar la
 * barra de progreso en un FLAC de 40 MB se siente roto.
 */
async function serveFile(target, request) {
  let stat;
  try {
    stat = await fsp.stat(target);
    if (!stat.isFile()) return notFound();
  } catch {
    return notFound();
  }

  const type = mimeFor(target);
  const range = request.headers.get('Range');
  const parsed = range ? parseRange(range, stat.size) : null;

  if (range && !parsed) {
    return new Response(null, {
      status: 416,
      headers: { ...CORS, 'Content-Range': `bytes */${stat.size}` },
    });
  }

  const start = parsed ? parsed.start : 0;
  const end = parsed ? parsed.end : stat.size - 1;
  const stream = fs.createReadStream(target, { start, end });

  return new Response(Readable.toWeb(stream), {
    status: parsed ? 206 : 200,
    headers: {
      ...CORS,
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(parsed ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}),
      'Cache-Control': 'no-cache',
    },
  });
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start;
  let end;
  if (rawStart === '') {
    // Sufijo: los ultimos N bytes.
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start < 0 || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

// --- Autorizacion ---------------------------------------------------------

function allowRoot(dir) {
  if (dir) allowedRoots.add(path.resolve(dir).toLowerCase());
}

function allowFile(file) {
  if (file) allowedFiles.add(path.resolve(file).toLowerCase());
}

function clearRoots() {
  allowedRoots.clear();
}

function isAuthorized(target) {
  const resolved = path.resolve(target).toLowerCase();
  if (allowedFiles.has(resolved)) return true;
  for (const root of allowedRoots) {
    if (isInside(root, resolved)) return true;
  }
  return false;
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// --- Claves de ruta -------------------------------------------------------

/**
 * Las rutas de Windows no caben limpias en una URL: llevan `C:`, barras
 * invertidas y `#`. Van en base64url, que no necesita escapado.
 */
function encodePath(absPath) {
  return `sounde-file://local/${Buffer.from(absPath, 'utf8').toString('base64url')}`;
}

function decodeKey(pathname) {
  const key = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!key) return null;
  try {
    const decoded = Buffer.from(key, 'base64url').toString('utf8');
    return decoded.includes('\0') ? null : decoded;
  } catch {
    return null;
  }
}

function artUrl(fileName) {
  return `sounde-art://cache/${encodeURIComponent(fileName)}`;
}

function getArtDir() {
  return artDir;
}

// --- Respuestas cortas ----------------------------------------------------

const notFound = () => new Response('no encontrado', { status: 404 });
const forbidden = () => new Response('no autorizado', { status: 403 });
const badRequest = () => new Response('peticion invalida', { status: 400 });

module.exports = {
  registerSchemes,
  registerHandlers,
  allowRoot,
  allowFile,
  clearRoots,
  isAuthorized,
  encodePath,
  artUrl,
  getArtDir,
  mimeFor,
};
