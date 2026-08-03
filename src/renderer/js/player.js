/**
 * Motor de audio.
 *
 * Dos decks (dos <audio>, cada uno con su propia entrada al grafo) que se
 * turnan: mientras uno suena, el otro precarga lo siguiente. De ahi salen
 * dos cosas que con un solo elemento son imposibles: el fundido cruzado, y
 * un cambio de pista casi sin hueco, porque asignar `src` corta el audio en
 * seco y volver a arrancar cuesta lo que tarde en llegar la primera trama.
 *
 * Grafo:
 *
 *   <audio> -> source -> trackGain -> fadeGain -\
 *                                                +-> preamp -> EQ x10 ->
 *   <audio> -> source -> trackGain -> fadeGain -/
 *
 *        -> limitador -> analizador -> master -> salida
 *
 * trackGain y fadeGain van separados a proposito: el primero lleva la
 * normalizacion ReplayGain de la pista y el segundo el fundido. Si fueran el
 * mismo nodo, cada fundido borraria la normalizacion y al reves.
 *
 * El analizador esta ANTES del master, asi que el visualizador dibuja la
 * senal de la musica y no la del mando de volumen: bajar el volumen no debe
 * aplastar las barras hasta dejarlas planas.
 */

import { crearEmisor } from './emitter.js';

/** Bandas por defecto, ~1 octava cada una. El proceso principal manda. */
export const BANDAS_EQ = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** Q de las bandas intermedias. 1.41 es el clasico de un grafico de octava. */
const Q_BANDA = 1.41;

/** Bajada/subida al cambiar de deck en seco. Suficiente para no chasquear. */
const CORTE = 0.04;

/** Margen antes del final para pedir la siguiente pista a la cola. */
const PREFETCH_BASE = 12;

/** Cuanto puede empujar o recortar ReplayGain, en factor lineal. */
const RG_MIN = 0.1;
const RG_MAX = 2;

export class Player {
  constructor({ bands = BANDAS_EQ } = {}) {
    const emisor = crearEmisor();
    this.on = emisor.on.bind(emisor);
    this.once = emisor.once.bind(emisor);
    this._emit = emisor.emit.bind(emisor);

    this.bands = [...bands];
    this.volume = 1;
    this.muted = false;
    this.rate = 1;
    this.crossfade = 0;
    this.normalize = true;
    this.eqEnabled = false;
    this.eqGains = this.bands.map(() => 0);
    this.preampDb = 0;

    // latencyHint 'playback' le dice a Chromium que priorice no cortarse
    // sobre responder rapido: aqui nadie esta tocando un instrumento.
    this.ctx = new AudioContext({ latencyHint: 'playback' });

    // --- Cadena comun, montada de la salida hacia atras ---
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.connect(this.master);

    // Limitador de seguridad. No es un efecto: es la red que impide que un
    // ReplayGain generoso mas la subida de graves del EQ acaben recortando
    // en la tarjeta, que es el ruido sucio que no se puede deshacer.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    this.limiter.connect(this.analyser);

    // EQ de 10 bandas. La primera y la ultima son shelf porque un pico en el
    // extremo del espectro deja fuera medio rango util.
    this.filtros = this.bands.map((freq, i) => {
      const f = this.ctx.createBiquadFilter();
      if (i === 0) f.type = 'lowshelf';
      else if (i === this.bands.length - 1) f.type = 'highshelf';
      else {
        f.type = 'peaking';
        f.Q.value = Q_BANDA;
      }
      f.frequency.value = freq;
      f.gain.value = 0;
      return f;
    });
    for (let i = 0; i < this.filtros.length - 1; i++) {
      this.filtros[i].connect(this.filtros[i + 1]);
    }
    this.filtros[this.filtros.length - 1].connect(this.limiter);

    this.preamp = this.ctx.createGain();
    this.preamp.connect(this.filtros[0]);

    // Los decks se crean una sola vez y viven lo que viva la app:
    // createMediaElementSource solo admite una llamada por elemento.
    this.decks = [this._crearDeck(0), this._crearDeck(1)];
    this.activo = 0;

    this._aplicarMaster(0);
  }

  // --- Estado ---------------------------------------------------------------

  get deck() {
    return this.decks[this.activo];
  }

