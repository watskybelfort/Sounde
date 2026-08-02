'use strict';

const { ipcMain } = require('electron');
const { applyBackdrop, setMiniPlayer } = require('./window');

/**
 * Registra los handlers del proceso principal.
 * `ctx` lleva { getWindow, settings }.
 */
function registerIpc(ctx) {
  const { getWindow, settings } = ctx;

  const withWindow = (fn) => (...args) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    return fn(win, ...args);
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
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('settings:changed', patch);
    return settings.all();
  });

  // --- Vidrio -------------------------------------------------------------
  ipcMain.handle('backdrop:apply', (_e, mode) => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (mode) settings.set('backdrop', mode);
    return applyBackdrop(win, settings);
  });
}

module.exports = { registerIpc };
