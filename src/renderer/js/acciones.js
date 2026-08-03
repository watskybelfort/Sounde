/**
 * Catalogo de acciones de la aplicacion.
 *
 * Un solo sitio del que beben el teclado y la paleta de comandos. Con listas
 * separadas, un atajo nuevo se olvida en la paleta y una accion nueva de la
 * paleta se queda sin atajo, y el usuario acaba sin saber que existe.
 *
 * `tecla` describe la combinacion; `texto` es lo que se lee en la paleta.
 */

export function crearAcciones(ctx) {
  const { motor, shell, favoritos, cola, temporizador, raiz } = ctx;
  const { player, queue } = motor;

  // El temporizador entra por la paleta y no por atajos: se pone una vez al
  // dia y gastar cinco combinaciones de teclado en el seria un despilfarro.
  const dormir = [15, 30, 45, 60, 90].map((minutos) => ({
    id: `dormir-${minutos}`,
    texto: `Apagar dentro de ${minutos} minutos`,
    icono: 'temporizador',
    grupo: 'Temporizador',
    ejecutar: () => temporizador?.porMinutos(minutos),
  }));

  const saltar = (segundos) => player.seek(player.currentTime + segundos);
  const volumen = (delta) => {
    motor.setVolume(Math.min(1, Math.max(0, player.volume + delta)));
    if (player.muted) motor.setMuted(false);
  };

  return [
    {
      id: 'reproducir',
      texto: 'Reproducir o pausar',
      icono: 'reproducir',
      grupo: 'Reproduccion',
      tecla: { key: ' ' },
      atajo: 'Espacio',
      ejecutar: () => {
        if (!player.track && queue.length) queue.playAt(Math.max(0, queue.index));
        else player.toggle();
      },
    },
    {
      id: 'siguiente',
      texto: 'Siguiente cancion',
      icono: 'siguiente',
      grupo: 'Reproduccion',
      tecla: { key: 'ArrowRight', ctrl: true },
      atajo: 'Ctrl + →',
      ejecutar: () => queue.next(),
    },
    {
      id: 'anterior',
      texto: 'Cancion anterior',
      icono: 'anterior',
      grupo: 'Reproduccion',
      tecla: { key: 'ArrowLeft', ctrl: true },
      atajo: 'Ctrl + ←',
      ejecutar: () => queue.prev(),
    },
    {
      id: 'adelantar',
      texto: 'Adelantar 5 segundos',
      icono: 'siguiente',
      grupo: 'Reproduccion',
      tecla: { key: 'ArrowRight' },
      atajo: '→',
      ejecutar: () => saltar(5),
    },
    {
      id: 'retroceder',
      texto: 'Retroceder 5 segundos',
      icono: 'anterior',
      grupo: 'Reproduccion',
      tecla: { key: 'ArrowLeft' },
      atajo: '←',
      ejecutar: () => saltar(-5),
    },
    {
      id: 'subir-volumen',
      texto: 'Subir el volumen',
      icono: 'volumen3',
      grupo: 'Reproduccion',
      tecla: { key: 'ArrowUp' },
      atajo: '↑',
      ejecutar: () => volumen(0.05),
    },
    {
      id: 'bajar-volumen',
      texto: 'Bajar el volumen',
      icono: 'volumen1',
      grupo: 'Reproduccion',
      tecla: { key: 'ArrowDown' },
      atajo: '↓',
      ejecutar: () => volumen(-0.05),
    },
    {
      id: 'silencio',
      texto: 'Silenciar o recuperar el sonido',
      icono: 'silencio',
      grupo: 'Reproduccion',
      tecla: { key: 'm' },
      atajo: 'M',
      ejecutar: () => motor.toggleMute(),
    },
    {
      id: 'aleatorio',
      texto: 'Cambiar el modo aleatorio',
      icono: 'aleatorio',
      grupo: 'Reproduccion',
      tecla: { key: 's' },
      atajo: 'S',
      ejecutar: () => queue.toggleShuffle(),
    },
    {
      id: 'repetir',
      texto: 'Cambiar el modo de repeticion',
      icono: 'repetirTodo',
      grupo: 'Reproduccion',
      tecla: { key: 'r' },
      atajo: 'R',
      ejecutar: () => queue.cycleRepeat(),
    },
    {
      id: 'favorito',
      texto: 'Marcar la cancion como favorita',
      icono: 'corazon',
      grupo: 'Reproduccion',
      tecla: { key: 'f' },
      atajo: 'F',
      ejecutar: () => favoritos?.alternar(player.track?.id),
    },

    // --- Navegacion ---------------------------------------------------------
    {
      id: 'ir-canciones',
      texto: 'Ir a Canciones',
      icono: 'musica',
      grupo: 'Ir a',
      tecla: { key: '1', ctrl: true },
      atajo: 'Ctrl + 1',
      ejecutar: () => shell.ir({ tipo: 'canciones' }),
    },
    {
      id: 'ir-albumes',
      texto: 'Ir a Albumes',
      icono: 'album',
      grupo: 'Ir a',
      tecla: { key: '2', ctrl: true },
      atajo: 'Ctrl + 2',
      ejecutar: () => shell.ir({ tipo: 'albumes' }),
    },
    {
      id: 'ir-artistas',
      texto: 'Ir a Artistas',
      icono: 'artista',
      grupo: 'Ir a',
      tecla: { key: '3', ctrl: true },
      atajo: 'Ctrl + 3',
      ejecutar: () => shell.ir({ tipo: 'artistas' }),
    },
    {
      id: 'ir-favoritos',
      texto: 'Ir a Favoritos',
      icono: 'corazonLleno',
      grupo: 'Ir a',
      tecla: { key: '4', ctrl: true },
      atajo: 'Ctrl + 4',
      ejecutar: () => shell.ir({ tipo: 'favoritos' }),
    },
    {
      id: 'ir-recientes',
      texto: 'Ir a Recientes',
      icono: 'reciente',
      grupo: 'Ir a',
      tecla: { key: '5', ctrl: true },
      atajo: 'Ctrl + 5',
      ejecutar: () => shell.ir({ tipo: 'recientes' }),
    },

    {
      id: 'letra',
      texto: 'Ver la letra',
      icono: 'letra',
      grupo: 'Ir a',
      tecla: { key: 'l', ctrl: true },
      atajo: 'Ctrl + L',
      ejecutar: () => shell.alternarLetra(),
    },

    // --- Ventana ------------------------------------------------------------
    {
      id: 'buscar',
      texto: 'Buscar en la biblioteca',
      icono: 'buscar',
      grupo: 'Ventana',
      tecla: { key: 'f', ctrl: true },
      atajo: 'Ctrl + F',
      ejecutar: () => {
        const campo = document.querySelector('#buscador');
        campo?.focus();
        campo?.select();
      },
    },
    {
      id: 'cola',
      texto: 'Mostrar u ocultar la cola',
      icono: 'cola',
      grupo: 'Ventana',
      tecla: { key: 'q', ctrl: true },
      atajo: 'Ctrl + Q',
      ejecutar: () => cola?.alternar(),
    },
    {
      id: 'mini',
      texto: 'Mini reproductor',
      icono: 'aVentana',
      grupo: 'Ventana',
      tecla: { key: 'm', ctrl: true },
      atajo: 'Ctrl + M',
      ejecutar: () => window.sounde.window.setMini(raiz.dataset.mini !== 'true'),
    },
    {
      id: 'lateral',
      texto: 'Plegar o desplegar el panel lateral',
      icono: 'plegar',
      grupo: 'Ventana',
      tecla: { key: 'b', ctrl: true },
      atajo: 'Ctrl + B',
      ejecutar: () => document.querySelector('#btn-plegar')?.click(),
    },

    // --- Temporizador -------------------------------------------------------
    ...dormir,
    {
      id: 'dormir-pista',
      texto: 'Apagar al terminar esta cancion',
      icono: 'temporizador',
      grupo: 'Temporizador',
      ejecutar: () => temporizador?.alTerminarLaPista(),
    },
    {
      id: 'dormir-quitar',
      texto: 'Quitar el temporizador',
      icono: 'quitar',
      grupo: 'Temporizador',
      ejecutar: () => temporizador?.cancelar(),
    },
  ];
}
