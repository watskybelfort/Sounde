/**
 * Vista de letra.
 *
 * Con tiempos, la linea que suena se resalta y se puede pulsar para saltar
 * ahi, que es la mitad de la gracia de tener un LRC. Sin tiempos se pinta el
 * texto y ya.
 *
 * El seguimiento va por requestAnimationFrame y no por el evento 'time' del
 * elemento de audio: ese llega unas cuatro veces por segundo y una letra que
 * cambia de linea con un cuarto de segundo de retraso se nota muchisimo, mas
 * que una barra de progreso a tirones. El DOM solo se toca cuando cambia la
 * linea activa, asi que el bucle no cuesta nada.
 */

import { el, glifo } from './dom.js';

/** Tras tocar la rueda, el auto-desplazamiento se calla este rato. */
const TREGUA = 5000;

export function crearLetra({ player }) {
  const cuerpo = el('div', { class: 'letra__lineas' });
  const nodo = el('div', { class: 'letra' }, [cuerpo]);

  let lineas = [];       // [{ t, texto }]
  let nodos = [];        // los <p>, en el mismo orden
  let sincronizada = false;
  let activa = -1;
  let bucle = 0;
  let visible = false;
  let pistaId = null;
  let ultimoManual = 0;

  // El usuario que se pone a leer por su cuenta manda sobre el seguimiento:
  // que la letra le arranque el scroll de las manos es insufrible.
  cuerpo.addEventListener('wheel', () => { ultimoManual = performance.now(); }, { passive: true });
  cuerpo.addEventListener('pointerdown', () => { ultimoManual = performance.now(); });

  async function mostrar(track) {
    pistaId = track?.id ?? null;
    activa = -1;

    if (!track) {
      pintarAviso('musica', 'Nada sonando', 'Pon una cancion y su letra aparecera aqui.');
      return;
    }

    pintarAviso('lista', 'Buscando la letra…', '');
    const letra = await window.sounde.lyrics.para(track.id);

    // Mientras se buscaba puede haber entrado otra cancion.
    if (pistaId !== track.id) return;

    if (!letra?.lineas?.length) {
      pintarAviso('lista', 'Sin letra',
        'No hay ningun .lrc junto al archivo ni letra en sus etiquetas.');
      return;
    }

    sincronizada = !!letra.sincronizada;
    lineas = letra.lineas;
    nodo.dataset.sincronizada = String(sincronizada);
    nodo.dataset.fuente = letra.fuente ?? '';

    nodos = lineas.map((linea, i) => el('p', {
      class: 'letra__linea',
      // Una linea vacia es un silencio del LRC: ocupa su hueco y no se pulsa.
      dataset: { vacia: String(!linea.texto) },
      ...(sincronizada && linea.texto
        ? { role: 'button', tabindex: '0', title: 'Saltar aqui' }
        : {}),
      texto: linea.texto || '',
    }));

    if (sincronizada) {
      cuerpo.onclick = (e) => {
        const i = nodos.indexOf(e.target.closest('.letra__linea'));
        if (i >= 0 && lineas[i].texto) player.seek(lineas[i].t);
      };
    } else {
      cuerpo.onclick = null;
    }

    cuerpo.replaceChildren(...nodos);
    // Sin esto, al volver a una cancion ya escuchada la letra aparece por el
    // principio aunque vaya por la mitad.
    seguir(true);
    arrancar();
  }

  function pintarAviso(icono, titulo, texto) {
    lineas = [];
    nodos = [];
    sincronizada = false;
    delete nodo.dataset.sincronizada;
    cuerpo.onclick = null;
    cuerpo.replaceChildren(el('div', { class: 'vacio vacio--vista' }, [
      el('div', { class: 'vacio__icono', texto: glifo(icono) }),
      el('h2', { class: 'vacio__titulo', texto: titulo }),
      texto ? el('p', { class: 'vacio__texto', texto }) : null,
    ]));
  }

  /** Indice de la ultima linea cuyo tiempo ya paso. */
  function indiceEn(segundos) {
    let lo = 0;
    let hi = lineas.length - 1;
    let salida = -1;
    while (lo <= hi) {
      const medio = (lo + hi) >> 1;
      if (lineas[medio].t <= segundos) {
        salida = medio;
        lo = medio + 1;
      } else {
        hi = medio - 1;
      }
    }
    return salida;
  }

  function seguir(forzarCentrado = false) {
    if (!sincronizada || !lineas.length) return;
    const i = indiceEn(player.currentTime);
    if (i === activa && !forzarCentrado) return;

    if (activa >= 0) nodos[activa]?.removeAttribute('data-activa');
    activa = i;
    if (activa < 0) return;

    const linea = nodos[activa];
    if (!linea) return;
    linea.dataset.activa = 'true';

    if (!forzarCentrado && performance.now() - ultimoManual < TREGUA) return;
    linea.scrollIntoView({ block: 'center', behavior: forzarCentrado ? 'auto' : 'smooth' });
  }

  function arrancar() {
    if (bucle || !visible || !sincronizada) return;
    const paso = () => {
      seguir();
      bucle = visible ? requestAnimationFrame(paso) : 0;
    };
    bucle = requestAnimationFrame(paso);
  }

  function parar() {
    if (bucle) cancelAnimationFrame(bucle);
    bucle = 0;
  }

  function setVisible(v) {
    visible = !!v;
    if (visible) arrancar();
    else parar();
  }

  return { nodo, mostrar, setVisible };
}
