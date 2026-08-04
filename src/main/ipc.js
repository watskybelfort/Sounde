'use strict';

const path = require('node:path');
const { ipcMain, dialog, shell, app } = require('electron');

const { applyBackdrop, setMiniPlayer } = require('./window');
const protocols = require('./protocols');
const { AUDIO_EXTENSIONS, EQ_BANDS, EQ_PRESETS } = require('./defaults');
const m3u = require('./m3u');
const taskbar = require('./taskbar');
const notificaciones = require('./notificaciones');
const bandeja = require('./bandeja');
const letras = require('./letras');
const servicios = require('./servicios');

// Darse de alta es el efecto de requerirlos: a partir de aqui `servicios` los
// conoce a los dos y el IPC no necesita nombrar a ninguno.
require('./spotify');
require('./youtube');

/**
 * Registra los handlers del proceso principal.
 * `ctx` lleva { getWindow, settings, library }.
 */
function registerIpc(ctx) {
  const { getWindow, settings, library, collections } = ctx;

  const withWindow = (fn) => (...args) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    return fn(win, ...args);
  };

  const emitir = (canal, datos) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(canal, datos);
  };

  /**
   * La biblioteca ha cambiado.
   *
   * Va junto al aviso a proposito: el indice de emparejado de Spotify se
   * construye sobre las pistas locales, asi que una cancion nueva en el disco
   * lo deja obsoleto. Separando las dos cosas, cualquier camino nuevo que
   * toque la biblioteca se olvidaria de invalidarlo y el sintoma seria de los
   * peores: añades el archivo que faltaba, la lista de Spotify lo sigue dando
   * por ausente, y solo se arregla reiniciando.
   */
  const bibliotecaCambio = () => {
    servicios.olvidarIndice();
    emitir('library:changed', { total: library.size() });
  };

  // --- Ventana ------------------------------------------------------------
  ipcMain.handle('window:minimize', withWindow((win) => {
    win.minimize();
    return true;
  }));

  ipcMain.handle('window:toggle-maximize', withWindow((win) => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  }));

  ipcMain.handle('window:close', withWindow((win) => {
    win.close();
    return true;
  }));

  ipcMain.handle('window:set-mini', withWindow((win, _e, enabled) => {
    const value = !!enabled;
    settings.set('miniPlayer', value);
    return setMiniPlayer(win, value);
  }));

  ipcMain.handle('window:get-state', withWindow((win) => ({
    maximized: win.isMaximized(),
    focused: win.isFocused(),
    mini: settings.get('miniPlayer', false),
  })));

  // --- Barra de tareas -----------------------------------------------------
  /*
   * Por `on` y no por `handle`: el renderer avisa de como va la reproduccion
   * varias veces por minuto y no espera respuesta. Un invoke por cada aviso
   * seria una promesa ida y vuelta para nada.
   */
  const mandarOrden = (orden) => emitir('player:command', { orden });

  bandeja.sincronizar(settings.get('minimizeToTray', false), {
    getWindow,
    mandar: mandarOrden,
    salir: () => app.quit(),
  });

  let ultimaVentana = null;
  ipcMain.on('player:state', (_e, estado) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    // Una ventana nueva nace sin botones ni distintivo. El cache de "lo ultimo
    // aplicado" es del modulo, no de la ventana: sin este reinicio la firma
    // seguiria coincidiendo y la barra se quedaria vacia para siempre.
    if (win !== ultimaVentana) {
      ultimaVentana = win;
      taskbar.reiniciar();
    }
    taskbar.aplicarEstado(win, estado, mandarOrden);

    // El aviso y la bandeja salen del mismo parte porque el cambio de pista ya
    // viene ahi: un canal por cada uno mandaria tres mensajes por cancion.
    const track = estado?.id ? library.get(estado.id) : null;
    if (track) {
      notificaciones.avisarDePista(win, track, {
        activo: settings.get('showNotifications', true),
        sonando: !!estado.sonando,
      });
    }
    bandeja.actualizar({ track, sonando: !!estado?.sonando, hayPista: !!estado?.hayPista });
  });

  // --- Ajustes ------------------------------------------------------------
  ipcMain.handle('settings:all', () => settings.all());

  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.all();
    settings.merge(patch);
    // La bandeja se enciende y se apaga en el acto: si esperase al siguiente
    // arranque, el ajuste pareceria no hacer nada.
    if (patch.minimizeToTray !== undefined) {
      bandeja.sincronizar(!!patch.minimizeToTray, { getWindow, mandar: mandarOrden, salir: () => app.quit() });
    }
    emitir('settings:changed', patch);
    return settings.all();
  });

  // --- Vidrio -------------------------------------------------------------
  ipcMain.handle('backdrop:apply', (_e, mode) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (mode) settings.set('backdrop', mode);
    return applyBackdrop(win, settings);
  });

  // --- Biblioteca ---------------------------------------------------------
  ipcMain.handle('library:all', () => library.all().map(paraCliente));

  ipcMain.handle('library:folders', () => settings.get('folders', []));

  ipcMain.handle('library:scan', async () => {
    const folders = settings.get('folders', []);
    if (!folders.length) return { ok: false, reason: 'sin-carpetas' };
    const res = await library.scan(folders, (p) => emitir('library:progress', p));
    bibliotecaCambio();
    return res;
  });

  ipcMain.handle('library:cancel-scan', () => {
    library.cancel();
    return true;
  });

  ipcMain.handle('library:add-folder', withWindow(async (win) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Anadir carpetas de musica',
      properties: ['openDirectory', 'multiSelections'],
    });
    if (canceled || !filePaths.length) return null;

    const actuales = settings.get('folders', []);
    const fusion = [...new Set([...actuales, ...filePaths])];
    settings.set('folders', fusion);
    for (const f of fusion) protocols.allowRoot(f);

    const res = await library.scan(fusion, (p) => emitir('library:progress', p));
    bibliotecaCambio();
    return { folders: fusion, ...res };
  }));

  ipcMain.handle('library:remove-folder', async (_e, folder) => {
    const restantes = settings.get('folders', []).filter((f) => f !== folder);
    settings.set('folders', restantes);

    // Se rehacen las raices autorizadas desde cero: quitar una carpeta tiene
    // que revocar el acceso, no solo sacarla de la lista.
    protocols.clearRoots();
    for (const f of restantes) protocols.allowRoot(f);

    const res = await library.scan(restantes, (p) => emitir('library:progress', p));
    bibliotecaCambio();
    return { folders: restantes, ...res };
  });

  ipcMain.handle('library:open-files', withWindow(async (win) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Abrir archivos de audio',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: AUDIO_EXTENSIONS.map((e) => e.slice(1)) },
        { name: 'Todos', extensions: ['*'] },
      ],
    });
    if (canceled || !filePaths.length) return [];
    const tracks = await library.addFiles(filePaths);
    bibliotecaCambio();
    return tracks.map(paraCliente);
  }));

  ipcMain.handle('library:add-paths', async (_e, rutas) => {
    if (!Array.isArray(rutas) || !rutas.length) return [];
    const expandidas = await expandir(rutas);
    const tracks = await library.addFiles(expandidas);
    bibliotecaCambio();
    return tracks.map(paraCliente);
  });

  ipcMain.handle('library:reveal', (_e, ruta) => {
    if (typeof ruta === 'string' && ruta) shell.showItemInFolder(ruta);
    return true;
  });

  // --- Favoritos e historial ----------------------------------------------
  ipcMain.handle('coll:all', () => collections.all());

  ipcMain.handle('coll:toggle-favorite', (_e, id) => {
    const valor = collections.toggleFavorite(id);
    emitir('coll:changed', { favorites: collections.favoriteIds() });
    return valor;
  });

  ipcMain.handle('coll:played', (_e, id) => {
    const stats = collections.played(id);
    // Avisar es lo que hace que "Recientes" se actualice mientras suena, en
    // vez de solo al reabrir la aplicacion.
    emitir('coll:played', { id, stats });
    return stats;
  });

  ipcMain.handle('coll:recent', (_e, limite) => collections.recentIds(limite));

  // --- Listas de reproduccion ---------------------------------------------
  const conListas = (fn) => (...args) => {
    const salida = fn(...args);
    emitir('coll:playlists', { playlists: collections.playlists });
    return salida;
  };

  ipcMain.handle('pl:all', () => collections.playlists);

  ipcMain.handle('pl:create', conListas((_e, name, trackIds) =>
    collections.createPlaylist(name, trackIds)));

  ipcMain.handle('pl:rename', conListas((_e, id, name) =>
    collections.renamePlaylist(id, name)));

  ipcMain.handle('pl:remove', conListas((_e, id) => collections.removePlaylist(id)));

  ipcMain.handle('pl:add', conListas((_e, id, trackIds) =>
    collections.addToPlaylist(id, trackIds)));

  ipcMain.handle('pl:remove-at', conListas((_e, id, indice) =>
    collections.removeFromPlaylist(id, indice)));

  ipcMain.handle('pl:move', conListas((_e, id, desde, hasta) =>
    collections.movePlaylistTrack(id, desde, hasta)));

  ipcMain.handle('pl:set-tracks', conListas((_e, id, trackIds) =>
    collections.setPlaylistTracks(id, trackIds)));

  ipcMain.handle('pl:export', withWindow(async (win, _e, id) => {
    const playlist = collections.findPlaylist(id);
    if (!playlist) return null;

    const pistas = playlist.tracks.map((t) => library.get(t)).filter(Boolean);
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Exportar la lista',
      defaultPath: `${playlist.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`,
      filters: [{ name: 'Listas', extensions: ['m3u8', 'm3u'] }],
    });
    if (canceled || !filePath) return null;

    try {
      return await m3u.escribir(filePath, pistas);
    } catch (err) {
      console.error('[m3u] no pude exportar:', err.message);
      return { error: err.message };
    }
  }));

  ipcMain.handle('pl:import', withWindow(async (win) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Importar una lista',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Listas', extensions: ['m3u8', 'm3u'] }],
    });
    if (canceled || !filePaths.length) return [];

    const creadas = [];
    for (const archivo of filePaths) {
      let rutas;
      try {
        rutas = await m3u.leer(archivo);
      } catch (err) {
        console.error('[m3u] no pude leer', archivo, '-', err.message);
        continue;
      }

      // Las pistas de la lista importada pueden estar fuera de las carpetas
      // vigiladas. Se anaden a la biblioteca para que se puedan reproducir:
      // sin eso, la lista aparece llena de canciones que dan 403.
      const tracks = await library.addFiles(rutas);
      const nombre = path.basename(archivo, path.extname(archivo));
      const lista = collections.createPlaylist(nombre, tracks.map((t) => t.id));
      creadas.push({ ...lista, encontradas: tracks.length, enElArchivo: rutas.length });
    }

    emitir('coll:playlists', { playlists: collections.playlists });
    bibliotecaCambio();
    return creadas;
  }));

  // --- Servicios de catalogo (Spotify, YouTube) -----------------------------
  servicios.init({ library });

  /** Un id de servicio desconocido no debe reventar: se contesta vacio. */
  const conServicio = (fn, siNoEsta = null) => (_e, id, ...args) => {
    const servicio = servicios.de(id);
    return servicio ? fn(servicio, ...args) : siNoEsta;
  };

  ipcMain.handle('svc:all', () => servicios.estados());

  ipcMain.handle('svc:state', conServicio((s) => s.estado()));

  ipcMain.handle('svc:set-client-id', conServicio((s, valor) => s.setClientId(valor)));

  ipcMain.handle('svc:set-client-secret', conServicio((s, valor) => s.setClientSecret(valor)));

  ipcMain.handle('svc:connect', conServicio(async (s) => {
    try {
      await s.conectar();
    } catch (err) {
      return { ok: false, error: err.message, ...s.estado() };
    }
    // La primera sincronizacion sale sola: conectar la cuenta y encontrarse
    // la pantalla vacia con un boton de "sincronizar" al lado es pedirle al
    // usuario que haga a mano el segundo paso obvio del primero.
    const res = await s.sincronizar({
      onProgress: (p) => emitir('svc:progress', { servicio: s.id, ...p }),
    });
    emitir('svc:changed', s.estado());
    return { ...res, ...s.estado() };
  }, { ok: false, error: 'Ese servicio no existe.' }));

  ipcMain.handle('svc:disconnect', conServicio((s) => {
    const estado = s.desconectar();
    emitir('svc:changed', estado);
    return estado;
  }));

  ipcMain.handle('svc:sync', conServicio(async (s) => {
    const res = await s.sincronizar({
      onProgress: (p) => emitir('svc:progress', { servicio: s.id, ...p }),
    });
    emitir('svc:changed', s.estado());
    return res;
  }, { ok: false, error: 'Ese servicio no existe.' }));

  ipcMain.handle('svc:cancel-sync', conServicio((s) => s.cancelar(), false));

  ipcMain.handle('svc:playlists', conServicio((s) => s.listas(), []));

  ipcMain.handle('svc:playlist', conServicio((s, listaId) => s.lista(listaId)));

  /**
   * Guarda en un archivo la lista de las canciones que no tienes.
   *
   * Sounde no descarga de estos servicios. Esto es lo que si puede hacer:
   * ahorrarte apuntar a mano que te falta, para que te lo lleves a donde
   * vayas a conseguir la musica.
   */
  ipcMain.handle('svc:export-missing', withWindow(async (win, _e, datos) => {
    const items = Array.isArray(datos?.items) ? datos.items : [];
    if (!items.length) return null;

    const formato = FORMATOS[datos?.formato] ?? FORMATOS.informe;
    const nombre = String(datos?.lista ?? 'lista').replace(/[\\/:*?"<>|]/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Guardar lo que falta',
      defaultPath: `${nombre} — ${formato.sufijo}.${formato.ext}`,
      filters: formato.filtros,
    });
    if (canceled || !filePath) return null;

    const { texto, total } = formato.escribir(datos?.lista, items);
    if (!total) return { ok: false, error: 'No habia ningun enlace que guardar.' };

    try {
      /*
       * El BOM va en los dos formatos que se leen y en ninguno mas.
       *
       * En el informe y en el CSV hace falta: sin el, Excel y el Bloc de
       * notas interpretan el archivo en la pagina de codigos de Windows y
       * los acentos salen rotos. En el de enlaces sobra y ademas estorba —
       * esos tres bytes se pegan a la primera URL y quien lea el archivo
       * con `-a` desde una linea de comandos se encuentra la primera
       * entrada invalida sin ver por que.
       */
      await require('node:fs/promises').writeFile(
        filePath,
        formato.bom ? `﻿${texto}` : texto,
        'utf8',
      );
      return { ok: true, filePath, total };
    } catch (err) {
      console.error('[servicios] no pude exportar:', err.message);
      return { ok: false, error: err.message };
    }
  }));

  // --- Letras ---------------------------------------------------------------
  ipcMain.handle('lyrics:for', async (_e, id) => {
    const track = id ? library.get(id) : null;
    if (!track) return null;
    return letras.buscar(track);
  });

  // Volver a escanear puede haber traido un .lrc que antes no estaba.
  ipcMain.handle('lyrics:forget', (_e, id) => {
    letras.olvidar(id);
    return true;
  });

  // --- Varios -------------------------------------------------------------
  /**
   * Abrir un enlace fuera.
   *
   * Solo http(s), y comprobado aqui. La pagina no puede mandar `file://` ni
   * un esquema raro: `shell.openExternal` se lo pasaria al sistema tal cual,
   * y eso es ejecutar lo que diga la cadena.
   */
  ipcMain.handle('app:open-external', (_e, url) => {
    let destino;
    try {
      destino = new URL(String(url));
    } catch {
      return false;
    }
    if (destino.protocol !== 'https:' && destino.protocol !== 'http:') return false;
    shell.openExternal(destino.toString());
    return true;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }));

  /**
   * Las bandas del EQ y sus presets viven en defaults.js y viajan por aqui.
   * El preload va en sandbox y no puede requerir archivos del proyecto, asi
   * que la alternativa seria copiarlos en el renderer y verlos separarse.
   */
  ipcMain.handle('app:constants', () => ({
    eqBands: EQ_BANDS,
    eqPresets: EQ_PRESETS,
    audioExtensions: AUDIO_EXTENSIONS,
  }));
}

