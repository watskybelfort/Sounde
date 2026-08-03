# Sounde

Reproductor de audio para Windows 11, con acrílico de verdad y el color sacado
de la carátula que suena.

![Sounde](docs/sounde.png)

---

## Lo que hace

**Reproducción.** Dos decks de audio que se turnan, así que el cambio de
canción no tiene hueco y el fundido cruzado (0–12 s) es real, no un corte
disimulado. Ecualizador de diez bandas con ocho presets y preamplificación,
normalización por ReplayGain, velocidad de 0.5× a 2× sin cambiar el tono, y un
limitador de seguridad que evita que un ReplayGain generoso más una subida de
graves acaben recortando en la tarjeta.

**Biblioteca.** Escaneo incremental de tus carpetas: solo se reparsea lo que
cambió de fecha o de tamaño, así que sobre una biblioteca ya vista el arranque
cuesta milisegundos. Canciones, álbumes, artistas, favoritos, recientes y
listas de reproducción, con importación y exportación en `.m3u`.

**Letras.** Un `.lrc` al lado del archivo o las etiquetas del propio archivo.
Si llevan tiempos, la línea que suena se resalta y pulsándola se salta ahí.

**Windows.** Teclas multimedia por sesión de medios (la ficha con carátula que
sale al pulsarlas es la de Sounde), botones sobre la miniatura de la barra de
tareas, barra de progreso y distintivo sobre el icono, aviso al cambiar de
canción, bandeja, y mini-player siempre encima.

**Manejo.** Paleta de comandos con `Ctrl+K` que busca a la vez acciones y
música, atajos para todo, temporizador de apagado con fundido, y panel de
ajustes que expone todo lo anterior.

## Instalar

Está en [INSTALAR.md](INSTALAR.md), incluido por qué el último clic para
ponerlo por defecto lo tienes que dar tú (resumen: Windows no deja hacerlo por
código, y hace bien).

```powershell
npm ci
npm run icono   # dibuja build/icon.ico desde el codigo
npm run dist    # instalador en dist/
```

Para trastear sin instalar nada: `npm start`.

---

## El vidrio: dos capas que se suman

Esto es lo que confunde a todo el mundo que toca el tema, incluido yo al
empezar, así que va primero.

**`backdrop-filter` NO puede difuminar el escritorio.** Solo muestrea píxeles
que ya están dentro de la página. Lo que hay detrás de la ventana no existe
para el CSS.

El desenfoque de verdad lo pone **DWM**, el compositor de Windows, sobre la
ventana entera. La ventana se declara con `backgroundColor: '#00000000'` y
`backgroundMaterial: 'acrylic'`, y a partir de ahí el trabajo del CSS es
justamente **no pintar opaco**.

De ahí salen dos capas distintas que se suman, y saber cuál estás moviendo es
la diferencia entre arreglar el vidrio y empeorarlo:

| | Dónde vive | Qué hace | Se toca en |
|---|---|---|---|
| **Capa de DWM** | Detrás de la página | Difumina el escritorio y lo mezcla con un tinte | Ajustes → Vidrio, y `backdropAlpha` |
| **Capa del CSS** | Encima, la pinta la página | Vela lo difuminado para que el texto se lea | Ajustes → Veladura, o `--transparencia` |

**Si el vidrio se ve turbio, casi siempre sobra de la de CSS, no de la de
Windows.**

En `src/renderer/styles/acrylic.css` hay tres perillas y todo lo demás se
deriva de ellas: `--transparencia`, `--tinte` y `--acento`.

`backdrop-filter` sí se usa en esta aplicación, pero solo en menús, diálogos,
la paleta y los globos: ahí sí hay píxeles de la propia interfaz debajo que
difuminar.

### Modos de vidrio

| Modo | Qué es |
|---|---|
| `acrylic` | El del sistema. Windows lo apaga solo al perder el foco: es su comportamiento, no un fallo. La interfaz lo compensa subiendo su propia veladura. |
| `acrylic-always` | Acrílico por `SetWindowCompositionAttribute`. Sigue difuminado sin foco. |
| `mica` / `tabbed` | Tiñen el fondo y difuminan menos. |
| `none` | Sin backdrop del sistema. Lo más ligero. |

### El color adaptativo

El tinte y el acento salen de la carátula: se cuenta un histograma de la
imagen, se descarta lo gris y lo casi negro, y el tono dominante cruza al
siguiente por el camino corto de la rueda de color.

