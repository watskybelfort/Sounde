'use strict';

const path = require('node:path');
const { app, safeStorage } = require('electron');

const { JsonStore } = require('../store');

/**
 * Almacen de credenciales de un servicio, con el token de refresco cifrado.
 *
 * Es una fabrica porque hay mas de un servicio y todos guardan lo mismo:
 * un identificador de aplicacion, un token de refresco y un perfil. Cada uno
 * en su archivo, para que desconectar uno no roce al otro.
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

function crearCredenciales({ archivo, etiqueta }) {
  let store = null;
  /** El token de acceso vive solo en memoria, con su momento de caducidad. */
  let acceso = null;

  function abrir() {
    if (!store) {
      store = new JsonStore(path.join(app.getPath('userData'), archivo), {
        version: VERSION,
        clientId: '',
        clientSecret: '',
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
  const getClientId = () => String(abrir().get('clientId', '') || '').trim();

  const setClientId = (valor) => abrir().set('clientId', String(valor || '').trim());

  /**
   * El "client secret" de una aplicacion de escritorio tampoco lo es.
   *
   * Google lo entrega junto al Client ID para clientes de escritorio y lo
   * documenta como no confidencial: va dentro de un programa que se instala
   * en el equipo del usuario, asi que cualquiera puede sacarlo. Se cifra
   * igualmente porque no cuesta nada, pero la seguridad del flujo la pone
   * PKCE, no esto.
   */
  function setClientSecret(valor) {
    const texto = String(valor || '').trim();
    if (!texto) {
      abrir().set('clientSecret', '');
      return;
    }
    abrir().set('clientSecret', cifrar(texto) ?? '');
  }

  function getClientSecret() {
    return descifrar(abrir().get('clientSecret', '')) ?? '';
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
    const cifrado = cifrar(String(token));
    if (!cifrado) return false;
    const s = abrir();
    s.set('refresh', cifrado);
    // A disco ya, sin pasar por la escritura diferida del almacen. Este token
    // ha costado una vuelta entera por el navegador y el consentimiento del
    // usuario: si la app se cierra en los 300 ms que tarda el temporizador,
    // hay que rehacer el flujo entero. Los ajustes se pueden permitir esa
    // espera porque se vuelven a poner con un clic; esto no.
    s.save();
    return true;
  }

  function leerRefresh() {
    const guardado = abrir().get('refresh', null);
    if (!guardado) return null;
    const claro = descifrar(guardado);
    if (claro === null) {
      // Pasa de verdad: el usuario de Windows cambio, se restauro el perfil, o
      // se copio la carpeta de datos a otro equipo. DPAPI ata el cifrado a la
      // cuenta, asi que ese blob ya no lo descifra nadie. Se tira y se pide
      // conectar otra vez, que es lo unico que puede funcionar.
      abrir().set('refresh', null);
    }
    return claro;
  }

  // --- Cifrado --------------------------------------------------------------

  function cifrar(texto) {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn(`[${etiqueta}] sin cifrado disponible: la sesion no se guarda`);
      return null;
    }
    try {
      return safeStorage.encryptString(texto).toString('base64');
    } catch (err) {
      console.error(`[${etiqueta}] no pude cifrar:`, err.message);
      return null;
    }
  }

  function descifrar(guardado) {
    if (!guardado || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(guardado, 'base64'));
    } catch (err) {
      console.warn(`[${etiqueta}] lo guardado ya no se puede descifrar:`, err.message);
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

  const olvidarAcceso = () => { acceso = null; };

  // --- Perfil y permisos ----------------------------------------------------

  const setPerfil = (perfil) => abrir().set('perfil', perfil ?? null);
  const getPerfil = () => abrir().get('perfil', null);
  const setScopes = (scopes) => abrir().set('scopes', String(scopes || ''));
  const getScopes = () => String(abrir().get('scopes', '') || '');
  const hayCuenta = () => !!leerRefresh();

  /** Desconectar: se va todo menos lo que identifica a la aplicacion. */
  function desconectar() {
    const s = abrir();
    olvidarAcceso();
    s.merge({ refresh: null, perfil: null, scopes: '' });
    s.save();
  }

  return {
    getClientId,
    setClientId,
    getClientSecret,
    setClientSecret,
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
}

module.exports = { crearCredenciales };
