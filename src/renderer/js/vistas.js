/**
 * Rejillas de albumes y artistas, y sus fichas.
 *
 * Aqui solo se construyen nodos: quien decide que se ve y que suena es
 * shell.js. Asi estas funciones se pueden reordenar o reutilizar sin
 * arrastrar detras la mitad de la aplicacion.
 */

import { el, glifo, formatoTiempo, plural } from './dom.js';

export function rejilla(tarjetas) {
  return el('div', { class: 'rejilla' }, tarjetas);
}

export function tarjetaAlbum(album, { onAbrir, onReproducir }) {
  return tarjeta({
    titulo: album.titulo,
    sub: [album.artista, album.year].filter(Boolean).join(' · '),
    artUrl: album.artUrl,
    onAbrir,
    onReproducir,
  });
}

export function tarjetaArtista(artista, { onAbrir, onReproducir }) {
  return tarjeta({
    titulo: artista.nombre,
    sub: plural(artista.pistas.length, 'cancion', 'canciones'),
    artUrl: artista.artUrl,
    redonda: true,
    onAbrir,
    onReproducir,
  });
}

function tarjeta({ titulo, sub, artUrl, redonda = false, onAbrir, onReproducir }) {
  const play = el('button', {
    class: 'tarjeta__play',
    texto: glifo('reproducir'),
    title: `Reproducir ${titulo}`,
    'aria-label': `Reproducir ${titulo}`,
    onClick: (e) => {
      // Abrir la ficha y reproducir son dos deseos distintos: sin frenar la
      // propagacion, pulsar el play abriria ademas el album por debajo.
      e.stopPropagation();
      onReproducir?.();
    },
  });

  const arte = el('div', { class: 'tarjeta__arte' }, [
    artUrl ? el('img', { src: artUrl, alt: '' }) : null,
    play,
  ]);
  if (artUrl) arte.dataset.conArte = 'true';

  // Div con rol de boton, no <button>: dentro va el boton de reproducir, y
  // un boton anidado en otro es HTML invalido y se comporta distinto en cada
  // navegador.
  const nodo = el('div', {
    class: `tarjeta${redonda ? ' tarjeta--redonda' : ''}`,
    role: 'button',
    tabindex: '0',
    title: `${titulo} — ${sub}`,
    onClick: () => onAbrir?.(),
    onKeydown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      onAbrir?.();
    },
  }, [
    arte,
    el('div', { class: 'tarjeta__titulo truncar', texto: titulo }),
    el('div', { class: 'tarjeta__sub truncar', texto: sub }),
  ]);

  return nodo;
}

export function botonVolver(texto, onVolver) {
  return el('button', { class: 'volver', onClick: onVolver }, [
    el('span', { class: 'volver__icono', texto: glifo('plegar') }),
    el('span', { texto }),
  ]);
}

export function fichaAlbum(album, { onVolver, volverA = 'Albumes', onReproducir, onAleatorio, listaNodo }) {
  return el('div', { class: 'detalle' }, [
    botonVolver(volverA, onVolver),
    cabeceraFicha({
      tipo: 'Album',
      titulo: album.titulo,
      artUrl: album.artUrl,
      meta: [
        album.artista,
        album.year,
        plural(album.pistas.length, 'cancion', 'canciones'),
        formatoTiempo(album.duracion),
      ].filter(Boolean).join(' · '),
      onReproducir,
      onAleatorio,
    }),
    el('div', { class: 'detalle__cuerpo' }, [listaNodo]),
  ]);
}

export function fichaArtista(artista, { onVolver, volverA = 'Artistas', onReproducir, onAleatorio, onAbrirAlbum, onReproducirAlbum }) {
  return el('div', { class: 'detalle detalle--artista' }, [
    botonVolver(volverA, onVolver),
    cabeceraFicha({
      tipo: 'Artista',
      titulo: artista.nombre,
      artUrl: artista.artUrl,
      redonda: true,
      meta: [
        plural(artista.albumes.length, 'album', 'albumes'),
        plural(artista.pistas.length, 'cancion', 'canciones'),
        formatoTiempo(artista.duracion),
      ].join(' · '),
      onReproducir,
      onAleatorio,
    }),
    el('div', { class: 'detalle__seccion' }, [
      el('div', { class: 'detalle__seccion-titulo', texto: 'Albumes' }),
      rejilla(artista.albumes.map((album) => tarjetaAlbum(album, {
        onAbrir: () => onAbrirAlbum(album),
        onReproducir: () => onReproducirAlbum(album),
      }))),
    ]),
  ]);
}

function cabeceraFicha({ tipo, titulo, meta, artUrl, onReproducir, onAleatorio }) {
  const arte = el('div', { class: 'detalle__arte' }, [
    artUrl ? el('img', { src: artUrl, alt: '' }) : null,
  ]);

  return el('div', { class: 'detalle__cabecera' }, [
    arte,
    el('div', { class: 'detalle__info' }, [
      el('div', { class: 'detalle__tipo', texto: tipo }),
      el('h2', { class: 'detalle__titulo', texto: titulo }),
      el('div', { class: 'detalle__meta', texto: meta }),
      el('div', { class: 'detalle__acciones' }, [
        el('button', { class: 'boton boton--acento', onClick: onReproducir }, [
          el('span', { class: 'boton__icono', texto: glifo('reproducir') }),
          el('span', { texto: 'Reproducir' }),
        ]),
        el('button', { class: 'boton', onClick: onAleatorio }, [
          el('span', { class: 'boton__icono', texto: glifo('aleatorio') }),
          el('span', { texto: 'Aleatorio' }),
        ]),
      ]),
    ]),
  ]);
}
