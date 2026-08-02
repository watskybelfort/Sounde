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

  // --- App ----------------------------------------------------------------
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    onOpenFiles: (h) => on('app:open-files', h),
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
