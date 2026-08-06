'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
/** El mismo azul, hundido, para el degradado del icono grande. */
const ACENTO_HONDO = [69, 104, 190];

/**
 * Las barras del icono de la aplicacion.
 *
 * Mas gruesas y mas cortas que las de la bandeja: aqui viven dentro de un
 * cuadrado con margen, no sueltas sobre el fondo, y con el trazo fino se
 * perderian contra el azul.
 */
const LOGO_GORDO = () => [
  rect(0.185, 0.455, 0.09, 0.09),
  rect(0.335, 0.335, 0.09, 0.33),
  rect(0.455, 0.215, 0.09, 0.57),
  rect(0.575, 0.335, 0.09, 0.33),
  rect(0.725, 0.455, 0.09, 0.09),
];

/** Por debajo de aqui las barras se cuadran con la rejilla de pixeles. */
const MENUDO = 24;

/** Las alturas de las cinco barras, en fraccion del lado. */
const ALTURAS = [0.09, 0.33, 0.57, 0.33, 0.09];

/**
 * Las mismas barras, pero calculadas en pixeles enteros.
 *
 * A 16 pixeles las del dibujo grande miden 1,44 y empiezan a 2,96: cada una
 * cae a caballo entre dos pixeles, el suavizado las reparte en dos medias
 * tintas, y las cinco juntas se leen como una mancha con un bulto en medio.
 * Es el unico tamaño donde el icono no se entendia.
 *
 * Aqui los bordes se colocan sobre la rejilla, asi que cada barra cubre sus
 * pixeles enteros y ninguno a medias: el suavizado no tiene nada que repartir
 * y salen limpias. El paso es uniforme —el dibujo grande abre mas los huecos
 * de fuera que los de dentro— porque a un pixel de hueco no se le puede quitar
 * nada, y mantenerlo igual en los cuatro es lo que deja la marca simetrica.
 *
 * El cuadrado de fondo NO se cuadra: sus esquinas redondeadas viven del
 * suavizado y sin el se vuelven un escalon.
 */
function logoMenudo(tam) {
  const ancho = Math.max(1, Math.round(tam * 0.09));
  const paso = ancho + Math.max(1, Math.round(tam * 0.055));
  const centro = tam / 2;
  // La barra del medio queda centrada y las otras cuatro caen a dos pasos.
  const primera = Math.round(centro - paso * 2 - ancho / 2);

  return ALTURAS.map((fraccion, i) => {
    const alto = Math.max(1, Math.round(tam * fraccion));
    const x = primera + paso * i;
    const y = Math.round(centro - alto / 2);
    return rect(x / tam, y / tam, ancho / tam, alto / tam);
  });
}

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

/**
 * El icono de la aplicacion, en color y a cualquier tamaño.
 *
 * Barras blancas sobre cuadrado azul, no al reves. Un icono oscuro
 * desaparece en una barra de tareas oscura, que es la de casi todo el mundo,
 * y uno de solo barras finas se vuelve ilegible a 16 pixeles. El degradado
 * es leve: a 16 no se ve, y a 256 evita que parezca un rectangulo de pintura.
 *
 * De 24 para abajo las barras se cuadran con la rejilla; ver logoMenudo.
 */
function iconoApp(tam) {
  const marco = rectRedondo(0.045, 0.045, 0.91, 0.91, 0.22);
  return componer(tam, [
    { formas: [marco], color: (x, y) => degradado(ACENTO, ACENTO_HONDO, (x + y * 2) / 3) },
    { formas: tam <= MENUDO ? logoMenudo(tam) : LOGO_GORDO(), color: [255, 255, 255] },
  ]);
}

