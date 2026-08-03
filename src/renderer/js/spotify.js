/**
 * La vista de una lista de Spotify cruzada con tu biblioteca.
 *
 * No reutiliza `lista.js` a proposito: aquella pinta pistas locales, y aqui
 * la mitad de las filas no tienen archivo detras. Meterlo alli habria llenado
 * el componente principal de la aplicacion de condiciones para un caso que no
 * es el suyo.
 *
 * La regla de la vista: lo que tienes se puede reproducir, lo que no se ve
 * igual pero apagado. Esconder lo que falta convertiria la lista en otra
 * lista distinta, y saber que te falta es justo para lo que sirve esto.
 */

import { el, glifo, plural, formatoTiempo } from './dom.js';
import { pedirTexto } from './dialogo.js';

const FILTROS = [
  { valor: 'todo', texto: 'Todo' },
  { valor: 'tengo', texto: 'Las que tengo' },
  { valor: 'faltan', texto: 'Las que faltan' },
];

export function crearVistaSpotify({ queue, resolver, listas }) {
  const nodo = el('div', { class: 'sp' });
  let datos = null;
  let filtro = 'todo';

  /** Las pistas locales de la lista, en el orden de la lista. */
  function pistasQueTengo() {
    return (datos?.items ?? [])
      .map((i) => (i.local ? resolver(i.local) : null))
      .filter(Boolean);
  }

  function reproducir(aleatorio = false) {
    const lote = pistasQueTengo();
    if (!lote.length) return;
    queue.setShuffle(aleatorio);
    queue.setContext(lote, {
      startIndex: aleatorio ? Math.floor(Math.random() * lote.length) : 0,
    });
  }

  function mostrar(lista) {
    datos = lista;
    filtro = 'todo';
    pintar();
  }

  function pintar() {
    if (!datos) {
      nodo.replaceChildren();
      return;
    }
    nodo.replaceChildren(cabecera(), cuerpo());
  }

  function cabecera() {
    const total = datos.items.length;
    const tengo = datos.encontradas ?? 0;

    return el('header', { class: 'sp__cabecera' }, [
      datos.artUrl
        ? el('img', { class: 'sp__arte', src: datos.artUrl, alt: '', loading: 'lazy' })
        : el('div', { class: 'sp__arte sp__arte--vacio', texto: glifo('lista') }),

      el('div', { class: 'sp__info' }, [
        el('span', { class: 'sp__tipo', texto: datos.owner ? `Lista de ${datos.owner}` : 'Spotify' }),
        el('h2', { class: 'sp__titulo', texto: datos.name }),
        datos.description ? el('p', { class: 'sp__desc', texto: datos.description }) : null,

        el('p', { class: 'sp__cuenta' }, [
          el('strong', { texto: `${tengo} de ${total}` }),
          el('span', { texto: ` ya en tu biblioteca` }),
          datos.descartadas
            ? el('span', {
              class: 'sp__nota',
              // Sin decirlo, una lista de 50 que aparece con 47 parece un
              // fallo de Sounde y no lo que es: episodios o pistas retiradas.
              texto: ` · ${plural(datos.descartadas, 'entrada omitida', 'entradas omitidas')} (podcasts o retiradas de Spotify)`,
            })
            : null,
        ]),

        el('div', { class: 'sp__acciones' }, [
          el('button', {
            class: 'boton boton--acento',
            ...(tengo ? {} : { disabled: true }),
            onclick: () => reproducir(false),
          }, [
            el('span', { class: 'boton__icono', texto: glifo('reproducir') }),
            el('span', { texto: 'Reproducir lo que tengo' }),
          ]),
          el('button', {
            class: 'boton',
            ...(tengo ? {} : { disabled: true }),
            title: 'Reproducir en orden aleatorio',
            onclick: () => reproducir(true),
          }, [
            el('span', { class: 'boton__icono', texto: glifo('aleatorio') }),
            el('span', { texto: 'Aleatorio' }),
          ]),
          el('button', {
            class: 'boton',
            ...(tengo ? {} : { disabled: true }),
            title: 'Crear una lista de Sounde con las canciones que ya tienes',
            onclick: guardarComoLista,
          }, [
            el('span', { class: 'boton__icono', texto: glifo('lista') }),
            el('span', { texto: 'Guardar como lista' }),
          ]),
        ]),

        el('div', { class: 'segmentado sp__filtros' }, FILTROS.map((f) => el('button', {
          class: 'segmentado__opcion',
          dataset: { valor: f.valor },
          'aria-pressed': String(filtro === f.valor),
          texto: f.texto,
          onclick: () => {
            filtro = f.valor;
            pintar();
          },
        }))),
      ]),
    ]);
  }

  async function guardarComoLista() {
    const ids = pistasQueTengo().map((t) => t.id);
    if (!ids.length) return;
    const nombre = await pedirTexto({
      titulo: 'Guardar como lista',
      etiqueta: `Se guardaran las ${ids.length} canciones que ya tienes`,
      valor: datos.name,
      aceptar: 'Crear',
    });
    if (nombre) await listas?.crear(nombre, ids);
  }

  function cuerpo() {
    const visibles = datos.items.filter((i) => (
      filtro === 'todo' || (filtro === 'tengo' ? !!i.local : !i.local)
    ));

    if (!visibles.length) {
      return el('div', { class: 'vacio vacio--vista' }, [
        el('div', { class: 'vacio__icono', texto: glifo(filtro === 'faltan' ? 'corazonLleno' : 'buscar') }),
        el('h2', {
          class: 'vacio__titulo',
          texto: filtro === 'faltan' ? 'Las tienes todas' : 'Aqui no hay ninguna',
        }),
        el('p', {
          class: 'vacio__texto',
          texto: filtro === 'faltan'
            ? 'Todas las canciones de esta lista estan en tu biblioteca.'
            : 'Ninguna cancion de esta lista esta todavia en tu disco.',
        }),
      ]);
    }

    return el('div', { class: 'sp__filas', role: 'list' }, visibles.map(fila));
  }

  function fila(item) {
    const local = item.local ? resolver(item.local) : null;
    const artistas = (item.artists ?? []).join(', ');

    return el('div', {
      class: 'sp__fila',
      role: 'listitem',
      dataset: { tengo: String(!!local) },
      // Solo lo que tiene archivo detras es pulsable. Una fila que se ilumina
      // al pasar por encima y luego no hace nada al pulsarla se lee como un
      // fallo, no como "esta no la tienes".
      ...(local ? { tabindex: '0', role: 'button' } : {}),
      ...(local ? {
        onclick: () => queue.setContext(pistasQueTengo(), { startId: local.id }),
        onkeydown: (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          queue.setContext(pistasQueTengo(), { startId: local.id });
        },
      } : {}),
    }, [
      item.artUrl
        ? el('img', { class: 'sp__fila-arte', src: item.artUrl, alt: '', loading: 'lazy' })
        : el('div', { class: 'sp__fila-arte sp__fila-arte--vacio', texto: glifo('musica') }),

      el('div', { class: 'sp__fila-texto' }, [
        el('span', { class: 'sp__fila-titulo truncar', texto: item.title, title: item.title }),
        el('span', { class: 'sp__fila-artista truncar', texto: artistas, title: artistas }),
      ]),

      el('span', { class: 'sp__fila-album truncar', texto: item.album ?? '', title: item.album ?? '' }),

      el('span', {
        class: 'sp__fila-marca',
        // 'probable' se distingue de 'exacta' porque el enlace lo hicimos
        // nosotros por parecido, no por identidad: si suena otra cosa, aqui
        // es donde el usuario mira para entender por que.
        title: local
          ? (item.confianza === 'exacta'
            ? `En tu biblioteca: ${local.title}`
            : `Emparejada por parecido con: ${local.title} — ${local.album}`)
          : 'No esta en tu biblioteca',
        texto: local ? glifo(item.confianza === 'exacta' ? 'corazonLleno' : 'corazon') : glifo('descargar'),
        dataset: { confianza: item.confianza ?? 'no' },
      }),

      el('span', { class: 'sp__fila-tiempo tabular', texto: formatoTiempo(item.duration) }),
    ]);
  }

  return { nodo, mostrar, get datos() { return datos; } };
}
