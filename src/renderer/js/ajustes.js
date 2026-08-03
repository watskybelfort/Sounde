/**
 * Panel de ajustes.
 *
 * Todo lo que hasta ahora solo se podia tocar editando settings.json a mano:
 * ecualizador, fundido cruzado, los mandos del vidrio, el visualizador y la
 * integracion con Windows.
 *
 * Los cambios se aplican al soltar, no al aceptar. No hay boton de aceptar ni
 * de cancelar: un ecualizador que no se oye hasta que cierras el panel no se
 * puede ajustar de oido, que es la unica forma de ajustarlo.
 */

import { el, glifo, clamp } from './dom.js';

const MODOS_VIDRIO = [
  { valor: 'acrylic', texto: 'Acrilico', ayuda: 'El del sistema. Windows lo apaga al perder el foco.' },
  { valor: 'acrylic-always', texto: 'Acrilico fijo', ayuda: 'Sigue difuminado sin foco. Usa la capa nativa.' },
  { valor: 'mica', texto: 'Mica', ayuda: 'Tiñe el fondo y difumina menos.' },
  { valor: 'tabbed', texto: 'Mica oscura', ayuda: 'Como mica, un punto mas oscura.' },
  { valor: 'none', texto: 'Sin vidrio', ayuda: 'Fondo opaco. Lo mas ligero.' },
];

const VISUALIZADORES = [
  { valor: 'bars', texto: 'Barras' },
  { valor: 'wave', texto: 'Onda' },
  { valor: 'off', texto: 'Ninguno' },
];

const NOMBRES_PRESET = {
  flat: 'Plano', graves: 'Graves', agudos: 'Agudos', vocal: 'Voz',
  trap: 'Trap', reggaeton: 'Reggaeton', acustico: 'Acustico', nocturno: 'Nocturno',
  custom: 'A medida',
};

