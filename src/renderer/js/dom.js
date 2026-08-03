/**
 * Ayudas de DOM y formato.
 *
 * Los glifos de Segoe Fluent Icons viven en el area privada de Unicode y se
 * escriben con su codigo, no con el caracter: pegado literal en un .js se
 * pierde al guardar y lo que aparece en pantalla son cuadraditos.
 */

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export const ICONO = {
  reproducir: 0xe768,
  pausa: 0xe769,
  anterior: 0xe892,
  siguiente: 0xe893,
  aleatorio: 0xe8b1,
  repetirTodo: 0xe8ee,
  repetirUna: 0xe8ed,
  volumen0: 0xe992,
  volumen1: 0xe993,
  volumen2: 0xe994,
  volumen3: 0xe995,
  silencio: 0xe74f,
  musica: 0xe8d6,
  album: 0xe93c,
  carpeta: 0xe8b7,
  anadir: 0xe710,
  abrir: 0xe8e5,
  buscar: 0xe721,
  quitar: 0xe711,
  refrescar: 0xe72c,
  plegar: 0xe76b,
  desplegar: 0xe76c,
  flechaArriba: 0xe70e,
  flechaAbajo: 0xe70d,
  ajustes: 0xe713,
  aPantalla: 0xe740,
  aVentana: 0xe73f,
  descargar: 0xe896,
};

export const glifo = (nombre) => String.fromCharCode(ICONO[nombre] ?? 0xe783);

export function pintarGlifo(el, nombre) {
  if (el) el.textContent = glifo(nombre);
}

export function el(tag, props = {}, hijos = []) {
  const nodo = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') nodo.className = v;
    else if (k === 'dataset') Object.assign(nodo.dataset, v);
    else if (k === 'texto') nodo.textContent = v;
    else if (k.startsWith('on')) nodo.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) nodo.setAttribute(k, v === true ? '' : String(v));
  }
  for (const h of [hijos].flat()) {
    if (h) nodo.append(h);
  }
  return nodo;
}

/** 214 -> '3:34'. Por encima de la hora anade el campo de horas. */
export function formatoTiempo(segundos) {
  if (!Number.isFinite(segundos) || segundos < 0) return '0:00';
  const total = Math.floor(segundos);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const dos = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}

/** '3 canciones' / '1 cancion': el plural mal puesto canta mucho. */
export function plural(n, singular, plural_) {
  return `${n} ${n === 1 ? singular : plural_}`;
}

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
