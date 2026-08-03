/**
 * Puente con la barra de tareas de Windows.
 *
 * El proceso principal pinta los botones de la miniatura, la barra de progreso
 * sobre el icono y el distintivo de estado, pero no sabe nada de la cola: la
 * pagina le va contando.
 *
 * El envio se recorta a proposito. La posicion cambia cuatro veces por segundo
 * y cruzar el IPC en cada una para mover una barra de cuarenta pixeles no lo
 * vale; los cambios de estado, en cambio, salen en el acto, porque un boton de
 * play que tarda un segundo en volverse pausa se siente roto.
 */

/** Cada cuanto se manda la posicion mientras suena. */
const CADENCIA = 900;

export function initBarraTareas(motor) {
  const { player, queue } = motor;
  const puente = window.sounde.player;
  if (!puente) return { avisar() {} };

  let ultimo = 0;

  const foto = () => ({
    hayPista: !!player.track,
    sonando: player.playing,
    // Con repeticion de toda la cola siempre hay siguiente, aunque sea la
    // primera: el boton no debe apagarse al llegar al final.
    hayPrev: queue.length > 0,
    hayNext: queue.length > 0 && (queue.repeat !== 'off' || queue.index < queue.length - 1),
    posicion: player.currentTime,
    duracion: player.duration,
  });

  const avisar = () => {
    ultimo = performance.now();
    puente.report(foto());
  };

  player.on('trackchange', avisar);
  player.on('state', avisar);
  player.on('duration', avisar);
  queue.on('mode', avisar);
  queue.on('change', avisar);

  player.on('time', () => {
    const ahora = performance.now();
    if (ahora - ultimo < CADENCIA) return;
    avisar();
  });

  puente.onCommand(({ orden }) => {
    if (orden === 'prev') queue.prev();
    else if (orden === 'next') queue.next();
    else if (orden === 'toggle') {
      // Igual que el boton de la ventana: sin nada cargado, arranca la cola.
      if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
      else player.toggle();
    }
  });

  avisar();
  return { avisar };
}