export function crearAjustes({ motor, ajustes, shell }) {
  let capa = null;
  let estado = { ...ajustes };
  let quitarOyente = null;

  function abrir() {
    if (capa) return;
    capa = construir();
    document.body.append(capa);
    // El foco entra en el panel para que Escape y el tabulador se queden
    // dentro y no acaben paseando por la lista de canciones de detras.
    capa.querySelector('.ajustes__cerrar')?.focus();

    quitarOyente = window.sounde.settings.onChange((patch) => {
      estado = { ...estado, ...patch };
    });
  }

  function cerrar() {
    if (!capa) return;
    capa.remove();
    capa = null;
    quitarOyente?.();
    quitarOyente = null;
  }

  function alternar() {
    if (capa) cerrar();
    else abrir();
  }

  /** Escribe en disco y en el estado local de una vez. */
  function guardar(patch) {
    estado = { ...estado, ...patch };
    window.sounde.settings.set(patch);
  }

  /**
   * Igual, pero para lo que se arrastra.
   *
   * Un deslizador suelta un evento por pixel; escribir cada uno serian
   * cuarenta IPC y cuarenta escrituras a disco por gesto. Lo que importa es
   * donde se suelta.
   */
  let pendiente = null;
  let acumulado = {};
  function guardarSuave(patch) {
    estado = { ...estado, ...patch };
    Object.assign(acumulado, patch);
    clearTimeout(pendiente);
    pendiente = setTimeout(() => {
      const envio = acumulado;
      acumulado = {};
      window.sounde.settings.set(envio);
    }, 220);
  }

  // --- Construccion -----------------------------------------------------------

  function construir() {
    const cuerpo = el('div', { class: 'ajustes__cuerpo' }, [
      seccionSonido(),
      seccionEcualizador(),
      seccionAspecto(),
      seccionSistema(),
      seccionBiblioteca(),
    ]);

    const hoja = el('div', {
      class: 'ajustes flotante',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Ajustes',
    }, [
      el('header', { class: 'ajustes__cabecera' }, [
        el('h2', { class: 'ajustes__titulo', texto: 'Ajustes' }),
        el('button', {
          class: 'icono-btn ajustes__cerrar',
          title: 'Cerrar',
          'aria-label': 'Cerrar',
          texto: glifo('quitar'),
          onclick: cerrar,
        }),
      ]),
      cuerpo,
    ]);

    const fondo = el('div', { class: 'ajustes-capa' }, [hoja]);

    // Pulsar fuera cierra; dentro no, o arrastrar un deslizador y soltar sobre
    // el fondo cerraria el panel a media maniobra.
    fondo.addEventListener('pointerdown', (e) => {
      if (e.target === fondo) cerrar();
    });
    fondo.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cerrar();
      }
    });

    return fondo;
  }

  // --- Secciones ---------------------------------------------------------------

  function seccionSonido() {
    return seccion('Sonido', [
      fila('Normalizar el volumen',
        'Iguala el nivel entre canciones usando el ReplayGain del archivo. Sin esa etiqueta no se inventa nada.',
        interruptor(estado.normalizeVolume, (v) => motor.setNormalize(v))),

      fila('Fundido cruzado',
        'Cero deja las canciones pegadas, sin hueco. Por encima, la siguiente entra mientras la anterior se va.',
        deslizador({
          min: 0, max: 12, paso: 0.5, valor: estado.crossfadeSeconds ?? 0,
          formato: (v) => (v === 0 ? 'sin fundido' : `${v} s`),
          onCambio: (v) => motor.setCrossfade(v),
        })),

      fila('Velocidad',
        'El tono se mantiene: a 1.5 no suena a ardilla.',
        deslizador({
          min: 0.5, max: 2, paso: 0.05, valor: estado.playbackRate ?? 1,
          formato: (v) => `${v.toFixed(2)}x`,
          onCambio: (v) => motor.setRate(v),
        })),

      fila('Recordar donde iba',
        'Al abrir la app, deja preparada la ultima cancion en su punto.',
        interruptor(estado.resumeOnLaunch, (v) => guardar({ resumeOnLaunch: v }))),
    ]);
  }

  function seccionEcualizador() {
    const bandas = motor.eqBands ?? [];
    const controles = [];

    const eq = el('div', { class: 'eq' }, bandas.map((hz, i) => {
      const marca = el('span', { class: 'eq__db tabular' });
      const rango = el('input', {
        class: 'eq__banda',
        type: 'range',
        min: '-12', max: '12', step: '0.5',
        value: String(estado.eqGains?.[i] ?? 0),
        'aria-label': `${etiquetaHz(hz)}, ganancia en decibelios`,
        oninput: (e) => {
          const db = Number(e.target.value);
          marca.textContent = formatoDb(db);
          motor.setEqGain(i, db);
          marcarPreset('custom');
        },
      });
      marca.textContent = formatoDb(estado.eqGains?.[i] ?? 0);
      controles.push({ rango, marca });
      return el('div', { class: 'eq__banda-caja' }, [
        marca,
        el('div', { class: 'eq__ranura' }, [rango]),
        el('span', { class: 'eq__hz', texto: etiquetaHz(hz) }),
      ]);
    }));

    const presets = el('div', { class: 'segmentado segmentado--envuelto' },
      Object.keys(motor.eqPresets ?? {}).map((nombre) => el('button', {
        class: 'segmentado__opcion',
        dataset: { preset: nombre },
        texto: NOMBRES_PRESET[nombre] ?? nombre,
        onclick: () => {
          const gains = motor.setEqPreset(nombre);
          gains.forEach((db, i) => {
            controles[i].rango.value = String(db);
            controles[i].marca.textContent = formatoDb(db);
          });
          marcarPreset(nombre);
        },
      })));

    function marcarPreset(nombre) {
      for (const b of presets.children) {
        b.setAttribute('aria-pressed', String(b.dataset.preset === nombre));
      }
    }
    marcarPreset(estado.eqPreset ?? 'flat');

    return seccion('Ecualizador', [
      fila('Ecualizador',
        'Apagado, los filtros siguen conectados a 0 dB: encenderlo y apagarlo no da ningun chasquido.',
        interruptor(estado.eqEnabled, (v) => motor.setEqEnabled(v))),
      el('div', { class: 'ajustes__bloque' }, [presets, eq]),
      fila('Preamplificacion',
        'Bajala si al subir graves el sonido empieza a apretarse.',
        deslizador({
          min: -12, max: 12, paso: 0.5, valor: estado.preampDb ?? 0,
          formato: formatoDb,
          onCambio: (v) => motor.setPreamp(v),
        })),
    ]);
  }

  function seccionAspecto() {
    return seccion('Aspecto', [
      fila('Vidrio',
        'El desenfoque de verdad lo pone Windows detras de la ventana; la pagina solo evita pintar opaco encima.',
        opciones(MODOS_VIDRIO, estado.backdrop ?? 'acrylic', (v) => {
          estado.backdrop = v;
          window.sounde.backdrop.apply(v);
        })),

      fila('Veladura de la interfaz',
        'Esta es la capa que pinta la pagina ENCIMA del vidrio. Si se ve turbio, casi siempre sobra de esta y no de la de Windows.',
        deslizador({
          min: 0, max: 1, paso: 0.02, valor: estado.glassOpacity ?? 0.42,
          formato: (v) => `${Math.round(v * 100)}%`,
          onCambio: (v) => {
            // La variable se escribe ya para que el vidrio responda mientras
            // se arrastra; a disco va cuando se suelta.
            document.documentElement.style.setProperty('--transparencia', String(v));
            guardarSuave({ glassOpacity: v });
          },
        })),

      fila('Color de la caratula',
        'El tinte y el acento salen del disco que suena y cruzan de uno a otro al cambiar de cancion.',
        interruptor(estado.adaptiveColor, (v) => guardar({ adaptiveColor: v }))),

      fila('Visualizador',
        'Se dibuja detras de los mandos, con la señal de la musica: bajar el volumen no aplasta las barras.',
        opciones(VISUALIZADORES, estado.visualizer ?? 'bars', (v) => guardar({ visualizer: v }))),
    ]);
  }

  function seccionSistema() {
    return seccion('Windows', [
      fila('Teclas multimedia',
        'Windows manda play, pausa y los saltos a quien esta sonando. Apagado, Sounde deja de responderlas; su ficha con la caratula se sigue publicando.',
        interruptor(estado.mediaKeys, (v) => guardar({ mediaKeys: v }))),

      fila('Avisar al cambiar de cancion',
        'Solo con la ventana detras. Delante no cuenta nada que no se lea ya abajo.',
        interruptor(estado.showNotifications, (v) => guardar({ showNotifications: v }))),

      fila('Dejarlo en la bandeja',
        'Con esto puesto, la X esconde la ventana y la musica sigue. Para salir de verdad, el menu del icono de la bandeja.',
        interruptor(estado.minimizeToTray, (v) => guardar({ minimizeToTray: v }))),
    ]);
  }

  function seccionBiblioteca() {
    const lista = el('div', { class: 'ajustes__carpetas' });

    async function pintar() {
      const carpetas = await window.sounde.library.folders();
      lista.replaceChildren(...(carpetas.length
        ? carpetas.map((carpeta) => el('div', { class: 'ajustes__carpeta' }, [
          el('span', { class: 'ajustes__carpeta-icono', texto: glifo('carpeta') }),
          el('span', { class: 'ajustes__carpeta-ruta truncar', texto: carpeta, title: carpeta }),
          el('button', {
            class: 'icono-btn',
            title: 'Quitar esta carpeta',
            'aria-label': `Quitar ${carpeta}`,
            texto: glifo('quitar'),
            onclick: async () => {
              await window.sounde.library.removeFolder(carpeta);
              await shell.refrescar();
              pintar();
            },
          }),
        ]))
        : [el('p', { class: 'ajustes__ayuda', texto: 'Todavia no hay ninguna carpeta vigilada.' })]));
    }
    pintar();

    return seccion('Biblioteca', [
      el('div', { class: 'ajustes__bloque' }, [
        lista,
        el('div', { class: 'ajustes__botones' }, [
          el('button', {
            class: 'boton',
            texto: 'Anadir carpeta',
            onclick: async () => {
              await window.sounde.library.addFolder();
              await shell.refrescar();
              pintar();
            },
          }),
          el('button', {
            class: 'boton',
            texto: 'Volver a escanear',
            onclick: () => window.sounde.library.scan(),
          }),
        ]),
      ]),
    ]);
  }

  return { abrir, cerrar, alternar, get abierto() { return !!capa; } };
}

