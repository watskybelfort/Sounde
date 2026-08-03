'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Unico puente entre la pagina y el proceso principal.
 *
 * El preload corre en sandbox y con contextIsolation, asi que la pagina
 * nunca ve `require` ni el modulo `electron`: solo estos metodos.
 */

/** Suscribe a un canal y devuelve la funcion para darse de baja. */
function on(channel, handler) {
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

/**
 * Los archivos de "Abrir con..." se guardan hasta que la pagina los pida.
 *
 * El proceso principal los manda en cuanto termina de cargar el documento,
 * pero el arranque del renderer es asincrono: para cuando boot() ha leido los
 * ajustes y montado el motor de audio, ese aviso ya paso y no lo escucho
 * nadie. El sintoma era el peor posible para un reproductor predeterminado:
 * doble clic en una cancion, se abre Sounde, y no suena nada. Con la app ya
 * abierta si funcionaba, que es lo que despista.
 *
 * El preload se ejecuta ANTES que cualquier script de la pagina, asi que
 * suscribirse aqui llega siempre a tiempo.
 */
const archivosPendientes = [];
let alRecibirArchivos = null;

ipcRenderer.on('app:open-files', (_event, tracks) => {
  if (alRecibirArchivos) alRecibirArchivos(tracks);
  else archivosPendientes.push(tracks);
});

contextBridge.exposeInMainWorld('sounde', {
  // --- Ventana ------------------------------------------------------------
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    setMini: (enabled) => ipcRenderer.invoke('window:set-mini', enabled),
    getState: () => ipcRenderer.invoke('window:get-state'),
    onState: (h) => on('window:state', h),
    onFocus: (h) => on('window:focus', h),
    onMini: (h) => on('window:mini', h),
  },

  // --- Reproduccion en el sistema -----------------------------------------
  player: {
    /** Avisa de como va la reproduccion: barra de tareas, botones, distintivo. */
    report: (estado) => ipcRenderer.send('player:state', estado),
    onCommand: (h) => on('player:command', h),
  },

  // --- Ajustes ------------------------------------------------------------
  settings: {
    all: () => ipcRenderer.invoke('settings:all'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    onChange: (h) => on('settings:changed', h),
  },

  // --- Vidrio -------------------------------------------------------------
  backdrop: {
    apply: (mode) => ipcRenderer.invoke('backdrop:apply', mode),
  },

  // --- Biblioteca ---------------------------------------------------------
  library: {
    all: () => ipcRenderer.invoke('library:all'),
    folders: () => ipcRenderer.invoke('library:folders'),
    scan: () => ipcRenderer.invoke('library:scan'),
    cancelScan: () => ipcRenderer.invoke('library:cancel-scan'),
    addFolder: () => ipcRenderer.invoke('library:add-folder'),
    removeFolder: (folder) => ipcRenderer.invoke('library:remove-folder', folder),
    openFiles: () => ipcRenderer.invoke('library:open-files'),
    addPaths: (paths) => ipcRenderer.invoke('library:add-paths', paths),
    reveal: (file) => ipcRenderer.invoke('library:reveal', file),
    onProgress: (h) => on('library:progress', h),
    onChanged: (h) => on('library:changed', h),

    /**
     * Desde Electron 32 los objetos File ya no traen `.path`. La unica via
     * legitima para saber que se solto es esta, y solo existe en el preload.
     */
    pathsFromDrop: (fileList) => {
      const salida = [];
      for (const file of fileList) {
        try {
          const p = webUtils.getPathForFile(file);
          if (p) salida.push(p);
        } catch { /* no era un archivo real del disco */ }
      }
      return salida;
    },
  },

  // --- Favoritos e historial ----------------------------------------------
  collections: {
    all: () => ipcRenderer.invoke('coll:all'),
    toggleFavorite: (id) => ipcRenderer.invoke('coll:toggle-favorite', id),
    played: (id) => ipcRenderer.invoke('coll:played', id),
    recent: (limite) => ipcRenderer.invoke('coll:recent', limite),
    onChange: (h) => on('coll:changed', h),
    onPlayed: (h) => on('coll:played', h),
  },

  // --- Listas de reproduccion ---------------------------------------------
  playlists: {
    all: () => ipcRenderer.invoke('pl:all'),
    create: (name, trackIds) => ipcRenderer.invoke('pl:create', name, trackIds),
    rename: (id, name) => ipcRenderer.invoke('pl:rename', id, name),
    remove: (id) => ipcRenderer.invoke('pl:remove', id),
    add: (id, trackIds) => ipcRenderer.invoke('pl:add', id, trackIds),
    removeAt: (id, indice) => ipcRenderer.invoke('pl:remove-at', id, indice),
    move: (id, desde, hasta) => ipcRenderer.invoke('pl:move', id, desde, hasta),
    setTracks: (id, trackIds) => ipcRenderer.invoke('pl:set-tracks', id, trackIds),
    exportar: (id) => ipcRenderer.invoke('pl:export', id),
    importar: () => ipcRenderer.invoke('pl:import'),
    onChange: (h) => on('coll:playlists', h),
  },

  // --- Spotify --------------------------------------------------------------
  /*
   * Solo lectura del catalogo: no hay nada aqui que modifique la cuenta del
   * usuario en Spotify, igual que los permisos que se piden al conectar.
   * Ninguna peticion sale de la pagina — todas cruzan a este puente y viajan
   * desde el proceso principal, que es lo que permite dejar la CSP sin
   * `connect-src`.
   */
  servicios: {
    todos: () => ipcRenderer.invoke('svc:all'),
    estado: (svc) => ipcRenderer.invoke('svc:state', svc),
    setClientId: (svc, valor) => ipcRenderer.invoke('svc:set-client-id', svc, valor),
    setClientSecret: (svc, valor) => ipcRenderer.invoke('svc:set-client-secret', svc, valor),
    conectar: (svc) => ipcRenderer.invoke('svc:connect', svc),
    desconectar: (svc) => ipcRenderer.invoke('svc:disconnect', svc),
    sincronizar: (svc) => ipcRenderer.invoke('svc:sync', svc),
    cancelar: (svc) => ipcRenderer.invoke('svc:cancel-sync', svc),
    listas: (svc) => ipcRenderer.invoke('svc:playlists', svc),
    lista: (svc, id) => ipcRenderer.invoke('svc:playlist', svc, id),
    exportarFaltantes: (datos) => ipcRenderer.invoke('svc:export-missing', datos),
    onProgreso: (h) => on('svc:progress', h),
    onCambio: (h) => on('svc:changed', h),
  },

  // --- Letras ---------------------------------------------------------------
  lyrics: {
    para: (id) => ipcRenderer.invoke('lyrics:for', id),
    olvidar: (id) => ipcRenderer.invoke('lyrics:forget', id),
  },

  // --- App ----------------------------------------------------------------
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    constants: () => ipcRenderer.invoke('app:constants'),
    abrirExterno: (url) => ipcRenderer.invoke('app:open-external', url),

    onOpenFiles: (h) => {
      alRecibirArchivos = h;
      // Lo que llego mientras la pagina arrancaba se entrega ahora, en orden.
      while (archivosPendientes.length) h(archivosPendientes.shift());
      return () => { alRecibirArchivos = null; };
    },
  },

  // --- Entorno ------------------------------------------------------------
  env: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  },
});
