'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const { JsonStore } = require('./store');
const { DEFAULT_SETTINGS, AUDIO_EXTENSIONS } = require('./defaults');
const { createMainWindow, setMiniPlayer } = require('./window');
const { registerIpc, paraCliente } = require('./ipc');
const { registerSchemes, registerHandlers } = require('./protocols');
const protocols = require('./protocols');
const { Library } = require('./library');
const { Collections } = require('./collections');

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
let library = null;
let collections = null;

function main() {
  app.setAppUserModelId('com.mxrningstar.sounde');
  app.commandLine.appendSwitch('force_high_performance_gpu');

  // Los privilegios de esquema hay que declararlos antes de que Chromium
  // arranque; despues de app.ready se ignoran en silencio.
  registerSchemes();

  app.on('second-instance', (_e, argv) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    abrirArchivos(archivosDeArgv(argv));
  });

  app.whenReady().then(async () => {
    settings = new JsonStore(
      path.join(app.getPath('userData'), 'settings.json'),
      DEFAULT_SETTINGS,
    );

    registerHandlers();

    const libraryStore = new JsonStore(
      path.join(app.getPath('userData'), 'library.json'),
      { version: 1, tracks: [] },
    );
    library = new Library(libraryStore);

    // Sin volver a autorizar las carpetas guardadas, tras reiniciar la app
    // toda la biblioteca da 403 al intentar sonar.
    for (const carpeta of settings.get('folders', [])) protocols.allowRoot(carpeta);
    for (const track of library.all()) protocols.allowFile(track.path);

    // Almacen aparte del de la biblioteca: esta es la unica informacion que
    // el usuario no puede recuperar reescaneando el disco.
    const collectionsStore = new JsonStore(
      path.join(app.getPath('userData'), 'collections.json'),
      { version: 1, favorites: [], stats: {}, history: [], playlists: [] },
    );
    collections = new Collections(collectionsStore);

    registerIpc({ getWindow: () => mainWindow, settings, library, collections });

    mainWindow = createMainWindow(settings);
    mainWindow.loadURL(APP_URL);

    if (settings.get('miniPlayer')) {
      mainWindow.once('ready-to-show', () => setMiniPlayer(mainWindow, true));
    }

    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    mainWindow.webContents.once('did-finish-load', () => {
      abrirArchivos(archivosDeArgv(process.argv));
      escaneoInicial();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow(settings);
        mainWindow.loadURL(APP_URL);
      }
    });
  });

  app.on('window-all-closed', () => {
    cerrar();
    app.quit();
  });

  app.on('before-quit', cerrar);
}

function cerrar() {
  if (settings) settings.save();
  if (library) library.persist();
  if (collections) collections.store.save();
}

/**
 * Los archivos que llegan de "Abrir con..." vienen sueltos en argv, mezclados
 * con los flags de Chromium. Se filtra por extension conocida y existencia
 * real: cualquier otra cosa es un flag, no una cancion.
 */
function archivosDeArgv(argv = []) {
  const exts = new Set(AUDIO_EXTENSIONS);
  return argv
    .slice(1)
    .filter((a) => typeof a === 'string' && !a.startsWith('-'))
    .filter((a) => exts.has(path.extname(a).toLowerCase()))
    .filter((a) => {
      try {
        return fs.statSync(a).isFile();
      } catch {
        return false;
      }
    })
    .map((a) => path.resolve(a));
}

/**
 * Escaneo al arrancar.
 *
 * Es incremental, asi que sobre una biblioteca ya vista cuesta milisegundos.
 * Sin esto, la musica que el usuario haya anadido a sus carpetas con la app
 * cerrada no aparece hasta que se acuerde de pulsar "volver a escanear", que
 * no se le va a ocurrir a nadie.
 */
async function escaneoInicial() {
  const folders = settings.get('folders', []);
  if (!folders.length || !library) return;

  const enviar = (canal, datos) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(canal, datos);
  };

  try {
    await library.scan(folders, (p) => enviar('library:progress', p));
  } catch (err) {
    console.error('[main] el escaneo inicial fallo:', err.message);
  }
  for (const track of library.all()) protocols.allowFile(track.path);
  enviar('library:changed', { total: library.size() });
}

async function abrirArchivos(files) {
  if (!files.length || !library || !mainWindow || mainWindow.isDestroyed()) return;
  const tracks = await library.addFiles(files);
  if (!tracks.length) return;
  mainWindow.webContents.send('app:open-files', tracks.map(paraCliente));
}
