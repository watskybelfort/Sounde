# ============================================================
#  Registra Sounde en Windows para que se pueda elegir como
#  reproductor predeterminado.
#
#  LO QUE ESTE SCRIPT NO PUEDE HACER, Y NADIE PUEDE:
#  poner Sounde como predeterminado por ti. Desde Windows 10, la clave
#  UserChoice va firmada con un hash que solo sabe calcular el propio
#  sistema; cualquier programa que la escriba a mano se la encuentra
#  revertida al siguiente arranque. Ese ultimo clic es tuyo a proposito,
#  para que ningun instalador te robe los tipos de archivo por la cara.
#
#  LO QUE SI HACE: dejar a Sounde declarado como aplicacion capaz de
#  abrir audio, de forma que aparezca en Configuracion > Aplicaciones >
#  Aplicaciones predeterminadas y en el "Abrir con" del Explorador. Sin
#  esto, ni siquiera sale en la lista.
#
#  Todo va en HKCU: es tu usuario, no la maquina, y no hace falta
#  administrador. Se deshace entero con -Quitar.
#
#  USO:
#    powershell -NoProfile -ExecutionPolicy Bypass -File registrar.ps1
#    powershell -NoProfile -ExecutionPolicy Bypass -File registrar.ps1 -Exe "C:\ruta\Sounde.exe"
#    powershell -NoProfile -ExecutionPolicy Bypass -File registrar.ps1 -Quitar
# ============================================================

param(
    [string]$Exe,
    [switch]$Quitar,
    [switch]$SinAbrirAjustes
)

$ErrorActionPreference = 'Stop'

$APP = 'Sounde'
$CAPACIDADES = 'HKCU:\Software\Sounde\Capabilities'
$REGISTRADAS = 'HKCU:\Software\RegisteredApplications'
$CLASES = 'HKCU:\Software\Classes'

# Extension -> descripcion. El ProgID se deriva: Sounde.mp3, Sounde.flac...
$TIPOS = [ordered]@{
    '.mp3'  = 'Audio MP3'
    '.flac' = 'Audio FLAC'
    '.m4a'  = 'Audio M4A'
    '.aac'  = 'Audio AAC'
    '.wav'  = 'Audio WAV'
    '.ogg'  = 'Audio OGG'
    '.oga'  = 'Audio OGA'
    '.opus' = 'Audio Opus'
    '.m4b'  = 'Audiolibro M4B'
    '.mka'  = 'Audio Matroska'
    '.weba' = 'Audio WebM'
    '.m3u'  = 'Lista de reproduccion M3U'
    '.m3u8' = 'Lista de reproduccion M3U8'
}

# '.mp3' -> 'Sounde.mp3'. La extension ya trae el punto que separa.
function ProgId($ext) { "$APP$ext" }

# ------------------------------------------------------------ quitar
if ($Quitar) {
    foreach ($ext in $TIPOS.Keys) {
        $p = Join-Path $CLASES (ProgId $ext)
        if (Test-Path $p) { Remove-Item $p -Recurse -Force }
        # El OpenWithProgids es una lista compartida: se quita solo lo nuestro.
        $owp = Join-Path $CLASES "$ext\OpenWithProgids"
        if (Test-Path $owp) {
            Remove-ItemProperty -Path $owp -Name (ProgId $ext) -ErrorAction SilentlyContinue
        }
    }
    if (Test-Path 'HKCU:\Software\Sounde') { Remove-Item 'HKCU:\Software\Sounde' -Recurse -Force }
    if (Test-Path $REGISTRADAS) {
        Remove-ItemProperty -Path $REGISTRADAS -Name $APP -ErrorAction SilentlyContinue
    }
    Write-Output 'Sounde ya no esta registrado. Windows dejara de ofrecerlo.'
    exit 0
}

# ------------------------------------------------------------ encontrar el exe
if (-not $Exe) {
    $candidatos = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Sounde\Sounde.exe'),
        (Join-Path $env:ProgramFiles 'Sounde\Sounde.exe'),
        (Join-Path $PSScriptRoot '..\dist\win-unpacked\Sounde.exe')
    )
    $Exe = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Exe -or -not (Test-Path $Exe)) {
    Write-Error "No encuentro Sounde.exe. Instalalo primero, o pasa la ruta con -Exe."
    exit 1
}
$Exe = (Resolve-Path $Exe).Path
Write-Output "Sounde: $Exe"

