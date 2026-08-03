'use strict';

/**
 * Genera build/icon.ico y build/icon.png a partir del rasterizador propio.
 *
 *   npm run icono
 *
 * El icono no es un binario suelto en el repo que nadie sabe de donde salio:
 * se dibuja con las mismas primitivas que los botones de la barra de tareas,
 * asi que cambiar el color o el grosor de las barras es tocar una linea y
 * volver a ejecutar esto.
 *
 * El contenedor ICO se escribe a mano. Son veintidos bytes de cabecera y una
 * entrada de dieciseis por tamaño; meter una dependencia para eso, con lo que
 * arrastran las de imagenes, no sale a cuenta.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, nativeImage } = require('electron');

const { iconoApp } = require('../src/main/iconos');

// Los que Windows pide de verdad: 16 y 32 para la barra de tareas y el
// explorador, 48 para iconos medianos, 256 para la vista de iconos grandes.
// Los intermedios evitan que el sistema escale desde uno lejano.
const TAMANOS = [16, 24, 32, 48, 64, 128, 256];

const SALIDA = path.join(__dirname, '..', 'build');

/**
 * A partir de aqui, PNG dentro del ICO; por debajo, mapa de bits clasico.
 *
 * Windows sabe leer PNG en cualquier entrada desde Vista, pero GDI+ no: los
 * interpreta como si fueran DIB y devuelve basura de colores, o revienta. Y
 * por GDI+ pasan NSIS y practicamente cualquier herramienta de .NET que toque
 * el icono. Los tamaños chicos van en DIB, que entiende todo el mundo, y solo
 * los grandes en PNG, donde el DIB pesaria 256 KB el solo.
 */
const DESDE_PNG = 128;

app.whenReady().then(() => {
  fs.mkdirSync(SALIDA, { recursive: true });

  const imagenes = TAMANOS.map((tam) => {
    const bgra = iconoApp(tam);
    const png = nativeImage.createFromBitmap(bgra, { width: tam, height: tam }).toPNG();
    return {
      tam,
      png,
      datos: tam >= DESDE_PNG ? png : dib(bgra, tam),
      formato: tam >= DESDE_PNG ? 'png' : 'dib',
    };
  });

  const ico = path.join(SALIDA, 'icon.ico');
  fs.writeFileSync(ico, empaquetarIco(imagenes));

  // El PNG grande lo usan Linux y las pantallas de "acerca de".
  fs.writeFileSync(path.join(SALIDA, 'icon.png'), imagenes.find((i) => i.tam === 256).png);

  for (const { tam, datos, formato } of imagenes) {
    console.log(`  ${String(tam).padStart(3)}x${tam}  ${formato}  ${String(datos.length).padStart(6)} bytes`);
  }
  console.log(`\n${ico}  (${fs.statSync(ico).size} bytes)`);
  app.exit(0);
});

/**
 * Entrada en formato DIB: cabecera, pixeles y mascara.
 *
 * Tres cosas que no se ven venir y estropean el icono en silencio:
 *
 *   - El alto de la cabecera va DOBLE. La cabecera describe dos mapas
 *     apilados, el de color y el de la mascara, aunque con 32 bits la mascara
 *     ya no haga falta.
 *   - Las filas van de abajo arriba. Al reves sale el icono boca abajo.
 *   - El alfa va SIN premultiplicar, al contrario que en el buffer que usa
 *     Chromium. Sin deshacerlo, los bordes suavizados salen oscurecidos.
 */
function dib(bgraPremultiplicado, tam) {
  const CABECERA = 40;
  const filaMascara = Math.ceil(tam / 32) * 4; // las filas se alinean a 4 bytes
  const buf = Buffer.alloc(CABECERA + tam * tam * 4 + filaMascara * tam);

  buf.writeUInt32LE(CABECERA, 0);
  buf.writeInt32LE(tam, 4);
  buf.writeInt32LE(tam * 2, 8);
  buf.writeUInt16LE(1, 12);   // planos
  buf.writeUInt16LE(32, 14);  // bits por pixel
  buf.writeUInt32LE(0, 16);   // sin compresion
  buf.writeUInt32LE(tam * tam * 4, 20);

  const pixeles = CABECERA;
  const mascara = pixeles + tam * tam * 4;

  for (let y = 0; y < tam; y++) {
    const origen = y * tam;
    const destino = (tam - 1 - y) * tam; // de abajo arriba
    for (let x = 0; x < tam; x++) {
      const o = (origen + x) * 4;
      const d = pixeles + (destino + x) * 4;
      const a = bgraPremultiplicado[o + 3];
      const recto = (c) => (a === 0 ? 0 : Math.min(255, Math.round((c * 255) / a)));
      buf[d] = recto(bgraPremultiplicado[o]);
      buf[d + 1] = recto(bgraPremultiplicado[o + 1]);
      buf[d + 2] = recto(bgraPremultiplicado[o + 2]);
      buf[d + 3] = a;

      // Mascara AND: 1 = transparente. Con 32 bits manda el alfa, pero hay
      // sitios (menus antiguos, algunos dialogos) que aun la miran.
      if (a < 128) {
        const bit = mascara + (tam - 1 - y) * filaMascara + (x >> 3);
        buf[bit] |= 0x80 >> (x & 7);
      }
    }
  }
  return buf;
}

/** Contenedor ICO: cabecera, directorio y las imagenes una detras de otra. */
function empaquetarIco(imagenes) {
  const CABECERA = 6;
  const ENTRADA = 16;

  const cabecera = Buffer.alloc(CABECERA);
  cabecera.writeUInt16LE(0, 0); // reservado
  cabecera.writeUInt16LE(1, 2); // 1 = icono (2 seria cursor)
  cabecera.writeUInt16LE(imagenes.length, 4);

  const directorio = Buffer.alloc(ENTRADA * imagenes.length);
  let desplazamiento = CABECERA + directorio.length;

  imagenes.forEach(({ tam, datos }, i) => {
    const o = i * ENTRADA;
    // 256 se codifica como 0: el campo es de un solo byte.
    directorio.writeUInt8(tam >= 256 ? 0 : tam, o);
    directorio.writeUInt8(tam >= 256 ? 0 : tam, o + 1);
    directorio.writeUInt8(0, o + 2);  // colores de la paleta: 0 = sin paleta
    directorio.writeUInt8(0, o + 3);  // reservado
    directorio.writeUInt16LE(1, o + 4);   // planos
    directorio.writeUInt16LE(32, o + 6);  // bits por pixel
    directorio.writeUInt32LE(datos.length, o + 8);
    directorio.writeUInt32LE(desplazamiento, o + 12);
    desplazamiento += datos.length;
  });

  return Buffer.concat([cabecera, directorio, ...imagenes.map((i) => i.datos)]);
}
