/**
 * Deslizador de tres capas.
 *
 * No es un <input type="range"> porque hacen falta dos rellenos (lo ya
 * descargado y lo ya reproducido) mas un globo con el tiempo bajo el cursor,
 * y el range nativo solo deja pintar uno. A cambio hay que resolver a mano
 * la captura del puntero y el teclado, que es lo que hace esto.
 *
 * Todos los valores van de 0 a 1. Las anchuras se escriben en variables CSS
 * con setProperty, nunca en un atributo style: la CSP no admite estilos en
 * linea, pero el CSSOM si.
 */

import { clamp } from './dom.js';

export function crearBarra(raiz, opciones = {}) {
  const {
    onCambio,     // durante el arrastre
    onSoltar,     // al soltar: el unico momento en que conviene saltar
    onPreview,    // posicion bajo el cursor, para el globo
    paso = 0.02,
    pasoGrande = 0.1,
    directo = false, // true = cada movimiento aplica ya (volumen)
  } = opciones;

  let valor = 0;
  let arrastrando = false;
  let punteroId = null;

  const escribir = (v) => raiz.style.setProperty('--valor', String(v));
  const preview = (v) => {
    raiz.style.setProperty('--preview', String(v));
    onPreview?.(v);
  };

  const posicionDe = (evento) => {
    const r = raiz.getBoundingClientRect();
    if (!r.width) return 0;
    return clamp((evento.clientX - r.left) / r.width, 0, 1);
  };

  const aplicar = (v, avisar) => {
    valor = clamp(v, 0, 1);
    escribir(valor);
    if (avisar) onCambio?.(valor);
  };

  raiz.addEventListener('pointerdown', (evento) => {
    if (evento.button !== 0) return;
    evento.preventDefault();
    arrastrando = true;
    punteroId = evento.pointerId;
    raiz.dataset.arrastrando = 'true';
    raiz.setPointerCapture(punteroId);
    const v = posicionDe(evento);
    preview(v);
    aplicar(v, true);
  });

  raiz.addEventListener('pointermove', (evento) => {
    const v = posicionDe(evento);
    preview(v);
    if (arrastrando) aplicar(v, true);
  });

  const terminar = (evento) => {
    if (!arrastrando) return;
    arrastrando = false;
    delete raiz.dataset.arrastrando;
    if (punteroId !== null && raiz.hasPointerCapture(punteroId)) raiz.releasePointerCapture(punteroId);
    punteroId = null;
    onSoltar?.(valor);
  };

  raiz.addEventListener('pointerup', terminar);
  raiz.addEventListener('pointercancel', terminar);

  raiz.addEventListener('keydown', (evento) => {
    const saltos = {
      ArrowRight: paso, ArrowUp: paso,
      ArrowLeft: -paso, ArrowDown: -paso,
      PageUp: pasoGrande, PageDown: -pasoGrande,
    };
    let destino = null;
    if (evento.key in saltos) destino = valor + saltos[evento.key];
    else if (evento.key === 'Home') destino = 0;
    else if (evento.key === 'End') destino = 1;
    if (destino === null) return;
    evento.preventDefault();
    aplicar(destino, true);
    onSoltar?.(valor);
  });

  const api = {
    get valor() { return valor; },
    get arrastrando() { return arrastrando; },

    /** Actualiza la posicion sin avisar. Se ignora durante el arrastre: si
     *  no, el reloj del reproductor pelearia con el dedo del usuario. */
    setValor(v) {
      if (arrastrando) return;
      valor = clamp(v, 0, 1);
      escribir(valor);
      if (directo) preview(valor);
    },

    setBuffer(v) {
      raiz.style.setProperty('--buffer', String(clamp(v, 0, 1)));
    },

    setDesactivada(si) {
      if (si) raiz.dataset.desactivada = 'true';
      else delete raiz.dataset.desactivada;
      raiz.setAttribute('aria-disabled', String(!!si));
    },

    setAria(valorTexto, ahora, maximo) {
      raiz.setAttribute('aria-valuetext', valorTexto);
      raiz.setAttribute('aria-valuenow', String(Math.round(ahora)));
      raiz.setAttribute('aria-valuemax', String(Math.round(maximo)));
    },
  };

  escribir(0);
  api.setBuffer(0);
  return api;
}
