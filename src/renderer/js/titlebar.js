/**
 * Barra de titulo propia.
 * Windows no dibuja marco, asi que los botones y el estado maximizado los
 * lleva la pagina.
 */

// Glifos de Segoe Fluent Icons. Se construyen por codigo en vez de pegarlos
// como caracter: son del area de uso privado y cualquier reguardado del
// archivo con la codificacion equivocada los convierte en cajitas.
const GLIFO_MAXIMIZAR = String.fromCharCode(0xe922);
const GLIFO_RESTAURAR = String.fromCharCode(0xe923);

export function initTitlebar() {
  const btnMin = document.getElementById('btn-minimizar');
  const btnMax = document.getElementById('btn-maximizar');
  const btnCerrar = document.getElementById('btn-cerrar');

  btnMin?.addEventListener('click', () => window.sounde.window.minimize());
  btnCerrar?.addEventListener('click', () => window.sounde.window.close());
  btnMax?.addEventListener('click', async () => {
    const maximized = await window.sounde.window.toggleMaximize();
    pintarMaximizar(btnMax, maximized);
  });

  window.sounde.window.onState(({ maximized }) => pintarMaximizar(btnMax, maximized));

  // Doble clic en la zona arrastrable = maximizar, como cualquier ventana.
  document.querySelector('.titlebar')?.addEventListener('dblclick', async (e) => {
    if (e.target.closest('.titlebar__controles')) return;
    const maximized = await window.sounde.window.toggleMaximize();
    pintarMaximizar(btnMax, maximized);
  });

  window.sounde.window.getState().then((state) => {
    if (state) pintarMaximizar(btnMax, state.maximized);
  });
}

function pintarMaximizar(btn, maximized) {
  if (!btn) return;
  btn.textContent = maximized ? GLIFO_RESTAURAR : GLIFO_MAXIMIZAR;
  btn.title = maximized ? 'Restaurar' : 'Maximizar';
  btn.setAttribute('aria-label', btn.title);
}
