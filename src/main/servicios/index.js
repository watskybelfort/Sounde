'use strict';

const emparejar = require('./emparejar');
const protocols = require('../protocols');

/**
 * Un servicio de catalogo remoto, visto desde el resto de la aplicacion.
 *
 * Spotify y YouTube traen los datos de sitios distintos y con formas
 * distintas, pero una vez normalizados hacen lo mismo: dar unas listas, unas
 * pistas, y cruzarlas con la biblioteca local. Todo eso vive aqui una sola
 * vez.
 *
 * Lo que cambia de un servicio a otro — como se autoriza, como se pide, como
 * se limpia lo que devuelve — se queda en su carpeta y entra por parametro.
 */

let biblioteca = null;
/** El indice de emparejado cuesta rehacerlo y solo cambia con la biblioteca. */
let indice = null;

const registrados = new Map();

function init({ library }) {
  biblioteca = library;
}

/** La biblioteca cambio: el indice que hubiera ya no vale, para todos. */
function olvidarIndice() {
  indice = null;
}

function getIndice() {
  if (!indice) indice = emparejar.construirIndice(biblioteca?.all() ?? []);
  return indice;
}

const conArte = (x) => ({ ...x, artUrl: x.art ? protocols.artUrl(x.art) : null });

/** Id reservado para "lo guardado", que no es una lista de verdad. */
const GUARDADAS = '__guardadas__';

/**
 * Da de alta un servicio.
 *
 * `auth`, `catalogo` y `cred` son los modulos de su carpeta; `ayuda` es lo
 * que la interfaz necesita contar para que el usuario consiga sus claves.
 */
function registrar({ id, nombre, auth, catalogo, cred, ayuda = {} }) {
  const servicio = {
    id,
    nombre,

    estado() {
      return {
        id,
        nombre,
        clientId: cred.getClientId(),
        hayClientId: !!cred.getClientId(),
        clientSecret: cred.getClientSecret ? cred.getClientSecret() : '',
        conectado: cred.hayCuenta(),
        perfil: cred.getPerfil(),
        sincronizando: !!servicio._enCurso,
        ayuda,
        ...catalogo.resumen(),
      };
    },

    setClientId(valor) {
      const previo = cred.getClientId();
      const nuevo = String(valor || '').trim();
      // Cambiar de aplicacion invalida la sesion: el token de refresco
      // pertenece al Client ID con el que se pidio, y con otro no lo canjea
      // nadie. Dejarlo puesto solo daria un error mas adelante, lejos de la
      // causa.
      if (previo && nuevo !== previo) {
        cred.desconectar();
        catalogo.limpiar();
      }
      cred.setClientId(nuevo);
      return servicio.estado();
    },

    setClientSecret(valor) {
      cred.setClientSecret?.(valor);
      return servicio.estado();
    },

    async conectar() {
      await auth.conectar();
      return servicio.estado();
    },

    desconectar() {
      cred.desconectar();
      catalogo.limpiar();
      return servicio.estado();
    },

    /**
     * Trae el catalogo. Si ya hay una en marcha se devuelve esa misma: el
     * boton se puede pulsar dos veces y dos sincronizaciones a la vez se
     * pisarian al guardar.
     */
    sincronizar({ onProgress } = {}) {
      if (servicio._enCurso) return servicio._enCurso.promesa;

      const control = new AbortController();
      const promesa = catalogo
        .sincronizar({ onProgress, senal: control.signal })
        .then((res) => ({ ok: true, servicio: id, ...res }))
        .catch((err) => ({
          ok: false,
          servicio: id,
          error: err.message,
          sinCuenta: !!err.sinCuenta,
          cuota: !!err.cuota,
          reintentar: !!err.reintentar,
        }))
        .finally(() => {
          servicio._enCurso = null;
        });

      servicio._enCurso = { promesa, control };
      return promesa;
    },

    cancelar() {
      servicio._enCurso?.control.abort();
      return true;
    },

    /** Las listas con el recuento de lo que ya tienes. */
    listas() {
      const d = catalogo.todo();
      const idx = getIndice();

      const salida = d.playlists.map((lista) => {
        let encontradas = 0;
        for (const t of lista.tracks) {
          const pista = d.pistas[t];
          if (pista && emparejar.emparejar(pista, idx)) encontradas++;
        }
        return conArte({
          id: lista.id,
          servicio: id,
          name: lista.name,
          description: lista.description,
          owner: lista.owner,
          propia: lista.propia,
          uri: lista.uri,
          art: lista.art,
          total: lista.tracks.length,
          descartadas: lista.descartadas ?? 0,
          sinAcceso: !!lista.sinAcceso,
          encontradas,
          faltan: lista.tracks.length - encontradas,
        });
      });

      // "Lo guardado" solo se ofrece si el servicio lo tiene: en YouTube la
      // API no llega a los me gusta de YouTube Music, y una entrada siempre
      // vacia en el lateral solo genera la duda de si algo va mal.
      if (d.guardadas?.length) {
        salida.unshift(conArte({
          id: GUARDADAS,
          servicio: id,
          name: ayuda.nombreGuardadas ?? 'Tus me gusta',
          art: null,
          total: d.guardadas.length,
          ...cuentaDe(d.guardadas, d.pistas, idx),
        }));
      }
      return salida;
    },

    /** Una lista con sus canciones, cada una enlazada o marcada como ausente. */
    lista(listaId) {
      const d = catalogo.todo();

      if (listaId === GUARDADAS) {
        const pistas = d.guardadas.map((t) => d.pistas[t]).filter(Boolean);
        const { items, encontradas, faltan } = emparejar.emparejarLista(pistas, getIndice());
        return {
          id: GUARDADAS,
          servicio: id,
          name: ayuda.nombreGuardadas ?? 'Tus me gusta',
          art: null,
          artUrl: null,
          encontradas,
          faltan,
          items: items.map(conArte),
        };
      }

      const encontrada = d.playlists.find((p) => p.id === listaId);
      if (!encontrada) return null;

      const pistas = encontrada.tracks.map((t) => d.pistas[t]).filter(Boolean);
      const { items, encontradas, faltan } = emparejar.emparejarLista(pistas, getIndice());

      return conArte({
        id: encontrada.id,
        servicio: id,
        name: encontrada.name,
        description: encontrada.description,
        owner: encontrada.owner,
        propia: encontrada.propia,
        uri: encontrada.uri,
        art: encontrada.art,
        descartadas: encontrada.descartadas ?? 0,
        sinAcceso: !!encontrada.sinAcceso,
        encontradas,
        faltan,
        items: items.map(conArte),
      });
    },

    _enCurso: null,
  };

  registrados.set(id, servicio);
  return servicio;
}

function cuentaDe(ids, pistas, idx) {
  let encontradas = 0;
  for (const t of ids) {
    const pista = pistas[t];
    if (pista && emparejar.emparejar(pista, idx)) encontradas++;
  }
  return { encontradas, faltan: ids.length - encontradas };
}

const de = (id) => registrados.get(id) ?? null;
const todos = () => [...registrados.values()];
const estados = () => todos().map((s) => s.estado());

module.exports = { init, olvidarIndice, registrar, de, todos, estados, GUARDADAS };
