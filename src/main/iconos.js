'use strict';

const { nativeImage } = require('electron');

/**
 * Iconos dibujados a mano, sin archivos.
 *
 * Los botones de la miniatura de la barra de tareas y el distintivo del icono
 * quieren NativeImage. Lo normal seria meter cuatro PNG en el repo, pero son
 * cuatro triangulos y dos rectangulos: guardarlos como binarios significa que
 * nadie los puede tocar, que hay que mantener la version 16 y la 32 a mano, y
 * que cambiar el color obliga a reexportar.
 *
 * Aqui se rasterizan. `nativeImage.createFromBitmap` acepta el mapa de bits en
 * crudo, en orden BGRA y con el alfa premultiplicado, que es exactamente lo
 * que sale de pintar en blanco: los tres canales valen lo mismo que el alfa.
 *
 * El dentado se quita por supermuestreo: se evalua la forma 16 veces por pixel
 * y la cobertura resultante es el alfa. A 16x16 un triangulo sin suavizar se
 * ve como una escalera.
 */

/** Muestras por lado y pixel. 4 -> 16 por pixel, de sobra a este tamano. */
const SS = 4;

/** Formas, en coordenadas normalizadas 0..1 sobre el lado del icono. */
const FORMAS = {
  reproducir: () => [triangulo(0.28, 0.2, 0.28, 0.8, 0.78, 0.5)],
  pausa: () => [rect(0.3, 0.2, 0.14, 0.6), rect(0.56, 0.2, 0.14, 0.6)],
  anterior: () => [rect(0.24, 0.2, 0.12, 0.6), triangulo(0.78, 0.2, 0.78, 0.8, 0.4, 0.5)],
  siguiente: () => [rect(0.64, 0.2, 0.12, 0.6), triangulo(0.22, 0.2, 0.22, 0.8, 0.6, 0.5)],
};

/**
 * La marca: las mismas cinco barras del SVG de la barra de titulo.
 *
 * Ahi el trazo es de 1.6 sobre 16, o sea 0.1 del lado. A 16 pixeles reales eso
 * es barra y media y en la bandeja del sistema se pierde, asi que aqui van
 * algo mas gruesas. Es el unico sitio donde la marca se separa del SVG, y es
 * por legibilidad, no por descuido.
 */
const LOGO = () => [
  rect(0.105, 0.45, 0.13, 0.10),
  rect(0.248, 0.3125, 0.13, 0.375),
  rect(0.435, 0.1625, 0.13, 0.675),
  rect(0.623, 0.3125, 0.13, 0.375),
  rect(0.766, 0.45, 0.13, 0.10),
];

/** El distintivo lleva disco de fondo y el glifo calado encima. */
const DISTINTIVOS = {
  reproducir: { fondo: [circulo(0.5, 0.5, 0.5)], hueco: FORMAS.reproducir() },
  pausa: { fondo: [circulo(0.5, 0.5, 0.5)], hueco: FORMAS.pausa() },
};

/** Azul por defecto de la app. El acento adaptativo vive en el renderer. */
const ACENTO = [122, 162, 247];

/**
 * Glifo blanco sobre transparente, con las dos resoluciones que pide Windows.
 *
 * Sin la representacion a 32, en un monitor al 200% el boton sale borroso: el
 * sistema estira la de 16 en vez de pedir la buena.
 */
function glifo(nombre) {
  const dibujar = FORMAS[nombre];
  if (!dibujar) return nativeImage.createEmpty();
  return conRepresentaciones((tam) => pintar(tam, { formas: dibujar(), color: [255, 255, 255] }));
}

/** La marca de Sounde en el color de acento, para la bandeja del sistema. */
function marca() {
  return conRepresentaciones((tam) => pintar(tam, { formas: LOGO(), color: ACENTO }));
}

/** Distintivo para el icono de la barra de tareas: disco con el glifo calado. */
function distintivo(nombre) {
  const receta = DISTINTIVOS[nombre];
  if (!receta) return nativeImage.createEmpty();
  return conRepresentaciones((tam) => pintar(tam, { ...receta, color: ACENTO }));
}

function conRepresentaciones(pintarTam) {
  const base = pintarTam(16);
  const img = nativeImage.createFromBitmap(base, { width: 16, height: 16 });
  img.addRepresentation({
    scaleFactor: 2,
    width: 32,
    height: 32,
    buffer: pintarTam(32),
  });
  return img;
}

/**
 * Rasteriza a un buffer BGRA premultiplicado.
 * `hueco` resta cobertura: es lo que cala el glifo dentro del disco.
 */
function pintar(tam, { formas = [], hueco = [], fondo = null, color }) {
  const dentro = fondo || formas;
  const cobertura = new Float32Array(tam * tam);
  const peso = 1 / (SS * SS);
  const n = tam * SS;

  for (let y = 0; y < n; y++) {
    const py = (y + 0.5) / (tam * SS);
    const fila = Math.floor(y / SS) * tam;
    for (let x = 0; x < n; x++) {
      const px = (x + 0.5) / (tam * SS);
      if (!dentro.some((f) => f(px, py))) continue;
      if (hueco.length && hueco.some((f) => f(px, py))) continue;
      cobertura[fila + Math.floor(x / SS)] += peso;
    }
  }

  const buf = Buffer.alloc(tam * tam * 4);
  const [r, g, b] = color;
  for (let i = 0; i < cobertura.length; i++) {
    const a = Math.min(1, cobertura[i]);
    if (a <= 0) continue;
    const o = i * 4;
    // Premultiplicado: cada canal escalado por el alfa. Sin esto los bordes
    // suavizados salen con un halo claro.
    buf[o] = Math.round(b * a);
    buf[o + 1] = Math.round(g * a);
    buf[o + 2] = Math.round(r * a);
    buf[o + 3] = Math.round(a * 255);
  }
  return buf;
}

// --- Formas ---------------------------------------------------------------

function rect(x, y, w, h) {
  return (px, py) => px >= x && px <= x + w && py >= y && py <= y + h;
}

function circulo(cx, cy, r) {
  const r2 = r * r;
  return (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r2;
}

/** Punto dentro del triangulo por el signo de los tres productos cruzados. */
function triangulo(ax, ay, bx, by, cx, cy) {
  const lado = (px, py, x1, y1, x2, y2) => (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
  return (px, py) => {
    const d1 = lado(px, py, ax, ay, bx, by);
    const d2 = lado(px, py, bx, by, cx, cy);
    const d3 = lado(px, py, cx, cy, ax, ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
}

module.exports = { glifo, distintivo, marca };