// --- Piezas -----------------------------------------------------------------

function seccion(titulo, hijos) {
  return el('section', { class: 'ajustes__seccion' }, [
    el('h3', { class: 'ajustes__seccion-titulo', texto: titulo }),
    ...hijos,
  ]);
}

function fila(titulo, ayuda, control) {
  return el('div', { class: 'ajustes__fila' }, [
    el('div', { class: 'ajustes__texto' }, [
      el('span', { class: 'ajustes__nombre', texto: titulo }),
      ayuda ? el('span', { class: 'ajustes__ayuda', texto: ayuda }) : null,
    ]),
    el('div', { class: 'ajustes__control' }, [control]),
  ]);
}

function interruptor(valor, onCambio) {
  const entrada = el('input', {
    class: 'interruptor__casilla',
    type: 'checkbox',
    ...(valor ? { checked: true } : {}),
    onchange: (e) => onCambio(e.target.checked),
  });
  return el('label', { class: 'interruptor' }, [
    entrada,
    el('span', { class: 'interruptor__pista' }, [el('span', { class: 'interruptor__pomo' })]),
  ]);
}

function deslizador({ min, max, paso, valor, formato, onCambio }) {
  const marca = el('span', { class: 'deslizador__valor tabular', texto: formato(valor) });
  const entrada = el('input', {
    class: 'deslizador__rango',
    type: 'range',
    min: String(min), max: String(max), step: String(paso),
    value: String(clamp(valor, min, max)),
    oninput: (e) => {
      const v = Number(e.target.value);
      marca.textContent = formato(v);
      onCambio(v);
    },
  });
  return el('div', { class: 'deslizador' }, [entrada, marca]);
}

function opciones(lista, valor, onCambio) {
  const caja = el('div', { class: 'segmentado' }, lista.map((o) => el('button', {
    class: 'segmentado__opcion',
    dataset: { valor: o.valor },
    title: o.ayuda ?? '',
    texto: o.texto,
    onclick: () => {
      marcar(o.valor);
      onCambio(o.valor);
    },
  })));

  function marcar(v) {
    for (const b of caja.children) b.setAttribute('aria-pressed', String(b.dataset.valor === v));
  }
  marcar(valor);
  return caja;
}

/** 1000 -> '1k', 16000 -> '16k'. En diez columnas estrechas no cabe mas. */
function etiquetaHz(hz) {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

function formatoDb(db) {
  const n = Number(db);
  if (Math.abs(n) < 0.05) return '0';
  return `${n > 0 ? '+' : ''}${n % 1 === 0 ? n : n.toFixed(1)}`;
}
