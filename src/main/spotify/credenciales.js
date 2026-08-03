'use strict';

const path = require('node:path');
const { app, safeStorage } = require('electron');

const { JsonStore } = require('../store');

/**
 * Las credenciales de Spotify, en su propio archivo y con el token de
 * refresco cifrado.
 *
 * Va aparte de settings.json por dos razones. La primera es que settings.json
 * se lee en claro y esta pensado para que el usuario lo abra y lo edite a
 * mano; un token de refresco ahi seria una credencial de larga vida a la
 * vista, en un archivo que ademas se comparte al pedir ayuda con la
 * configuracion. La segunda es que desconectar la cuenta tiene que poder
 * borrar esto entero sin arrastrarse los ajustes del ecualizador.
 *
 * El de acceso NO se guarda: dura una hora y se vuelve a pedir al arrancar.
 * Persistirlo solo añadiria una copia mas de un secreto que caduca solo.
 */

const VERSION = 1;

let store = null;
/** El token de acceso vive solo en memoria, con su momento de caducidad. */
let acceso = null;

function abrir() {
  if (!store) {
    store = new JsonStore(path.join(app.getPath('userData'), 'spotify.json'), {
      version: VERSION,
      clientId: '',
      refresh: null,
      perfil: null,
      scopes: '',
    });
  }
  return store;
}

/**
 * El Client ID no es un secreto.
 *
 * En un flujo PKCE el identificador de la aplicacion viaja en la URL de
 * autorizacion, que el usuario ve entera en la barra del navegador. Lo que
 * protege el intercambio es el verificador, que se genera en cada intento y
 * no se guarda en ningun sitio. Asi que este campo va en claro a proposito:
 * cifrarlo daria una sensacion de seguridad que no corresponde.
 */
function getClientId() {
  return String(abrir().get('clientId', '') || '').trim();
}

function setClientId(valor) {
  abrir().set('clientId', String(valor || '').trim());
}

// --- Token de refresco ----------------------------------------------------

/**
 * Guarda el token de refresco cifrado con la clave del usuario de Windows.
 *
 * Si el cifrado no esta disponible se devuelve `false` y NO se escribe nada.
 * La alternativa seria dejarlo en claro, y prefiero que el usuario tenga que
 * volver a conectar la cuenta en cada arranque antes que dejarle en el disco
 * una credencial que da acceso a su biblioteca sin caducar.
 */
function guardarRefresh(token) {
  if (!token) return false;
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[spotify] sin cifrado disponible: la sesion no se guarda');
    return false;
  }
  try {
    const s = abrir();
    s.set('refresh', safeStorage.encryptString(String(token)).toString('base64'));
    // A disco ya, sin pasar por la escritura diferida del almacen. Este token
    // ha costado una vuelta entera por el navegador y el consentimiento del
    // usuario: si la app se cierra en los 300 ms que tarda el temporizador,
    // hay que rehacer el flujo entero. Los ajustes se pueden permitir esa
    // espera porque se vuelven a poner con un clic; esto no.
    s.save();
    return true;
  } catch (err) {
    console.error('[spotify] no pude cifrar el token:', err.message);
    return false;
  }
}

function leerRefresh() {
  const guardado = abrir().get('refresh', null);
  if (!guardado || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(guardado, 'base64'));
  } catch (err) {
    // Pasa de verdad: el usuario de Windows cambio, se restauro el perfil, o
    // se copio la carpeta de datos a otro equipo. DPAPI ata el cifrado a la
    // cuenta, asi que ese blob ya no lo descifra nadie. Se tira y se pide
    // conectar otra vez, que es lo unico que puede funcionar.
    console.warn('[spotify] el token guardado ya no se puede descifrar:', err.message);
    abrir().set('refresh', null);
    return null;
  }
}

// --- Token de acceso (solo memoria) ---------------------------------------

function setAcceso(token, segundos) {
  // Se resta un minuto al margen: si el token caduca justo entre que se
  // comprueba y llega la peticion, la respuesta es un 401 que nadie espera.
  acceso = {
    token,
    caduca: Date.now() + Math.max(0, (Number(segundos) || 3600) - 60) * 1000,
  };
}

function getAcceso() {
  if (!acceso || Date.now() >= acceso.caduca) return null;
  return acceso.token;
}

function olvidarAcceso() {
  acceso = null;
}

// --- Perfil y permisos ----------------------------------------------------

function setPerfil(perfil) {
  abrir().set('perfil', perfil ?? null);
}

function getPerfil() {
  return abrir().get('perfil', null);
}

function setScopes(scopes) {
  abrir().set('scopes', String(scopes || ''));
}

function getScopes() {
  return String(abrir().get('scopes', '') || '');
}

function hayCuenta() {
  return !!leerRefresh();
}

/** Desconectar: se va todo menos el Client ID, que es de la app, no de la cuenta. */
function desconectar() {
  const s = abrir();
  olvidarAcceso();
  s.merge({ refresh: null, perfil: null, scopes: '' });
  s.save();
}

module.exports = {
  getClientId,
  setClientId,
  guardarRefresh,
  leerRefresh,
  setAcceso,
  getAcceso,
  olvidarAcceso,
  setPerfil,
  getPerfil,
  setScopes,
  getScopes,
  hayCuenta,
  desconectar,
};
