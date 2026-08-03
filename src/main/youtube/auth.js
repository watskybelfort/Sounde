'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { shell } = require('electron');

const cred = require('./credenciales');

/**
 * Autorizacion con Google por OAuth 2.0 + PKCE.
 *
 * Mismo esquema que el de Spotify y por las mismas razones — el programa se
 * instala en el equipo del usuario, asi que no puede guardar secretos — pero
 * con dos diferencias que Google permite y agradecemos:
 *
 * 1. El puerto de retorno puede ser CUALQUIERA. Google admite cualquier
 *    `http://127.0.0.1:puerto` para clientes de escritorio sin registrarlo,
 *    asi que se pide uno libre al sistema. Con eso desaparece el fallo de
 *    "el puerto 8888 esta ocupado", que en Spotify hay que contar y explicar.
 *
 * 2. El `client_secret` es opcional. Google lo entrega para clientes de
 *    escritorio y lo documenta como no confidencial; se manda si el usuario
 *    lo pego y se calla si no. Quien protege el intercambio es el verificador.
 */

const AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

/** Solo lectura. Sounde no modifica nada en la cuenta de YouTube. */
const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

const ESPERA_MS = 3 * 60 * 1000;

let enCurso = null;

const base64url = (buf) => buf.toString('base64url');
const generarVerificador = () => base64url(crypto.randomBytes(96));
const retoDe = (v) => base64url(crypto.createHash('sha256').update(v).digest());

// --- Conexion -------------------------------------------------------------

function conectar() {
  if (enCurso) return enCurso;

  const clientId = cred.getClientId();
  if (!clientId) {
    return Promise.reject(new Error('Falta el Client ID de tu proyecto de Google.'));
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

  // Primero el puerto, DESPUES el navegador: hasta que no esta atado no se
  // sabe cual es, porque lo elige el sistema.
  const puerto = await retorno.escuchando;
  const redirectUri = `http://127.0.0.1:${puerto}`;

  const url = new URL(AUTORIZAR);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: SCOPES,
    redirect_uri: redirectUri,
    state: estado,
    code_challenge_method: 'S256',
    code_challenge: retoDe(verificador),
    /*
     * Sin estos dos, Google solo entrega el token de refresco la PRIMERA vez
     * que el usuario autoriza la aplicacion. En la segunda conexion vendria
     * un token de acceso suelto, la sesion duraria una hora y luego pediria
     * conectar otra vez sin que se entienda por que.
     */
    access_type: 'offline',
    prompt: 'consent',
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
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verificador,
    ...secretoSiHay(),
  });

  cred.setAcceso(datos.access_token, datos.expires_in);
  cred.guardarRefresh(datos.refresh_token);
  cred.setScopes(datos.scope || SCOPES);
  return datos;
}

/** El client_secret solo viaja si el usuario lo puso. */
function secretoSiHay() {
  const secreto = cred.getClientSecret();
  return secreto ? { client_secret: secreto } : {};
}

/**
 * Servidor de retorno en un puerto libre.
 *
 * `escuchando` resuelve con el puerto que dio el sistema; hasta entonces no
 * se puede componer la URI de retorno, asi que quien llama tiene que esperar.
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
    const url = new URL(req.url, 'http://127.0.0.1');

    const error = url.searchParams.get('error');
    const recibido = url.searchParams.get('state');
    const code = url.searchParams.get('code');

    // Google vuelve a la raiz, no a una ruta concreta. Cualquier peticion sin
    // parametros (el favicon, por ejemplo) se ignora sin dar el retorno por
    // recibido: contestarla cerraria el servidor antes de tiempo.
    if (!error && !code) {
      res.writeHead(404, { Connection: 'close' }).end();
      return;
    }

    let fallo = null;
    if (error) fallo = error === 'access_denied' ? 'Has cancelado la conexion.' : error;
    else if (recibido !== estado) fallo = 'El estado no coincide: la respuesta no es de esta peticion.';

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
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
    servidor.once('listening', () => res(servidor.address().port));
    servidor.once('error', (err) => {
      cerrar();
      rechazarCodigo(err);
      rej(err);
    });
  });

  codigo.catch(() => {});
  // Puerto 0: que lo elija el sistema entre los libres.
  servidor.listen(0, '127.0.0.1');

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
  if (!refresh) throw new SinCuenta('No hay ninguna cuenta de Google conectada.');

  const clientId = cred.getClientId();
  if (!clientId) throw new SinCuenta('Falta el Client ID de tu proyecto de Google.');

  let datos;
  try {
    datos = await canjear({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
      ...secretoSiHay(),
    });
  } catch (err) {
    /*
     * `invalid_grant` es definitivo: el usuario revoco el acceso, o el token
     * caduco. Con Google hay una causa mas y conviene nombrarla — un proyecto
     * en modo de prueba invalida los tokens de refresco a los siete dias, asi
     * que esto le pasara al usuario cada semana hasta que publique la app.
     */
    if (err.codigo === 'invalid_grant') {
      cred.desconectar();
      throw new SinCuenta(
        'Google ha cerrado la sesion. Si tu proyecto sigue en modo de prueba, '
        + 'esto pasa cada siete dias: vuelve a conectar la cuenta.',
      );
    }
    throw err;
  }

  cred.setAcceso(datos.access_token, datos.expires_in);
  // Google no suele rotarlo, pero si viene uno nuevo manda el nuevo.
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
  } catch { /* Google contesto algo que no es JSON */ }

  if (!res.ok) {
    const err = new Error(datos?.error_description || datos?.error || `Google devolvio ${res.status}`);
    err.codigo = datos?.error ?? null;
    err.status = res.status;
    throw err;
  }
  if (!datos?.access_token) throw new Error('Google no devolvio ningun token.');
  return datos;
}

class SinCuenta extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'SinCuenta';
    this.sinCuenta = true;
  }
}

function pagina(fallo) {
  const titulo = fallo ? 'No se pudo conectar' : 'Cuenta conectada';
  const texto = fallo ? escapar(fallo) : 'Ya puedes cerrar esta pestaña y volver a Sounde.';
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

module.exports = { conectar, tokenValido, refrescar, SinCuenta, SCOPES };
