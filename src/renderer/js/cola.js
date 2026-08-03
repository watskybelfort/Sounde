/**
 * Panel de cola.
 *
 * Reutiliza la misma ventana deslizante que la lista de canciones: una cola
 * puede tener las mismas veinte mil pistas que la biblioteca, y pintarlas
 * todas cada vez que cambia de cancion es un tiron cada tres minutos.
 *
 * El reordenado calcula el hueco de destino a partir de la posicion del
 * puntero, no del nodo que hay debajo. Con filas recicladas, preguntarle al
 * DOM "sobre que fila estoy" da respuestas que cambian al desplazarse.
 */

import { el, glifo, formatoTiempo, plural, clamp } from './dom.js';

const MARGEN = 5;
const ALTO_FILA = 46;

export function crearCola(queue, player) {
  let items = [];
  let indice = -1;
  let arrastrando = null;
  let hueco = -1;
  const pool = [];

  const filas = el('div', { class: 'cola__espacio' });
  const linea = el('div', { class: 'cola__linea' });
  const viewport = el('div', { class: 'cola__viewport' }, [filas, linea]);

  const cuenta = el('span', { class: 'cola__cuenta' });
  const vacio = el('div', { class: 'cola__vacio' }, [
    el('div', { class: 'vacio__icono', texto: glifo('cola') }),
    el('p', { class: 'vacio__texto', texto: 'La cola esta vacia. Reproduce algo y aparecera aqui lo que viene despues.' }),
  ]);

  const nodo = el('aside', { class: 'cola', 'aria-label': 'Cola de reproduccion' }, [
    el('header', { class: 'cola__cabecera' }, [
      el('span', { class: 'cola__titulo', texto: 'Cola' }),
      cuenta,
      el('button', {
        class: 'icono-btn cola__accion',
        texto: glifo('vaciar'),
        title: 'Vaciar la cola',
        'aria-label': 'Vaciar la cola',
        onClick: () => queue.clear(),
      }),
    ]),
    viewport,
    vacio,
  ]);

  viewport.addEventListener('scroll', pintar, { passive: true });
  new ResizeObserver(() => pintar()).observe(viewport);

  // --- Reordenado -----------------------------------------------------------

  function huecoEn(clientY) {
    const r = viewport.getBoundingClientRect();
    const y = clientY - r.top + viewport.scrollTop;
    // round, no floor: el destino es el hueco ENTRE filas, asi que la mitad
    // de arriba de una fila deja la pista encima y la de abajo, debajo.
    return clamp(Math.round(y / ALTO_FILA), 0, items.length);
  }

  viewport.addEventListener('dragover', (e) => {
    if (arrastrando === null) return;
    e.preventDefault();
    // Sin frenarlo, el manejador global de archivos enciende la capa de
    // "suelta la musica aqui" mientras se reordena la cola.
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    hueco = huecoEn(e.clientY);
    linea.hidden = false;
    linea.style.setProperty('--hueco', String(hueco));
  });

  viewport.addEventListener('drop', (e) => {
    if (arrastrando === null) return;
    e.preventDefault();
    e.stopPropagation();
    // Al sacar la pista de su sitio, todo lo que venia detras sube una
    // posicion: si el destino estaba mas abajo, hay que descontarlo.
    const destino = arrastrando < hueco ? hueco - 1 : hueco;
    if (destino !== arrastrando) queue.move(arrastrando, destino);
    terminarArrastre();
  });

  viewport.addEventListener('dragleave', (e) => {
    if (e.target === viewport) linea.hidden = true;
  });

  function terminarArrastre() {
    arrastrando = null;
    hueco = -1;
    linea.hidden = true;
    delete nodo.dataset.moviendo;
  }

  // --- Pintado --------------------------------------------------------------

  function crearFila() {
    const asa = el('span', { class: 'cola__asa', texto: glifo('asa') });
    const imagen = el('img', { alt: '' });
    const arte = el('div', { class: 'cola__arte' }, [imagen]);
    const titulo = el('div', { class: 'cola__fila-titulo truncar' });
    const artista = el('div', { class: 'cola__fila-artista truncar' });
    const duracion = el('span', { class: 'cola__duracion tabular' });
    const quitar = el('button', {
      class: 'cola__quitar',
      texto: glifo('quitar'),
      title: 'Quitar de la cola',
    });

    const fila = el('div', { class: 'cola__fila', draggable: 'true' }, [
      asa,
      arte,
      el('div', { class: 'cola__textos' }, [titulo, artista]),
      duracion,
      quitar,
    ]);

    let i = -1;

    fila.addEventListener('dragstart', (e) => {
      arrastrando = i;
      nodo.dataset.moviendo = 'true';
      e.dataTransfer.effectAllowed = 'move';
      // Firefox y Chromium exigen datos o el arrastre no arranca.
      e.dataTransfer.setData('text/plain', String(i));
    });
    fila.addEventListener('dragend', terminarArrastre);

    fila.addEventListener('click', (e) => {
      if (e.target === quitar) return;
      queue.playAt(i);
    });

    quitar.addEventListener('click', (e) => {
      e.stopPropagation();
      queue.removeAt(i);
    });

    return {
      nodo: fila,
      pintar(track, indiceFila) {
        i = indiceFila;
        fila.style.setProperty('--i', String(indiceFila));
        if (!track) return;
        titulo.textContent = track.title;
        artista.textContent = track.artist;
        duracion.textContent = formatoTiempo(track.duration);
        fila.title = `${track.title} · ${track.artist}`;
        quitar.setAttribute('aria-label', `Quitar ${track.title} de la cola`);

        if (track.artUrl) {
          if (imagen.getAttribute('src') !== track.artUrl) imagen.src = track.artUrl;
          imagen.hidden = false;
          arte.dataset.conArte = 'true';
        } else {
          imagen.removeAttribute('src');
          imagen.hidden = true;
          delete arte.dataset.conArte;
        }

        fila.dataset.actual = String(indiceFila === indice);
        fila.dataset.pasada = String(indiceFila < indice);
      },
    };
  }

  function pintar() {
    const alto = viewport.clientHeight || 0;
    const desde = Math.max(0, Math.floor(viewport.scrollTop / ALTO_FILA) - MARGEN);
    const hasta = Math.min(items.length, Math.ceil((viewport.scrollTop + alto) / ALTO_FILA) + MARGEN);
    const cuantas = Math.max(0, hasta - desde);

    while (pool.length < cuantas) {
      const fila = crearFila();
      pool.push(fila);
      filas.append(fila.nodo);
    }
    for (let k = cuantas; k < pool.length; k++) pool[k].nodo.hidden = true;
    for (let k = 0; k < cuantas; k++) {
      pool[k].nodo.hidden = false;
      pool[k].pintar(items[desde + k], desde + k);
    }
  }

  function refrescar() {
    const foto = queue.snapshot();
    items = foto.items;
    indice = foto.index;

    const restantes = Math.max(0, items.length - indice - 1);
    cuenta.textContent = items.length
      ? `${plural(restantes, 'cancion por delante', 'canciones por delante')}`
      : '';
    nodo.dataset.vacia = String(!items.length);
    filas.style.setProperty('--filas', String(items.length));
    pintar();
  }

  queue.on('change', refrescar);
  queue.on('track', refrescar);
  player.on('state', pintar);

  refrescar();

  return {
    nodo,
    refrescar,
    /** Lleva la vista a la pista que suena, que es lo que se quiere ver. */
    irAActual() {
      if (indice < 0) return;
      viewport.scrollTop = Math.max(0, indice * ALTO_FILA - viewport.clientHeight / 3);
      pintar();
    },
  };
}
