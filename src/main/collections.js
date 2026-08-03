'use strict';

/**
 * Favoritos, historial y cuentas de escucha.
 *
 * Va en un almacen propio y no dentro de library.json a proposito: la
 * biblioteca se reconstruye entera con cada escaneo y es reemplazable, pero
 * esto es lo unico del programa que el usuario no puede recuperar si se
 * pierde. Separarlos hace imposible que un fallo escaneando se lleve por
 * delante los favoritos.
 *
 * Todo se indexa por el id de pista, que es el hash de su ruta. Mover un
 * archivo de sitio cambia su id y pierde su historial; a cambio, la lista
 * sobrevive a reinicios y a reescaneos sin depender de nada mas.
 */

const VERSION = 1;

/** Cuantas escuchas se recuerdan. De sobra para "reciente" sin engordar. */
const MAX_HISTORIAL = 1000;

class Collections {
  constructor(store) {
    this.store = store;
    this.favorites = new Set(asArray(store.get('favorites', [])));
    this.stats = new Map(Object.entries(store.get('stats', {}) || {}));
    this.history = asArray(store.get('history', []));
    this.playlists = asArray(store.get('playlists', []));
  }

  // --- Favoritos ------------------------------------------------------------

  isFavorite(id) {
    return this.favorites.has(id);
  }

  toggleFavorite(id) {
    if (!id) return false;
    if (this.favorites.has(id)) this.favorites.delete(id);
    else this.favorites.add(id);
    this.persist();
    return this.favorites.has(id);
  }

  setFavorite(id, valor) {
    if (!id) return false;
    if (valor) this.favorites.add(id);
    else this.favorites.delete(id);
    this.persist();
    return !!valor;
  }

  favoriteIds() {
    return [...this.favorites];
  }

  // --- Escuchas -------------------------------------------------------------

  /**
   * Anota una escucha. La llama el renderer cuando la pista ya ha sonado lo
   * suficiente, no al empezar: contando desde el primer segundo, pasar diez
   * canciones seguidas buscando una deja diez escuchas falsas.
   */
  played(id, at = Date.now()) {
    if (!id) return null;
    const previo = this.stats.get(id) ?? { plays: 0, lastPlayed: 0, firstPlayed: at };
    const actualizado = {
      plays: previo.plays + 1,
      lastPlayed: at,
      firstPlayed: previo.firstPlayed ?? at,
    };
    this.stats.set(id, actualizado);

    // El historial guarda cada escucha, no solo la ultima: sirve para "lo de
    // esta semana" y para deshacer el orden de reproduccion de una tarde.
    this.history.push({ id, at });
    if (this.history.length > MAX_HISTORIAL) {
      this.history.splice(0, this.history.length - MAX_HISTORIAL);
    }

    this.persist();
    return actualizado;
  }

  statsOf(id) {
    return this.stats.get(id) ?? null;
  }

  /** Ids escuchados de mas reciente a mas antiguo, sin repetir. */
  recentIds(limite = 200) {
    const vistos = new Set();
    const salida = [];
    for (let i = this.history.length - 1; i >= 0 && salida.length < limite; i--) {
      const { id } = this.history[i];
      if (vistos.has(id)) continue;
      vistos.add(id);
      salida.push(id);
    }
    return salida;
  }

  // --- Listas de reproduccion -----------------------------------------------