  get track() {
    return this.deck.track;
  }

  get playing() {
    const a = this.deck.audio;
    return !!this.deck.track && !a.paused && !a.ended;
  }

  get currentTime() {
    return this.deck.audio.currentTime || 0;
  }

  get duration() {
    const d = this.deck;
    const nativa = d.audio.duration;
    if (Number.isFinite(nativa) && nativa > 0) return nativa;
    // Un mp3 VBR sin cabecera Xing informa Infinity hasta que termina de
    // descargarse. El valor de los metadatos es el unico util para pintar
    // la barra desde el primer segundo.
    return d.track?.duration || 0;
  }

  /** Segundos ya descargados desde la posicion actual, para pintar el buffer. */
  get buffered() {
    const a = this.deck.audio;
    const t = a.currentTime;
    for (let i = 0; i < a.buffered.length; i++) {
      if (a.buffered.start(i) <= t && t <= a.buffered.end(i)) return a.buffered.end(i);
    }
    return t;
  }

  // --- Transporte -----------------------------------------------------------

  /**
   * Pone `track` a sonar.
   *
   * Con `crossfade` > 0 y algo ya sonando entra por el deck libre y se cruzan
   * las ganancias. Si no, cambia en seco, reusando el deck libre cuando ya
   * traia esa pista precargada: ahi el arranque es inmediato.
   */
  async playTrack(track, opciones = {}) {
    if (!track?.url) return false;

    const crossfade = Math.max(0, opciones.crossfade ?? this.crossfade);
    const inicio = Math.max(0, opciones.startAt ?? 0);
    await this._reanudar();

    const actual = this.deck;
    const libre = this.decks[1 - this.activo];
    const sonando = !!actual.track && !actual.audio.paused && !actual.audio.ended;
    const fundir = crossfade > 0 && sonando;

    // Un deck que ya fallo al precargar no sirve: hay que recargarlo o se
    // queda mudo para siempre sin volver a emitir 'error'.
    const precargado = libre.track?.id === track.id && !libre.audio.error;

    const destino = fundir || precargado ? libre : actual;
    if (destino.track?.id !== track.id || destino.audio.error) {
      this._cargar(destino, track);
    } else {
      // Aunque no haga falta recargarlo, el deck cambia de papel. Sin subir
      // el token, el temporizador que apaga el deck viejo de un cruce
      // anterior lo encuentra "sin cambios" y para justo la pista que acaba
      // de entrar: el cruce se oye entrar y morir a los dos segundos.
      destino.token++;
    }
    this._situar(destino, inicio);

    const t = this.ctx.currentTime;
    const dur = fundir ? crossfade : CORTE;

    if (destino !== actual) {
      rampaDesde(destino.fadeGain.gain, 0, 1, t, dur);

      if (actual.track) {
        // Rampa lineal, no exponencial: en un fundido de un solo sonido la
        // exponencial suena mas natural, pero cruzando dos pistas las dos
        // curvas se hunden a la vez y deja un bache en mitad del cruce.
        rampa(actual.fadeGain.gain, 0, t, dur);
        const viejo = actual;
        const token = viejo.token;
        setTimeout(() => {
          // El token cambia si el deck se ha reutilizado mientras tanto;
          // pararlo entonces cortaria la pista que acaba de entrar.
          if (viejo.token !== token || viejo === this.deck) return;
          viejo.audio.pause();
          fijar(viejo.fadeGain.gain, 1, this.ctx.currentTime);
        }, dur * 1000 + 80);
      }
    } else {
      rampa(destino.fadeGain.gain, 1, t, 0.02);
    }

    this.activo = destino.indice;
    this._emit('trackchange', { track, duration: this.duration });

    try {
      await destino.audio.play();
    } catch (err) {
      this._emit('error', { track, activo: true, message: err.message });
      return false;
    }
    return true;
  }

  /** Deja la pista lista en el deck libre para que el cambio no tenga hueco. */
  preload(track) {
    if (!track?.url) return false;
    const libre = this.decks[1 - this.activo];
    if (libre.track?.id === track.id && !libre.audio.error) return true;
    // Si sigue sonando es que hay un fundido en curso: tocarlo ahora cortaria
    // la cola de la pista anterior a mitad.
    if (!libre.audio.paused) return false;
    this._cargar(libre, track);
    return true;
  }

