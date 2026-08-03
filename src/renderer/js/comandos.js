/**
 * Paleta de comandos (Ctrl+K).
 *
 * Busca a la vez acciones y musica. Separarlas en dos cajas obligaria a
 * saber de antemano si lo que uno quiere es "aleatorio" el modo o
 * "Aleatorio" la cancion, que es justo lo que no se sabe al empezar a
 * escribir.
 *
 * El emparejado es difuso por subsecuencia: "nchacr" encuentra "Noche
 * Acrilica". Buscar por sub-cadena exacta obliga a acertar el principio de
 * la palabra y se queda corto en cuanto hay acentos o articulos.
 */

import { el, glifo, formatoTiempo } from './dom.js';

/** Cuantos resultados se pintan. Mas no caben y solo cuestan tiempo. */
const MAX = 40;

export function crearComandos({ acciones, shell, motor, favoritos, listas }) {
  let capa = null;
  let campo = null;
  let listado = null;
  let resultados = [];
  let seleccion = 0;

  function abrir() {
    if (capa) return;

    campo = el('input', {
      class: 'comandos__campo',
      type: 'text',
      spellcheck: 'false',
      placeholder: 'Busca una cancion, un album o una accion…',
      'aria-label': 'Paleta de comandos',
    });

    listado = el('div', { class: 'comandos__lista', role: 'listbox' });

    const panel = el('div', { class: 'comandos flotante', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'comandos__cabecera' }, [
        el('span', { class: 'comandos__icono', texto: glifo('buscar') }),
        campo,
        el('span', { class: 'comandos__pista', texto: 'Esc' }),
      ]),
      listado,
    ]);

    capa = el('div', { class: 'comandos-capa' }, [panel]);
    capa.addEventListener('pointerdown', (e) => {
      if (e.target === capa) cerrar();
    });

    campo.addEventListener('input', () => buscar(campo.value));
    campo.addEventListener('keydown', teclado);

    document.body.append(capa);
    campo.focus();
    buscar('');
  }

  function cerrar() {
    capa?.remove();
    capa = null;
    resultados = [];
  }

  function teclado(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cerrar();
      return;
    }
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      mover(1);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      mover(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      lanzar(seleccion);
    }
  }

  function mover(delta) {
    if (!resultados.length) return;
    seleccion = (seleccion + delta + resultados.length) % resultados.length;
    pintarSeleccion();
  }

  function lanzar(i) {
    const r = resultados[i];
    if (!r) return;
    cerrar();
    r.ejecutar();
  }

  // --- Busqueda -------------------------------------------------------------

  function buscar(texto) {
    const q = texto.trim().toLowerCase();
    const salida = [];

    for (const accion of acciones) {
      const puntos = q ? puntuar(accion.texto.toLowerCase(), q) : 0.5;
      if (puntos === null) continue;
      salida.push({
        tipo: 'accion',
        puntos: puntos + 0.35, // las acciones pesan mas: son pocas y exactas
        titulo: accion.texto,
        sub: accion.grupo,
        icono: accion.icono,
        extra: accion.atajo,
        ejecutar: accion.ejecutar,
      });
    }

    if (q) {
      for (const track of shell.pistas) {
        const puntos = puntuar(`${track.title} ${track.artist} ${track.album}`.toLowerCase(), q);
        if (puntos === null) continue;
        salida.push({
          tipo: 'pista',
          puntos,
          titulo: track.title,
          sub: `${track.artist} · ${track.album}`,
          artUrl: track.artUrl,
          extra: formatoTiempo(track.duration),
          ejecutar: () => motor.queue.setContext([track], { startIndex: 0 }),
        });
      }

      for (const p of listas?.listas ?? []) {
        const puntos = puntuar(p.name.toLowerCase(), q);
        if (puntos === null) continue;
        salida.push({
          tipo: 'lista',
          puntos: puntos + 0.2,
          titulo: p.name,
          sub: 'Lista de reproduccion',
          icono: 'lista',
          ejecutar: () => shell.ir({ tipo: 'lista', clave: p }),
        });
      }
    }

    salida.sort((a, b) => b.puntos - a.puntos);
    resultados = salida.slice(0, MAX);
    seleccion = 0;
    pintar();
  }

  function pintar() {
    if (!resultados.length) {
      listado.replaceChildren(el('div', { class: 'comandos__vacio', texto: 'Nada coincide' }));
      return;
    }

    listado.replaceChildren(...resultados.map((r, i) => {
      const icono = r.artUrl
        ? el('img', { class: 'comandos__arte', src: r.artUrl, alt: '' })
        : el('span', { class: 'comandos__glifo', texto: glifo(r.icono ?? 'musica') });

      return el('div', {
        class: 'comandos__item',
        role: 'option',
        dataset: { indice: String(i) },
        onClick: () => lanzar(i),
        onPointerenter: () => { seleccion = i; pintarSeleccion(); },
      }, [
        icono,
        el('div', { class: 'comandos__textos' }, [
          el('div', { class: 'comandos__titulo truncar', texto: r.titulo }),
          el('div', { class: 'comandos__sub truncar', texto: r.sub ?? '' }),
        ]),
        r.extra ? el('span', { class: 'comandos__extra', texto: r.extra }) : null,
      ]);
    }));
    pintarSeleccion();
  }

  function pintarSeleccion() {
    const items = listado.children;
    for (let i = 0; i < items.length; i++) {
      const activo = i === seleccion;
      items[i].dataset.activo = String(activo);
      if (activo) items[i].scrollIntoView({ block: 'nearest' });
    }
  }

  return {
    abrir,
    cerrar,
    alternar: () => (capa ? cerrar() : abrir()),
    get abierta() { return !!capa; },
  };
}

/**
 * Puntua cuanto encaja `consulta` dentro de `texto` como subsecuencia.
 * Devuelve null si no encaja. Puntua mas alto lo que empieza igual y lo que
 * aparece junto, que es como la gente espera que se ordenen los resultados.
 */
export function puntuar(texto, consulta) {
  let i = 0;
  let puntos = 0;
  let seguidas = 0;
  let primera = -1;

  for (let j = 0; j < texto.length && i < consulta.length; j++) {
    if (texto[j] !== consulta[i]) {
      seguidas = 0;
      continue;
    }
    if (primera < 0) primera = j;
    seguidas++;
    // Las letras consecutivas valen mucho mas que las sueltas: si no, una
    // consulta corta encaja en cualquier titulo largo por casualidad.
    puntos += 1 + seguidas * 2;
    // Empezar palabra tambien suma: "no ac" debe ganar a "canon acrilico".
    if (j === 0 || texto[j - 1] === ' ') puntos += 3;
    i++;
  }

  if (i < consulta.length) return null;
  // Penalizar lo que empieza tarde y lo muy largo, para que un titulo corto
  // que casa entero gane a uno larguisimo donde las letras estan sueltas.
  return puntos - primera * 0.1 - texto.length * 0.01;
}
