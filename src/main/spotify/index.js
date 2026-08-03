'use strict';

const auth = require('./auth');
const api = require('./api');
const cred = require('./credenciales');
const catalogo = require('./catalogo');
const emparejar = require('./emparejar');
const protocols = require('../protocols');

/**
 * La cara de Spotify hacia el resto de la aplicacion.
 *
 * `ipc.js` solo habla con este archivo. Los de dentro (auth, api, catalogo,
 * emparejar) no se tocan desde fuera: asi el dia que Spotify cambie algo, o
 * el dia que se añada otro servicio, lo que hay que respetar es esta docena
 * de funciones y no media aplicacion.
 */

let biblioteca = null;
/** El indice de emparejado, que cuesta rehacerlo y solo cambia con la biblioteca. */
let indice = null;
let enSincronizacion = null;

function init({ library }) {
  biblioteca = library;
}

/** La biblioteca cambio: el indice que hubiera ya no vale. */
function olvidarIndice() {
  indice = null;
}

function getIndice() {
  if (!indice) indice = emparejar.construirIndice(biblioteca?.all() ?? []);
  return indice;
}

/**
 * El nombre del archivo de caratula pasa a URL del esquema propio.
 *
 * La pagina nunca ve nombres de archivo sueltos, igual que con la biblioteca
 * local: lo que recibe es una URL que ya esta validada contra la cache.
 */
const conArte = (x) => ({ ...x, artUrl: x.art ? protocols.artUrl(x.art) : null });

// --- Estado ---------------------------------------------------------------

function estado() {
  return {
    clientId: cred.getClientId(),
    hayClientId: !!cred.getClientId(),
    conectado: cred.hayCuenta(),
    perfil: cred.getPerfil(),
    redirectUri: auth.REDIRECT_URI,
    sincronizando: !!enSincronizacion,
    ...catalogo.resumen(),
  };
}

function setClientId(valor) {
  const previo = cred.getClientId();
  const nuevo = String(valor || '').trim();
  // Cambiar de aplicacion invalida la sesion: el token de refresco pertenece
  // al Client ID con el que se pidio, y con otro no lo canjea nadie. Dejarlo
  // puesto solo daria un `invalid_client` mas adelante, lejos de la causa.
  if (previo && nuevo !== previo) {
    cred.desconectar();
    catalogo.limpiar();
  }
  cred.setClientId(nuevo);
  return estado();
}

// --- Conexion -------------------------------------------------------------

async function conectar() {
  await auth.conectar();
  return estado();
}

function desconectar() {
  cred.desconectar();
  catalogo.limpiar();
  return estado();
}

// --- Sincronizacion -------------------------------------------------------

/**
 * Trae el catalogo. Si ya hay una en marcha, se devuelve esa misma en vez de
 * lanzar otra: el boton se puede pulsar dos veces y dos sincronizaciones a la
 * vez se pisarian al guardar.
 */
function sincronizar({ onProgress } = {}) {
  if (enSincronizacion) return enSincronizacion.promesa;

  const control = new AbortController();
  const promesa = catalogo
    .sincronizar({ onProgress, senal: control.signal })
    .then((res) => ({ ok: true, ...res }))
    .catch((err) => ({
      ok: false,
      error: err.message,
      sinCuenta: !!err.sinCuenta,
      reintentar: !!err.reintentar,
    }))
    .finally(() => {
      enSincronizacion = null;
    });

  enSincronizacion = { promesa, control };
  return promesa;
}

function cancelarSincronizacion() {
  enSincronizacion?.control.abort();
  return true;
}

// --- Lectura del catalogo, ya cruzada con la biblioteca -------------------

/**
 * Las listas con el recuento de lo que ya tienes.
 *
 * El cruce se hace aqui y no en la pagina porque la biblioteca vive en este
 * proceso: mandar veinte mil pistas al renderer para que compare seria mover
 * megabytes por el puente en cada vistazo.
 */
function listas() {
  const d = catalogo.todo();
  const idx = getIndice();

  return d.playlists.map((lista) => {
    let encontradas = 0;
    for (const id of lista.tracks) {
      const pista = d.pistas[id];
      if (pista && emparejar.emparejar(pista, idx)) encontradas++;
    }
    return conArte({
      id: lista.id,
      name: lista.name,
      description: lista.description,
      owner: lista.owner,
      propia: lista.propia,
      uri: lista.uri,
      art: lista.art,
      total: lista.tracks.length,
      descartadas: lista.descartadas ?? 0,
      encontradas,
      faltan: lista.tracks.length - encontradas,
    });
  });
}

/** Una lista con sus canciones, cada una enlazada a tu archivo o marcada como ausente. */
function lista(id) {
  const d = catalogo.todo();
  const encontrada = d.playlists.find((p) => p.id === id);
  if (!encontrada) return null;

  const pistas = encontrada.tracks.map((t) => d.pistas[t]).filter(Boolean);
  const { items, encontradas, faltan } = emparejar.emparejarLista(pistas, getIndice());

  return conArte({
    id: encontrada.id,
    name: encontrada.name,
    description: encontrada.description,
    owner: encontrada.owner,
    propia: encontrada.propia,
    uri: encontrada.uri,
    art: encontrada.art,
    descartadas: encontrada.descartadas ?? 0,
    encontradas,
    faltan,
    items: items.map(conArte),
  });
}

/** Las canciones guardadas ("Tus me gusta"), tratadas como una lista mas. */
function guardadas() {
  const d = catalogo.todo();
  const pistas = d.guardadas.map((t) => d.pistas[t]).filter(Boolean);
  const { items, encontradas, faltan } = emparejar.emparejarLista(pistas, getIndice());
  return {
    id: GUARDADAS,
    name: 'Tus me gusta',
    encontradas,
    faltan,
    art: null,
    artUrl: null,
    items: items.map(conArte),
  };
}

/** Id reservado para las guardadas, que no son una lista de verdad en Spotify. */
const GUARDADAS = '__guardadas__';

module.exports = {
  init,
  olvidarIndice,
  estado,
  setClientId,
  conectar,
  desconectar,
  sincronizar,
  cancelarSincronizacion,
  listas,
  lista,
  guardadas,
  GUARDADAS,
  SinCuenta: auth.SinCuenta,
  ErrorSpotify: api.ErrorSpotify,
};
