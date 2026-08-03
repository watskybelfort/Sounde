'use strict';

const auth = require('./auth');
const cred = require('./credenciales');

/**
 * Cliente de la Web API de Spotify.
 *
 * Vive entero en el proceso principal, y eso no es casual: la pagina de
 * Sounde tiene una CSP con `default-src 'none'` y sin `connect-src`. Si las
 * peticiones salieran del renderer habria que abrirle un agujero a
 * api.spotify.com, y ese agujero vale para cualquier cosa que llegue a
 * ejecutarse ahi dentro. Desde aqui la CSP se queda intacta.
 */

const BASE = 'https://api.spotify.com/v1';

/** Tope de reintentos por peticion, contando todas las causas. */
const REINTENTOS = 3;

/**
 * Si Spotify pide esperar mas que esto, se abandona.
 *
 * Un 429 con Retry-After de varios minutos no es un bache: es que se ha
 * agotado la cuota. Dormir ahi dejaria la sincronizacion aparentemente colgada
 * sin nada en pantalla que lo explique, y el usuario cerraria la aplicacion
 * pensando que se ha quedado tonta. Es mejor contarlo y dejar que lo repita.
 */
const ESPERA_MAXIMA_MS = 60_000;

class ErrorSpotify extends Error {
  constructor(mensaje, { status = 0, ruta = '', reintentar = false } = {}) {
    super(mensaje);
    this.name = 'ErrorSpotify';
    this.status = status;
    this.ruta = ruta;
    this.reintentar = reintentar;
  }
}

/**
 * Una peticion GET a la API, ya autenticada.
 *
 * `ruta` es relativa ('/me/playlists') o una URL completa, que es lo que
 * viene en el campo `next` de las respuestas paginadas.
 */
async function pedir(ruta, { senal } = {}) {
  const url = ruta.startsWith('http') ? ruta : `${BASE}${ruta}`;
  let refrescado = false;

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    if (senal?.aborted) throw new ErrorSpotify('Cancelado', { ruta });

    const token = await auth.tokenValido();
    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: senal,
      });
    } catch (err) {
      if (senal?.aborted) throw new ErrorSpotify('Cancelado', { ruta });
      // Sin red no hay nada que hacer salvo esperar un poco y probar. Es el
      // caso del portatil que acaba de salir de suspension.
      if (intento === REINTENTOS) {
        throw new ErrorSpotify(`No se pudo conectar con Spotify: ${err.message}`, { ruta, reintentar: true });
      }
      await dormir(500 * 2 ** intento, senal);
      continue;
    }

    if (res.ok) return res.status === 204 ? null : res.json();

    /*
     * 401 con el token que creiamos vivo. Pasa cuando el usuario revoca el
     * acceso desde su cuenta, o cuando el reloj del equipo va adelantado y
     * nuestro calculo de caducidad no coincide con el de Spotify. Se fuerza
     * UN refresco y se repite; si vuelve a salir 401, es que la sesion esta
     * muerta de verdad y reintentar solo alarga el fallo.
     */
    if (res.status === 401 && !refrescado) {
      refrescado = true;
      cred.olvidarAcceso();
      continue;
    }

    if (res.status === 429) {
      const espera = segundosDeEspera(res);
      if (espera > ESPERA_MAXIMA_MS || intento === REINTENTOS) {
        throw new ErrorSpotify(
          `Spotify ha limitado las peticiones. Vuelve a intentarlo en ${Math.ceil(espera / 1000)} s.`,
          { status: 429, ruta, reintentar: true },
        );
      }
      await dormir(espera, senal);
      continue;
    }

    // 5xx es de Spotify, no nuestro: se reintenta con espera creciente.
    if (res.status >= 500 && intento < REINTENTOS) {
      await dormir(500 * 2 ** intento, senal);
      continue;
    }

    throw new ErrorSpotify(await mensajeDe(res), { status: res.status, ruta });
  }

  throw new ErrorSpotify('Se agotaron los reintentos.', { ruta, reintentar: true });
}

/**
 * Recorre una respuesta paginada y devuelve todos los elementos.
 *
 * `tope` existe para que una cuenta con veinte mil canciones guardadas no
 * convierta la primera sincronizacion en una descarga infinita. Cuando se
 * alcanza, se devuelve lo que hay y `completo: false`, y quien llama decide
 * si lo dice o no: callarselo haria que la biblioteca pareciera incompleta
 * sin motivo aparente.
 */
async function paginar(ruta, { limite = 50, tope = 10_000, senal, onLote } = {}) {
  const separador = ruta.includes('?') ? '&' : '?';
  let siguiente = `${ruta}${separador}limit=${limite}`;
  const salida = [];
  let total = null;

  while (siguiente) {
    const pagina = await pedir(siguiente, { senal });
    if (!pagina) break;
    if (total === null && Number.isFinite(pagina.total)) total = pagina.total;

    const lote = (pagina.items ?? []).filter(Boolean);
    salida.push(...lote);
    onLote?.({ recibidos: salida.length, total: total ?? salida.length });

    if (salida.length >= tope) return { items: salida.slice(0, tope), total, completo: false };
    siguiente = pagina.next ?? null;
  }

  return { items: salida, total: total ?? salida.length, completo: true };
}

/** Reparte los ids en lotes del tamaño que admite cada endpoint. */
async function porLotes(ids, tamano, fn) {
  const salida = [];
  for (let i = 0; i < ids.length; i += tamano) {
    salida.push(...(await fn(ids.slice(i, i + tamano))));
  }
  return salida;
}

// --- Utilidades -----------------------------------------------------------

/** Retry-After viene en segundos. Sin cabecera, un segundo de cortesia. */
function segundosDeEspera(res) {
  const cabecera = Number(res.headers.get('Retry-After'));
  if (!Number.isFinite(cabecera) || cabecera < 0) return 1000;
  return cabecera * 1000;
}

async function mensajeDe(res) {
  let detalle = '';
  try {
    const cuerpo = await res.json();
    detalle = cuerpo?.error?.message ?? '';
  } catch { /* no era JSON */ }

  if (res.status === 403) {
    return detalle || 'Spotify ha rechazado la peticion: puede que falte algun permiso.';
  }
  if (res.status === 404) return detalle || 'Eso ya no existe en Spotify.';
  return detalle ? `Spotify: ${detalle}` : `Spotify devolvio ${res.status}.`;
}

function dormir(ms, senal) {
  return new Promise((resolve, reject) => {
    const reloj = setTimeout(resolve, ms);
    senal?.addEventListener('abort', () => {
      clearTimeout(reloj);
      reject(new ErrorSpotify('Cancelado'));
    }, { once: true });
  });
}

module.exports = { pedir, paginar, porLotes, ErrorSpotify, BASE };
