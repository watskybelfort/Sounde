/**
 * Barra de transporte: lo que suena, los mandos y la posicion.
 *
 * La barra de posicion no se mueve con los eventos del elemento de audio:
 * 'timeupdate' llega unas cuatro veces por segundo y a ese ritmo la barra
 * avanza a tirones. Se pinta con requestAnimationFrame mientras suena, y los
 * eventos solo sirven para corregir despues de un salto o una pausa.
 */

import { $, glifo, pintarGlifo, formatoTiempo } from './dom.js';
import { crearBarra } from './barra.js';

export function initTransporte(motor) {
  const { player, queue } = motor;

  const arte = $('#ahora-arte');
  const imagen = $('#ahora-imagen');
  const titulo = $('#ahora-titulo');
  const artista = $('#ahora-artista');

  const btnAnterior = $('#btn-anterior');
  const btnReproducir = $('#btn-reproducir');
  const btnSiguiente = $('#btn-siguiente');
  const btnAleatorio = $('#btn-aleatorio');
  const btnRepetir = $('#btn-repetir');
  const btnSilencio = $('#btn-silencio');
  const btnMini = $('#btn-mini');

  const relojActual = $('#reloj-actual');
  const relojTotal = $('#reloj-total');
  const globo = $('#globo-tiempo');

  pintarGlifo(btnAnterior, 'anterior');
  pintarGlifo(btnReproducir, 'reproducir');
  pintarGlifo(btnSiguiente, 'siguiente');
  pintarGlifo(btnAleatorio, 'aleatorio');
  pintarGlifo(btnMini, 'aVentana');

  // --- Posicion -------------------------------------------------------------

  const barraTiempo = crearBarra($('#barra-tiempo'), {
    onPreview: (v) => {
      const dur = player.duration;
      if (globo) globo.textContent = formatoTiempo(v * dur);
    },
    onCambio: (v) => {
      // Durante el arrastre solo se mueve el reloj: saltar en cada pixel
      // dispara una peticion de rango por fotograma y el audio tartamudea.
      if (relojActual) relojActual.textContent = formatoTiempo(v * player.duration);
    },
    onSoltar: (v) => player.seek(v * player.duration),
  });

  const barraVolumen = crearBarra($('#barra-volumen'), {
    directo: true,
    paso: 0.05,
    onCambio: (v) => {
      motor.setVolume(v);
      if (player.muted) motor.setMuted(false);
      pintarVolumen();
    },
  });

  // --- Pintado --------------------------------------------------------------

  function pintarPista(track) {
    const hay = !!track;
    titulo.textContent = hay ? track.title : 'Nada sonando';
    artista.textContent = hay ? [track.artist, track.album].filter(Boolean).join(' · ') : 'Elige algo y dale al play';

    if (hay && track.artUrl) {
      imagen.src = track.artUrl;
      imagen.alt = `Caratula de ${track.album}`;
      arte.dataset.conArte = 'true';
      imagen.hidden = false;
    } else {
      imagen.removeAttribute('src');
      imagen.hidden = true;
      delete arte.dataset.conArte;
    }

    barraTiempo.setDesactivada(!hay);
    barraTiempo.setValor(0);
    barraTiempo.setBuffer(0);
    relojActual.textContent = '0:00';
    relojTotal.textContent = formatoTiempo(hay ? track.duration : 0);
  }

  function pintarEstado(sonando) {
    pintarGlifo(btnReproducir, sonando ? 'pausa' : 'reproducir');
    const etiqueta = sonando ? 'Pausar' : 'Reproducir';
    btnReproducir.title = etiqueta;
    btnReproducir.setAttribute('aria-label', etiqueta);
  }

  function pintarVolumen() {
    const v = player.muted ? 0 : player.volume;
    barraVolumen.setValor(v);
    const nombre = player.muted ? 'silencio'
      : v === 0 ? 'volumen0'
        : v < 0.34 ? 'volumen1'
          : v < 0.67 ? 'volumen2' : 'volumen3';
    pintarGlifo(btnSilencio, nombre);
    btnSilencio.setAttribute('aria-pressed', String(!!player.muted));
    btnSilencio.title = player.muted ? 'Quitar el silencio' : 'Silenciar';
    barraVolumen.setAria(`${Math.round(v * 100)}%`, v * 100, 100);
  }

  function pintarModos() {
    btnAleatorio.setAttribute('aria-pressed', String(queue.shuffle));
    btnAleatorio.title = queue.shuffle ? 'Aleatorio: activado' : 'Aleatorio: desactivado';

    pintarGlifo(btnRepetir, queue.repeat === 'one' ? 'repetirUna' : 'repetirTodo');
    btnRepetir.setAttribute('aria-pressed', String(queue.repeat !== 'off'));
    btnRepetir.title = queue.repeat === 'off' ? 'Repetir: desactivado'
      : queue.repeat === 'all' ? 'Repetir: toda la cola' : 'Repetir: esta cancion';
  }

  function pintarTiempo() {
    const dur = player.duration;
    const actual = player.currentTime;
    if (dur > 0) {
      barraTiempo.setValor(actual / dur);
      barraTiempo.setBuffer(player.buffered / dur);
      barraTiempo.setAria(`${formatoTiempo(actual)} de ${formatoTiempo(dur)}`, actual, dur);
    }
    if (!barraTiempo.arrastrando) relojActual.textContent = formatoTiempo(actual);
    relojTotal.textContent = formatoTiempo(dur);
  }

  // --- Bucle de refresco ----------------------------------------------------

  let bucle = 0;
  function arrancarBucle() {
    if (bucle) return;
    const paso = () => {
      pintarTiempo();
      bucle = player.playing ? requestAnimationFrame(paso) : 0;
    };
    bucle = requestAnimationFrame(paso);
  }

  function pararBucle() {
    if (bucle) cancelAnimationFrame(bucle);
    bucle = 0;
    pintarTiempo();
  }

  // --- Cableado -------------------------------------------------------------

  btnReproducir.addEventListener('click', () => {
    // Sin nada cargado, el boton de play arranca la cola por el principio en
    // vez de no hacer nada, que es lo que la gente espera.
    if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
    else player.toggle();
  });
  btnAnterior.addEventListener('click', () => queue.prev());
  btnSiguiente.addEventListener('click', () => queue.next());
  btnAleatorio.addEventListener('click', () => queue.toggleShuffle());
  btnRepetir.addEventListener('click', () => queue.cycleRepeat());
  btnSilencio.addEventListener('click', () => {
    motor.toggleMute();
    pintarVolumen();
  });

  btnMini.addEventListener('click', async () => {
    const raiz = document.documentElement;
    const mini = raiz.dataset.mini !== 'true';
    await window.sounde.window.setMini(mini);
  });

  window.sounde.window.onMini(({ mini }) => {
    document.documentElement.dataset.mini = String(mini);
    pintarGlifo(btnMini, mini ? 'aPantalla' : 'aVentana');
    btnMini.title = mini ? 'Volver a la ventana completa' : 'Mini reproductor';
  });

  player.on('state', ({ playing }) => {
    pintarEstado(playing);
    if (playing) arrancarBucle();
    else pararBucle();
  });

  player.on('trackchange', ({ track }) => pintarPista(track));
  player.on('duration', () => pintarTiempo());
  player.on('time', () => {
    if (!bucle) pintarTiempo();
  });

  queue.on('mode', pintarModos);

  pintarPista(null);
  pintarEstado(false);
  pintarVolumen();
  pintarModos();

  return { pintarPista, pintarVolumen, pintarModos };
}
