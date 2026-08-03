/**
 * Favoritos compartidos.
 *
 * El corazon aparece en dos sitios a la vez, en cada fila y en el
 * transporte, y los dos tienen que decir lo mismo siempre. Con cada uno
 * guardando su copia, marcar desde la lista deja el del transporte apagado
 * hasta que cambie de cancion. Aqui hay una sola verdad y ambos la escuchan.
 */

import { crearEmisor } from './emitter.js';

export async function crearFavoritos() {
  const emisor = crearEmisor();
  let ids = new Set();

  const datos = await window.sounde.collections.all();
  ids = new Set(datos.favorites ?? []);

  window.sounde.collections.onChange(({ favorites }) => {
    ids = new Set(favorites ?? []);
    emisor.emit('cambio', ids);
  });

  return {
    on: emisor.on.bind(emisor),
    get ids() { return ids; },
    tiene: (id) => !!id && ids.has(id),
    alternar: (id) => (id ? window.sounde.collections.toggleFavorite(id) : null),
  };
}
