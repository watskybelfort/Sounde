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

module.exports = { Collections };
