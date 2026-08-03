/**
 * Estructura de la aplicacion: lateral, carpetas vigiladas, estado de la
 * biblioteca y la capa de arrastrar y soltar.
 */

import { $, el, glifo, pintarGlifo, plural, formatoTiempo } from './dom.js';

const raiz = document.documentElement;

export function initShell(motor) {
  const { queue } = motor;

  const cuerpo = $('#vista-cuerpo');
  const resumen = $('#vista-resumen');
  const listaCarpetas = $('#lista-carpetas');
  const escaneo = $('#escaneo');
  const escaneoTexto = $('#escaneo-texto');

  pintarGlifo($('#icono-canciones'), 'musica');
  pintarGlifo($('#icono-anadir'), 'anadir');
  pintarGlifo($('#icono-abrir'), 'abrir');
  pintarGlifo($('#btn-reescanear'), 'refrescar');
  pintarGlifo($('#soltar-icono'), 'descargar');

  let pistas = [];

  // --- Lateral --------------------------------------------------------------

  const btnPlegar = $('#btn-plegar');
  const iconoPlegar = $('#icono-plegar');

  function pintarPlegado() {
    const plegado = raiz.dataset.lateral === 'plegado';
    pintarGlifo(iconoPlegar, plegado ? 'desplegar' : 'plegar');
    const etiqueta = plegado ? 'Desplegar el panel' : 'Plegar el panel';
    btnPlegar.title = etiqueta;
    btnPlegar.setAttribute('aria-label', etiqueta);
  }

  btnPlegar.addEventListener('click', () => {
    const plegado = raiz.dataset.lateral === 'plegado';
    raiz.dataset.lateral = plegado ? 'abierto' : 'plegado';
    pintarPlegado();
    window.sounde.settings.set({ sidebarCollapsed: !plegado });
  });

  pintarPlegado();

  $('#btn-anadir-carpeta').addEventListener('click', async () => {
    await window.sounde.library.addFolder();
    await refrescar();
  });

  $('#btn-abrir-archivos').addEventListener('click', async () => {
    const tracks = await window.sounde.library.openFiles();
    if (tracks.length) queue.setContext(tracks, { startIndex: 0 });
    await refrescar();
  });

  $('#btn-reescanear').addEventListener('click', async () => {
    await window.sounde.library.scan();
    await refrescar();
  });

  // --- Progreso del escaneo -------------------------------------------------

  window.sounde.library.onProgress((p) => {
    escaneo.hidden = false;
    if (p.phase === 'walk') {
      // Durante el recorrido no se sabe cuantos archivos hay todavia: fingir
      // un porcentaje seria mentir, asi que la barra va de lado a lado.
      escaneo.dataset.indeterminado = 'true';
      escaneoTexto.textContent = `Buscando musica… ${p.done} archivos`;
      return;
    }
    delete escaneo.dataset.indeterminado;
    const fraccion = p.total ? p.done / p.total : 0;
    escaneo.style.setProperty('--valor', String(fraccion));
    escaneoTexto.textContent = `Leyendo etiquetas… ${p.done} de ${p.total}`;
  });

  window.sounde.library.onChanged(() => refrescar());

  // --- Arrastrar y soltar ---------------------------------------------------

  // Se cuenta la profundidad porque dragleave salta tambien al pasar por
  // encima de cualquier hijo, y sin contar la capa parpadea sin parar.
  let profundidad = 0;

  document.addEventListener('dragenter', (e) => {
    if (!llevaArchivos(e)) return;
    profundidad++;
    raiz.dataset.soltando = 'true';
  });

  document.addEventListener('dragleave', () => {
    profundidad = Math.max(0, profundidad - 1);
    if (!profundidad) delete raiz.dataset.soltando;
  });

  document.addEventListener('dragover', (e) => {
    if (!llevaArchivos(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    // Sin esto el navegador navega al archivo soltado, que en una app de
    // escritorio significa perder la interfaz entera.
    e.preventDefault();
    profundidad = 0;
    delete raiz.dataset.soltando;

    const rutas = window.sounde.library.pathsFromDrop(e.dataTransfer?.files ?? []);
    if (!rutas.length) return;
    const tracks = await window.sounde.library.addPaths(rutas);
    if (tracks.length) queue.setContext(tracks, { startIndex: 0 });
    await refrescar();
  });

  // --- Pintado --------------------------------------------------------------

  async function refrescar() {
    pistas = await window.sounde.library.all();
    const carpetas = await window.sounde.library.folders();
    escaneo.hidden = true;
    pintarCarpetas(carpetas);
    pintarResumen();
    pintarCuerpo();
    return pistas;
  }

  function pintarCarpetas(carpetas) {
    listaCarpetas.replaceChildren(...carpetas.map((ruta) => {
      const nombre = ruta.split(/[\\/]/).filter(Boolean).pop() || ruta;
      return el('div', { class: 'carpeta', title: ruta }, [
        el('span', { class: 'lateral__icono', texto: glifo('carpeta') }),
        el('span', { class: 'carpeta__nombre', texto: nombre }),
        el('button', {
          class: 'carpeta__quitar',
          title: 'Dejar de vigilar esta carpeta',
          'aria-label': `Quitar ${nombre}`,
          texto: glifo('quitar'),
          onClick: async () => {
            await window.sounde.library.removeFolder(ruta);
            await refrescar();
          },
        }),
      ]);
    }));
  }

  function pintarResumen() {
    const total = pistas.reduce((s, t) => s + (t.duration || 0), 0);
    resumen.textContent = pistas.length
      ? `${plural(pistas.length, 'cancion', 'canciones')} · ${formatoTiempo(total)}`
      : 'Sin musica todavia';
    const cuenta = $('#cuenta-canciones');
    if (cuenta) cuenta.textContent = pistas.length ? String(pistas.length) : '';
  }

  function pintarCuerpo() {
    if (!pistas.length) {
      cuerpo.replaceChildren(vacio());
      return;
    }
    cuerpo.replaceChildren(resumenBiblioteca());
  }

  function vacio() {
    return el('div', { class: 'vacio' }, [
      el('div', { class: 'vacio__icono', texto: glifo('musica') }),
      el('h2', { class: 'vacio__titulo', texto: 'Aqui no hay musica todavia' }),
      el('p', {
        class: 'vacio__texto',
        texto: 'Anade una carpeta y Sounde la vigila: lo que metas dentro aparece solo la proxima vez que abras. Tambien puedes soltar archivos sobre la ventana.',
      }),
      el('div', { class: 'vacio__acciones' }, [
        el('button', {
          class: 'boton boton--acento',
          onClick: async () => {
            await window.sounde.library.addFolder();
            await refrescar();
          },
        }, [
          el('span', { class: 'boton__icono', texto: glifo('anadir') }),
          el('span', { texto: 'Anadir una carpeta' }),
        ]),
        el('button', {
          class: 'boton',
          onClick: async () => {
            const tracks = await window.sounde.library.openFiles();
            if (tracks.length) queue.setContext(tracks, { startIndex: 0 });
            await refrescar();
          },
        }, [
          el('span', { class: 'boton__icono', texto: glifo('abrir') }),
          el('span', { texto: 'Abrir archivos' }),
        ]),
      ]),
    ]);
  }

  function resumenBiblioteca() {
    return el('div', { class: 'vacio' }, [
      el('div', { class: 'vacio__icono', texto: glifo('musica') }),
      el('h2', { class: 'vacio__titulo', texto: plural(pistas.length, 'cancion lista', 'canciones listas') }),
      el('p', { class: 'vacio__texto', texto: 'Dale a reproducir y suena todo seguido.' }),
      el('div', { class: 'vacio__acciones' }, [
        el('button', {
          class: 'boton boton--acento',
          onClick: () => {
            queue.setShuffle(false);
            queue.setContext(pistas, { startIndex: 0 });
          },
        }, [
          el('span', { class: 'boton__icono', texto: glifo('reproducir') }),
          el('span', { texto: 'Reproducir todo' }),
        ]),
        el('button', {
          class: 'boton',
          onClick: () => {
            queue.setShuffle(true);
            queue.setContext(pistas, { startIndex: Math.floor(Math.random() * pistas.length) });
          },
        }, [
          el('span', { class: 'boton__icono', texto: glifo('aleatorio') }),
          el('span', { texto: 'Aleatorio' }),
        ]),
      ]),
    ]);
  }

  return { refrescar, get pistas() { return pistas; } };
}

/** Un arrastre de texto dentro de la app no debe encender la capa. */
function llevaArchivos(evento) {
  return [...(evento.dataTransfer?.types ?? [])].includes('Files');
}
