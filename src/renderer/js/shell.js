/**
 * Estructura de la aplicacion: lateral, carpetas vigiladas, estado de la
 * biblioteca y la capa de arrastrar y soltar.
 */

import { $, el, glifo, pintarGlifo, plural, formatoTiempo } from './dom.js';
import { crearLista } from './lista.js';

const raiz = document.documentElement;

export function initShell(motor, ajustes = {}) {
  const { queue, player } = motor;

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
  pintarGlifo($('#icono-buscar'), 'buscar');
  pintarGlifo($('#btn-tocar-todo'), 'reproducir');
  pintarGlifo($('#btn-tocar-aleatorio'), 'aleatorio');

  let pistas = [];

  // --- Lista ----------------------------------------------------------------

  const lista = crearLista({
    // Reproducir desde la lista hace que la cola SEA la lista tal y como se
    // ve: filtrada y ordenada. Encolar la biblioteca entera haria que la
    // siguiente cancion saliera de la nada respecto a lo que hay en pantalla.
    onReproducir: (track, _i, visibles) => queue.setContext(visibles, { startId: track.id }),
    onOrden: ({ por, dir }) => window.sounde.settings.set({ sortBy: por, sortDir: dir }),
    onFiltrado: (visibles) => pintarResumen(visibles),
  });

  lista.setOrden(ajustes.sortBy, ajustes.sortDir);

  const buscador = $('#buscador');
  buscador.addEventListener('input', () => lista.setFiltro(buscador.value));
  buscador.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    buscador.value = '';
    lista.setFiltro('');
    buscador.blur();
  });

  $('#btn-tocar-todo').addEventListener('click', () => {
    if (!lista.visibles.length) return;
    queue.setShuffle(false);
    queue.setContext(lista.visibles, { startIndex: 0 });
  });

  $('#btn-tocar-aleatorio').addEventListener('click', () => {
    if (!lista.visibles.length) return;
    queue.setShuffle(true);
    queue.setContext(lista.visibles, { startIndex: Math.floor(Math.random() * lista.visibles.length) });
  });

  const marcarActual = () => lista.setActual(player.track?.id ?? null, player.playing);
  player.on('trackchange', marcarActual);
  player.on('state', marcarActual);

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
    lista.setPistas(pistas);
    marcarActual();
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

  function pintarResumen(visibles = pistas) {
    const total = visibles.reduce((s, t) => s + (t.duration || 0), 0);
    const filtrando = visibles.length !== pistas.length;
    resumen.textContent = !pistas.length
      ? 'Sin musica todavia'
      : `${plural(visibles.length, 'cancion', 'canciones')}${filtrando ? ` de ${pistas.length}` : ''} · ${formatoTiempo(total)}`;

    const cuenta = $('#cuenta-canciones');
    if (cuenta) cuenta.textContent = pistas.length ? String(pistas.length) : '';

    // Buscar y no encontrar nada tiene que decirlo: una lista vacia sin
    // explicacion se lee como que la biblioteca se ha perdido.
    const sinResultados = pistas.length > 0 && visibles.length === 0;
    $('#btn-tocar-todo').disabled = !visibles.length;
    $('#btn-tocar-aleatorio').disabled = !visibles.length;
    if (cuerpo.dataset.modo === 'lista') {
      cuerpo.dataset.vacio = String(sinResultados);
    }
  }

  function pintarCuerpo() {
    if (!pistas.length) {
      cuerpo.dataset.modo = 'vacio';
      cuerpo.replaceChildren(vacio());
      return;
    }
    if (cuerpo.dataset.modo !== 'lista') {
      cuerpo.dataset.modo = 'lista';
      cuerpo.replaceChildren(lista.nodo, sinResultados());
    }
    pintarResumen(lista.visibles);
  }

  function sinResultados() {
    return el('div', { class: 'vacio vacio--busqueda' }, [
      el('div', { class: 'vacio__icono', texto: glifo('buscar') }),
      el('h2', { class: 'vacio__titulo', texto: 'Nada coincide' }),
      el('p', { class: 'vacio__texto', texto: 'Prueba con otra palabra: se busca en titulo, artista y album.' }),
    ]);
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

  return { refrescar, lista, get pistas() { return pistas; } };
}

/** Un arrastre de texto dentro de la app no debe encender la capa. */
function llevaArchivos(evento) {
  return [...(evento.dataTransfer?.types ?? [])].includes('Files');
}
