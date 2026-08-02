'use strict';

const path = require('node:path');
const { ipcMain, dialog, shell, app } = require('electron');

const { applyBackdrop, setMiniPlayer } = require('./window');
const protocols = require('./protocols');
const { AUDIO_EXTENSIONS } = require('./defaults');

/**
 * Registra los handlers del proceso principal.
 * `ctx` lleva { getWindow, settings, library }.
 */
function registerIpc(ctx) {
  const { getWindow, settings, library } = ctx;

  const withWindow = (fn) => (...args) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    return fn(win, ...args);
  };

  const emitir = (canal, datos) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(canal, datos);
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

  // --- Ajustes ------------------------------------------------------------
  ipcMain.handle('settings:all', () => settings.all());

  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.all();
    settings.merge(patch);
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
    emitir('library:changed', { total: library.size() });
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
    emitir('library:changed', { total: library.size() });
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
    emitir('library:changed', { total: library.size() });
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
    emitir('library:changed', { total: library.size() });
    return tracks.map(paraCliente);
  }));

  ipcMain.handle('library:add-paths', async (_e, rutas) => {
    if (!Array.isArray(rutas) || !rutas.length) return [];
    const expandidas = await expandir(rutas);
    const tracks = await library.addFiles(expandidas);
    emitir('library:changed', { total: library.size() });
    return tracks.map(paraCliente);
  });

  ipcMain.handle('library:reveal', (_e, ruta) => {
    if (typeof ruta === 'string' && ruta) shell.showItemInFolder(ruta);
    return true;
  });

  // --- Varios -------------------------------------------------------------
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }));
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
