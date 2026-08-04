'use strict';

/**
 * Valores por defecto de todo lo persistente.
 *
 * OJO con la diferencia que confunde a todo el mundo:
 *   - `backdropAlpha` es la veladura que DWM pone DETRAS de la pagina,
 *     mezclada con el escritorio difuminado. Sube el numero y el escritorio
 *     se ve menos.
 *   - `--tinte` del CSS (theme/acrylic.css) es la veladura que la pagina
 *     pinta ENCIMA. Sube el numero y la UI se ve mas solida.
 * Son capas distintas y se suman. Si el vidrio se ve turbio, casi siempre
 * sobra la de CSS, no la de DWM.
 */

const DEFAULT_SETTINGS = {
  // --- Vidrio -------------------------------------------------------------
  // 'acrylic'        acrilico del sistema (Win11). Windows lo apaga solo
  //                  cuando la ventana pierde el foco: es su comportamiento.
  // 'acrylic-always' acrilico via SetWindowCompositionAttribute. Se mantiene
  //                  difuminado aunque la ventana no tenga el foco.
  // 'mica'           mica del sistema (tinta el fondo, difumina menos).
  // 'tabbed'         mica alternativa, un punto mas oscura.
  // 'none'           sin backdrop del sistema, la UI pinta su propio fondo.
  backdrop: 'acrylic',
  backdropTint: '#0E1116',
  backdropAlpha: 96, // 0..255, solo aplica en 'acrylic-always'

  // --- Color adaptativo ---------------------------------------------------
  adaptiveColor: true, // el tinte y el acento salen de la caratula
  accentFallback: '#7AA2F7',
  glassOpacity: 0.42, // veladura del CSS, la de ENCIMA
  contrastBoost: 0, // -20..20, sube el contraste del texto sobre vidrio

  // --- Reproduccion -------------------------------------------------------
  volume: 0.8,
  muted: false,
  repeat: 'off', // 'off' | 'all' | 'one'
  shuffle: false,
  crossfadeSeconds: 0, // 0 = pegado (gapless), >0 = fundido cruzado
  playbackRate: 1,
  normalizeVolume: true, // usa ReplayGain si el archivo lo trae
  resumeOnLaunch: true,

  // --- Ecualizador --------------------------------------------------------
  eqEnabled: false,
  eqPreset: 'flat',
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  preampDb: 0,

  // --- Biblioteca ---------------------------------------------------------
  folders: [],
  sortBy: 'title',
  sortDir: 'asc',
  view: 'songs',
  sidebarCollapsed: false,
  queueOpen: false,
  // Un clic en la lista reproduce; apagado, hace falta el doble clic.
  clickToPlay: true,
  // Listas remotas que el usuario ha escondido, por servicio:
  // { spotify: ['id', ...], youtube: [...] }
  hiddenPlaylists: {},
  // Canciones locales escondidas, por id. El archivo NO se toca: esto solo
  // decide que no aparezca en la aplicacion, y se deshace entero.
  hiddenTracks: [],
  // Servicios con el grupo del lateral plegado, por id: ['youtube', ...]
  collapsedServices: [],

  // --- Ventana ------------------------------------------------------------
  bounds: null,
  maximized: false,
  miniPlayer: false,

  // --- Sistema ------------------------------------------------------------
  minimizeToTray: false,
  showNotifications: true,
  mediaKeys: true,
  visualizer: 'bars', // 'bars' | 'wave' | 'off'
};

// Extensiones que Chromium puede decodificar de verdad. Deliberadamente NO
// incluye wma, ape ni dsd: se listarian en la UI y luego no sonarian.
const AUDIO_EXTENSIONS = [
  '.mp3', '.m4a', '.m4b', '.aac', '.flac', '.wav', '.ogg', '.oga',
  '.opus', '.weba', '.webm', '.mka', '.mp4',
];

const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  graves: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  agudos: [0, 0, 0, 0, 0, 1, 3, 4, 5, 6],
  vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  trap: [7, 6, 3, 0, -1, 0, 1, 2, 3, 3],
  reggaeton: [6, 5, 2, 0, -1, 1, 2, 2, 2, 1],
  acustico: [3, 2, 1, 0, 1, 2, 3, 3, 2, 1],
  nocturno: [-3, -2, -1, 0, 1, 1, 0, -1, -2, -3],
};

module.exports = { DEFAULT_SETTINGS, AUDIO_EXTENSIONS, EQ_BANDS, EQ_PRESETS };