function degradado(a, b, t) {
  const k = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** Lo devuelto por iconoVentana(), que no cambia en toda la ejecucion. */
let deVentana = null;

/**
 * El icono que lleva la ventana: barra de tareas, Alt+Tab y miniatura.
 *
 * Instalado no haria falta —la ventana hereda el icono del .exe, que le pone
 * el instalador—, pero en desarrollo (`npm start`) el ejecutable es el de
 * Electron y sin esto Sounde se abre con el atomo gris de fabrica.
 *
 * Se devuelve la RUTA del .ico, no la imagen. `nativeImage.createFromPath` de
 * un .ico multitamaño se queda con la representacion de 256 y todo lo demas
 * sale de reescalarla; pasandole la ruta, Windows abre el contenedor y coge de
 * dentro el tamaño exacto que pide cada sitio, que es para lo que se generan
 * los siete de `npm run icono`.
 *
 * Si el archivo no esta —build/ es material de compilacion y no viaja dentro
 * del paquete— se dibuja con el mismo rasterizador. Sale igual, solo que sin
 * los tamaños grandes, que en un paquete real ya vienen del .exe.
 */
function iconoVentana() {
  if (deVentana) return deVentana;

  const archivo = path.join(__dirname, '..', '..', 'build', 'icon.ico');
  if (fs.existsSync(archivo)) {
    deVentana = archivo;
    return deVentana;
  }

  // 32 de base y 64 para pantallas al 200%. Los tamaños grandes se dejan
  // fuera a proposito: rasterizar 256 cuesta decimas de segundo y esto se
  // ejecuta justo antes de abrir la ventana.
  const img = nativeImage.createFromBitmap(iconoApp(32), { width: 32, height: 32 });
  img.addRepresentation({ scaleFactor: 2, width: 64, height: 64, buffer: iconoApp(64) });
  deVentana = img;
  return deVentana;
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
function pintar(tam, capa) {
  return componer(tam, [capa]);
}

/**
 * Varias capas, de abajo arriba, sobre transparente.
 *
 * Hace falta para el icono de la aplicacion, que no es un glifo de un solo
 * color: es un cuadrado redondeado con las barras encima. `color` puede ser
 * un trio fijo o una funcion de (x, y) normalizados, que es como se consigue
 * un degradado sin meter aqui un motor de graficos.
 */
function componer(tam, capas) {
  const buf = Buffer.alloc(tam * tam * 4);
  const peso = 1 / (SS * SS);
  const n = tam * SS;

  for (const { formas = [], hueco = [], fondo = null, color } of capas) {
    const dentro = fondo || formas;
    const cobertura = new Float32Array(tam * tam);

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

    for (let i = 0; i < cobertura.length; i++) {
      const a = Math.min(1, cobertura[i]);
      if (a <= 0) continue;
      const [r, g, b] = typeof color === 'function'
        ? color((i % tam) / tam, Math.floor(i / tam) / tam)
        : color;
      const o = i * 4;
      // Sobre lo que ya hubiera, en premultiplicado: canal = nuevo*a +
      // viejo*(1-a). Sin premultiplicar, los bordes suavizados salen con halo.
      buf[o] = Math.round(b * a + buf[o] * (1 - a));
      buf[o + 1] = Math.round(g * a + buf[o + 1] * (1 - a));
      buf[o + 2] = Math.round(r * a + buf[o + 2] * (1 - a));
      buf[o + 3] = Math.round(a * 255 + buf[o + 3] * (1 - a));
    }
  }
  return buf;
}

// --- Formas ---------------------------------------------------------------

function rect(x, y, w, h) {
  return (px, py) => px >= x && px <= x + w && py >= y && py <= y + h;
}

/** Cuadrado con las esquinas redondeadas, al estilo de los iconos de Windows. */
function rectRedondo(x, y, w, h, r) {
  const x1 = x + w;
  const y1 = y + h;
  return (px, py) => {
    if (px < x || px > x1 || py < y || py > y1) return false;
    // Solo las cuatro esquinas necesitan la prueba del circulo; el resto del
    // rectangulo entra directo.
    const cx = px < x + r ? x + r : px > x1 - r ? x1 - r : px;
    const cy = py < y + r ? y + r : py > y1 - r ? y1 - r : py;
    if (cx === px && cy === py) return true;
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
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

module.exports = { glifo, distintivo, marca, iconoApp, iconoVentana };
