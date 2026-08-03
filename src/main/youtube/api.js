'use strict';

const auth = require('./auth');
const cred = require('./credenciales');

/**
 * Cliente de la YouTube Data API v3.
 *
 * Igual que el de Spotify, vive entero en el proceso principal para no tener
 * que abrirle `connect-src` a googleapis.com en la CSP de la pagina.
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

const REINTENTOS = 3;

/** Maximo que admiten playlists.list, playlistItems.list y videos.list. */
const MAX_POR_PAGINA = 50;

class ErrorYouTube extends Error {
  constructor(mensaje, { status = 0, razon = '', cuota = false, reintentar = false } = {}) {
    super(mensaje);
    this.name = 'ErrorYouTube';
    this.status = status;
    this.razon = razon;
    this.cuota = cuota;
    this.reintentar = reintentar;
  }
}

async function pedir(ruta, params = {}, { senal } = {}) {
  const url = new URL(`${BASE}${ruta}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  let refrescado = false;

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    if (senal?.aborted) throw new ErrorYouTube('Cancelado');

    const token = await auth.tokenValido();
    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: senal,
      });
    } catch (err) {
      if (senal?.aborted) throw new ErrorYouTube('Cancelado');
      if (intento === REINTENTOS) {
        throw new ErrorYouTube(`No se pudo conectar con YouTube: ${err.message}`, { reintentar: true });
      }
      await dormir(500 * 2 ** intento, senal);
      continue;
    }

    if (res.ok) return res.json();

    if (res.status === 401 && !refrescado) {
      refrescado = true;
      cred.olvidarAcceso();
      continue;
    }

    const detalle = await detalleDe(res);

    /*
     * Los dos 403 de Google no son el mismo problema y no se tratan igual.
     *
     *   quotaExceeded / rateLimitExceeded  se acabaron las 10.000 unidades
     *                                      del dia. Reintentar no sirve: el
     *                                      contador se reinicia a medianoche
     *                                      hora del Pacifico y no antes.
     *   forbidden / cualquier otro         falta un permiso, o el recurso no
     *                                      es del usuario.
     *
     * Confundirlos hace que la interfaz diga "no tienes permiso" cuando lo
     * que pasa es que hay que esperar, y el usuario se pone a revisar los
     * permisos del proyecto sin motivo.
     */
    if (res.status === 403 && ES_CUOTA.has(detalle.razon)) {
      throw new ErrorYouTube(
        'Se ha agotado la cuota diaria de la API de YouTube. Se reinicia a medianoche (hora del Pacifico).',
        { status: 403, razon: detalle.razon, cuota: true, reintentar: true },
      );
    }

    if (res.status >= 500 && intento < REINTENTOS) {
      await dormir(500 * 2 ** intento, senal);
      continue;
    }

    throw new ErrorYouTube(detalle.mensaje, { status: res.status, razon: detalle.razon });
  }

  throw new ErrorYouTube('Se agotaron los reintentos.', { reintentar: true });
}

const ES_CUOTA = new Set(['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']);

/**
 * Recorre las paginas siguiendo `nextPageToken`.
 *
 * Google no da un enlace completo como Spotify: hay que volver a componer la
 * peticion entera con el token de la pagina.
 */
async function paginar(ruta, params = {}, { tope = 5000, senal, onLote } = {}) {
  const salida = [];
  let pageToken;
  let total = null;

  do {
    const pagina = await pedir(ruta, { ...params, maxResults: MAX_POR_PAGINA, pageToken }, { senal });
    if (!pagina) break;
    if (total === null) total = pagina.pageInfo?.totalResults ?? null;

    salida.push(...(pagina.items ?? []).filter(Boolean));
    onLote?.({ recibidos: salida.length, total: total ?? salida.length });

    if (salida.length >= tope) {
      return { items: salida.slice(0, tope), total, completo: false };
    }
    pageToken = pagina.nextPageToken;
  } while (pageToken);

  return { items: salida, total: total ?? salida.length, completo: true };
}

/**
 * Reparte ids en lotes de 50 y los pide de una vez.
 *
 * `videos.list` cuesta 1 unidad tanto por un video como por cincuenta, asi
 * que pedirlos de uno en uno gastaria cincuenta veces la cuota para el mismo
 * resultado.
 */
async function porLotes(ids, ruta, params, { senal } = {}) {
  const salida = [];
  for (let i = 0; i < ids.length; i += MAX_POR_PAGINA) {
    const lote = ids.slice(i, i + MAX_POR_PAGINA);
    const res = await pedir(ruta, { ...params, id: lote.join(','), maxResults: MAX_POR_PAGINA }, { senal });
    salida.push(...(res?.items ?? []));
  }
  return salida;
}

async function detalleDe(res) {
  let cuerpo = null;
  try {
    cuerpo = await res.json();
  } catch { /* no era JSON */ }

  const error = cuerpo?.error;
  const razon = error?.errors?.[0]?.reason ?? error?.status ?? '';
  const mensaje = error?.message
    ? `YouTube: ${error.message}`
    : `YouTube devolvio ${res.status}.`;
  return { razon, mensaje };
}

function dormir(ms, senal) {
  return new Promise((resolve, reject) => {
    const reloj = setTimeout(resolve, ms);
    senal?.addEventListener('abort', () => {
      clearTimeout(reloj);
      reject(new ErrorYouTube('Cancelado'));
    }, { once: true });
  });
}

module.exports = { pedir, paginar, porLotes, ErrorYouTube, MAX_POR_PAGINA, BASE };