const dosDigitos = (n) => String(n).padStart(2, '0');

function duracion(segundos) {
  const t = Math.max(0, Math.round(Number(segundos) || 0));
  return `${Math.floor(t / 60)}:${dosDigitos(t % 60)}`;
}

/**
 * Los tres formatos de "lo que falta", y para que sirve cada uno.
 *
 * El formato lo elige el usuario en el menu y manda sobre la extension. Antes
 * se deducia de la extension que se escribiera en el dialogo de guardado, y
 * eso funcionaba con dos formatos porque .txt y .csv no se pisan; con tres no
 * puede funcionar, porque el informe y la lista de enlaces son los dos .txt y
 * contienen cosas distintas.
 */
const FORMATOS = {
  // Para leerlo: artista, titulo, album, duracion y enlace, tres lineas por
  // cancion.
  informe: {
    ext: 'txt',
    sufijo: 'lo que me falta',
    bom: true,
    filtros: [{ name: 'Texto', extensions: ['txt'] }],
    escribir: (lista, items) => ({ texto: comoTexto(lista, items), total: items.length }),
  },
  // Para abrirlo en Excel y ordenar por columnas.
  csv: {
    ext: 'csv',
    sufijo: 'lo que me falta',
    bom: true,
    filtros: [{ name: 'CSV', extensions: ['csv'] }],
    escribir: (_lista, items) => ({ texto: comoCsv(items), total: items.length }),
  },
  // Para darselo a otra herramienta, no para leerlo.
  enlaces: {
    ext: 'txt',
    sufijo: 'enlaces',
    bom: false,
    filtros: [{ name: 'Texto', extensions: ['txt'] }],
    escribir: (_lista, items) => comoEnlaces(items),
  },
};

