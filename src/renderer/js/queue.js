/**
 * Cola de reproduccion.
 *
 * `items` es el orden real en que va a sonar la musica, que es exactamente lo
 * que muestra la vista de Cola. El aleatorio no es una capa que traduce
 * indices por detras: baraja la lista de verdad, asi que lo que se ve es lo
 * que suena. `original` guarda el orden sin barajar para poder deshacerlo.
 *
 * El motor no sabe nada de esto. La cola escucha sus avisos ('prefetch',
 * 'fadepoint', 'ended') y le va diciendo que pista toca.
 */

import { crearEmisor } from './emitter.js';

/** Antes de este punto, "anterior" reinicia la pista en vez de retroceder. */
const REINICIO = 3;

/** Fundido maximo en un salto manual: el completo se hace eterno a mano. */
const FUNDIDO_MANUAL = 1.5;

/** Pistas rotas seguidas antes de rendirse y parar. */
const MAX_FALLOS = 5;

/** Cuantas entradas guarda el historial de escucha. */
const MAX_HISTORIAL = 500;

export class Queue {
  constructor(player) {
    const emisor = crearEmisor();
    this.on = emisor.on.bind(emisor);
    this._emit = emisor.emit.bind(emisor);

    this.player = player;
    this.items = [];
    this.original = [];
    this.index = -1;
    this.shuffle = false;
    this.repeat = 'off'; // 'off' | 'all' | 'one'
    this.historial = [];
    this.fallos = 0;

    player.on('prefetch', () => {
      const siguiente = this.peekNext();
      if (siguiente) player.preload(siguiente);
    });

    player.on('fadepoint', () => {
      // El cruce empieza aqui: la cola avanza mientras la pista anterior aun
      // se esta apagando. El 'ended' de ese deck ya lo descarta el motor.
      if (player.crossfade > 0) this._avanzarAuto();
    });

    player.on('ended', () => this._avanzarAuto());

    player.on('error', ({ track, activo, message }) => {
      if (!activo) return; // fallo al precargar: se recarga solo al entrar
      this.fallos++;
      this._emit('skip', { track, message });
      if (this.fallos > MAX_FALLOS) {
        this._emit('end', { reason: 'demasiados-errores' });
        return;
      }
      this._avanzarAuto();
    });

    player.on('state', ({ playing }) => {
      if (playing) this.fallos = 0;
    });
  }

  // --- Lectura --------------------------------------------------------------

  get current() {
    return this.items[this.index] ?? null;
  }

  get length() {
    return this.items.length;
  }

  /** Que sonaria despues, sin tocar nada. */
  peekNext() {
    if (!this.items.length) return null;
    if (this.repeat === 'one') return this.current;
    if (this.index + 1 < this.items.length) return this.items[this.index + 1];
    if (this.repeat === 'all') return this.items[0];
    return null;
  }

  snapshot() {
    return {
      items: this.items,
      index: this.index,
      shuffle: this.shuffle,
      repeat: this.repeat,
      current: this.current,
    };
  }

  // --- Contexto -------------------------------------------------------------

  /**
   * Sustituye la cola entera. Es lo que pasa al pulsar una cancion en una
   * lista: suena esa y la cola pasa a ser esa lista, no solo esa pista.
   */
  async setContext(tracks, opciones = {}) {
    const lista = (tracks || []).filter((t) => t?.url);
    if (!lista.length) {
      this.clear();
      return false;
    }

    this.original = [...lista];
    this.items = [...lista];

    let inicio = 0;
    if (opciones.startId) inicio = Math.max(0, this.items.findIndex((t) => t.id === opciones.startId));
    else if (Number.isInteger(opciones.startIndex)) inicio = clamp(opciones.startIndex, 0, this.items.length - 1);

    if (this.shuffle) {
      // La elegida se queda primera y el resto se baraja: pulsar una cancion
      // con el aleatorio puesto tiene que sonar esa, no otra cualquiera.
      const elegida = this.items[inicio];
      const resto = this.items.filter((_, i) => i !== inicio);
      this.items = [elegida, ...barajar(resto)];
      inicio = 0;
    }

    this.index = inicio;
    this.fallos = 0;
    this._emit('change', this.snapshot());
    if (opciones.autoplay === false) {
      this._emit('track', { track: this.current, index: this.index });
      return true;
    }
    return this._reproducirActual({ manual: true });
  }

  async playAt(i) {
    if (i < 0 || i >= this.items.length) return false;
    this.index = i;
    this._emit('change', this.snapshot());
    return this._reproducirActual({ manual: true });
  }

  async playId(id) {
    const i = this.items.findIndex((t) => t.id === id);
    return i >= 0 ? this.playAt(i) : false;
  }

  // --- Navegacion -----------------------------------------------------------

  async next() {
    if (!this.items.length) return false;

    if (this.index + 1 < this.items.length) this.index++;
    else if (this.repeat !== 'off') this.index = 0;
    else return this._terminar();

    this._emit('change', this.snapshot());
    return this._reproducirActual({ manual: true });
  }

  async prev() {
    if (!this.items.length) return false;

    // El gesto clasico: si ya lleva un rato sonando, "anterior" significa
    // "vuelve a empezar esta", no "salta a la de antes".
    if (this.player.currentTime > REINICIO) {
      this.player.seek(0);
      return true;
    }

    if (this.index > 0) this.index--;
    else if (this.repeat === 'all') this.index = this.items.length - 1;
    else {
      this.player.seek(0);
      return true;
    }

    this._emit('change', this.snapshot());
    return this._reproducirActual({ manual: true });
  }

