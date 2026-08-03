# Instalar Sounde y ponerlo por defecto

## 1. Construir el instalador

```powershell
npm ci
npm run icono   # dibuja build/icon.ico a partir del codigo
npm run dist    # deja el instalador en dist/
```

Sale `dist/Sounde-0.1.0-x64.exe`, de unos 95 MB. Es un instalador NSIS **por
usuario**: no pide administrador, se instala en
`%LOCALAPPDATA%\Programs\Sounde` y se desinstala desde Configuración como
cualquier otra aplicación.

Si solo quieres probarlo sin instalar nada, `npm run pack` deja la aplicación
suelta en `dist/win-unpacked/Sounde.exe`.

## 2. Instalar

Doble clic en `dist/Sounde-0.1.0-x64.exe`. Deja elegir carpeta y crea accesos
directos en el escritorio y en el menú de inicio.

El instalador ya declara los trece tipos de archivo que Sounde sabe abrir
(mp3, flac, m4a, aac, wav, ogg, oga, opus, m4b, mka, weba, m3u, m3u8), así que
a partir de aquí aparece en el menú **Abrir con** del Explorador.

## 3. Registrarlo en "Aplicaciones predeterminadas"

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\registrar.ps1
```

Esto declara Sounde como aplicación capaz de abrir audio y lo mete en la lista
de Configuración. Escribe solo en `HKCU` (tu usuario, no la máquina) y se
deshace entero con:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\registrar.ps1 -Quitar
```

Si estás probando la versión sin instalar, pásale la ruta:

```powershell
... -File tools\registrar.ps1 -Exe "dist\win-unpacked\Sounde.exe"
```

## 4. El último clic es tuyo

**Ningún programa puede ponerse como predeterminado por su cuenta en Windows
10 u 11, y Sounde tampoco.** La clave `UserChoice` que decide quién abre cada
extensión va firmada con un hash que solo sabe calcular el propio sistema:
cualquier aplicación que la escriba a mano se la encuentra revertida al
siguiente arranque. Es deliberado, y está bien que lo sea — es lo que impide
que un instalador te robe los tipos de archivo sin preguntar.

Así que el último paso lo das tú, por cualquiera de estas dos vías:

**Todo de una vez.** Configuración → Aplicaciones → Aplicaciones
predeterminadas → busca **Sounde** → *Establecer como predeterminado*.
El script abre esa pantalla al terminar.

**Un tipo suelto.** Clic derecho en un `.mp3` → Abrir con → Elegir otra
aplicación → **Sounde** → marca *Usar siempre esta aplicación*.

## 5. Comprobar que funcionó

Doble clic en cualquier canción del disco. Debe abrirse Sounde y empezar a
sonar. Si Sounde ya estaba abierto, la canción entra en la instancia que ya
existe en vez de levantar un segundo reproductor peleándose por el audio.

Un `.m3u` también funciona: se expande a las canciones que lleva dentro.

## Desinstalar

Configuración → Aplicaciones → Sounde → Desinstalar.

El desinstalador **no** borra tu biblioteca, tus favoritos ni tus listas: eso
vive en `%APPDATA%\Sounde` y es lo único que no se puede recuperar volviendo a
escanear el disco. Si de verdad quieres borrarlo todo, esa carpeta se elimina a
mano.
