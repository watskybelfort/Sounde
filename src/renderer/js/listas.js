/**
 * Listas de reproduccion compartidas.
 *
 * Igual que los favoritos: una sola copia en el renderer y todos los sitios
 * que las enseñan (lateral, submenu de "anadir a", ficha) escuchan el mismo
 * cambio. Con una copia por sitio, crear una lista desde el menu no aparece
 * en el lateral hasta reabrir.
 */

import { crearEmisor } from './emitter.js';

export async function crearListas() {
  const emisor = crearEmisor();
  let listas = (await window.sounde.playlists.all()) ?? [];

  window.sounde.playlists.onChange(({ playlists }) => {
    listas = playlists ?? [];
    emisor.emit('cambio', listas);
  });

  return {
    on: emisor.on.bind(emisor),
    get listas() { return listas; },
    buscar: (id) => listas.find((p) => p.id === id) ?? null,

    crear: (nombre, ids) => window.sounde.playlists.create(nombre, ids ?? []),
    renombrar: (id, nombre) => window.sounde.playlists.rename(id, nombre),
    borrar: (id) => window.sounde.playlists.remove(id),
    anadir: (id, ids) => window.sounde.playlists.add(id, ids),
    quitarEn: (id, indice) => window.sounde.playlists.removeAt(id, indice),
    mover: (id, desde, hasta) => window.sounde.playlists.move(id, desde, hasta),
  };
}

/** Las pistas de una lista, en su orden, saltandose las que ya no existen. */
export function pistasDe(lista, porId) {
  if (!lista) return [];
  return lista.tracks.map((id) => porId.get(id)).filter(Boolean);
}