  async play() {
    const d = this.deck;
    if (!d.track) return false;
    await this._reanudar();
    rampa(d.fadeGain.gain, 1, this.ctx.currentTime, 0.03);
    try {
      await d.audio.play();
    } catch (err) {
      this._emit('error', { track: d.track, activo: true, message: err.message });
      return false;
    }
    return true;
  }

  pause() {
    // Sin rampa a mano: Blink ya mete un fundido corto al pausar un elemento
    // multimedia, asi que no chasquea y la UI responde en el acto.
    this.deck.audio.pause();
  }

  toggle() {
    if (this.playing) {
      this.pause();
      return false;
    }
    this.play();
    return true;
  }

  stop() {
    for (const d of this.decks) {
      d.audio.pause();
      d.token++;
      d.track = null;
      // removeAttribute + load, no `src = ''`: la cadena vacia se resuelve
      // contra la URL de la pagina y dispara un error de carga falso.
      d.audio.removeAttribute('src');
      d.audio.load();
      fijar(d.fadeGain.gain, 1, this.ctx.currentTime);
    }
    this._emit('trackchange', { track: null, duration: 0 });
    this._emit('state', { playing: false, track: null });
  }

  seek(segundos) {
    const d = this.deck;
    if (!d.track) return;
    const dur = this.duration;
    const destino = clamp(segundos, 0, dur > 0 ? Math.max(0, dur - 0.05) : segundos);
    try {
      d.audio.currentTime = destino;
    } catch { /* aun sin metadatos: el salto se pierde, no es grave */ }
    // Los avisos se rearman: tras saltar hacia atras el punto de fundido y
    // el de precarga vuelven a estar por delante.
    d.avisos.prefetch = false;
    d.avisos.fade = false;
    this._emit('time', { current: destino, duration: dur, track: d.track });
  }

  // --- Mandos ---------------------------------------------------------------

  setVolume(v) {
    this.volume = clamp(Number(v) || 0, 0, 1);
    this._aplicarMaster();
    // Avisar no es opcional: el volumen se cambia desde el mando, desde el
    // teclado y desde los ajustes, y sin evento el mando se queda quieto
    // mientras el sonido sube, que parece que el atajo no funciona.
    this._emit('volumen', { volume: this.volume, muted: this.muted });
    return this.volume;
  }

  setMuted(m) {
    this.muted = !!m;
    this._aplicarMaster();
    this._emit('volumen', { volume: this.volume, muted: this.muted });
    return this.muted;
  }

  setRate(r) {
    this.rate = clamp(Number(r) || 1, 0.25, 4);
    for (const d of this.decks) {
      // Sin esto, acelerar la reproduccion sube el tono y todo suena a ardilla.
      d.audio.preservesPitch = true;
      d.audio.playbackRate = this.rate;
    }
    return this.rate;
  }

  setCrossfade(segundos) {
    this.crossfade = clamp(Number(segundos) || 0, 0, 12);
    return this.crossfade;
  }

  setNormalize(activo) {
    this.normalize = !!activo;
    for (const d of this.decks) this._aplicarGananciaPista(d);
    return this.normalize;
  }

  setEqEnabled(activo) {
    this.eqEnabled = !!activo;
    this._aplicarEq();
    return this.eqEnabled;
  }

  setEqGains(gains) {
    if (!Array.isArray(gains)) return this.eqGains;
    this.eqGains = this.bands.map((_, i) => clamp(Number(gains[i]) || 0, -12, 12));
    this._aplicarEq();
    return this.eqGains;
  }

  setEqGain(i, db) {
    if (i < 0 || i >= this.filtros.length) return;
    this.eqGains[i] = clamp(Number(db) || 0, -12, 12);
    rampa(this.filtros[i].gain, this.eqEnabled ? this.eqGains[i] : 0, this.ctx.currentTime, 0.06);
  }

  setPreamp(db) {
    this.preampDb = clamp(Number(db) || 0, -12, 12);
    rampa(this.preamp.gain, dbALineal(this.preampDb), this.ctx.currentTime, 0.06);
    return this.preampDb;
  }

