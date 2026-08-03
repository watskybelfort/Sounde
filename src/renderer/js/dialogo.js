/**
 * Dialogos modales propios.
 *
 * `prompt` y `confirm` del navegador estan desactivados en Electron y ademas
 * se pintan con el estilo del sistema, que sobre una ventana acrilica canta
 * como una patada. Estos usan el mismo vidrio flotante que los menus.
 */

import { el, glifo } from './dom.js';

export function pedirTexto({ titulo, etiqueta, valor = '', aceptar = 'Guardar', maxLength = 80 } = {}) {
  return new Promise((resolver) => {
    const campo = el('input', {
      class: 'dialogo__campo',
      type: 'text',
      value: valor,
      maxlength: String(maxLength),
      spellcheck: 'false',
      'aria-label': etiqueta ?? titulo,
    });

    const cerrar = montar({
      titulo,
      cuerpo: [etiqueta ? el('label', { class: 'dialogo__etiqueta', texto: etiqueta }) : null, campo],
      aceptar,
      onAceptar: () => resolver(campo.value.trim() || null),
      onCancelar: () => resolver(null),
    });

    campo.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      cerrar();
      resolver(campo.value.trim() || null);
    });

    campo.focus();
    campo.select();
  });
}

export function confirmar({ titulo, texto, aceptar = 'Aceptar', peligro = false } = {}) {
  return new Promise((resolver) => {
    montar({
      titulo,
      cuerpo: [texto ? el('p', { class: 'dialogo__texto', texto }) : null],
      aceptar,
      peligro,
      onAceptar: () => resolver(true),
      onCancelar: () => resolver(false),
    });
  });
}

function montar({ titulo, cuerpo, aceptar, peligro, onAceptar, onCancelar }) {
  const capa = el('div', { class: 'dialogo-capa' });

  const cerrar = () => {
    capa.remove();
    document.removeEventListener('keydown', tecla, true);
  };

  const tecla = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    cerrar();
    onCancelar?.();
  };

  const panel = el('div', { class: 'dialogo flotante', role: 'dialog', 'aria-modal': 'true' }, [
    el('h2', { class: 'dialogo__titulo', texto: titulo }),
    el('div', { class: 'dialogo__cuerpo' }, cuerpo),
    el('div', { class: 'dialogo__acciones' }, [
      el('button', {
        class: 'boton',
        texto: 'Cancelar',
        onClick: () => { cerrar(); onCancelar?.(); },
      }),
      el('button', {
        class: `boton ${peligro ? 'boton--peligro' : 'boton--acento'}`,
        texto: aceptar,
        onClick: () => { cerrar(); onAceptar?.(); },
      }),
    ]),
  ]);

  // Pulsar fuera cancela, pero solo si el gesto empieza Y termina fuera: si
  // no, seleccionar texto y soltar el raton pasado el borde cierra solo.
  capa.addEventListener('pointerdown', (e) => {
    if (e.target !== capa) return;
    const soltar = (ev) => {
      capa.removeEventListener('pointerup', soltar);
      if (ev.target === capa) { cerrar(); onCancelar?.(); }
    };
    capa.addEventListener('pointerup', soltar);
  });

  capa.append(panel);
  document.body.append(capa);
  document.addEventListener('keydown', tecla, true);
  return cerrar;
}
