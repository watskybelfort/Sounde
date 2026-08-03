/**
 * Estructura de la aplicacion: lateral, vistas de la biblioteca, carpetas
 * vigiladas y la capa de arrastrar y soltar.
 *
 * El estado de navegacion es un objeto plano `{ tipo, clave }` y una sola
 * funcion lo pinta. Con un puñado de banderas booleanas repartidas, entrar
 * en un album desde artistas y volver acaba dejando la cabecera diciendo una
 * cosa y el cuerpo otra.
 */

import { $, el, glifo, pintarGlifo, plural, formatoTiempo } from './dom.js';
import { crearLista } from './lista.js';
import { agruparAlbumes, agruparArtistas } from './agrupar.js';
import {
  rejilla, tarjetaAlbum, tarjetaArtista, fichaAlbum, fichaArtista,
} from './vistas.js';

const raiz = document.documentElement;

const TITULOS = {
  canciones: 'Canciones',
  albumes: 'Albumes',
  artistas: 'Artistas',
};

export function initShell(motor, ajustes = {}) {
  const { queue, player } = motor;

  const cuerpo = $('#vista-cuerpo');
  const tituloVista = $('#vista-titulo');
  const resumen = $('#vista-resumen');
  const listaCarpetas = $('#lista-carpetas');
  const escaneo = $('#escaneo');
  const escaneoTexto = $('#escaneo-texto');
  const acciones = $('#vista-acciones');
  const buscador = $('#buscador');

  pintarGlifo($('#icono-canciones'), 'musica');
  pintarGlifo($('#icono-albumes'), 'album');
  pintarGlifo($('#icono-artistas'), 'artista');
  pintarGlifo($('#icono-anadir'), 'anadir');
  pintarGlifo($('#icono-abrir'), 'abrir');
  pintarGlifo($('#btn-reescanear'), 'refrescar');
  pintarGlifo($('#soltar-icono'), 'descargar');
  pintarGlifo($('#icono-buscar'), 'buscar');
  pintarGlifo($('#btn-tocar-todo'), 'reproducir');
  pintarGlifo($('#btn-tocar-aleatorio'), 'aleatorio');

  let pistas = [];
  let albumes = [];
  let artistas = [];
  let filtro = '';
  let vista = { tipo: TITULOS[ajustes.view] ? ajustes.view : 'canciones' };

  // --- Listas ---------------------------------------------------------------

  const reproducirDesde = (track, _i, visibles) => queue.setContext(visibles, { startId: track.id });

  const lista = crearLista({
    onReproducir: reproducirDesde,
    onOrden: ({ por, dir }) => window.sounde.settings.set({ sortBy: por, sortDir: dir }),
    onFiltrado: () => { if (vista.tipo === 'canciones') pintarResumen(); },
  });
  lista.setOrden(ajustes.sortBy, ajustes.sortDir);

  // Dentro de un album no hay nada que ordenar ni columna de album que
  // enseñar: el orden es el del disco y el album es siempre el mismo.
  const listaAlbum = crearLista({
    onReproducir: reproducirDesde,
    conCabecera: false,
    conAlbum: false,
    conArte: false,
    numerar: 'pista',
    altoFila: 42,
  });
  listaAlbum.setOrden('pista', 'asc');

  const marcarActual = () => {
    const id = player.track?.id ?? null;
    lista.setActual(id, player.playing);
    listaAlbum.setActual(id, player.playing);
  };
  player.on('trackchange', marcarActual);
  player.on('state', marcarActual);

  // --- Navegacion -----------------------------------------------------------

  const navs = {
    canciones: $('#nav-canciones'),
    albumes: $('#nav-albumes'),
    artistas: $('#nav-artistas'),
  };

  for (const [tipo, boton] of Object.entries(navs)) {
    boton.addEventListener('click', () => ir({ tipo }));
  }

  /**
   * Pila de navegacion. Sin ella, entrar en un album desde la ficha de un
   * artista y volver te deja en la rejilla de albumes, que no es de donde
   * venias: se pierde el sitio y hay que rehacer el camino.
   */
  const historial = [];

  function ir(nueva) {
    // Volver a una vista principal reinicia el camino: no tiene sentido
    // acumular pasos que ya no llevan a ningun sitio.
    historial.length = 0;
    aplicarVista(nueva);
  }

  function abrir(ficha) {
    historial.push(vista);
    aplicarVista(ficha);
  }

  function volver() {
    aplicarVista(historial.pop() ?? { tipo: base() });
  }

  function aplicarVista(nueva) {
    vista = nueva;
    filtro = '';
    buscador.value = '';
    lista.setFiltro('');
    if (TITULOS[nueva.tipo]) window.sounde.settings.set({ view: nueva.tipo });
    pintarCuerpo();
  }

  function etiquetaDe(v) {
    if (!v) return TITULOS[base()];
    if (v.tipo === 'album') return v.clave.titulo;
    if (v.tipo === 'artista') return v.clave.nombre;
    return TITULOS[v.tipo];
  }

  /**
   * La seccion en la que se esta navegando, para marcar el lateral y titular
   * la cabecera. Manda el fondo de la pila, no el tipo de la ficha abierta:
   * si entraste por Artistas y desde ahi a un album, sigues en Artistas, y
   * ver el lateral saltar a Albumes se siente como haber cambiado de sitio
   * sin haberlo pedido.
   */
  function base() {
    const inicio = historial[0] ?? vista;
    if (TITULOS[inicio.tipo]) return inicio.tipo;
    return vista.tipo === 'album' ? 'albumes' : vista.tipo === 'artista' ? 'artistas' : 'canciones';
  }

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

  // --- Buscador y acciones de cabecera --------------------------------------

  buscador.addEventListener('input', () => {
    filtro = buscador.value;
    if (vista.tipo === 'canciones') lista.setFiltro(filtro);
    else pintarCuerpo();
  });

  buscador.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    buscador.value = '';
    filtro = '';
    if (vista.tipo === 'canciones') lista.setFiltro('');
    else pintarCuerpo();
    buscador.blur();
  });

  $('#btn-tocar-todo').addEventListener('click', () => reproducir(loQueSeVe(), false));
  $('#btn-tocar-aleatorio').addEventListener('click', () => reproducir(loQueSeVe(), true));

  /** Las pistas de la vista actual, respetando el filtro. */
  function loQueSeVe() {
    if (vista.tipo === 'canciones') return lista.visibles;
    if (vista.tipo === 'albumes') return albumesFiltrados().flatMap((a) => a.pistas);
    if (vista.tipo === 'artistas') return artistasFiltrados().flatMap((a) => a.pistas);
    if (vista.tipo === 'album') return vista.clave?.pistas ?? [];
    if (vista.tipo === 'artista') return vista.clave?.pistas ?? [];
    return pistas;
  }

  function reproducir(lote, aleatorio) {
    if (!lote?.length) return;
    queue.setShuffle(!!aleatorio);
    queue.setContext(lote, {
      startIndex: aleatorio ? Math.floor(Math.random() * lote.length) : 0,
    });
  }

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
    escaneo.style.setProperty('--valor', String(p.total ? p.done / p.total : 0));
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

  // --- Datos ----------------------------------------------------------------

  async function refrescar() {
    pistas = await window.sounde.library.all();
    const carpetas = await window.sounde.library.folders();
    escaneo.hidden = true;

    albumes = agruparAlbumes(pistas);
    artistas = agruparArtistas(pistas);

    // Una ficha abierta puede haber dejado de existir tras un reescaneo.
    if (vista.tipo === 'album') vista = revalidar(albumes, 'albumes');
    else if (vista.tipo === 'artista') vista = revalidar(artistas, 'artistas');

    pintarCarpetas(carpetas);
    lista.setPistas(pistas);
    marcarActual();
    pintarCuerpo();
    return pistas;
  }

  function revalidar(coleccion, vuelta) {
    const encontrado = coleccion.find((x) => x.clave === vista.clave?.clave);
    return encontrado ? { tipo: vista.tipo, clave: encontrado } : { tipo: vuelta };
  }

  const texto = (v) => String(v ?? '').toLowerCase();

  function albumesFiltrados() {
    const q = filtro.trim().toLowerCase();
    if (!q) return albumes;
    return albumes.filter((a) => texto(a.titulo).includes(q) || texto(a.artista).includes(q));
  }

  function artistasFiltrados() {
    const q = filtro.trim().toLowerCase();
    if (!q) return artistas;
    return artistas.filter((a) => texto(a.nombre).includes(q));
  }

  // --- Pintado --------------------------------------------------------------

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
    const cuenta = $('#cuenta-canciones');
    if (cuenta) cuenta.textContent = pistas.length ? String(pistas.length) : '';

    if (!pistas.length) {
      resumen.textContent = 'Sin musica todavia';
      return;
    }

    if (vista.tipo === 'canciones') {
      const visibles = lista.visibles;
      const total = visibles.reduce((s, t) => s + (t.duration || 0), 0);
      const filtrando = visibles.length !== pistas.length;
      resumen.textContent = `${plural(visibles.length, 'cancion', 'canciones')}` +
        `${filtrando ? ` de ${pistas.length}` : ''} · ${formatoTiempo(total)}`;
      cuerpo.dataset.vacio = String(visibles.length === 0);
      return;
    }

    if (vista.tipo === 'albumes') {
      resumen.textContent = plural(albumesFiltrados().length, 'album', 'albumes');
      return;
    }
    if (vista.tipo === 'artistas') {
      resumen.textContent = plural(artistasFiltrados().length, 'artista', 'artistas');
      return;
    }
    // En una ficha la cabecera calla: el titulo grande, el artista, el año y
    // la duracion ya estan a dos centimetros, repetirlos es ruido.
    resumen.textContent = '';
  }

  function pintarCuerpo() {
    const enFicha = vista.tipo === 'album' || vista.tipo === 'artista';

    for (const [tipo, boton] of Object.entries(navs)) {
      boton.setAttribute('aria-current', String(tipo === base()));
    }
    tituloVista.textContent = TITULOS[base()];
    acciones.dataset.ficha = String(enFicha);

    if (!pistas.length) {
      cuerpo.dataset.modo = 'vacio';
      cuerpo.replaceChildren(vacio());
      pintarResumen();
      return;
    }

    if (vista.tipo === 'canciones') pintarCanciones();
    else if (vista.tipo === 'albumes') pintarRejillaAlbumes();
    else if (vista.tipo === 'artistas') pintarRejillaArtistas();
    else if (vista.tipo === 'album') pintarFichaAlbum();
    else pintarFichaArtista();

    pintarResumen();
  }

  function pintarCanciones() {
    cuerpo.dataset.modo = 'lista';
    cuerpo.replaceChildren(lista.nodo, sinResultados());
  }

  function pintarRejillaAlbumes() {
    cuerpo.dataset.modo = 'rejilla';
    const lote = albumesFiltrados();
    if (!lote.length) {
      cuerpo.replaceChildren(sinResultados());
      return;
    }
    cuerpo.replaceChildren(rejilla(lote.map((album) => tarjetaAlbum(album, {
      onAbrir: () => abrir({ tipo: 'album', clave: album }),
      onReproducir: () => reproducir(album.pistas, false),
    }))));
  }

  function pintarRejillaArtistas() {
    cuerpo.dataset.modo = 'rejilla';
    const lote = artistasFiltrados();
    if (!lote.length) {
      cuerpo.replaceChildren(sinResultados());
      return;
    }
    cuerpo.replaceChildren(rejilla(lote.map((artista) => tarjetaArtista(artista, {
      onAbrir: () => abrir({ tipo: 'artista', clave: artista }),
      onReproducir: () => reproducir(artista.pistas, false),
    }))));
  }

  function pintarFichaAlbum() {
    const album = vista.clave;
    cuerpo.dataset.modo = 'detalle';
    const unSoloArtista = album.pistas.every((t) => t.artist === album.pistas[0].artist);
    listaAlbum.nodo.classList.toggle('lista--sin-artista', unSoloArtista);
    listaAlbum.setPistas(album.pistas);
    listaAlbum.setActual(player.track?.id ?? null, player.playing);
    cuerpo.replaceChildren(fichaAlbum(album, {
      onVolver: volver,
      volverA: etiquetaDe(historial[historial.length - 1]),
      onReproducir: () => reproducir(album.pistas, false),
      onAleatorio: () => reproducir(album.pistas, true),
      listaNodo: listaAlbum.nodo,
    }));
  }

  function pintarFichaArtista() {
    const artista = vista.clave;
    cuerpo.dataset.modo = 'rejilla';
    cuerpo.replaceChildren(fichaArtista(artista, {
      onVolver: volver,
      volverA: etiquetaDe(historial[historial.length - 1]),
      onReproducir: () => reproducir(artista.pistas, false),
      onAleatorio: () => reproducir(artista.pistas, true),
      onAbrirAlbum: (album) => abrir({ tipo: 'album', clave: album }),
      onReproducirAlbum: (album) => reproducir(album.pistas, false),
    }));
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

  return { refrescar, ir, lista, get pistas() { return pistas; } };
}

/** Un arrastre de texto dentro de la app no debe encender la capa. */
function llevaArchivos(evento) {
  return [...(evento.dataTransfer?.types ?? [])].includes('Files');
}
