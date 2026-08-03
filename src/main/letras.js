'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Letras.
 *
 * Se buscan en dos sitios y en este orden:
 *
 *   1. Un .lrc al lado del archivo, con el mismo nombre. Manda sobre la
 *      etiqueta a proposito: si alguien se ha molestado en poner un .lrc
 *      junto a la cancion, es porque el de dentro no le servia.
 *   2. Las etiquetas del propio archivo (USLT y compañia). Pueden traer los
 *      tiempos ya separados, o traer un texto que resulta ser un LRC entero
 *      metido de cualquier manera, que pasa mas de lo que parece.
 *
 * No se guardan en la biblioteca. Una letra son dos o tres kilobytes y
 * multiplicarlos por varios miles de pistas engorda el library.json que se
 * lee entero en cada arranque, para algo que se mira en una cancion de cien.
 */

/** Lo ya buscado, por id de pista. Guarda tambien los "no hay". */
const cache = new Map();
const MAX_CACHE = 200;

let _parseFile = null;
async function getParseFile() {
  if (!_parseFile) {
    const mod = await import('music-metadata');
    _parseFile = mod.parseFile;
  }
  return _parseFile;
}

/**
 * Devuelve { sincronizada, lineas: [{ t, texto }], fuente } o null.
 * En las no sincronizadas `t` es null y el orden es el del texto.
 */
async function buscar(track) {
  if (!track?.path) return null;
  if (cache.has(track.id)) return cache.get(track.id);

  let salida = null;
  try {
    salida = (await deSidecar(track.path)) || (await deEtiquetas(track.path));
  } catch (err) {
    console.warn('[letras] no pude leer las de', path.basename(track.path), '-', err.message);
  }

  cache.set(track.id, salida);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return salida;
}

function olvidar(id) {
  if (id) cache.delete(id);
  else cache.clear();
}

async function deSidecar(archivo) {
  const hermano = path.join(
    path.dirname(archivo),
    `${path.basename(archivo, path.extname(archivo))}.lrc`,
  );
  let crudo;
  try {
    crudo = await leerTexto(hermano);
  } catch {
    return null;
  }
  const parseada = parsearLrc(crudo);
  return parseada ? { ...parseada, fuente: 'archivo' } : null;
}

async function deEtiquetas(archivo) {
  const parseFile = await getParseFile();
  // skipCovers de verdad importa aqui: una caratula de 4 MB tarda mas en
  // decodificarse que todo lo demas junto, y no se va a usar.
  const meta = await parseFile(archivo, { duration: false, skipCovers: true, skipPostHeaders: true });
  const etiquetas = meta?.common?.lyrics;
  if (!etiquetas) return null;

  const lista = Array.isArray(etiquetas) ? etiquetas : [etiquetas];
  for (const entrada of lista) {
    // Con los tiempos ya separados por el propio archivo no hay nada que
    // parsear: solo pasarlos a segundos, que vienen en milisegundos.
    if (Array.isArray(entrada?.syncText) && entrada.syncText.length) {
      const lineas = entrada.syncText
        .map((s) => ({ t: msASegundos(s.timestamp), texto: limpiar(s.text) }))
        .filter((l) => l.texto !== null);
      if (lineas.some((l) => l.t !== null)) {
        lineas.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
        return { sincronizada: true, lineas, fuente: 'etiqueta' };
      }
      if (lineas.length) return { sincronizada: false, lineas, fuente: 'etiqueta' };
    }

    const texto = typeof entrada === 'string' ? entrada : entrada?.text;
    if (typeof texto !== 'string' || !texto.trim()) continue;

    // Un LRC completo dentro de la etiqueta de texto plano es de lo mas
    // corriente: si trae corchetes con tiempos, se parsea como tal.
    const parseada = parsearLrc(texto);
    if (parseada) return { ...parseada, fuente: 'etiqueta' };

    const lineas = texto.split(/\r?\n/).map((l) => ({ t: null, texto: l.trim() }));
    if (lineas.some((l) => l.texto)) return { sincronizada: false, lineas, fuente: 'etiqueta' };
  }
  return null;
}

/**
 * Parsea un LRC.
 *
 * Devuelve null si el texto no trae ni un tiempo: asi quien llama sabe que
 * tiene un texto plano entre manos y no una letra sincronizada vacia.
 */
function parsearLrc(crudo) {
  if (typeof crudo !== 'string' || !crudo.trim()) return null;

  const desfase = leerDesfase(crudo);
  const lineas = [];
  let algunTiempo = false;

  for (const bruta of crudo.split(/\r?\n/)) {
    const linea = bruta.replace(/^\uFEFF/, '');
    // Una misma letra puede llevar varios tiempos delante cuando el estribillo
    // se repite: [00:42.10][01:58.30]No me esperes. Son varias entradas.
    const tiempos = [];
    let resto = linea;
    for (;;) {
      const m = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(resto);
      if (!m) break;
      tiempos.push(aSegundos(m[1], m[2], m[3]));
      resto = resto.slice(m[0].length);
    }

    if (!tiempos.length) {
      // Sin tiempos solo queda texto suelto o una etiqueta [ti:...]. Las
      // etiquetas se descartan; el texto suelto se guarda por si el archivo
      // resulta no estar sincronizado del todo.
      const suelto = limpiar(linea);
      if (suelto && !/^\s*\[[a-z]+:/i.test(linea)) lineas.push({ t: null, texto: suelto });
      continue;
    }

    algunTiempo = true;
    const texto = limpiar(resto);
    for (const t of tiempos) {
      lineas.push({ t: Math.max(0, t - desfase), texto: texto ?? '' });
    }
  }

  if (!algunTiempo) return null;

  // Solo se queda con las que llevan tiempo: mezclar sueltas en una letra
  // sincronizada las dejaria pegadas al principio sin poder seguirlas.
  const conTiempo = lineas.filter((l) => l.t !== null);
  conTiempo.sort((a, b) => a.t - b.t);
  return { sincronizada: true, lineas: conTiempo };
}

/**
 * [offset:+250] corre la letra un cuarto de segundo.
 *
 * Por convencion el signo va al reves de lo que uno diria: un offset positivo
 * adelanta la letra, o sea que hay que RESTARLO de los tiempos.
 */
function leerDesfase(crudo) {
  const m = /\[offset:\s*([+-]?\d+)\s*\]/i.exec(crudo);
  return m ? Number(m[1]) / 1000 : 0;
}

function aSegundos(min, seg, frac) {
  const decimales = frac ? Number(`0.${frac}`) : 0;
  return Number(min) * 60 + Number(seg) + decimales;
}

function msASegundos(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? ms / 1000 : null;
}

/** Quita las marcas de palabra del LRC mejorado: <00:12.34>. */
function limpiar(texto) {
  if (typeof texto !== 'string') return null;
  return texto.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim();
}

/**
 * Lee el .lrc respetando su codificacion.
 *
 * Muchos vienen en la pagina de codigos de Windows y no en UTF-8. Leerlos
 * siempre como UTF-8 llena los acentos de rombos negros con interrogacion,
 * asi que si aparecen se relee como latin1, que para español acierta.
 */
async function leerTexto(archivo) {
  const bytes = await fsp.readFile(archivo);
  const utf8 = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const rotos = (utf8.match(/\uFFFD/g) || []).length;
  if (rotos === 0) return utf8;
  return bytes.toString('latin1');
}

module.exports = { buscar, olvidar, parsearLrc };
