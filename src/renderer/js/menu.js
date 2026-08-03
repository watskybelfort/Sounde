/**
 * Menu contextual.
 *
 * Solo hay uno abierto a la vez y vive colgado del body, no dentro de la
 * fila: metido en la lista lo recortaria el overflow del viewport y ademas
 * desapareceria al reciclarse la fila mientras el menu esta abierto.
 *
 * Aqui `backdrop-filter` si tiene sentido, y es de los pocos sitios: flota
 * sobre la interfaz de la propia pagina, asi que debajo hay pixeles reales
 * que difuminar. Sobre el fondo de la ventana no habria nada que hacer.
 */

import { el, glifo } from './dom.js';

/** Margen minimo contra el borde de la ventana al colocarlo. */
const BORDE = 8;

let abierto = null;

export function cerrarMenu() {
  if (!abierto) return;
  abierto.raiz.remove();
  // Los submenus cuelgan del body por su cuenta, no del menu padre: si no se
  // recogen aqui se quedan flotando en pantalla despues de cerrar, y ademas
  // el siguiente menu encuentra sus opciones viejas en el DOM.
  for (const sub of abierto.submenus) sub.remove();
  document.removeEventListener('pointerdown', abierto.fuera, true);
  document.removeEventListener('keydown', abierto.tecla, true);
  window.removeEventListener('blur', cerrarMenu);
  window.removeEventListener('resize', cerrarMenu);
  abierto = null;
}

/**
 * `items`: [{ texto, icono, onClick, submenu, separador, activo, peligro }]
 */
export function abrirMenu(items, { x, y }) {
  cerrarMenu();

  const submenus = [];
  const raiz = construir(items, 'menu flotante', submenus);
  document.body.append(raiz);
  colocar(raiz, x, y);

  const fuera = (e) => {
    if (!raiz.contains(e.target)) cerrarMenu();
  };
  const tecla = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      cerrarMenu();
    }
  };

  document.addEventListener('pointerdown', fuera, true);
  document.addEventListener('keydown', tecla, true);
  window.addEventListener('blur', cerrarMenu);
  window.addEventListener('resize', cerrarMenu);

  abierto = { raiz, fuera, tecla, submenus };
  raiz.querySelector('.menu__item')?.focus();
  return raiz;
}

function construir(items, clase, submenus) {
  const raiz = el('div', { class: clase, role: 'menu' });
  let submenuAbierto = null;

  const cerrarSub = () => {
    if (!submenuAbierto) return;
    submenuAbierto.nodo.remove();
    const i = submenus.indexOf(submenuAbierto.nodo);
    if (i >= 0) submenus.splice(i, 1);
    submenuAbierto = null;
  };

  for (const item of items) {
    if (!item) continue;
    if (item.separador) {
      raiz.append(el('div', { class: 'menu__separador' }));
      continue;
    }

    const nodo = el('button', {
      class: `menu__item${item.peligro ? ' menu__item--peligro' : ''}`,
      role: 'menuitem',
      type: 'button',
    }, [
      el('span', { class: 'menu__icono', texto: item.icono ? glifo(item.icono) : '' }),
      el('span', { class: 'menu__texto truncar', texto: item.texto }),
      item.submenu ? el('span', { class: 'menu__flecha', texto: glifo('desplegar') }) : null,
      item.atajo ? el('span', { class: 'menu__atajo', texto: item.atajo }) : null,
    ]);

    if (item.activo) nodo.dataset.activo = 'true';

    if (item.submenu) {
      const abrirSub = () => {
        if (submenuAbierto?.dueno === nodo) return;
        cerrarSub();
        const sub = construir(item.submenu(), 'menu menu--sub flotante', submenus);
        document.body.append(sub);
        submenus.push(sub);
        const r = nodo.getBoundingClientRect();
        colocar(sub, r.right - 4, r.top - 6);
        submenuAbierto = { nodo: sub, dueno: nodo };
      };
      nodo.addEventListener('pointerenter', abrirSub);
      nodo.addEventListener('focus', abrirSub);
      nodo.addEventListener('click', abrirSub);
    } else {
      nodo.addEventListener('pointerenter', cerrarSub);
      nodo.addEventListener('click', () => {
        cerrarMenu();
        item.onClick?.();
      });
    }

    raiz.append(nodo);
  }

  raiz.addEventListener('keydown', (e) => {
    const opciones = [...raiz.querySelectorAll('.menu__item')];
    const i = opciones.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      opciones[(i + 1) % opciones.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      opciones[(i - 1 + opciones.length) % opciones.length]?.focus();
    }
  });

  return raiz;
}

/**
 * Coloca el menu evitando que se salga. Al pasarse por la derecha se voltea
 * hacia la izquierda del cursor en vez de pegarse al borde: pegado, tapa
 * justo la fila sobre la que se ha pulsado.
 */
function colocar(nodo, x, y) {
  const { width, height } = nodo.getBoundingClientRect();
  const maxX = window.innerWidth - BORDE;
  const maxY = window.innerHeight - BORDE;

  let izq = x;
  let arr = y;
  if (x + width > maxX) izq = Math.max(BORDE, x - width);
  if (y + height > maxY) arr = Math.max(BORDE, y - height);

  nodo.style.setProperty('--x', `${Math.round(izq)}px`);
  nodo.style.setProperty('--y', `${Math.round(arr)}px`);
}
