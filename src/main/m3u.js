'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Lectura y escritura de listas m3u / m3u8.
 *
 * El formato es un archivo de texto con una ruta por linea y, opcionalmente,
 * lineas #EXTINF con duracion y titulo. Es el unico formato que entienden
 * todos los reproductores, asi que es la puerta de entrada y salida natural
 * de las listas.
 */

/**
 * Las rutas se escriben relativas al archivo de la lista siempre que se
 * pueda. Con rutas absolutas, mover la carpeta de musica o llevarse la lista
 * a otro equipo la deja apuntando a la nada.
 */
function serializar(pistas, destino) {
  const dir = path.dirname(destino);
  const lineas = ['#EXTM3U'];

  for (const t of pistas) {
    const segundos = Math.round(t.duration || 0);
    lineas.push(`#EXTINF:${segundos},${t.artist} - ${t.title}`);
    lineas.push(rutaRelativa(dir, t.path));
  }

  // Terminar en salto de linea: algunos lectores se comen la ultima entrada
  // si el archivo acaba sin el.
  return `${lineas.join('\r\n')}\r\n`;
}

function rutaRelativa(dir, absoluta) {
  const rel = path.relative(dir, absoluta);
  // Un `..` al principio es lo normal y correcto: la lista casi nunca esta
  // dentro de la carpeta de musica. Lo unico que hay que descartar es que
  // esten en unidades distintas, y ahi path.relative ya devuelve una ruta
  // absoluta porque no existe camino relativo entre C: y D:.
  if (!rel || path.isAbsolute(rel)) return absoluta;
  // Barras normales aunque estemos en Windows: es lo que espera el formato y
  // lo que sabe leer cualquier otro reproductor.
  return rel.split(path.sep).join('/');
}

async function escribir(destino, pistas) {
  await fsp.writeFile(destino, serializar(pistas, destino), 'utf8');
  return { archivo: destino, pistas: pistas.length };
}

/**
 * Devuelve las rutas absolutas que contiene la lista, en su orden.
 * Se ignoran comentarios y URLs remotas: esto es un reproductor local.
 */
async function leer(origen) {
  const bruto = await fsp.readFile(origen, 'utf8');
  const dir = path.dirname(origen);
  const salida = [];

  // El BOM tambien aparece en los m3u8 guardados desde el Bloc de notas y
  // pegado a la primera ruta la convierte en un archivo que no existe.
  for (const linea of bruto.replace(/^﻿/, '').split(/\r?\n/)) {
    const texto = linea.trim();
    if (!texto || texto.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(texto)) continue;
    salida.push(path.resolve(dir, texto.split('/').join(path.sep)));
  }

  return salida;
}

module.exports = { serializar, escribir, leer };
