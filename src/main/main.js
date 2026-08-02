'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const { JsonStore } = require('./store');
const { DEFAULT_SETTINGS } = require('./defaults');
const { createMainWindow, setMiniPlayer } = require('./window');
const { registerIpc } = require('./ipc');
const { registerSchemes, registerHandlers } = require('./protocols');

const APP_URL = 'sounde://app/index.html';

// Una sola instancia: si el usuario abre un segundo archivo desde el
// Explorador, se lo pasamos a la ventana que ya esta abierta en vez de
// levantar un reproductor nuevo que compita por el audio.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  main();
}

let mainWindow = null;
let settings = null;

function main() {
  app.setAppUserModelId('com.mxrningstar.sounde');
  app.commandLine.appendSwitch('force_high_performance_gpu');

  // Los privilegios de esquema hay que declararlos antes de que Chromium
  // arranque; despues de app.ready se ignoran en silencio.
  registerSchemes();

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    settings = new JsonStore(
      path.join(app.getPath('userData'), 'settings.json'),
      DEFAULT_SETTINGS,
    );

    registerHandlers();
    registerIpc({ getWindow: () => mainWindow, settings });

    mainWindow = createMainWindow(settings);
    mainWindow.loadURL(APP_URL);

    if (settings.get('miniPlayer')) {
      mainWindow.once('ready-to-show', () => setMiniPlayer(mainWindow, true));
    }

    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(settings);
        mainWindow.loadURL(APP_URL);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (settings) settings.save();
    app.quit();
  });

  app.on('before-quit', () => {
    if (settings) settings.save();
  });
}