  /** Aplica de golpe lo que venga de los ajustes guardados. */
  aplicarAjustes(a = {}) {
    if (a.volume !== undefined) this.setVolume(a.volume);
    if (a.muted !== undefined) this.setMuted(a.muted);
    if (a.playbackRate !== undefined) this.setRate(a.playbackRate);
    if (a.crossfadeSeconds !== undefined) this.setCrossfade(a.crossfadeSeconds);
    if (a.normalizeVolume !== undefined) this.setNormalize(a.normalizeVolume);
    if (a.preampDb !== undefined) this.setPreamp(a.preampDb);
    if (a.eqGains !== undefined) this.eqGains = this.bands.map((_, i) => clamp(Number(a.eqGains[i]) || 0, -12, 12));
    if (a.eqEnabled !== undefined) this.eqEnabled = !!a.eqEnabled;
    if (a.eqGains !== undefined || a.eqEnabled !== undefined) this._aplicarEq();
  }

  // --- Interioridades -------------------------------------------------------

  _crearDeck(indice) {
    const audio = new Audio();
    audio.preload = 'auto';
    // crossOrigin ANTES de cualquier src, o la peticion sale sin CORS y el
    // nodo de Web Audio saca silencio. Ver la nota en main/protocols.js.
    audio.crossOrigin = 'anonymous';
    audio.preservesPitch = true;

    const source = this.ctx.createMediaElementSource(audio);
    const trackGain = this.ctx.createGain();
    const fadeGain = this.ctx.createGain();
    source.connect(trackGain).connect(fadeGain).connect(this.preamp);

    const deck = {
      indice,
      audio,
      source,
      trackGain,
      fadeGain,
      track: null,
      token: 0,
      avisos: { prefetch: false, fade: false },
      pendiente: 0,
    };

    audio.addEventListener('timeupdate', () => this._tick(deck));
    audio.addEventListener('durationchange', () => {
      if (deck === this.deck) this._emit('duration', { duration: this.duration, track: deck.track });
    });
    audio.addEventListener('loadedmetadata', () => {
      if (deck.pendiente > 0) {
        try {
          audio.currentTime = deck.pendiente;
        } catch { /* el formato no deja saltar: se queda en cero */ }
        deck.pendiente = 0;
      }
      if (deck === this.deck) this._emit('duration', { duration: this.duration, track: deck.track });
    });
    audio.addEventListener('ended', () => {
      // El deck que se apaga en un fundido tambien termina; si no se filtra,
      // la cola avanzaria dos pistas de una vez.
      if (deck !== this.deck) return;
      this._emit('ended', { track: deck.track });
    });
    audio.addEventListener('play', () => {
      if (deck === this.deck) this._emit('state', { playing: true, track: deck.track });
    });
    audio.addEventListener('pause', () => {
      if (deck === this.deck) this._emit('state', { playing: false, track: deck.track });
    });
    audio.addEventListener('waiting', () => {
      if (deck === this.deck) this._emit('buffering', { buffering: true, track: deck.track });
    });
    audio.addEventListener('playing', () => {
      if (deck === this.deck) this._emit('buffering', { buffering: false, track: deck.track });
    });
    audio.addEventListener('error', () => {
      this._emit('error', {
        track: deck.track,
        activo: deck === this.deck,
        code: audio.error?.code ?? null,
        message: mensajeError(audio.error),
      });
    });

    return deck;
  }

  _cargar(deck, track) {
    deck.token++;
    deck.track = track;
    deck.avisos = { prefetch: false, fade: false };
    deck.pendiente = 0;
    deck.audio.playbackRate = this.rate;
    deck.audio.src = track.url;
    deck.audio.load();
    this._aplicarGananciaPista(deck);
  }

  /** Coloca el cabezal, esperando a los metadatos si aun no han llegado. */
  _situar(deck, segundos) {
    if (segundos <= 0) {
      if (deck.audio.currentTime > 0.05 && deck.audio.readyState >= 1) {
        try {
          deck.audio.currentTime = 0;
        } catch { /* da igual: arranca donde pueda */ }
      }
      return;
    }
    if (deck.audio.readyState >= 1) {
      try {
        deck.audio.currentTime = segundos;
        return;
      } catch { /* cae al camino de abajo */ }
    }
    deck.pendiente = segundos;
  }

