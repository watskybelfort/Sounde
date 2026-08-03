/**
 * Une el motor, la cola y los ajustes guardados.
 *
 * El Player y la Queue no saben que existe el disco ni el proceso principal:
 * se les puede instanciar en una prueba y funcionan solos. Toda la conexion
 * con lo persistente esta aqui.
 */

import { Player } from './player.js';
import { Queue } from './queue.js';

/**
 * Escribir en ajustes a cada pixel del mando de volumen manda un IPC por
 * fotograma. Se agrupa: lo que importa es el valor en el que se suelta.
 */
const ESPERA_GUARDADO = 250;

export async function crearMotor(ajustes) {
  const { eqBands, eqPresets } = await window.sounde.app.constants();

  const player = new Player({ bands: eqBands });
  player.aplicarAjustes(ajustes);

  const queue = new Queue(player);
  queue.setRepeat(ajustes.repeat);
  // Se pone directo, sin setShuffle: la cola aun esta vacia y no hay nada que
  // barajar, pero el modo tiene que quedar activo para cuando se llene.
  queue.shuffle = !!ajustes.shuffle;

  const guardar = agrupar((patch) => window.sounde.settings.set(patch), ESPERA_GUARDADO);

  queue.on('mode', ({ shuffle, repeat }) => guardar({ shuffle, repeat }));

  // Los cambios de ajustes de otra parte de la app (panel de ajustes, atajos)
  // llegan por aqui y el motor los adopta sin recargar nada.
  window.sounde.settings.onChange((patch) => player.aplicarAjustes(patch));

  return {
    player,
    queue,
    eqBands,
    eqPresets,

    setVolume(v) {
      const r = player.setVolume(v);
      guardar({ volume: r });
      return r;
    },

    setMuted(m) {
      const r = player.setMuted(m);
      guardar({ muted: r });
      return r;
    },

    toggleMute() {
      return this.setMuted(!player.muted);
    },

    setRate(r) {
      const v = player.setRate(r);
      guardar({ playbackRate: v });
      return v;
    },

    setCrossfade(s) {
      const v = player.setCrossfade(s);
      guardar({ crossfadeSeconds: v });
      return v;
    },

    setNormalize(b) {
      const v = player.setNormalize(b);
      guardar({ normalizeVolume: v });
      return v;
    },

    setEqEnabled(b) {
      const v = player.setEqEnabled(b);
      guardar({ eqEnabled: v });
      return v;
    },

    setEqGain(i, db) {
      player.setEqGain(i, db);
      // El preset deja de ser el que era en cuanto se toca una banda a mano.
      guardar({ eqGains: [...player.eqGains], eqPreset: 'custom' });
      return player.eqGains;
    },

    setEqPreset(nombre) {
      const gains = eqPresets[nombre];
      if (!gains) return player.eqGains;
      player.setEqGains(gains);
      guardar({ eqGains: [...player.eqGains], eqPreset: nombre });
      return player.eqGains;
    },

    setPreamp(db) {
      const v = player.setPreamp(db);
      guardar({ preampDb: v });
      return v;
    },
  };
}

/** Agrupa llamadas seguidas en una sola, fusionando los parches. */
function agrupar(fn, ms) {
  let timer = null;
  let acumulado = {};
  return (patch) => {
    Object.assign(acumulado, patch);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const envio = acumulado;
      acumulado = {};
      fn(envio);
    }, ms);
  };
}
