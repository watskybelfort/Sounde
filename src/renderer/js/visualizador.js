/**
 * Visualizador de audio.
 *
 * Se dibuja detras del transporte, a media tinta, con el acento de la
 * caratula. No es un adorno suelto: al estar pegado a los mandos, el mismo
 * golpe de vista dice que suena, por donde va y como suena.
 *
 * El bucle solo corre mientras hay sonido. Un canvas repintandose a 60 fps
 * con la musica parada gasta bateria para enseñar una linea recta.
 */

import { el } from './dom.js';

/** Rango util de un altavoz normal. Por debajo y por encima casi no hay nada. */
const F_MIN = 40;
const F_MAX = 16000;

/** Cuanto cae como mucho una barra por fotograma. Sin freno, tiemblan. */
const CAIDA = 0.055;

export function crearVisualizador(player, { modo = 'bars' } = {}) {
  const lienzo = el('canvas', { class: 'visualizador', 'aria-hidden': 'true' });
  const ctx = lienzo.getContext('2d');

  let ancho = 0;
  let alto = 0;
  let bucle = 0;
  let alturas = [];

  const frecuencias = new Uint8Array(player.analyser.frequencyBinCount);
  const onda = new Uint8Array(player.analyser.fftSize);

  const sinMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)');

  function medir() {
    const r = lienzo.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // El canvas se dibuja en pixeles reales: en una pantalla a 150 % un
    // canvas de tamaño CSS sale borroso y las barras finas se emborronan.
    const dpr = window.devicePixelRatio || 1;
    ancho = Math.round(r.width * dpr);
    alto = Math.round(r.height * dpr);
    lienzo.width = ancho;
    lienzo.height = alto;
  }

  new ResizeObserver(medir).observe(lienzo);

  function acento() {
    const bruto = getComputedStyle(document.documentElement).getPropertyValue('--acento');
    const [r, g, b] = bruto.trim().split(/\s+/).map(Number);
    return Number.isFinite(r) ? { r, g, b } : { r: 122, g: 162, b: 247 };
  }

  /**
   * Las barras se pintan con un degradado vertical: densas abajo y disueltas
   * en la punta. Con opacidad plana, un pico alto tapa la barra de progreso y
   * el visualizador pasa de textura de fondo a estorbo.
   */
  function pincel() {
    const { r, g, b } = acento();
    const grad = ctx.createLinearGradient(0, alto, 0, 0);
    grad.addColorStop(0, `rgb(${r} ${g} ${b} / 0.40)`);
    grad.addColorStop(0.55, `rgb(${r} ${g} ${b} / 0.16)`);
    grad.addColorStop(1, `rgb(${r} ${g} ${b} / 0.02)`);
    return grad;
  }

  // --- Dibujo ---------------------------------------------------------------

  function barras() {
    player.analyser.getByteFrequencyData(frecuencias);

    const dpr = window.devicePixelRatio || 1;
    const ancho1 = Math.max(2, Math.round(3 * dpr));
    const hueco = Math.max(1, Math.round(2 * dpr));
    const n = Math.max(1, Math.floor(ancho / (ancho1 + hueco)));
    if (alturas.length !== n) alturas = new Array(n).fill(0);

    const nyquist = player.ctx.sampleRate / 2;
    const bins = frecuencias.length;
    const razon = F_MAX / F_MIN;

    ctx.clearRect(0, 0, ancho, alto);
    ctx.fillStyle = pincel();

    for (let i = 0; i < n; i++) {
      // Reparto logaritmico: en escala lineal, media pantalla se la comen
      // agudos donde casi nunca hay energia y los graves se apelotonan.
      const f0 = F_MIN * razon ** (i / n);
      const f1 = F_MIN * razon ** ((i + 1) / n);
      const b0 = Math.min(bins - 1, Math.floor((f0 / nyquist) * bins));
      const b1 = Math.min(bins, Math.max(b0 + 1, Math.ceil((f1 / nyquist) * bins)));

      // El maximo de la banda, no la media: promediando, las bandas anchas de
      // agudos salen siempre planas aunque tengan picos claros dentro.
      let pico = 0;
      for (let k = b0; k < b1; k++) if (frecuencias[k] > pico) pico = frecuencias[k];

      // Los agudos siempre traen menos energia que los graves; sin esta
      // inclinacion la mitad derecha del visualizador no se mueve nunca.
      const inclinacion = 1 + (i / n) * 0.9;
      const objetivo = Math.min(1, (pico / 255) * inclinacion);

      alturas[i] = objetivo > alturas[i] ? objetivo : Math.max(objetivo, alturas[i] - CAIDA);

      const h = Math.max(1, alturas[i] * alto);
      ctx.fillRect(i * (ancho1 + hueco), alto - h, ancho1, h);
    }
  }

  function ondaLinea() {
    player.analyser.getByteTimeDomainData(onda);
    const dpr = window.devicePixelRatio || 1;
    const { r, g, b } = acento();

    ctx.clearRect(0, 0, ancho, alto);
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    ctx.strokeStyle = `rgb(${r} ${g} ${b} / 0.42)`;
    ctx.beginPath();

    const paso = ancho / onda.length;
    for (let i = 0; i < onda.length; i++) {
      // 128 es el cero de un byte con signo desplazado: la linea plana.
      const v = (onda[i] - 128) / 128;
      const y = alto / 2 + v * (alto / 2) * 0.8;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * paso, y);
    }
    ctx.stroke();
  }

  function limpiar() {
    if (ancho && alto) ctx.clearRect(0, 0, ancho, alto);
  }

  // --- Bucle ----------------------------------------------------------------

  function paso() {
    if (modo === 'bars') barras();
    else ondaLinea();
    bucle = player.playing ? requestAnimationFrame(paso) : 0;
    if (!bucle) apagarSuave();
  }

  /** Al parar, las barras bajan hasta el suelo en vez de congelarse. */
  function apagarSuave() {
    const bajar = () => {
      if (player.playing) return;
      let vivo = false;
      for (let i = 0; i < alturas.length; i++) {
        if (alturas[i] > 0.001) {
          alturas[i] = Math.max(0, alturas[i] - CAIDA);
          vivo = true;
        }
      }
      if (modo === 'bars') pintarAlturas();
      else limpiar();
      if (vivo) requestAnimationFrame(bajar);
      else limpiar();
    };
    requestAnimationFrame(bajar);
  }

  function pintarAlturas() {
    const dpr = window.devicePixelRatio || 1;
    const ancho1 = Math.max(2, Math.round(3 * dpr));
    const hueco = Math.max(1, Math.round(2 * dpr));
    ctx.clearRect(0, 0, ancho, alto);
    ctx.fillStyle = pincel();
    for (let i = 0; i < alturas.length; i++) {
      const h = Math.max(1, alturas[i] * alto);
      ctx.fillRect(i * (ancho1 + hueco), alto - h, ancho1, h);
    }
  }

  function arrancar() {
    if (bucle || modo === 'off' || sinMovimiento.matches) return;
    medir();
    bucle = requestAnimationFrame(paso);
  }

  function parar() {
    cancelAnimationFrame(bucle);
    bucle = 0;
  }

  player.on('state', ({ playing }) => (playing ? arrancar() : null));

  return {
    nodo: lienzo,

    setModo(nuevo) {
      modo = nuevo || 'off';
      alturas = [];
      lienzo.hidden = modo === 'off';
      // El modo queda escrito en el nodo: es el unico sitio donde se puede
      // mirar desde fuera que esta dibujando, sin sondas ni variables sueltas.
      lienzo.dataset.modo = modo;
      if (modo === 'off') {
        parar();
        limpiar();
      } else if (player.playing) {
        arrancar();
      }
      return modo;
    },

    get modo() { return modo; },
  };
}
