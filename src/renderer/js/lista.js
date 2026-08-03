/**
 * Lista de canciones con ventana deslizante.
 *
 * Solo se crean las filas que caben en pantalla mas un margen, y se reutilizan
 * los mismos nodos al desplazarse. Pintar la biblioteca entera es comodo hasta
 * que alguien tiene veinte mil pistas: son cientos de miles de nodos, la
 * ventana tarda segundos en abrir y el scroll va a saltos.
 */

import { el, glifo, formatoTiempo, clamp } from './dom.js';

const MARGEN = 6; // filas de sobra arriba y abajo, para que no aparezcan a la vista

export const COLUMNAS = [
  { clave: 'title', etiqueta: 'Titulo' },
  { clave: 'album', etiqueta: 'Album' },
  { clave: 'duration', etiqueta: 'Duracion' },
];

export function crearLista(opciones = {}) {
  const {
    onReproducir,
    altoFila = 52,
    conCabecera = true,
    // 'posicion' numera por el sitio en la lista; 'pista' usa el numero de
    // pista del disco, que es lo unico que tiene sentido dentro de un album.
    numerar = 'posicion',
    conAlbum = true,
    conArte = true,
    onFavorito,
    onMenu,
    onMover,
  } = opciones;

  /**
   * Si un clic solo selecciona o ademas reproduce.
   *
   * Se puede cambiar en caliente (`setUnClic`) porque el ajuste vive en el
   * panel y la lista ya esta montada cuando se toca: rehacerla entera para
   * esto perderia el sitio del desplazamiento y la seleccion.
   */
  let unClic = opciones.unClic ?? true;

  let todas = [];
  let visibles = [];
  let idActual = null;
  let sonando = false;
  let seleccion = -1;
  let orden = { por: 'title', dir: 'asc' };
  let filtro = '';
  let favoritos = new Set();
  const pool = [];

  const filas = el('div', { class: 'lista__espacio' });
  const linea = el('div', { class: 'lista__linea', hidden: true });
  const viewport = el('div', { class: 'lista__viewport', tabindex: '0' }, [filas, linea]);
  const cabecera = conCabecera ? crearCabecera() : null;
  const raiz = el('div', {
    class: `lista${conAlbum ? '' : ' lista--sin-album'}${conArte ? '' : ' lista--sin-arte'}`,
  }, [cabecera?.nodo, viewport]);
  raiz.style.setProperty('--alto-fila', `${altoFila}px`);

  viewport.addEventListener('scroll', pintar, { passive: true });

  // --- Reordenado (solo donde el orden lo decide el usuario) ----------------

  let arrastrando = null;
  let hueco = -1;

  function huecoEn(clientY) {
    const r = viewport.getBoundingClientRect();
    const y = clientY - r.top + viewport.scrollTop;
    // round y no floor: el destino es el hueco ENTRE filas, asi que la mitad
    // de arriba de una fila deja la pista encima y la de abajo, debajo.
    return clamp(Math.round(y / altoFila), 0, visibles.length);
  }

  function finArrastre() {
    arrastrando = null;
    hueco = -1;
    linea.hidden = true;
  }

  if (onMover) {
    viewport.addEventListener('dragover', (e) => {
      if (arrastrando === null) return;
      e.preventDefault();
      // Sin frenarlo, el manejador global de archivos enciende la capa de
      // "suelta la musica aqui" mientras se reordena la lista.
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
      // Al sacar la pista de su sitio, lo que venia detras sube un puesto.
      const destino = arrastrando < hueco ? hueco - 1 : hueco;
      const origen = arrastrando;
      finArrastre();
      if (destino !== origen) onMover(origen, destino);
    });
  }

  // Un redimensionado cambia cuantas filas caben: sin esto, agrandar la
  // ventana deja media pantalla en blanco hasta que alguien toque el scroll.
  const observador = new ResizeObserver(() => pintar());
  observador.observe(viewport);

  viewport.addEventListener('keydown', (e) => {
    if (!visibles.length) return;
    if (e.key === 'ArrowDown') mover(1, e);
    else if (e.key === 'ArrowUp') mover(-1, e);
    else if (e.key === 'Home') irA(0, e);
    else if (e.key === 'End') irA(visibles.length - 1, e);
    else if (e.key === 'Enter' && seleccion >= 0) {
      e.preventDefault();
      lanzar(seleccion);
    }
  });

  function mover(delta, evento) {
    irA(clamp(seleccion + delta, 0, visibles.length - 1), evento);
  }

  function irA(indice, evento) {
    evento.preventDefault();
    seleccion = indice;
    asegurarVisible(indice);
    pintar();
  }

  function asegurarVisible(indice) {
    const arriba = indice * altoFila;
    const abajo = arriba + altoFila;
    if (arriba < viewport.scrollTop) viewport.scrollTop = arriba;
    else if (abajo > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = abajo - viewport.clientHeight;
    }
  }

  function lanzar(indice) {
    const track = visibles[indice];
    if (track) onReproducir?.(track, indice, visibles);
  }

  // --- Cabecera -------------------------------------------------------------

  function crearCabecera() {
    const flechas = new Map();
    const cols = COLUMNAS.map((col) => {
      const flecha = el('span', { class: 'lista__flecha' });
      flechas.set(col.clave, flecha);
      return el('button', {
        class: `lista__col lista__col--${col.clave === 'duration' ? 'fin' : col.clave}`,
        onClick: () => ordenarPor(col.clave),
      }, [el('span', { texto: col.etiqueta }), flecha]);
    });

    const nodo = el('div', { class: 'lista__cabecera' }, [
      el('div', { class: 'lista__col', texto: '#' }),
      cols[0],
      cols[1],
      // Hueco de la columna de favorito. Sin el, cada titulo de columna se
      // desplaza y deja de estar encima de lo que titula.
      el('div'),
      cols[2],
    ]);

    return {
      nodo,
      pintar() {
        for (const [clave, flecha] of flechas) {
          const activa = orden.por === clave;
          flecha.textContent = activa ? glifo(orden.dir === 'asc' ? 'flechaArriba' : 'flechaAbajo') : '';
          const boton = flecha.parentElement;
          if (activa) boton.setAttribute('aria-sort', orden.dir === 'asc' ? 'ascending' : 'descending');
          else boton.removeAttribute('aria-sort');
        }
      },
    };
  }

  function ordenarPor(clave) {
    if (orden.por === clave) orden.dir = orden.dir === 'asc' ? 'desc' : 'asc';
    else orden = { por: clave, dir: 'asc' };
    aplicar();
    opciones.onOrden?.({ ...orden });
  }

  // --- Datos ----------------------------------------------------------------

  function aplicar() {
    const texto = filtro.trim().toLowerCase();
    visibles = texto
      ? todas.filter((t) => coincide(t, texto))
      : [...todas];

    // 'ninguno' respeta el orden con el que llegan. Lo usan las vistas donde
    // el orden ES la informacion, como lo escuchado hace poco: reordenarlo
    // alfabeticamente lo convertiria en otra lista cualquiera.
    if (orden.por !== 'ninguno') {
      const signo = orden.dir === 'asc' ? 1 : -1;
      visibles.sort((a, b) => signo * comparar(a, b, orden.por));
    }

    seleccion = -1;
    viewport.scrollTop = 0;
    filas.style.setProperty('--filas', String(visibles.length));
    cabecera?.pintar();
    pintar();
    opciones.onFiltrado?.(visibles);
  }

  // --- Pintado --------------------------------------------------------------

  function pintar() {
    const alto = viewport.clientHeight || 0;
    const desde = Math.max(0, Math.floor(viewport.scrollTop / altoFila) - MARGEN);
    const hasta = Math.min(visibles.length, Math.ceil((viewport.scrollTop + alto) / altoFila) + MARGEN);
    const cuantas = Math.max(0, hasta - desde);

    while (pool.length < cuantas) {
      const fila = crearFila();
      pool.push(fila);
      filas.append(fila.nodo);
    }
    for (let i = cuantas; i < pool.length; i++) pool[i].nodo.hidden = true;

    for (let i = 0; i < cuantas; i++) {
      const indice = desde + i;
      pool[i].nodo.hidden = false;
      pool[i].pintar(visibles[indice], indice);
    }
  }

  function crearFila() {
    const numero = el('span', { class: 'fila__num-texto tabular' });
    const play = el('span', { class: 'fila__num-play', texto: glifo('reproducir') });
    const ecualizador = el('div', { class: 'fila__ecualizador' }, [
      el('span'), el('span'), el('span'),
    ]);
    const imagen = el('img', { alt: '' });
    const arte = el('div', { class: 'fila__arte' }, [imagen]);
    const titulo = el('div', { class: 'fila__titulo truncar' });
    const artista = el('div', { class: 'fila__artista truncar' });
    const album = el('div', { class: 'fila__album truncar' });
    const duracion = el('div', { class: 'fila__duracion tabular' });
    const favorito = el('button', { class: 'fila__fav' });

    const nodo = el('div', { class: 'fila', role: 'row' }, [
      el('div', { class: 'fila__num' }, [numero, play, ecualizador]),
      el('div', { class: 'fila__principal' }, [
        arte,
        el('div', { class: 'fila__textos' }, [titulo, artista]),
      ]),
      album,
      favorito,
      duracion,
    ]);

    let indiceActual = -1;

    favorito.addEventListener('click', (e) => {
      // Sin frenarlo, marcar un favorito selecciona ademas la fila.
      e.stopPropagation();
      onFavorito?.(visibles[indiceActual]);
    });

    nodo.addEventListener('click', () => {
      seleccion = indiceActual;
      pintar();
      // Con `unClic` puesto, el clic ya suena. El doble clic sigue atado
      // igualmente: si no lo estuviera, quien tenga la costumbre de dar dos
      // veces lanzaria la cancion, la reiniciaria en el acto, y pareceria que
      // se ha trabado.
      if (unClic) lanzar(indiceActual);
    });
    nodo.addEventListener('dblclick', () => lanzar(indiceActual));

    if (onMenu) {
      nodo.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        seleccion = indiceActual;
        pintar();
        onMenu(visibles[indiceActual], indiceActual, e);
      });
    }

    if (onMover) {
      nodo.draggable = true;
      nodo.addEventListener('dragstart', (e) => {
        arrastrando = indiceActual;
        e.dataTransfer.effectAllowed = 'move';
        // Chromium no arranca el arrastre si no se le dan datos.
        e.dataTransfer.setData('text/plain', String(indiceActual));
      });
      nodo.addEventListener('dragend', finArrastre);
    }

    return {
      nodo,
      pintar(track, indice) {
        indiceActual = indice;
        nodo.style.setProperty('--i', String(indice));
        if (!track) return;

        numero.textContent = String(numerar === 'pista' ? (track.trackNo ?? indice + 1) : indice + 1);
        titulo.textContent = track.title;
        artista.textContent = track.artist;
        album.textContent = track.album;
        duracion.textContent = formatoTiempo(track.duration);
        nodo.title = `${track.title} · ${track.artist}`;

        if (track.artUrl) {
          if (imagen.getAttribute('src') !== track.artUrl) imagen.src = track.artUrl;
          imagen.hidden = false;
          arte.dataset.conArte = 'true';
        } else {
          imagen.removeAttribute('src');
          imagen.hidden = true;
          delete arte.dataset.conArte;
        }

        const esFav = favoritos.has(track.id);
        favorito.textContent = glifo(esFav ? 'corazonLleno' : 'corazon');
        favorito.dataset.marcado = String(esFav);
        favorito.title = esFav ? 'Quitar de favoritos' : 'Anadir a favoritos';
        favorito.setAttribute('aria-label', `${esFav ? 'Quitar' : 'Anadir'} ${track.title} ${esFav ? 'de' : 'a'} favoritos`);

        nodo.dataset.id = track.id;
        nodo.dataset.activa = String(track.id === idActual);
        nodo.dataset.sonando = String(sonando);
        nodo.dataset.seleccionada = String(indice === seleccion);
      },
    };
  }

  // --- API ------------------------------------------------------------------

  return {
    nodo: raiz,

    setPistas(lista) {
      todas = lista ?? [];
      aplicar();
    },

    setFiltro(texto) {
      filtro = texto ?? '';
      aplicar();
    },

    /** No hace falta repintar: los oyentes leen la bandera al dispararse. */
    setUnClic(valor) {
      unClic = !!valor;
    },

    setOrden(por, dir) {
      orden = { por: por ?? orden.por, dir: dir ?? orden.dir };
      aplicar();
    },

    setActual(id, estaSonando) {
      idActual = id ?? null;
      sonando = !!estaSonando;
      pintar();
    },

    setFavoritos(ids) {
      favoritos = ids instanceof Set ? ids : new Set(ids ?? []);
      pintar();
    },

    get visibles() { return visibles; },

    get orden() { return { ...orden }; },

    destruir() {
      observador.disconnect();
    },
  };
}

