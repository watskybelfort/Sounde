/**
 * Arranque del renderer: aplica ajustes al DOM y engancha la barra de titulo.
 */

import { initTitlebar } from './titlebar.js';
import { crearMotor } from './engine.js';

const MODOS = [
  ['acrylic', 'Acrilico'],
  ['acrylic-always', 'Acrilico fijo'],
  ['mica', 'Mica'],
  ['tabbed', 'Mica alterna'],
  ['none', 'Sin vidrio'],
];

const raiz = document.documentElement;

boot();

async function boot() {
  initTitlebar();

  const ajustes = await window.sounde.settings.all();
  aplicarAjustes(ajustes);

  // Windows apaga el acrilico del sistema al perder el foco. La UI compensa
  // subiendo su propia veladura; sin esto el contraste se cae y parece que
  // el tema se rompio.
  window.sounde.window.onFocus(({ focused }) => {
    raiz.dataset.focused = String(focused);
    setTexto('dato-foco', focused ? 'con foco' : 'sin foco');
  });

  window.sounde.settings.onChange((patch) => aplicarAjustes(patch));

  const motor = await crearMotor(ajustes);
  engancharMotor(motor);

  pintarDiagnostico(ajustes);
  pintarModos(ajustes.backdrop);
}

/**
 * Lo minimo para que la app ya sirva de algo mientras no esta la interfaz:
 * abrir archivos desde el Explorador los pone a sonar y el titulo dice que
 * suena. Todo lo demas cuelga de `motor`, que es lo que consumira la UI.
 */
function engancharMotor(motor) {
  motor.queue.on('track', ({ track }) => {
    setTexto('titulo-ahora', track ? `${track.artist} — ${track.title}` : 'Sounde');
    document.title = track ? `${track.title} · Sounde` : 'Sounde';
  });

  motor.queue.on('skip', ({ track, message }) => {
    console.warn('[cola] me salto', track?.title, '-', message);
  });

  window.sounde.app.onOpenFiles((tracks) => {
    if (!tracks?.length) return;
    motor.queue.setContext(tracks, { startIndex: 0 });
  });

  // Soltar archivos sobre la ventana. El navegador por defecto navegaria a
  // ellos, que en una app de escritorio significa perder la interfaz entera.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const rutas = window.sounde.library.pathsFromDrop(e.dataTransfer?.files ?? []);
    if (!rutas.length) return;
    const tracks = await window.sounde.library.addPaths(rutas);
    if (tracks.length) motor.queue.setContext(tracks, { startIndex: 0 });
  });
}

export function aplicarAjustes(ajustes) {
  if (!ajustes) return;

  if (ajustes.backdrop !== undefined) {
    raiz.dataset.backdrop = ajustes.backdrop;
    setTexto('dato-backdrop', ajustes.backdrop);
  }
  if (ajustes.glassOpacity !== undefined) {
    raiz.style.setProperty('--transparencia', String(ajustes.glassOpacity));
  }
  if (ajustes.accentFallback !== undefined && !ajustes.adaptiveColor) {
    raiz.style.setProperty('--acento', hexARgb(ajustes.accentFallback));
  }
  if (ajustes.backdropTint !== undefined) {
    raiz.style.setProperty('--tinte', hexARgb(ajustes.backdropTint));
  }
  if (ajustes.miniPlayer !== undefined) {
    raiz.dataset.mini = String(ajustes.miniPlayer);
  }
}

function pintarDiagnostico(ajustes) {
  const { versions } = window.sounde.env;
  setTexto('dato-electron', versions.electron);
  setTexto('dato-chromium', versions.chrome);
  setTexto('dato-foco', document.hasFocus() ? 'con foco' : 'sin foco');
  setTexto('dato-backdrop', ajustes.backdrop);
}

function pintarModos(activo) {
  const cont = document.getElementById('modos');
  if (!cont) return;
  cont.replaceChildren(
    ...MODOS.map(([valor, etiqueta]) => {
      const b = document.createElement('button');
      b.className = 'probe__boton';
      b.textContent = etiqueta;
      b.dataset.valor = valor;
      if (valor === activo) b.dataset.activo = 'true';
      b.addEventListener('click', async () => {
        const modo = await window.sounde.backdrop.apply(valor);
        raiz.dataset.backdrop = modo;
        setTexto('dato-backdrop', modo);
        for (const otro of cont.children) delete otro.dataset.activo;
        b.dataset.activo = 'true';
      });
      return b;
    }),
  );
}

function setTexto(id, texto) {
  const el = document.getElementById(id);
  if (el) el.textContent = texto;
}

/** '#7AA2F7' -> '122 162 247', que es el formato que quieren las variables. */
export function hexARgb(hex) {
  const h = String(hex).replace('#', '').trim();
  if (h.length !== 6) return '122 162 247';
  const n = Number.parseInt(h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}
