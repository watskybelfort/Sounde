/**
 * Atajos de teclado.
 *
 * La regla que evita el 90 % de los problemas: si el foco esta en un campo de
 * texto, el teclado es del campo. Sin eso, escribir "sonata" en el buscador
 * silencia el sonido con la 's', marca un favorito con la 'f' y salta de
 * cancion con las flechas.
 */

const CAMPOS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function initAtajos(acciones, { alPulsar } = {}) {
  const porTecla = acciones.filter((a) => a.tecla);

  function escribiendo() {
    const el = document.activeElement;
    if (!el) return false;
    return CAMPOS.has(el.tagName) || el.isContentEditable;
  }

  document.addEventListener('keydown', (evento) => {
    // Un dialogo o un menu abiertos se quedan con el teclado: dispararle un
    // atajo global a alguien que esta confirmando un borrado es peligroso.
    if (document.querySelector('.dialogo-capa, .menu')) return;

    // El panel de ajustes es como la paleta: solo responde el suyo, que sirve
    // para cerrarlo. Si no, la 'm' de un campo o la barra espaciadora sobre un
    // deslizador harian dos cosas a la vez.
    const enAjustes = !!document.querySelector('.ajustes-capa');

    // La paleta de comandos es una excepcion parcial: mientras esta abierta
    // solo responde su propio atajo, que sirve para cerrarla.
    const enPaleta = !!document.querySelector('.comandos-capa');

    if (evento.repeat && evento.key === ' ') return;

    for (const accion of porTecla) {
      if (!coincide(evento, accion.tecla)) continue;
      if (enPaleta && !accion.siempre) continue;
      if (enAjustes && accion.id !== 'ajustes') continue;

      // Los atajos sin modificador solo valen fuera de un campo de texto. Los
      // que llevan Ctrl si funcionan siempre: Ctrl+F para buscar tiene que
      // valer aunque el foco ya este en el buscador.
      const simple = !accion.tecla.ctrl && !accion.tecla.alt;
      if (simple && escribiendo()) continue;

      evento.preventDefault();
      accion.ejecutar();
      alPulsar?.(accion);
      return;
    }
  });

  return { acciones };
}

function coincide(evento, spec) {
  if (!!spec.ctrl !== (evento.ctrlKey || evento.metaKey)) return false;
  if (!!spec.shift !== evento.shiftKey) return false;
  if (!!spec.alt !== evento.altKey) return false;
  // Comparacion sin distinguir mayusculas: con Bloq Mayus puesto, `key` llega
  // como 'M' y el atajo dejaria de responder sin motivo aparente.
  return String(evento.key).toLowerCase() === String(spec.key).toLowerCase();
}
