'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { shell } = require('electron');

const cred = require('./credenciales');

/**
 * Autorizacion con Spotify por OAuth 2.0 + PKCE.
 *
 * PKCE y no el flujo clasico porque este programa se instala en el equipo del
 * usuario: un secreto de cliente dentro del instalador lo puede leer
 * cualquiera con un editor hexadecimal, asi que no es un secreto. PKCE se
 * diseño justo para esto — lo que demuestra que quien canjea el codigo es
 * quien lo pidio es un verificador que se genera en cada intento y no se
 * guarda en ningun sitio.
 *
 * La pagina de Spotify se abre en el NAVEGADOR DEL SISTEMA, no en una ventana
 * de Electron. Meterla dentro seria pedirle al usuario que escriba la
 * contraseña de Spotify en una ventana que ha dibujado esta aplicacion, sin
 * barra de direcciones que le diga si el sitio es el de verdad, y sin que le
 * funcione el gestor de contraseñas. Aunque aqui no se toque, la costumbre es
 * exactamente la que aprovecha el phishing.
 */

const AUTORIZAR = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';

/**
 * Puerto fijo, y `127.0.0.1` en vez de `localhost`.
 *
 * Fijo porque la URI de retorno hay que darla de alta en el panel de Spotify
 * y la comparacion es exacta: con un puerto al azar habria que registrarlos
 * todos. Y la IP literal porque Spotify dejo de admitir el nombre `localhost`
 * en las URI de retorno — puede resolver a ::1 o a otra cosa segun el equipo,
 * asi que exigen la direccion escrita.
 */
const PUERTO = 8888;
const REDIRECT_URI = `http://127.0.0.1:${PUERTO}/callback`;

/**
 * Lo minimo para leer el catalogo. Nada de escritura: Sounde no modifica
 * nada en la cuenta de Spotify, y pedir permisos que no se usan hace que la
 * pantalla de consentimiento de del usuario asuste mas de lo que deberia.
 */
const SCOPES = [
  'user-read-private',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

/** Si el usuario deja la pestaña abierta y se va, el servidor no se queda puesto. */
const ESPERA_MS = 3 * 60 * 1000;

let enCurso = null;

// --- PKCE -----------------------------------------------------------------

const base64url = (buf) => buf.toString('base64url');

function generarVerificador() {
  // 96 bytes -> 128 caracteres en base64url, el maximo que admite la norma.
  return base64url(crypto.randomBytes(96));
}

function retoDe(verificador) {
  return base64url(crypto.createHash('sha256').update(verificador).digest());
}

// --- Flujo de conexion ----------------------------------------------------

/**
 * Abre el navegador y espera el retorno. Devuelve el perfil ya leido.
 *
 * Solo puede haber un intento a la vez: dos servidores no caben en el mismo
 * puerto y el segundo moriria con EADDRINUSE sin que el usuario entienda por
 * que. Si ya hay uno, se le devuelve ese mismo.
 */
function conectar() {
  if (enCurso) return enCurso;

  const clientId = cred.getClientId();
  if (!clientId) {
    return Promise.reject(new Error('Falta el Client ID de la aplicacion de Spotify.'));
  }

  enCurso = flujo(clientId).finally(() => {
    enCurso = null;
  });
  return enCurso;
}

async function flujo(clientId) {
  const verificador = generarVerificador();
  const estado = base64url(crypto.randomBytes(24));

  const retorno = escuchar(estado);

  /*
   * Primero el puerto, DESPUES el navegador.
   *
   * Al reves, si el puerto esta ocupado, la secuencia para el usuario es:
   * se abre Spotify, escribe su contraseña, concede los permisos, y solo
   * entonces aterriza en un puerto donde no hay nadie. Ha dado acceso a su
   * cuenta a cambio de un error. Esperando aqui, si el puerto no se puede
   * atar el navegador no llega a abrirse y el fallo se cuenta antes de pedir
   * nada.
   */
  await retorno.escuchando;

  const url = new URL(AUTORIZAR);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    state: estado,
    code_challenge_method: 'S256',
    code_challenge: retoDe(verificador),
  }).toString();

  try {
    await shell.openExternal(url.toString());
  } catch (err) {
    retorno.cancelar();
    throw new Error(`No se pudo abrir el navegador: ${err.message}`);
  }

  const codigo = await retorno.codigo;

  const datos = await canjear({
    grant_type: 'authorization_code',
    code: codigo,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verificador,
  });
  cred.setAcceso(datos.access_token, datos.expires_in);
  cred.guardarRefresh(datos.refresh_token);
  cred.setScopes(datos.scope || SCOPES);
  return datos;
}

/**
 * Levanta el servidor de bucle local.
 *
 * Devuelve `escuchando` (el puerto ya esta atado) aparte de `codigo` (ha
 * llegado el retorno), porque quien llama tiene que poder esperar a lo
 * primero sin esperar a lo segundo.
 *
 * El `state` se compara SIEMPRE. Sin esa comprobacion, cualquier pagina que
 * el usuario tuviera abierta podria apuntar a este puerto con un codigo suyo
 * y dejar la sesion de Sounde conectada a otra cuenta.
 */