/**
 * Solo las URL, una por linea, y nada mas.
 *
 * Sin cabecera, sin numerar y sin lineas en blanco a proposito: este archivo
 * no esta hecho para leerlo sino para pegarlo en un gestor de descargas o
 * pasarselo a una herramienta que acepte una lista. Cualquier adorno se
 * convierte alli en una entrada que falla.
 *
 * Se descarta lo que no tenga enlace en vez de dejar una linea vacia, y se
 * devuelve cuantos salieron de verdad: si una lista de treinta deja veintiocho
 * enlaces, el aviso tiene que decir veintiocho.
 */
function comoEnlaces(items) {
  const urls = items
    .map((i) => String(i.url ?? '').trim())
    .filter(Boolean);
  // CRLF porque el destino natural de esto en Windows es el Bloc de notas o
  // un .bat, y con LF solo los dos lo muestran todo pegado en un renglon.
  return { texto: urls.length ? `${urls.join('\r\n')}\r\n` : '', total: urls.length };
}

function comoTexto(lista, items) {
  const cabecera = [
    `Lo que me falta de "${lista ?? 'la lista'}"`,
    `${items.length} canciones`,
    '',
  ];
  const filas = items.map((i, n) => {
    const linea = `${n + 1}. ${i.artistas || 'Artista desconocido'} — ${i.titulo}`;
    const extra = [i.album, duracion(i.duracion)].filter(Boolean).join(' · ');
    return extra ? `${linea}\n   ${extra}\n   ${i.url ?? ''}` : linea;
  });
  return `${[...cabecera, ...filas].join('\n')}\n`;
}