Hay una regla que hay que respetar y está anotada en el CSS: **nada que derive
de `--acento` o `--tinte` puede llevar `transition`**. El bucle de animación
reescribe esas variables en cada fotograma, así que una transición CSS encima
se reinicia sesenta veces por segundo y nunca converge. El síntoma es de los
que se buscan una tarde: el logo y la barra de progreso siguen pintando el
color del álbum anterior mientras la variable ya tiene el nuevo.

---

## Atajos

| | |
|---|---|
| `Espacio` | Reproducir / pausar |
| `Ctrl` `←` `→` | Canción anterior / siguiente |
| `←` `→` | Retroceder / adelantar 5 s |
| `↑` `↓` | Volumen |
| `M` · `S` · `R` · `F` | Silencio · aleatorio · repetición · favorito |
| `Ctrl+1..5` | Canciones, Álbumes, Artistas, Favoritos, Recientes |
| `Ctrl+L` | Letra |
| `Ctrl+F` | Buscar |
| `Ctrl+Q` | Cola |
| `Ctrl+B` | Plegar el panel lateral |
| `Ctrl+M` | Mini-player |
| `Ctrl+,` | Ajustes |
| `Ctrl+K` | Paleta de comandos |

Con el foco en un campo de texto, las teclas sueltas son del campo. Las que
llevan `Ctrl` funcionan igual: `Ctrl+F` tiene que valer aunque ya estés en el
buscador.

---

## Cómo está montado

```
src/main/         proceso principal
  main.js         arranque, instancia unica, "Abrir con"
  window.js       la ventana acrilica y el mini-player
  protocols.js    los tres esquemas propios
  library.js      escaneo y metadatos
  collections.js  favoritos, historial y listas
  letras.js       .lrc y etiquetas
  taskbar.js      miniatura, progreso y distintivo
  bandeja.js      icono de la bandeja
  iconos.js       los iconos, dibujados
  ipc.js          todos los handlers
  preload.js      el unico puente con la pagina

src/renderer/     la pagina
  js/player.js    motor de audio (Web Audio)
  js/queue.js     cola, aleatorio y repeticion
  js/shell.js     navegacion y vistas
  ...
```

### Tres esquemas propios

- `sounde://app/…` — la interfaz. Hace falta un esquema estándar porque sobre
  `file://` Chromium bloquea los módulos ES por CORS.
- `sounde-file://local/…` — el audio del disco, con rangos HTTP para que
  arrastrar la barra no descargue el archivo entero.
- `sounde-art://cache/…` — las carátulas ya extraídas.

Las rutas viajan en base64url: una ruta de Windows lleva `C:`, barras
invertidas y a veces `#`, y no cabe limpia en una URL.

### Seguridad

`contextIsolation`, `sandbox`, sin `nodeIntegration`, y una CSP estricta **sin
`'unsafe-inline'`**. Por eso en todo el código no hay ni un atributo `style=""`
ni un `<style>` suelto: lo dinámico se hace por CSSOM, que la CSP sí permite.

Los esquemas propios no sirven cualquier ruta del disco: solo lo que esté bajo
una carpeta autorizada o sea un archivo abierto a propósito.

### El grafo de audio

```
<audio> → source → trackGain → fadeGain ─┐
                                          ├→ preamp → EQ ×10 →
<audio> → source → trackGain → fadeGain ─┘

  → limitador → analizador → master → salida
```

`trackGain` y `fadeGain` van separados a propósito: el primero lleva la
normalización de la pista y el segundo el fundido. Si fueran el mismo nodo,
cada fundido borraría la normalización.

El analizador está **antes** del master, así que el visualizador dibuja la
señal de la música y no la del mando de volumen: bajar el volumen no debe
aplastar las barras hasta dejarlas planas.

---

## Cómo se ha verificado

Cada pieza lleva su comprobación por código, y las que se ven se han mirado en
capturas de la ventana real. No es decoración del historial: la mitad de los
fallos de este repositorio los cazó una prueba y no una lectura.

Algunos ejemplos de lo que hizo falta medir en vez de suponer:

- El fundido cruzado se verificó muestreando el RMS por el analizador, no
  escuchándolo: se oía bien y estaba matando la pista entrante.
- El color adaptativo se verificó leyendo píxeles de una captura: la variable
  ya tenía el color nuevo mientras la pantalla seguía pintando el viejo.
- Las teclas multimedia se verificaron preguntándole a Windows por WinRT qué
  sesión de medios ve y mandándole órdenes desde el sistema hacia la
  aplicación, no al revés.
- El ecualizador vertical se verificó mirando dónde caen los pomos en la
  imagen: en la primera versión estaban los diez a la misma altura mientras
  las etiquetas decían de +6 a −9, y todas las comprobaciones de valores
  pasaban.

---

## Licencia

MIT.
