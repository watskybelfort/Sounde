'use strict';

const { Tray, Menu } = require('electron');

const { marca } = require('./iconos');

/**
 * Bandeja del sistema.
 *
 * Apagada por defecto, porque cambia una cosa que la gente da por sabida: con
 * la bandeja puesta, la X de la ventana esconde en vez de cerrar. Es lo que se
 * quiere de un reproductor (la musica no debe parar porque hayas cerrado la
 * ventana) pero no es lo que se espera de una ventana cualquiera, asi que se
 * pide a proposito.
 *
 * Salir de verdad se hace desde el menu de la bandeja.
 */

let bandeja = null;
let ctx = null;
let ultimo = { titulo: null, artista: null, sonando: false, hayPista: false };

function activa() {
  return !!bandeja;
}

/**
 * Enciende o apaga la bandeja segun el ajuste.
 * `contexto` lleva { getWindow, mandar, salir }.
 */
function sincronizar(encendida, contexto) {
  ctx = contexto || ctx;
  if (encendida && !bandeja) crear();
  else if (!encendida && bandeja) destruir();
  return activa();
}

function crear() {
  bandeja = new Tray(marca());
  bandeja.setToolTip('Sounde');

  // Un clic normal la trae y la esconde otra vez, que es lo que hace todo el
  // mundo con el icono de la bandeja sin pensarlo.
  bandeja.on('click', alternarVentana);
  bandeja.on('double-click', mostrarVentana);

  pintarMenu();
}

function destruir() {
  if (!bandeja) return;
  bandeja.destroy();
  bandeja = null;
}

/** `track` es la pista de la biblioteca, o null. */
function actualizar({ track, sonando, hayPista } = {}) {
  const nuevo = {
    titulo: track?.title ?? null,
    artista: track?.artist ?? null,
    sonando: !!sonando,
    hayPista: !!hayPista,
  };
  const igual = Object.keys(nuevo).every((k) => nuevo[k] === ultimo[k]);
  if (igual) return;
  ultimo = nuevo;
  if (!bandeja) return;

  bandeja.setToolTip(nuevo.titulo
    ? `${nuevo.titulo}${nuevo.artista ? ` — ${nuevo.artista}` : ''}`
    : 'Sounde');
  // El menu de Electron es inmutable: para que "Reproducir" pase a "Pausar"
  // hay que construirlo otra vez.
  pintarMenu();
}

function pintarMenu() {
  if (!bandeja) return;
  const mandar = (orden) => () => ctx?.mandar?.(orden);

  bandeja.setContextMenu(Menu.buildFromTemplate([
    // Cabecera muerta: dice lo que suena sin obligar a posar el raton encima
    // para leer el tooltip.
    { label: ultimo.titulo || 'Nada sonando', enabled: false },
    { type: 'separator' },
    { label: 'Anterior', enabled: ultimo.hayPista, click: mandar('prev') },
    {
      label: ultimo.sonando ? 'Pausar' : 'Reproducir',
      enabled: true,
      click: mandar('toggle'),
    },
    { label: 'Siguiente', enabled: ultimo.hayPista, click: mandar('next') },
    { type: 'separator' },
    { label: 'Mostrar Sounde', click: mostrarVentana },
    { label: 'Salir', click: () => ctx?.salir?.() },
  ]));
}

function mostrarVentana() {
  const win = ctx?.getWindow?.();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function alternarVentana() {
  const win = ctx?.getWindow?.();
  if (!win || win.isDestroyed()) return;
  if (win.isVisible() && !win.isMinimized()) win.hide();
  else mostrarVentana();
}

module.exports = { sincronizar, actualizar, activa, destruir };