function escuchar(estado) {
  let resolverCodigo;
  let rechazarCodigo;
  const codigo = new Promise((res, rej) => {
    resolverCodigo = res;
    rechazarCodigo = rej;
  });

  let cerrado = false;
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PUERTO}`);
    if (url.pathname !== '/callback') {
      res.writeHead(404, { Connection: 'close' }).end();
      return;
    }

    const error = url.searchParams.get('error');
    const recibido = url.searchParams.get('state');
    const code = url.searchParams.get('code');

    let fallo = null;
    if (error) fallo = error === 'access_denied' ? 'Has cancelado la conexion.' : error;
    else if (recibido !== estado) fallo = 'El estado no coincide: la respuesta no es de esta peticion.';
    else if (!code) fallo = 'Spotify no devolvio ningun codigo.';

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // Sin esto el navegador deja la conexion en keep-alive y el cierre del
      // servidor se queda esperando a que se le ocurra soltarla.
      Connection: 'close',
    });
    // El cierre va en la respuesta a `end`, no justo detras: cortando antes
    // de que el cuerpo salga, el usuario ve una pestaña en blanco en vez de
    // la pagina que le dice que ya puede volver.
    res.end(pagina(fallo), () => {
      cerrar();
      if (fallo) rechazarCodigo(new Error(fallo));
      else resolverCodigo(code);
    });
  });

  function cerrar() {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(reloj);
    servidor.close();
    servidor.closeAllConnections?.();
  }

  const reloj = setTimeout(() => {
    cerrar();
    rechazarCodigo(new Error('Se agoto el tiempo de espera de la autorizacion.'));
  }, ESPERA_MS);

  const escuchando = new Promise((res, rej) => {
    servidor.once('listening', res);
    servidor.once('error', (err) => {
      cerrar();
      const fallo = err.code === 'EADDRINUSE'
        ? new Error(`El puerto ${PUERTO} esta ocupado por otro programa. Cierralo y vuelve a intentarlo.`)
        : err;
      // Los dos: quien espera el puerto se entera, y la promesa del codigo no
      // se queda colgada para siempre sin nadie que la resuelva.
      rechazarCodigo(fallo);
      rej(fallo);
    });
  });

  // Nadie tiene por que mirar `codigo` si el fallo llego por `escuchando`.
  codigo.catch(() => {});

  servidor.listen(PUERTO, '127.0.0.1');

  return {
    escuchando,
    codigo,
    cancelar: () => {
      cerrar();
      rechazarCodigo(new Error('Conexion cancelada.'));
    },
  };
}

// --- Token de acceso ------------------------------------------------------

/**
 * Devuelve un token de acceso valido, refrescandolo si hace falta.
 *
 * `refrescando` guarda la promesa en vuelo para que varias llamadas a la vez
 * compartan un unico refresco. Spotify ROTA el token de refresco: cada
 * respuesta puede traer uno nuevo que invalida al anterior. Si dos peticiones
 * refrescaran en paralelo con el mismo token, la segunda llegaria con uno ya
 * quemado y la sesion se caeria sola. Y esto pasa de verdad, porque al
 * sincronizar salen varias peticiones juntas justo cuando el token ha
 * caducado.
 */
let refrescando = null;

async function tokenValido() {
  const vivo = cred.getAcceso();
  if (vivo) return vivo;

  if (!refrescando) {
    refrescando = refrescar().finally(() => {
      refrescando = null;
    });
  }
  return refrescando;
}

async function refrescar() {
  const refresh = cred.leerRefresh();
  if (!refresh) throw new SinCuenta('No hay ninguna cuenta de Spotify conectada.');

  const clientId = cred.getClientId();
  if (!clientId) throw new SinCuenta('Falta el Client ID de la aplicacion de Spotify.');

  let datos;
  try {
    datos = await canjear({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
    });
  } catch (err) {
    // `invalid_grant` es definitivo: el usuario revoco el acceso desde su
    // cuenta, o el token caduco por desuso. Reintentar no lo va a arreglar,
    // asi que se limpia la sesion y se pide conectar otra vez. Dejarla puesta
    // haria que cada sincronizacion fallara en silencio para siempre.
    if (err.codigo === 'invalid_grant') {
      cred.desconectar();
      throw new SinCuenta('Spotify ha cerrado la sesion. Vuelve a conectar la cuenta.');
    }
    throw err;
  }

  cred.setAcceso(datos.access_token, datos.expires_in);
  // Solo viene cuando rota. Guardar `undefined` borraria la sesion entera.
  if (datos.refresh_token) cred.guardarRefresh(datos.refresh_token);
  return datos.access_token;
}

async function canjear(cuerpo) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(cuerpo).toString(),
  });

  const texto = await res.text();
  let datos = null;
  try {
    datos = JSON.parse(texto);
  } catch { /* Spotify contesto algo que no es JSON */ }

  if (!res.ok) {
    const err = new Error(datos?.error_description || datos?.error || `Spotify devolvio ${res.status}`);
    err.codigo = datos?.error ?? null;
    err.status = res.status;
    throw err;
  }
  if (!datos?.access_token) throw new Error('Spotify no devolvio ningun token.');
  return datos;
}

/** Distingue "no hay sesion" de "fallo la red", que se tratan distinto arriba. */
class SinCuenta extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'SinCuenta';
    this.sinCuenta = true;
  }
}

/** La pestaña que ve el usuario al volver del navegador. */
function pagina(fallo) {
  const titulo = fallo ? 'No se pudo conectar' : 'Cuenta conectada';
  const texto = fallo
    ? escapar(fallo)
    : 'Ya puedes cerrar esta pestaña y volver a Sounde.';
  return `<!doctype html><html lang="es"><meta charset="utf-8">
<title>Sounde</title>
<style>
  body { margin:0; display:grid; place-items:center; min-height:100vh;
         background:#0E1116; color:#E8EAF0;
         font:16px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif; }
  main { text-align:center; padding:2rem; }
  h1 { font-size:1.5rem; font-weight:600; margin:0 0 .5rem; }
  p { margin:0; color:#9AA3B2; }
</style>
<main><h1>${titulo}</h1><p>${texto}</p></main>`;
}

const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

module.exports = {
  conectar,
  tokenValido,
  refrescar,
  SinCuenta,
  REDIRECT_URI,
  SCOPES,
  PUERTO,
};