  _tick(deck) {
    if (deck !== this.deck) return;
    const actual = deck.audio.currentTime;
    const dur = this.duration;
    this._emit('time', { current: actual, duration: dur, track: deck.track });

    if (!dur || !Number.isFinite(dur)) return;
    const restante = dur - actual;

    // Con un fundido largo la precarga tiene que ir por delante del cruce, o
    // la siguiente pista entraria sin un solo byte en memoria.
    const margen = Math.max(PREFETCH_BASE, this.crossfade + 6);
    if (!deck.avisos.prefetch && restante <= margen) {
      deck.avisos.prefetch = true;
      this._emit('prefetch', { track: deck.track, remaining: restante });
    }

    if (this.crossfade > 0 && !deck.avisos.fade && restante <= this.crossfade) {
      deck.avisos.fade = true;
      this._emit('fadepoint', { track: deck.track, remaining: restante });
    }
  }

  _aplicarMaster(dur = 0.06) {
    rampa(this.master.gain, this.muted ? 0 : curvaVolumen(this.volume), this.ctx.currentTime, dur);
  }

  _aplicarEq() {
    const t = this.ctx.currentTime;
    // Con el EQ apagado los filtros se quedan conectados a 0 dB, que es
    // transparente. Desconectarlos en caliente daria un corte audible cada
    // vez que se toca el interruptor.
    this.filtros.forEach((f, i) => {
      rampa(f.gain, this.eqEnabled ? this.eqGains[i] : 0, t, 0.06);
    });
    rampa(this.preamp.gain, dbALineal(this.eqEnabled ? this.preampDb : 0), t, 0.06);
  }

  _aplicarGananciaPista(deck) {
    const t = deck.track;
    // Sin ReplayGain en el archivo no se inventa nada: factor 1. Analizar el
    // audio para deducirlo costaria leer la pista entera antes de sonar.
    const db = this.normalize ? (t?.gainTrackDb ?? t?.gainAlbumDb ?? null) : null;
    const factor = db == null ? 1 : clamp(dbALineal(db), RG_MIN, RG_MAX);
    rampa(deck.trackGain.gain, factor, this.ctx.currentTime, 0.05);
  }

  async _reanudar() {
    if (this.ctx.state === 'running') return;
    try {
      await this.ctx.resume();
    } catch (err) {
      console.warn('[player] no pude reanudar el contexto:', err.message);
    }
  }
}

// --- Utilidades de parametros ---------------------------------------------

/**
 * Rampa lineal con los dos extremos escritos a mano.
 *
 * La version corta seria cancelAndHoldAtTime y encadenar la rampa detras,
 * pero entonces el punto de partida lo decide el motor y Chromium no siempre
 * arranca donde uno cree: interrumpir una rampa en curso con otra hacia el
 * lado contrario hacia que la segunda saltara a su destino de golpe. En un
 * fundido cruzado eso se oye como que una de las dos pistas desaparece.
 * Anclando el origen con setValueAtTime no hay nada que interpretar.
 */
function rampaDesde(param, desde, hasta, t, dur) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(desde, t);
  param.linearRampToValueAtTime(hasta, t + Math.max(dur, 0.005));
}

function fijar(param, valor, t) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(valor, t);
}

/** Rampa desde donde este el parametro ahora mismo. */
function rampa(param, valor, t, dur) {
  rampaDesde(param, param.value, valor, t, dur);
}

function dbALineal(db) {
  return 10 ** (db / 20);
}

/**
 * El oido no es lineal: con ganancia lineal, la mitad del recorrido del mando
 * ya suena casi a tope y todo el ajuste fino se apelotona abajo. La curva
 * cuadratica reparte el recorrido de forma que se sienta parejo.
 */
function curvaVolumen(v) {
  return v * v;
}

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

const ERRORES = {
  1: 'carga cancelada',
  2: 'error de red',
  3: 'no se pudo decodificar',
  4: 'formato no soportado o archivo inaccesible',
};

function mensajeError(err) {
  if (!err) return 'error desconocido';
  return ERRORES[err.code] || err.message || 'error desconocido';
}
