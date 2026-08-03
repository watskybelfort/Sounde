'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { BrowserWindow, nativeTheme, screen } = require('electron');

const ROOT = path.join(__dirname, '..', '..');
const NATIVE_SCRIPT = path.join(ROOT, 'tools', 'acrylic-native.ps1');

const MAIN_MIN = { width: 960, height: 640 };
// 136 de alto = 30 de barra de titulo + 106 de transporte. El ancho da para
// la caratula, dos lineas de texto y una barra de posicion que todavia se
// puede pinchar; por debajo de ~400 la barra se queda en un muñon inutil.
const MINI_SIZE = { width: 460, height: 136 };
const MINI_MIN_WIDTH = 380;

/** Estado del ultimo tamano "grande", para volver desde el mini-player. */
let restoreBounds = null;

/** Ultimo modo de vidrio aplicado, para saber si hay que limpiar antes. */
let lastMode = null;

/**
 * `backdrop-filter` NO puede difuminar el escritorio: solo muestrea pixeles
 * que ya estan dentro de la pagina. Como la ventana de Sounde compone con
 * alfa, el desenfoque del escritorio lo pone DWM sobre la ventana entera y
 * el CSS se limita a NO pintar opaco.
 *
 * Por eso `backdrop-filter` en esta app vive unicamente en menus, modales y
 * tooltips: ahi si hay pixeles de la propia UI debajo que difuminar.
 */
function createMainWindow(settings) {
  const saved = settings.get('bounds');
  const bounds = isOnScreen(saved) ? saved : null;

  const win = new BrowserWindow({
    width: bounds?.width ?? 1180,
    height: bounds?.height ?? 760,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: MAIN_MIN.width,
    minHeight: MAIN_MIN.height,
    show: false,
    frame: false,
    // transparent:true apagaria el backdrop del sistema. La ventana tiene que
    // ser opaca "para Electron" y llevar el color de fondo con alfa 0 para
    // que DWM sea quien componga el acrilico.
    transparent: false,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    roundedCorners: true,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    title: 'Sounde',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false, // o el visualizador se congela de fondo
    },
  });

  win.setMenuBarVisibility(false);
  nativeTheme.themeSource = 'dark';

  if (settings.get('maximized')) win.maximize();

  win.once('ready-to-show', () => win.show());

  const persist = debounce(() => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    settings.set('maximized', maximized);
    if (!maximized && !isMini(win)) settings.set('bounds', win.getBounds());
  }, 400);

  win.on('resize', persist);
  win.on('move', persist);
  win.on('maximize', () => emit(win, 'window:state', { maximized: true }));
  win.on('unmaximize', () => emit(win, 'window:state', { maximized: false }));

  // Windows apaga el acrilico del sistema cuando la ventana pierde el foco.
  // No es un fallo: hay que avisarle a la UI para que compense la veladura,
  // o al desenfocar parece que el tema se rompio.
  win.on('focus', () => emit(win, 'window:focus', { focused: true }));
  win.on('blur', () => emit(win, 'window:focus', { focused: false }));

  applyBackdrop(win, settings);
  return win;
}

/**
 * Aplica el backdrop segun ajustes.
 *
 * 'acrylic' | 'mica' | 'tabbed' | 'none' los resuelve Electron contra DWM.
 * 'acrylic-always' baja a la capa nativa porque es el unico modo que
 * sobrevive a perder el foco.
 */
function applyBackdrop(win, settings) {
  const mode = settings.get('backdrop', 'acrylic');
  const native = mode === 'acrylic-always';

  // El Off nativo SOLO se usa para salir del modo nativo. Lanzarlo siempre
  // "por limpieza" rompe justo lo que se queria arreglar: recoge el marco
  // extendido a margenes 0 y deja DWMWA_SYSTEMBACKDROP_TYPE en None, y
  // setBackgroundMaterial no lo vuelve a extender. El sintoma es enganoso:
  // la ventana queda transparente y el escritorio se ve detras perfecto, a
  // filo, sin una gota de desenfoque.
  const veniaDeNativo = lastMode === 'acrylic-always';
  lastMode = mode;

  const aplicar = () => {
    if (win.isDestroyed()) return;
    try {
      if (native) {
        win.setBackgroundMaterial('none');
        runNative('Acrylic', settings);
      } else {
        win.setBackgroundMaterial(mode);
      }
    } catch (err) {
      console.error('[backdrop] setBackgroundMaterial fallo:', err.message);
    }
  };

  if (veniaDeNativo) runNative('Off', settings, aplicar);
  else aplicar();

  return mode;
}

function runNative(mode, settings, done) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', NATIVE_SCRIPT,
    '-TargetPid', String(process.pid),
    '-Mode', mode,
    '-Tint', settings.get('backdropTint', '#0E1116'),
    '-Alpha', String(settings.get('backdropAlpha', 96)),
  ];
  execFile('powershell.exe', args, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
    if (err) console.error('[backdrop] capa nativa fallo:', err.message);
    else if (stdout) console.log('[backdrop]', stdout.trim());
    if (done) done();
  });
}

/** Mini-player: barra compacta, siempre encima, sin redimension vertical. */
function setMiniPlayer(win, enabled) {
  if (win.isDestroyed()) return false;
  if (enabled) {
    if (win.isMaximized()) win.unmaximize();
    // Solo se apunta el tamano grande si veniamos de el. Entrar dos veces en
    // mini guardaria las medidas del propio mini y ya no habria vuelta.
    if (!isMini(win)) restoreBounds = win.getBounds();
    win.setMinimumSize(MINI_MIN_WIDTH, MINI_SIZE.height);
    // Ancho libre, alto clavado: la maqueta del mini es de dos filas fijas y
    // estirarla en vertical solo reparte aire feo.
    win.setMaximumSize(4096, MINI_SIZE.height);
    win.setSize(MINI_SIZE.width, MINI_SIZE.height, true);
    win.setAlwaysOnTop(true, 'floating');
    win.setMaximizable(false);
  } else {
    win.setAlwaysOnTop(false);
    win.setMaximizable(true);
    // El orden importa: con el maximo todavia puesto en 136, el setSize de
    // abajo se recorta contra el y la ventana vuelve del mini aplastada.
    win.setMaximumSize(0, 0);
    win.setMinimumSize(MAIN_MIN.width, MAIN_MIN.height);
    const b = restoreBounds ?? { width: 1180, height: 760 };
    win.setSize(b.width, b.height, true);
    if (restoreBounds) win.setPosition(restoreBounds.x, restoreBounds.y, true);
  }
  emit(win, 'window:mini', { mini: enabled });
  return enabled;
}

function isMini(win) {
  return win.isAlwaysOnTop() && win.getSize()[1] <= MINI_SIZE.height + 8;
}

/** Una ventana guardada en un monitor que ya no existe abre fuera de pantalla. */
function isOnScreen(bounds) {
  if (!bounds || typeof bounds.x !== 'number') return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return (
      bounds.x < a.x + a.width &&
      bounds.x + bounds.width > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + bounds.height > a.y
    );
  });
}

function emit(win, channel, payload) {
  if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

module.exports = { createMainWindow, applyBackdrop, setMiniPlayer, runNative, MINI_SIZE };
