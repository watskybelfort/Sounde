# ============================================================
#  Ventana testigo: cuatro cuadrantes de colores imposibles.
#
#  Es el unico test que decide de verdad si la ventana compone con alfa.
#  Aplicar un tinte y ver que la ventana "se tine" NO prueba nada: en Win11
#  la politica de acento puede pintar el tinte POR ENCIMA, imagenes
#  incluidas, y parece que el alfa llega al compositor cuando no llega.
#
#  Con bloques grandes y saturados el resultado se lee solo:
#    - si detras de Sounde aparecen las cuatro zonas de color, hay alfa;
#    - si ademas los bordes entre zonas salen degradados en vez de a filo,
#      hay desenfoque real y no simple transparencia.
#
#  USO:
#    powershell -NoProfile -File witness.ps1 -Seconds 40
# ============================================================

param(
    [int]$Seconds = 40,
    [int]$Width = 0,
    [int]$Height = 0,
    [int]$X = 0,
    [int]$Y = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Por defecto cubre el monitor principal entero: asi da igual donde abra
# Sounde, siempre cae encima del testigo.
$area = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($Width -le 0) { $Width = $area.Width }
if ($Height -le 0) { $Height = $area.Height }
if ($X -eq 0 -and $Y -eq 0) { $X = $area.X; $Y = $area.Y }

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point($X, $Y)
$form.Size = New-Object System.Drawing.Size($Width, $Height)
$form.ShowInTaskbar = $false
$form.TopMost = $false
$form.Text = 'TESTIGO'

$form.Add_Paint({
        param($s, $e)
        $g = $e.Graphics
        $w = [int]($s.ClientSize.Width / 2)
        $h = [int]($s.ClientSize.Height / 2)
        $colores = @(
            @{ c = [System.Drawing.Color]::FromArgb(255, 0, 200); x = 0; y = 0 },   # magenta
            @{ c = [System.Drawing.Color]::FromArgb(0, 230, 255); x = $w; y = 0 },  # cian
            @{ c = [System.Drawing.Color]::FromArgb(60, 255, 0); x = 0; y = $h },   # verde
            @{ c = [System.Drawing.Color]::FromArgb(255, 190, 0); x = $w; y = $h }  # ambar
        )
        foreach ($q in $colores) {
            $brush = New-Object System.Drawing.SolidBrush($q.c)
            $g.FillRectangle($brush, $q.x, $q.y, $w, $h)
            $brush.Dispose()
        }
    })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $Seconds * 1000
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$timer.Start()

Write-Output "testigo abierto ${Width}x${Height} en ($X,$Y) durante $Seconds s"
[void]$form.ShowDialog()
$form.Dispose()