  /**
   * Una lista guarda ids, no rutas ni pistas enteras. Guardando la pista
   * completa, editar sus etiquetas dejaria la lista mostrando los datos
   * viejos para siempre.
   */
  createPlaylist(name, trackIds = []) {
    const lista = {
      id: nuevoId(),
      name: nombreLibre(this.playlists, name),
      tracks: [...new Set(asArray(trackIds))],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.playlists.push(lista);
    this.persist();
    return lista;
  }

  renamePlaylist(id, name) {
    const lista = this.findPlaylist(id);
    if (!lista) return null;
    lista.name = nombreLibre(this.playlists.filter((p) => p.id !== id), name);
    lista.updatedAt = Date.now();
    this.persist();
    return lista;
  }

  removePlaylist(id) {
    const antes = this.playlists.length;
    this.playlists = this.playlists.filter((p) => p.id !== id);
    if (this.playlists.length !== antes) this.persist();
    return antes !== this.playlists.length;
  }

  findPlaylist(id) {
    return this.playlists.find((p) => p.id === id) ?? null;
  }

  addToPlaylist(id, trackIds) {
    const lista = this.findPlaylist(id);
    if (!lista) return null;
    // Sin filtrar repetidos, arrastrar el mismo album dos veces deja la lista
    // con todo duplicado y sin forma comoda de limpiarlo.
    const ya = new Set(lista.tracks);
    const nuevos = asArray(trackIds).filter((t) => t && !ya.has(t));
    lista.tracks.push(...nuevos);
    lista.updatedAt = Date.now();
    this.persist();
    return { lista, anadidas: nuevos.length, repetidas: asArray(trackIds).length - nuevos.length };
  }

  removeFromPlaylist(id, indice) {
    const lista = this.findPlaylist(id);
    if (!lista || indice < 0 || indice >= lista.tracks.length) return null;
    lista.tracks.splice(indice, 1);
    lista.updatedAt = Date.now();
    this.persist();
    return lista;
  }

  movePlaylistTrack(id, desde, hasta) {
    const lista = this.findPlaylist(id);
    if (!lista) return null;
    if (desde < 0 || desde >= lista.tracks.length) return lista;
    const destino = Math.max(0, Math.min(hasta, lista.tracks.length - 1));
    const [pieza] = lista.tracks.splice(desde, 1);
    lista.tracks.splice(destino, 0, pieza);
    lista.updatedAt = Date.now();
    this.persist();
    return lista;
  }

  setPlaylistTracks(id, trackIds) {
    const lista = this.findPlaylist(id);
    if (!lista) return null;
    lista.tracks = [...new Set(asArray(trackIds))];
    lista.updatedAt = Date.now();
    this.persist();
    return lista;
  }

  // --- Serializacion --------------------------------------------------------

  all() {
    return {
      version: VERSION,
      favorites: this.favoriteIds(),
      stats: Object.fromEntries(this.stats),
      history: this.history,
      playlists: this.playlists,
    };
  }

  /** Quita de favoritos e historial lo que ya no existe en la biblioteca. */
  prune(idsVivos) {
    const vivos = idsVivos instanceof Set ? idsVivos : new Set(idsVivos);
    let cambios = 0;

    for (const id of [...this.favorites]) {
      if (!vivos.has(id)) {
        this.favorites.delete(id);
        cambios++;
      }
    }
    for (const id of [...this.stats.keys()]) {
      if (!vivos.has(id)) {
        this.stats.delete(id);
        cambios++;
      }
    }
    const antes = this.history.length;
    this.history = this.history.filter((h) => vivos.has(h.id));
    cambios += antes - this.history.length;

    if (cambios) this.persist();
    return cambios;
  }

  persist() {
    this.store.merge(this.all());
  }
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function nuevoId() {
  return require('node:crypto').randomUUID();
}

/**
 * Dos listas con el mismo nombre son indistinguibles en el lateral y una de
 * las dos se vuelve imposible de encontrar. Se numera la repetida.
 */
function nombreLibre(listas, propuesto) {
  const base = String(propuesto ?? '').trim() || 'Lista nueva';
  const usados = new Set(listas.map((p) => p.name.toLowerCase()));
  if (!usados.has(base.toLowerCase())) return base;
  for (let n = 2; n < 999; n++) {
    const intento = `${base} ${n}`;
    if (!usados.has(intento.toLowerCase())) return intento;
  }
  return `${base} ${Date.now()}`;
}

module.exports = { Collections };
