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
  rejilla, tarjetaAlbum, tarjetaArtista, fichaAlbum, fichaArtista, fichaLista,
} from './vistas.js';
import { pistasDe } from './listas.js';
import { abrirMenu } from './menu.js';
import { pedirTexto, confirmar } from './dialogo.js';
import { crearLetra } from './letra.js';
import { crearVistaCatalogo } from './catalogo.js';

const raiz = document.documentElement;

const TITULOS = {
  canciones: 'Canciones',
  albumes: 'Albumes',
  artistas: 'Artistas',
  favoritos: 'Favoritos',
  recientes: 'Recientes',
};

export function initShell(motor, ajustes = {}, { favoritos, listas } = {}) {
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
  pintarGlifo($('#icono-favoritos'), 'corazonLleno');
  pintarGlifo($('#icono-recientes'), 'reciente');
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
  let recientes = [];
  let filtro = '';
  let vista = { tipo: TITULOS[ajustes.view] ? ajustes.view : 'canciones' };

  // --- Listas ---------------------------------------------------------------

  const reproducirDesde = (track, _i, visibles) => queue.setContext(visibles, { startId: track.id });

  const alternarFavorito = (track) => favoritos?.alternar(track?.id);

  const lista = crearLista({
    onReproducir: reproducirDesde,
    onFavorito: alternarFavorito,
    onMenu: menuDePista,
    // Reordenar solo tiene sentido en una lista propia; en la biblioteca el
    // orden lo decide la columna por la que se ordena.
    onMover: (desde, hasta) => {
      if (vista.tipo !== 'lista') return;
      listas?.mover(vista.clave.id, desde, hasta);
    },
    onOrden: ({ por, dir }) => {
      // El orden solo se guarda desde Canciones. En Recientes o Favoritos el
      // orden es de la vista, no del gusto del usuario para la biblioteca.
      if (vista.tipo === 'canciones') window.sounde.settings.set({ sortBy: por, sortDir: dir });
    },
    onFiltrado: () => pintarResumen(),
    unClic: ajustes.clickToPlay !== false,
  });
  lista.setOrden(ajustes.sortBy, ajustes.sortDir);

  // Dentro de un album no hay nada que ordenar ni columna de album que
  // enseñar: el orden es el del disco y el album es siempre el mismo.
  const listaAlbum = crearLista({
    onReproducir: reproducirDesde,
    onFavorito: alternarFavorito,
    onMenu: menuDePista,
    conCabecera: false,
    conAlbum: false,
    conArte: false,
    numerar: 'pista',
    altoFila: 42,
    unClic: ajustes.clickToPlay !== false,
  });
  listaAlbum.setOrden('pista', 'asc');

  const marcarActual = () => {
    const id = player.track?.id ?? null;
    lista.setActual(id, player.playing);
    listaAlbum.setActual(id, player.playing);
  };
  player.on('trackchange', marcarActual);
  player.on('state', marcarActual);

  favoritos?.on('cambio', (ids) => {
    lista.setFavoritos(ids);
    listaAlbum.setFavoritos(ids);
    pintarCuentaFavoritos();
    // Quitar un favorito estando en la vista de Favoritos tiene que sacarlo
    // de la lista en el momento, no a la siguiente visita.
    if (vista.tipo === 'favoritos') pintarCuerpo();
  });

  // --- Canciones escondidas -------------------------------------------------

  /**
   * Canciones que el usuario no quiere ver.
   *
   * Esconder NO borra el archivo. Sounde no tiene por que decidir que se
   * queda en la carpeta de nadie, y borrar de verdad desde un menu contextual
   * seria irreversible al primer resbalon. Lo que se guarda es el id, que se
   * filtra nada mas cargar la biblioteca: a partir de ahi la cancion no esta
   * en canciones, ni en albumes, ni en artistas, ni en recientes, ni en lo
   * que se cruza contra los servicios, y vuelve entera al deshacerlo.
   *
   * Por id y no por ruta porque el id ya identifica al archivo y sobrevive a
   * un reescaneo de la carpeta.
   */
  let pistasEscondidas = new Set(ajustes.hiddenTracks ?? []);

  const cuantasEscondidas = () => pistasEscondidas.size;

  async function esconderPista(track) {
    if (!track || pistasEscondidas.has(track.id)) return;
    pistasEscondidas.add(track.id);
    await guardarPistasEscondidas();
  }

  async function mostrarPistasEscondidas() {
    if (!pistasEscondidas.size) return;
    pistasEscondidas = new Set();
    await guardarPistasEscondidas();
  }

  async function guardarPistasEscondidas() {
    window.sounde.settings.set({ hiddenTracks: [...pistasEscondidas] });
    sacarDeLaCola();
    await refrescar();
  }

  /*
   * Esconderla y dejarla sonando seria lo mas raro que puede hacer esto: la
   * cancion ya no esta en ninguna lista pero sigue saliendo por los altavoces
   * y en la barra de reproduccion. Se recorre al reves para que quitar una no
   * mueva el indice de las que quedan por mirar.
   */
  function sacarDeLaCola() {
    const items = queue.snapshot?.().items ?? [];
    for (let i = items.length - 1; i >= 0; i--) {
      if (pistasEscondidas.has(items[i]?.id)) queue.removeAt(i);
    }
  }

  // --- Menu contextual de pista ---------------------------------------------

  function menuDePista(track, _indice, evento) {
    if (!track) return;
    const esFav = !!favoritos?.tiene(track.id);
    const album = albumes.find((a) => a.pistas.some((t) => t.id === track.id));
    const artista = artistas.find((a) => a.nombre === (track.albumArtist || track.artist));

    abrirMenu([
      { texto: 'Reproducir', icono: 'reproducir', onClick: () => reproducirDesde(track, 0, lista.visibles) },
      { texto: 'Reproducir a continuacion', icono: 'siguiente', onClick: () => queue.addNext([track]) },
      { texto: 'Anadir a la cola', icono: 'cola', onClick: () => queue.addLast([track]) },
      { separador: true },
      {
        texto: esFav ? 'Quitar de favoritos' : 'Anadir a favoritos',
        icono: esFav ? 'corazonLleno' : 'corazon',
        activo: esFav,
        onClick: () => favoritos?.alternar(track.id),
      },
      { texto: 'Anadir a una lista', icono: 'lista', submenu: () => submenuListas([track.id]) },
      vista.tipo === 'lista'
        ? {
          texto: 'Quitar de esta lista',
          icono: 'quitar',
          // El indice real es el de la lista guardada, no el de la fila: con
          // un filtro puesto no coinciden y se borraria otra cancion.
          onClick: () => listas?.quitarEn(vista.clave.id, vista.clave.tracks.indexOf(track.id)),
        }
        : null,
      { separador: true },
      album ? { texto: 'Ir al album', icono: 'album', onClick: () => abrir({ tipo: 'album', clave: album }) } : null,
      artista ? { texto: 'Ir al artista', icono: 'artista', onClick: () => abrir({ tipo: 'artista', clave: artista }) } : null,
      { texto: 'Abrir la ubicacion', icono: 'carpeta', onClick: () => window.sounde.library.reveal(track.path) },
      { separador: true },
      {
        texto: 'Esconder de la aplicacion',
        icono: 'quitar',
        // No lleva `peligro` a proposito: se pinta en rojo lo que no se puede
        // deshacer, y esto se deshace desde Ajustes con un boton.
        onClick: () => esconderPista(track),
      },
    ], { x: evento.clientX, y: evento.clientY });
  }

  function submenuListas(ids) {
    const propias = listas?.listas ?? [];
    return [
      {
        texto: 'Lista nueva…',
        icono: 'anadir',
        onClick: async () => {
          const nombre = await pedirTexto({
            titulo: 'Nueva lista',
            etiqueta: 'Nombre de la lista',
            valor: 'Lista nueva',
            aceptar: 'Crear',
          });
          if (nombre) await listas?.crear(nombre, ids);
        },
      },
      propias.length ? { separador: true } : null,
      ...propias.map((p) => ({
        texto: p.name,
        icono: 'lista',
        onClick: () => listas?.anadir(p.id, ids),
      })),
    ].filter(Boolean);
  }

  function menuDeLista(playlist, evento) {
    abrirMenu([
      {
        texto: 'Renombrar',
        icono: 'renombrar',
        onClick: async () => {
          const nombre = await pedirTexto({
            titulo: 'Renombrar la lista',
            etiqueta: 'Nombre',
            valor: playlist.name,
          });
          if (nombre) await listas?.renombrar(playlist.id, nombre);
        },
      },
      {
        texto: 'Exportar a m3u…',
        icono: 'exportar',
        onClick: () => window.sounde.playlists.exportar(playlist.id),
      },
      { separador: true },
      {
        texto: 'Borrar la lista',
        icono: 'papelera',
        peligro: true,
        onClick: async () => {
          const seguro = await confirmar({
            titulo: `Borrar "${playlist.name}"`,
            texto: 'La lista desaparece. Las canciones siguen en la biblioteca.',
            aceptar: 'Borrar',
            peligro: true,
          });
          if (!seguro) return;
          await listas?.borrar(playlist.id);
          ir({ tipo: 'canciones' });
        },
      },
    ], { x: evento.clientX, y: evento.clientY });
  }

  $('#btn-nueva-lista').addEventListener('click', (evento) => {
    abrirMenu([
      {
        texto: 'Lista nueva…',
        icono: 'anadir',
        onClick: async () => {
          const nombre = await pedirTexto({
            titulo: 'Nueva lista',
            etiqueta: 'Nombre de la lista',
            valor: 'Lista nueva',
            aceptar: 'Crear',
          });
          if (nombre) await listas?.crear(nombre, []);
        },
      },
      {
        texto: 'Importar un m3u…',
        icono: 'importar',
        onClick: async () => {
          const creadas = await window.sounde.playlists.importar();
          if (!creadas?.length) return;
          // Decir cuantas se han quedado por el camino evita la sensacion de
          // que la importacion "ha ido mal" cuando faltan archivos.
          const perdidas = creadas.reduce((s, c) => s + (c.enElArchivo - c.encontradas), 0);
          if (perdidas) {
            await confirmar({
              titulo: 'Lista importada',
              texto: `${perdidas} de las canciones del archivo no estan en el disco y se han quedado fuera.`,
              aceptar: 'Entendido',
            });
          }
          await refrescar();
        },
      },
    ], { x: evento.clientX, y: evento.clientY });
  });

  listas?.on('cambio', () => {
    pintarListas();
    // Si la lista abierta acaba de cambiar, hay que repintarla con lo nuevo.
    if (vista.tipo === 'lista') {
      const viva = listas.buscar(vista.clave.id);
      if (!viva) ir({ tipo: 'canciones' });
      else {
        vista = { tipo: 'lista', clave: viva };
        pintarCuerpo();
      }
    }
  });

  // --- Navegacion -----------------------------------------------------------

  const navs = {
    canciones: $('#nav-canciones'),
    albumes: $('#nav-albumes'),
    artistas: $('#nav-artistas'),
    favoritos: $('#nav-favoritos'),
    recientes: $('#nav-recientes'),
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

  /** Quien quiera enterarse de los cambios de vista (el boton de la letra). */
  const oyentesVista = [];
  const onVista = (fn) => {
    oyentesVista.push(fn);
    return () => oyentesVista.splice(oyentesVista.indexOf(fn), 1);
  };

  function aplicarVista(nueva) {
    vista = nueva;
    filtro = '';
    buscador.value = '';
    lista.setFiltro('');
    if (TITULOS[nueva.tipo]) window.sounde.settings.set({ view: nueva.tipo });
    pintarCuerpo();
    for (const fn of oyentesVista) {
      try {
        fn(vista);
      } catch (err) {
        console.warn('[shell] un oyente de vista fallo:', err.message);
      }
    }
    // Al entrar en Recientes se relee el historial: puede haber cambiado
    // desde la ultima vez sin que nadie tocara la biblioteca.
    if (nueva.tipo === 'recientes') {
      refrescarRecientes().then(() => {
        if (vista.tipo === 'recientes') pintarCuerpo();
      });
    }
  }

  function etiquetaDe(v) {
    if (!v) return TITULOS[base()] ?? 'Canciones';
    if (v.tipo === 'album') return v.clave.titulo;
    if (v.tipo === 'artista') return v.clave.nombre;
    if (v.tipo === 'lista') return v.clave.name;
    if (v.tipo === 'letra') return 'Letra';
    if (v.tipo === 'catalogo') return vistaCatalogo.datos?.name ?? 'Catalogo';
    return TITULOS[v.tipo] ?? 'Canciones';
  }

  // --- Letra ----------------------------------------------------------------

  /**
   * La letra NO esta en TITULOS a proposito: no es una seccion de la
   * biblioteca. Se abre encima de donde estes y al volver sigues ahi, que es
   * lo que quiere quien la abre a media escucha. Por lo mismo no se guarda
   * como vista de arranque: reabrir la app en la letra de nada seria absurdo.
   */
  const letra = crearLetra({ player });

  // --- Servicios de catalogo (Spotify, YouTube) -----------------------------

  /**
   * Las listas de los servicios conectados.
   *
   * Como la letra, no estan en TITULOS: no son secciones de la biblioteca
   * local, y guardar una como vista de arranque haria que Sounde abriera en
   * una lista remota vacia mientras se sincroniza.
   *
   * La vista es UNA sola para todos los servicios. Lo que llega del proceso
   * principal ya viene normalizado, asi que a partir de aqui una lista de
   * YouTube y una de Spotify son la misma cosa.
   */
  const vistaCatalogo = crearVistaCatalogo({
    queue,
    listas,
    // La vista solo guarda el id local; la pista de verdad la tiene el shell.
    resolver: (id) => pistas.find((t) => t.id === id) ?? null,
  });

  /** { id, nombre, conectado, listas: [...] } por servicio. */
  let servicios = [];
  const contenedorServicios = $('#grupos-servicios');

  /**
   * Listas escondidas, por servicio.
   *
   * Esconder es local y NO toca nada en la cuenta del usuario: los permisos
   * que pide Sounde son de solo lectura, asi que aunque quisiera no podria
   * borrar una lista de Spotify ni de YouTube. Lo que se guarda aqui es
   * simplemente que no salga en el lateral.
   */
  let escondidas = { ...(ajustes.hiddenPlaylists ?? {}) };

  const estaEscondida = (svc, id) => (escondidas[svc] ?? []).includes(id);

  function esconder(svc, id) {
    const suyas = new Set(escondidas[svc] ?? []);
    suyas.add(id);
    guardarEscondidas({ ...escondidas, [svc]: [...suyas] });
  }

  function mostrarTodas(svc) {
    const copia = { ...escondidas };
    delete copia[svc];
    guardarEscondidas(copia);
  }

  function guardarEscondidas(nuevo) {
    escondidas = nuevo;
    window.sounde.settings.set({ hiddenPlaylists: nuevo });
    // Si estabas dentro de la que acabas de esconder, no tiene sentido
    // quedarse mirandola con el lateral ya sin ella.
    if (vista.tipo === 'catalogo' && estaEscondida(vista.clave?.servicio, vista.clave?.lista)) {
      ir({ tipo: 'canciones' });
    } else {
      pintarServicios();
    }
  }

  /**
   * Servicios con el grupo plegado en el lateral.
   *
   * Esconder listas de una en una no resuelve el caso de tener YouTube
   * conectado con veinte listas y querer, hoy, mirar solo lo local: habria
   * que esconderlas todas y volver a mostrarlas manana. Plegar es lo otro,
   * y es lo que hace falta — el servicio sigue entero, solo que ocupa una
   * linea en vez de veinte.
   */
  let serviciosPlegados = new Set(ajustes.collapsedServices ?? []);

  function alternarServicio(svcId) {
    if (serviciosPlegados.has(svcId)) serviciosPlegados.delete(svcId);
    else serviciosPlegados.add(svcId);
    window.sounde.settings.set({ collapsedServices: [...serviciosPlegados] });
    pintarServicios();
  }

  function menuDeListaRemota(svc, playlist, evento) {
    const suyas = escondidas[svc.id] ?? [];
    abrirMenu([
      {
        texto: 'Abrir en el navegador',
        icono: 'abrir',
        onClick: () => window.sounde.app.abrirExterno(playlist.uri),
      },
      { separador: true },
      {
        texto: 'Esconder esta lista',
        icono: 'quitar',
        onClick: () => esconder(svc.id, playlist.id),
      },
      suyas.length ? {
        texto: `Volver a mostrar las ${suyas.length} escondidas`,
        icono: 'refrescar',
        onClick: () => mostrarTodas(svc.id),
      } : null,
    ].filter(Boolean), { x: evento.clientX, y: evento.clientY });
  }

  async function refrescarServicios() {
    const estados = await window.sounde.servicios.todos();
    servicios = await Promise.all(estados.map(async (e) => ({
      ...e,
      listas: e.conectado ? await window.sounde.servicios.listas(e.id) : [],
    })));

    // Si estabas mirando una lista de un servicio que acaba de desconectarse,
    // esa vista ya no existe: quedarse ahi deja una pantalla muerta.
    if (vista.tipo === 'catalogo') {
      const suyo = servicios.find((s) => s.id === vista.clave?.servicio);
      if (!suyo?.conectado) ir({ tipo: 'canciones' });
      else await abrirListaRemota(vista.clave.servicio, vista.clave.lista, true);
    }
    pintarServicios();
  }

  function pintarServicios() {
    if (!contenedorServicios) return;

    contenedorServicios.replaceChildren(...servicios
      .filter((s) => s.conectado)
      .map((s) => {
        const sincronizar = el('button', {
          class: 'lateral__accion',
          title: `Sincronizar con ${s.nombre}`,
          'aria-label': `Sincronizar con ${s.nombre}`,
          texto: glifo('refrescar'),
          onClick: async (e) => {
            const grupo = e.target.closest('.lateral__grupo');
            grupo.dataset.sincronizando = 'true';
            await window.sounde.servicios.sincronizar(s.id);
            delete grupo.dataset.sincronizando;
            await refrescarServicios();
          },
        });

        const visibles = s.listas.filter((p) => !estaEscondida(s.id, p.id));
        const ocultas = s.listas.length - visibles.length;
        const plegado = serviciosPlegados.has(s.id);

        return el('div', {
          class: 'lateral__grupo lateral__grupo--servicio',
          dataset: { plegado: String(plegado) },
        }, [
          el('span', { class: 'lateral__titulo' }, [
            /*
             * El nombre del servicio pasa a ser el propio boton de plegar en
             * vez de llevar una flecha suelta al lado. Es la zona mas facil
             * de acertar de todo el grupo, y asi no hay que afinar sobre un
             * icono de 22 px que ademas competiria con el de sincronizar.
             */
            el('button', {
              class: 'lateral__plegar',
              'aria-expanded': String(!plegado),
              title: plegado
                ? `Mostrar las listas de ${s.nombre}`
                : `Plegar las listas de ${s.nombre}`,
              onClick: () => alternarServicio(s.id),
            }, [
              el('span', {
                class: 'lateral__plegar-flecha',
                /*
                 * Abajo abierto, derecha cerrado — el triangulo de toda la
                 * vida. Aqui NO valen `plegar`/`desplegar`, que son las
                 * flechas izquierda y derecha: esas son las del lateral y las
                 * de "volver", y son horizontales porque aquello se mueve de
                 * lado. Esto se abre hacia abajo, y una flecha a la izquierda
                 * sobre un grupo desplegado se lee como "retroceder".
                 */
                texto: glifo(plegado ? 'desplegar' : 'flechaAbajo'),
              }),
              el('span', { texto: s.nombre }),
              // Plegado, el grupo no dice nada de lo que guarda dentro. El
              // numero evita tener que desplegarlo solo para ver si hay algo.
              plegado && visibles.length
                ? el('span', { class: 'lateral__plegar-cuenta tabular', texto: String(visibles.length) })
                : null,
            ]),
            sincronizar,
          ]),
          plegado ? null : el('div', { class: 'lateral__listas' }, visibles.map((p) => el('button', {
            class: 'lateral__item',
            title: `${p.name} — tienes ${p.encontradas} de ${p.total}`,
            onContextmenu: (e) => {
              e.preventDefault();
              menuDeListaRemota(s, p, e);
            },
            'aria-current': String(
              vista.tipo === 'catalogo'
              && vista.clave?.servicio === s.id
              && vista.clave?.lista === p.id,
            ),
            onClick: () => abrirListaRemota(s.id, p.id),
          }, [
            el('span', {
              class: 'lateral__icono',
              texto: glifo(p.id === '__guardadas__' ? 'corazonLleno' : 'lista'),
            }),
            el('span', { class: 'lateral__texto', texto: p.name }),
            el('span', {
              class: 'lateral__cuenta tabular',
              texto: p.total ? `${p.encontradas}/${p.total}` : '',
            }),
          ]))),

          // Sin esto, esconder una lista la hace desaparecer sin rastro y no
          // hay forma de recuperarla salvo editando settings.json a mano.
          // Plegado no se pinta: el grupo entero esta recogido a proposito y
          // esta linea lo volveria a abrir a dos renglones.
          !plegado && ocultas ? el('button', {
            class: 'lateral__item lateral__item--tenue',
            title: 'Volver a mostrar las listas escondidas',
            onClick: () => mostrarTodas(s.id),
          }, [
            el('span', { class: 'lateral__icono', texto: glifo('refrescar') }),
            el('span', {
              class: 'lateral__texto',
              texto: `${ocultas} escondida${ocultas === 1 ? '' : 's'}`,
            }),
          ]) : null,
        ]);
      }));
  }

  /**
   * El nombre del servicio de la lista abierta, para la cabecera.
   *
   * Es lo que ocupa el sitio de "Canciones" o "Listas": con dos servicios
   * conectados hay que poder saber de cual es lo que estas mirando sin bajar
   * la vista al lateral.
   */
  function nombreDelServicio() {
    const suyo = servicios.find((s) => s.id === vista.clave?.servicio);
    return suyo?.nombre ?? 'Catalogo';
  }

  /** `silencioso` repinta sin mover la navegacion, tras una sincronizacion. */
  async function abrirListaRemota(servicio, listaId, silencioso = false) {
    const lista = await window.sounde.servicios.lista(servicio, listaId);
    if (!lista) {
      if (!silencioso) ir({ tipo: 'canciones' });
      return;
    }
    vistaCatalogo.mostrar(lista);
    if (!silencioso) ir({ tipo: 'catalogo', clave: { servicio, lista: listaId } });
    else pintarServicios();
  }

  window.sounde.servicios.onCambio(() => refrescarServicios());
  refrescarServicios();

  function alternarLetra() {
    if (vista.tipo === 'letra') volver();
    else abrir({ tipo: 'letra' });
  }

  player.on('trackchange', ({ track }) => {
    if (vista.tipo === 'letra') letra.mostrar(track);
  });

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
    if (['canciones', 'favoritos', 'recientes', 'lista'].includes(vista.tipo)) {
      return lista.visibles;
    }
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

  // El ajuste se toca con la lista ya montada: hay que enterarse en caliente.
  window.sounde.settings.onChange((patch) => {
    if (patch.clickToPlay === undefined) return;
    lista.setUnClic(patch.clickToPlay);
    listaAlbum.setUnClic(patch.clickToPlay);
  });

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
    /*
     * El filtro va aqui y en ningun otro sitio. `pistas` es de donde salen
     * canciones, albumes, artistas, recientes y el resolutor que usan las
     * listas de los servicios, asi que filtrando una sola vez la cancion
     * escondida desaparece de todo a la vez. Filtrarlo por vista habria sido
     * repetir la misma condicion en seis sitios y olvidarla en el septimo.
     */
    pistas = (await window.sounde.library.all())
      .filter((t) => !pistasEscondidas.has(t.id));
    const carpetas = await window.sounde.library.folders();
    escaneo.hidden = true;

    albumes = agruparAlbumes(pistas);
    artistas = agruparArtistas(pistas);

    await refrescarRecientes();

    lista.setFavoritos(favoritos?.ids ?? new Set());
    listaAlbum.setFavoritos(favoritos?.ids ?? new Set());
    pintarCuentaFavoritos();

    // Una ficha abierta puede haber dejado de existir tras un reescaneo.
    if (vista.tipo === 'album') vista = revalidar(albumes, 'albumes');
    else if (vista.tipo === 'artista') vista = revalidar(artistas, 'artistas');

    pintarCarpetas(carpetas);
    marcarActual();
    pintarCuerpo();

    // El recuento de "cuantas de esta lista ya tienes" se calcula contra la
    // biblioteca, asi que un archivo nuevo lo cambia. Sin esto, añades la
    // cancion que faltaba y la lista de Spotify la sigue dando por ausente
    // hasta reiniciar.
    refrescarServicios();
    return pistas;
  }

  /**
   * El historial guarda ids; las pistas que ya no estan en la biblioteca se
   * caen solas al no encontrarse en el mapa. Se recalcula al entrar en la
   * vista y cada vez que se anota una escucha, o "Recientes" solo diria la
   * verdad justo despues de abrir la aplicacion.
   */
  async function refrescarRecientes() {
    const porId = new Map(pistas.map((t) => [t.id, t]));
    const ids = await window.sounde.collections.recent(200);
    recientes = ids.map((id) => porId.get(id)).filter(Boolean);
  }

  window.sounde.collections.onPlayed(async () => {
    await refrescarRecientes();
    if (vista.tipo === 'recientes') pintarCuerpo();
  });

  function pintarListas() {
    const cont = $('#lista-listas');
    if (!cont) return;
    const propias = listas?.listas ?? [];
    cont.replaceChildren(...propias.map((p) => {
      const boton = el('button', {
        class: 'lateral__item',
        title: p.name,
        'aria-current': String(vista.tipo === 'lista' && vista.clave?.id === p.id),
        onClick: () => ir({ tipo: 'lista', clave: p }),
        onContextmenu: (e) => {
          e.preventDefault();
          menuDeLista(p, e);
        },
      }, [
        el('span', { class: 'lateral__icono', texto: glifo('lista') }),
        el('span', { class: 'lateral__texto', texto: p.name }),
        el('span', { class: 'lateral__cuenta tabular', texto: p.tracks.length ? String(p.tracks.length) : '' }),
      ]);
      return boton;
    }));
  }

  function pintarCuentaFavoritos() {
    const cuenta = $('#cuenta-favoritos');
    if (!cuenta) return;
    const n = pistas.filter((t) => favoritos?.tiene(t.id)).length;
    cuenta.textContent = n ? String(n) : '';
  }

  /** Las pistas que alimentan la lista principal segun la vista. */
  function fuenteDeLista() {
    if (vista.tipo === 'favoritos') return pistas.filter((t) => favoritos?.tiene(t.id));
    if (vista.tipo === 'recientes') return recientes;
    if (vista.tipo === 'lista') return pistasDe(vista.clave, new Map(pistas.map((t) => [t.id, t])));
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

    if (vista.tipo === 'letra') {
      const t = player.track;
      resumen.textContent = t ? [t.title, t.artist].filter(Boolean).join(' · ') : 'Nada sonando';
      return;
    }

    if (vista.tipo === 'catalogo') {
      const d = vistaCatalogo.datos;
      resumen.textContent = d ? `${d.encontradas} de ${d.items.length} en tu biblioteca` : '';
      return;
    }

    if (!pistas.length) {
      resumen.textContent = 'Sin musica todavia';
      return;
    }

    if (vista.tipo === 'canciones' || vista.tipo === 'favoritos' || vista.tipo === 'recientes') {
      const visibles = lista.visibles;
      const fuente = fuenteDeLista().length;
      const total = visibles.reduce((s, t) => s + (t.duration || 0), 0);
      const filtrando = visibles.length !== fuente;
      resumen.textContent = `${plural(visibles.length, 'cancion', 'canciones')}` +
        `${filtrando ? ` de ${fuente}` : ''} · ${formatoTiempo(total)}`;
      cuerpo.dataset.vacio = String(visibles.length === 0);
      // Distinguir "esta vista aun no tiene nada" de "la busqueda no
      // encuentra nada" importa: el consejo util es distinto en cada caso.
      cuerpo.dataset.fuenteVacia = String(fuente === 0);
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
      boton.setAttribute('aria-current', String(tipo === base() && vista.tipo !== 'lista'));
    }
    pintarListas();
    pintarServicios();
    tituloVista.textContent = vista.tipo === 'lista' ? 'Listas'
      : vista.tipo === 'letra' ? 'Letra'
        : vista.tipo === 'catalogo' ? nombreDelServicio() : TITULOS[base()];
    acciones.dataset.ficha = String(
      enFicha || vista.tipo === 'lista' || vista.tipo === 'letra' || vista.tipo === 'catalogo',
    );

    letra.setVisible(vista.tipo === 'letra');

    /*
     * Antes del corte por biblioteca vacia, igual que la letra: una lista de
     * Spotify se puede mirar sin tener una sola cancion en el disco. De hecho
     * es cuando mas sirve — es la lista de lo que te falta entero.
     */
    if (vista.tipo === 'catalogo') {
      cuerpo.dataset.modo = 'catalogo';
      cuerpo.replaceChildren(vistaCatalogo.nodo);
      pintarResumen();
      return;
    }
    if (vista.tipo === 'letra') {
      // Antes del corte por biblioteca vacia: una cancion abierta con "Abrir
      // con..." no esta en la lista y su letra se puede leer igual.
      cuerpo.dataset.modo = 'letra';
      cuerpo.replaceChildren(letra.nodo);
      letra.mostrar(player.track);
      pintarResumen();
      return;
    }

    if (!pistas.length) {
      cuerpo.dataset.modo = 'vacio';
      cuerpo.replaceChildren(vacio());
      pintarResumen();
      return;
    }

    if (vista.tipo === 'canciones' || vista.tipo === 'favoritos' || vista.tipo === 'recientes') pintarCanciones();
    else if (vista.tipo === 'albumes') pintarRejillaAlbumes();
    else if (vista.tipo === 'artistas') pintarRejillaArtistas();
    else if (vista.tipo === 'album') pintarFichaAlbum();
    else if (vista.tipo === 'lista') pintarFichaLista();
    else pintarFichaArtista();

    pintarResumen();
  }

  function pintarCanciones() {
    cuerpo.dataset.modo = 'lista';
    // En Recientes manda el orden de escucha; ordenarlo por titulo lo
    // convertiria en otra lista de canciones cualquiera.
    if (vista.tipo === 'recientes') lista.setOrden('ninguno', 'asc');
    else if (lista.orden.por === 'ninguno') lista.setOrden(ajustes.sortBy ?? 'title', ajustes.sortDir ?? 'asc');
    lista.setPistas(fuenteDeLista());
    lista.setActual(player.track?.id ?? null, player.playing);
    // filter(Boolean) no es cosmetico: replaceChildren convierte un null en
    // el texto "null" y lo pinta en pantalla, al contrario que el ayudante
    // el(), que los descarta. Aqui vacioDeVista() devuelve null en Canciones.
    cuerpo.replaceChildren(...[lista.nodo, sinResultados(), vacioDeVista()].filter(Boolean));
  }

  /** Aviso propio de Favoritos y Recientes cuando aun no hay nada dentro. */
  function vacioDeVista() {
    if (vista.tipo === 'favoritos') {
      return el('div', { class: 'vacio vacio--vista' }, [
        el('div', { class: 'vacio__icono', texto: glifo('corazon') }),
        el('h2', { class: 'vacio__titulo', texto: 'Sin favoritos todavia' }),
        el('p', { class: 'vacio__texto', texto: 'Pulsa el corazon de una cancion, en la lista o abajo en el transporte, y aparecera aqui.' }),
      ]);
    }
    if (vista.tipo === 'recientes') {
      return el('div', { class: 'vacio vacio--vista' }, [
        el('div', { class: 'vacio__icono', texto: glifo('reciente') }),
        el('h2', { class: 'vacio__titulo', texto: 'Aun no has escuchado nada' }),
        el('p', { class: 'vacio__texto', texto: 'Una cancion entra aqui cuando ha sonado de verdad, no al pasarla de largo.' }),
      ]);
    }
    return null;
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

  function pintarFichaLista() {
    const playlist = vista.clave;
    const suyas = fuenteDeLista();
    cuerpo.dataset.modo = 'detalle';
    // Aqui SI se reordena a mano, asi que la lista no se ordena sola.
    lista.setOrden('ninguno', 'asc');
    lista.setPistas(suyas);
    lista.setActual(player.track?.id ?? null, player.playing);
    cuerpo.replaceChildren(fichaLista(playlist, suyas, {
      onVolver: volver,
      volverA: etiquetaDe(historial[historial.length - 1]),
      onReproducir: () => reproducir(suyas, false),
      onAleatorio: () => reproducir(suyas, true),
      onMenu: (e) => menuDeLista(playlist, e),
      listaNodo: lista.nodo,
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

  return {
    refrescar, ir, alternarLetra, onVista, lista, refrescarServicios,
    // Las escondidas se deshacen desde Ajustes, que es el unico sitio donde
    // se pueden buscar cuando ya no estan en ninguna lista.
    cuantasEscondidas, mostrarPistasEscondidas,
    get pistas() { return pistas; },
    get vista() { return vista; },
  };
}

/** Un arrastre de texto dentro de la app no debe encender la capa. */
function llevaArchivos(evento) {
  return [...(evento.dataTransfer?.types ?? [])].includes('Files');
}
