/**
 * Puente con la barra de tareas de Windows.
 *
 * El proceso principal pinta los botones de la miniatura y el distintivo de
 * estado, pero no sabe nada de la cola: la pagina le va contando.
 *
 * Solo se manda cuando algo cambia de verdad: pista, play/pausa o cola. La
 * posicion no viaja, porque al otro lado ya no hay nada que se mueva con ella
 * desde que el icono no lleva barra de progreso.
 */

export function initBarraTareas(motor) {
  const { player, queue } = motor;
  const puente = window.sounde.player;
  if (!puente) return { avisar() {} };

  const foto = () => ({
    // El id, no el titulo: el proceso principal ya tiene la pista entera en la
    // biblioteca y asi no hay dos copias de los metadatos que puedan divergir.
    id: player.track?.id ?? null,
    hayPista: !!player.track,
    sonando: player.playing,
    // Con repeticion de toda la cola siempre hay siguiente, aunque sea la
    // primera: el boton no debe apagarse al llegar al final.
    hayPrev: queue.length > 0,
    hayNext: queue.length > 0 && (queue.repeat !== 'off' || queue.index < queue.length - 1),
  });

  const avisar = () => puente.report(foto());

  player.on('trackchange', avisar);
  player.on('state', avisar);
  queue.on('mode', avisar);
  queue.on('change', avisar);

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