/** Las comillas dobles se escapan doblandolas, que es lo que entiende Excel. */
const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function comoCsv(items) {
  const cabecera = ['Artista', 'Titulo', 'Album', 'Duracion', 'Enlace'];
  const filas = items.map((i) => [
    i.artistas, i.titulo, i.album, duracion(i.duracion), i.url,
  ].map(celda).join(','));
  return `${[cabecera.join(','), ...filas].join('\r\n')}\r\n`;
}

/**
 * Lo que ve el renderer. Las rutas del disco no viajan como `file://`: la
 * pagina no puede leerlas y ademas serian un agujero. Van como URL del
 * esquema propio, que ya valida contra las raices autorizadas.
 */
function paraCliente(track) {
  return {
    ...track,
    url: protocols.encodePath(track.path),
    artUrl: track.art ? protocols.artUrl(track.art) : null,
  };
}

/** Si sueltan una carpeta, hay que entrar a buscar el audio de dentro. */
async function expandir(rutas) {
  const fsp = require('node:fs/promises');
  const salida = [];
  const exts = new Set(AUDIO_EXTENSIONS);

  for (const ruta of rutas) {
    let stat;
    try {
      stat = await fsp.stat(ruta);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      if (exts.has(path.extname(ruta).toLowerCase())) salida.push(ruta);
      continue;
    }
    if (stat.isDirectory()) {
      protocols.allowRoot(ruta);
      const pila = [ruta];
      while (pila.length) {
        const dir = pila.pop();
        let entradas;
        try {
          entradas = await fsp.readdir(dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entradas) {
          const completo = path.join(dir, e.name);
          if (e.isDirectory()) pila.push(completo);
          else if (exts.has(path.extname(e.name).toLowerCase())) salida.push(completo);
        }
      }
    }
  }
  return salida;
}

module.exports = { registerIpc, paraCliente };