  // --- Modos ----------------------------------------------------------------

  setShuffle(activo) {
    activo = !!activo;
    if (activo === this.shuffle) return this.shuffle;
    this.shuffle = activo;

    const actual = this.current;
    if (activo) {
      // Solo se baraja lo que falta. Tocar lo ya reproducido haria que
      // "anterior" saltase a canciones que nunca sonaron.
      const cabeza = this.items.slice(0, this.index + 1);
      const cola = barajar(this.items.slice(this.index + 1));
      this.items = [...cabeza, ...cola];
    } else {
      this.items = [...this.original];
      if (actual) {
        const i = this.items.findIndex((t) => t.id === actual.id);
        if (i >= 0) this.index = i;
      }
    }

    this._emit('change', this.snapshot());
    this._emit('mode', { shuffle: this.shuffle, repeat: this.repeat });
    return this.shuffle;
  }

  toggleShuffle() {
    return this.setShuffle(!this.shuffle);
  }

  setRepeat(modo) {
    this.repeat = ['off', 'all', 'one'].includes(modo) ? modo : 'off';
    this._emit('mode', { shuffle: this.shuffle, repeat: this.repeat });
    return this.repeat;
  }

  /** off -> all -> one -> off, que es el ciclo que espera todo el mundo. */
  cycleRepeat() {
    const orden = ['off', 'all', 'one'];
    return this.setRepeat(orden[(orden.indexOf(this.repeat) + 1) % orden.length]);
  }

  // --- Edicion --------------------------------------------------------------

  /** Justo despues de la actual: "reproducir a continuacion". */
  addNext(tracks) {
    const nuevos = normalizar(tracks);
    if (!nuevos.length) return 0;
    const at = this.index + 1;
    this.items.splice(at, 0, ...nuevos);
    this.original.push(...nuevos);
    if (this.index < 0) this.index = 0;
    this._emit('change', this.snapshot());
    return nuevos.length;
  }

  addLast(tracks) {
    const nuevos = normalizar(tracks);
    if (!nuevos.length) return 0;
    this.items.push(...nuevos);
    this.original.push(...nuevos);
    if (this.index < 0) this.index = 0;
    this._emit('change', this.snapshot());
    return nuevos.length;
  }

  removeAt(i) {
    if (i < 0 || i >= this.items.length) return false;
    const [fuera] = this.items.splice(i, 1);
    const enOriginal = this.original.findIndex((t) => t.id === fuera.id);
    if (enOriginal >= 0) this.original.splice(enOriginal, 1);

    if (i < this.index) this.index--;
    else if (i === this.index) {
      // Se ha quitado la que sonaba: entra la que ocupa su hueco.
      this.index = Math.min(this.index, this.items.length - 1);
      if (this.index < 0) {
        this.clear();
        return true;
      }
      this._reproducirActual({ manual: true });
    }
    this._emit('change', this.snapshot());
    return true;
  }

  move(desde, hasta) {
    if (desde === hasta) return false;
    if (desde < 0 || desde >= this.items.length) return false;
    const destino = clamp(hasta, 0, this.items.length - 1);

    const actual = this.current;
    const [pieza] = this.items.splice(desde, 1);
    this.items.splice(destino, 0, pieza);
    // El indice sigue a la pista que suena, no a su posicion vieja: arrastrar
    // otra fila nunca debe cambiar lo que esta sonando.
    if (actual) this.index = this.items.findIndex((t) => t.id === actual.id);
    this._emit('change', this.snapshot());
    return true;
  }

  clear() {
    this.items = [];
    this.original = [];
    this.index = -1;
    this.player.stop();
    this._emit('change', this.snapshot());
    return true;
  }

  // --- Interioridades -------------------------------------------------------

  async _reproducirActual({ manual = false, fundir = false } = {}) {
    const track = this.current;
    if (!track) return this._terminar();

    // A mano el fundido se recorta: esperar seis segundos a que entre la
    // pista que acabas de pedir se siente como que el boton no responde.
    const crossfade = fundir
      ? this.player.crossfade
      : manual
        ? Math.min(this.player.crossfade, FUNDIDO_MANUAL)
        : this.player.crossfade;

    this._emit('track', { track, index: this.index });
    this._anotar(track);
    return this.player.playTrack(track, { crossfade });
  }

  async _avanzarAuto() {
    if (!this.items.length) return false;

    if (this.repeat === 'one') {
      // Repetir una: vuelve a empezar sin mover el indice.
      return this._reproducirActual({ fundir: this.player.crossfade > 0 });
    }

    if (this.index + 1 < this.items.length) this.index++;
    else if (this.repeat === 'all') this.index = 0;
    else return this._terminar();

    this._emit('change', this.snapshot());
    return this._reproducirActual({ fundir: this.player.crossfade > 0 });
  }

  _terminar() {
    this.player.pause();
    this._emit('end', { reason: 'fin-de-cola' });
    return false;
  }

  _anotar(track) {
    this.historial.push({ id: track.id, at: Date.now() });
    if (this.historial.length > MAX_HISTORIAL) {
      this.historial.splice(0, this.historial.length - MAX_HISTORIAL);
    }
  }
}

// --- Utilidades -----------------------------------------------------------

/**
 * Fisher-Yates. La version de ordenar con `Math.random() - 0.5` es tentadora
 * y esta mal: el resultado no es uniforme y las pistas del principio tienden
 * a quedarse cerca del principio.
 */
function barajar(lista) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizar(tracks) {
  const lista = Array.isArray(tracks) ? tracks : [tracks];
  return lista.filter((t) => t?.url);
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}
