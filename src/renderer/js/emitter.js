/**
 * Emisor de eventos minimo.
 *
 * `on` devuelve la funcion para darse de baja, igual que los canales del
 * preload, para que suscribirse y limpiar se escriba siempre igual en toda
 * la app.
 */
export function crearEmisor() {
  const canales = new Map();

  return {
    on(evento, fn) {
      let oyentes = canales.get(evento);
      if (!oyentes) {
        oyentes = new Set();
        canales.set(evento, oyentes);
      }
      oyentes.add(fn);
      return () => oyentes.delete(fn);
    },

    once(evento, fn) {
      const baja = this.on(evento, (datos) => {
        baja();
        fn(datos);
      });
      return baja;
    },

    emit(evento, datos) {
      const oyentes = canales.get(evento);
      if (!oyentes) return;
      // Copia: un oyente puede darse de baja dentro de su propia llamada.
      for (const fn of [...oyentes]) {
        try {
          fn(datos);
        } catch (err) {
          // Un oyente que revienta no puede parar la reproduccion: si el
          // 'time' de la UI falla, la cancion tiene que seguir sonando.
          console.error(`[emisor] fallo en '${evento}':`, err);
        }
      }
    },

    clear() {
      canales.clear();
    },
  };
}
