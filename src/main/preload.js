'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
