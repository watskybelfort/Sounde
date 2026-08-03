/**
 * Temporizador de apagado.
 *
 * Dos formas de contar, y las dos hacen falta:
 *
 *   - Por minutos. Lo que uno pide al meterse en la cama.
 *   - Al terminar la cancion. Lo que uno pide cuando ya esta dormido a medias
 *     y no quiere que se corte a mitad de un tema.
 *
 * No apaga en seco: baja el volumen en ocho segundos y pausa. Un corte limpio
 * a mitad de cancion despierta igual que el silencio de golpe cuando se va la
 * luz.
 */

import { crearEmisor } from './emitter.js';

/** Lo que dura el fundido final, en segundos. */
const FUNDIDO = 8;

export function crearTemporizador(motor) {
  const { player, queue } = motor;
  const emisor = crearEmisor();

  let modo = 'off';        // 'off' | 'minutos' | 'pista'
  let fin = 0;             // marca de tiempo en que toca apagar
  let reloj = 0;
  let quitarOyente = null;

  const restante = () => (modo === 'minutos' ? Math.max(0, fin - Date.now()) : 0);

  const avisar = () => emisor.emit('cambio', {
    activo: modo !== 'off',
    modo,
    restanteMs: restante(),
  });

  function limpiar() {
    if (reloj) clearInterval(reloj);
    reloj = 0;
    if (quitarOyente) quitarOyente();
    quitarOyente = null;
  }

  async function apagar() {
    const antes = modo;
    limpiar();
    modo = 'off';
    avisar();
    if (antes !== 'off') await player.apagar(FUNDIDO);
  }

  function porMinutos(minutos) {
    limpiar();
    player.cancelarApagado();
    modo = 'minutos';
    fin = Date.now() + minutos * 60_000;
    // Cada segundo: la cuenta atras se enseña en minutos y segundos, y con
    // un tic mas largo la ultima cifra da saltos.
    reloj = setInterval(() => {
      if (Date.now() >= fin) apagar();
      else avisar();
    }, 1000);
    avisar();
    return modo;
  }

  function alTerminarLaPista() {
    limpiar();
    player.cancelarApagado();
    modo = 'pista';
    // Se engancha a la cola y no al evento 'ended' del reproductor: con
    // fundido cruzado la siguiente ya ha empezado cuando la anterior termina,
    // y apagar entonces cortaria una cancion recien empezada.
    quitarOyente = queue.on('track', () => apagar());
    avisar();
    return modo;
  }

  function cancelar() {
    if (modo === 'off') return false;
    limpiar();
    modo = 'off';
    // Por si se cancela durante el fundido: sin esto el volumen se queda por
    // el suelo y parece que la app se ha quedado muda.
    player.cancelarApagado();
    avisar();
    return true;
  }

  return {
    on: emisor.on.bind(emisor),
    porMinutos,
    alTerminarLaPista,
    cancelar,
    get modo() { return modo; },
    get activo() { return modo !== 'off'; },
    get restanteMs() { return restante(); },
  };
}

/** '00:42' o '1:05:00'. Como el reloj del transporte, en cuenta atras. */
export function formatoCuenta(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const dos = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${m}:${dos(s)}`;
}