function coincide(track, texto) {
  return (
    track.title.toLowerCase().includes(texto) ||
    track.artist.toLowerCase().includes(texto) ||
    track.album.toLowerCase().includes(texto)
  );
}

/**
 * Comparacion con desempate: ordenar por album y dejar las pistas dentro en
 * orden alfabetico convierte cualquier disco en un revoltijo. Dentro de un
 * album manda el numero de pista.
 */
function comparar(a, b, por) {
  if (por === 'duration') return (a.duration || 0) - (b.duration || 0);

  if (por === 'pista') {
    const disco = (a.discNo || 0) - (b.discNo || 0);
    if (disco) return disco;
    const pista = (a.trackNo || 0) - (b.trackNo || 0);
    if (pista) return pista;
  }

  if (por === 'album') {
    const alb = texto(a.album).localeCompare(texto(b.album), 'es');
    if (alb) return alb;
    const disco = (a.discNo || 0) - (b.discNo || 0);
    if (disco) return disco;
    const pista = (a.trackNo || 0) - (b.trackNo || 0);
    if (pista) return pista;
  }

  if (por === 'artist') {
    const art = texto(a.artist).localeCompare(texto(b.artist), 'es');
    if (art) return art;
  }

  return texto(a.title).localeCompare(texto(b.title), 'es');
}

function texto(v) {
  return String(v ?? '');
}