# ------------------------------------------------------------ ProgIDs
# Un ProgID por extension. Podria haber uno solo para todo el audio, pero
# entonces Windows no deja elegir "Sounde para mp3 y otra cosa para flac".
foreach ($ext in $TIPOS.Keys) {
    $progId = ProgId $ext
    $base = Join-Path $CLASES $progId

    New-Item -Path $base -Force | Out-Null
    Set-ItemProperty -Path $base -Name '(default)' -Value $TIPOS[$ext]
    # FriendlyTypeName es lo que se lee en la columna "Tipo" del Explorador.
    Set-ItemProperty -Path $base -Name 'FriendlyTypeName' -Value $TIPOS[$ext]

    New-Item -Path (Join-Path $base 'DefaultIcon') -Force | Out-Null
    Set-ItemProperty -Path (Join-Path $base 'DefaultIcon') -Name '(default)' -Value "`"$Exe`",0"

    $cmd = Join-Path $base 'shell\open\command'
    New-Item -Path $cmd -Force | Out-Null
    # "%1" entre comillas: sin ellas, cualquier ruta con espacios llega
    # partida en trozos y la app abre "C:\Mi" y "musica\tema.mp3".
    Set-ItemProperty -Path $cmd -Name '(default)' -Value "`"$Exe`" `"%1`""

    # La extension declara que Sounde sabe abrirla. Esto es lo que la mete en
    # el "Abrir con", sin tocar quien es el predeterminado ahora.
    #
    # OJO con el -Force: sobre una clave que YA existe, New-Item la vuelve a
    # crear vacia. Esta lista es de todos, no nuestra, asi que crearla "por si
    # acaso" borraba de un plumazo a los demas reproductores del menu "Abrir
    # con". Lo cazo la prueba, con un vecino de mentira que desaparecio.
    $owp = Join-Path $CLASES "$ext\OpenWithProgids"
    if (-not (Test-Path $owp)) { New-Item -Path $owp -Force | Out-Null }
    New-ItemProperty -Path $owp -Name $progId -Value ([byte[]]@()) -PropertyType None -Force | Out-Null
}

# ------------------------------------------------------------ Capabilities
# Este bloque es el que hace que Sounde salga en Configuracion >
# Aplicaciones predeterminadas como una entrada propia. Sin el, la app
# aparece suelta en el "Abrir con" y no hay forma comoda de asignarle todo.
New-Item -Path $CAPACIDADES -Force | Out-Null
Set-ItemProperty -Path $CAPACIDADES -Name 'ApplicationName' -Value 'Sounde'
Set-ItemProperty -Path $CAPACIDADES -Name 'ApplicationDescription' `
    -Value 'Reproductor de audio con acrilico real de Windows'
Set-ItemProperty -Path $CAPACIDADES -Name 'ApplicationIcon' -Value "`"$Exe`",0"

$asociaciones = Join-Path $CAPACIDADES 'FileAssociations'
New-Item -Path $asociaciones -Force | Out-Null
foreach ($ext in $TIPOS.Keys) {
    Set-ItemProperty -Path $asociaciones -Name $ext -Value (ProgId $ext)
}

# Misma trampa que con OpenWithProgids: esta clave la comparten todas las
# aplicaciones del sistema y recrearla las borraria a todas.
if (-not (Test-Path $REGISTRADAS)) { New-Item -Path $REGISTRADAS -Force | Out-Null }
Set-ItemProperty -Path $REGISTRADAS -Name $APP -Value 'Software\Sounde\Capabilities'

# Avisar a la shell de que las asociaciones cambiaron, o el Explorador sigue
# enseñando el icono viejo hasta reiniciar.
Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Shell {
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);
}
"@
[Shell]::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)  # SHCNE_ASSOCCHANGED

Write-Output ''
Write-Output "Listo: $($TIPOS.Count) tipos de archivo declarados."
Write-Output ''
Write-Output 'AHORA TE TOCA A TI (Windows no deja hacerlo por ti):'
Write-Output '  Configuracion > Aplicaciones > Aplicaciones predeterminadas > Sounde'
Write-Output '  y pulsa "Establecer como predeterminado".'
Write-Output ''
Write-Output 'O, mas rapido para un solo tipo: clic derecho en un .mp3 >'
Write-Output 'Abrir con > Elegir otra aplicacion > Sounde > Establecer siempre.'

if (-not $SinAbrirAjustes) {
    Start-Process 'ms-settings:defaultapps'
}
