# ============================================================
#  Captura la ventana de Sounde para poder MIRAR el resultado.
#
#  Trae la ventana al frente ANTES de capturar, siempre. Capturar el rect
#  mientras otra ventana la tapa produce el falso positivo mas caro que hay:
#  sale la ventana de encima recortada al rect y se lee como transparencia
#  perfecta, nitida y todo. Si una captura parece un exito rotundo, sospecha
#  de esto antes que de nada.
#
#  USO:
#    powershell -NoProfile -File capture-window.ps1 -TitleLike 'Sounde' -Out captura.png
# ============================================================

param(
    [string]$TitleLike = 'Sounde',
    [Parameter(Mandatory)][string]$Out,
    [int]$MaxWidth = 1100
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not ("WinCap" -as [type])) {
    Add-Type -Language CSharp @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class WinCap {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    public delegate bool EnumProc(IntPtr hwnd, IntPtr l);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    public const uint SWP_NOMOVE = 0x0002, SWP_NOSIZE = 0x0001, SWP_SHOWWINDOW = 0x0040;
    public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    public static List<IntPtr> Find(string titlePart) {
        var found = new List<IntPtr>();
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h)) return true;
            int len = GetWindowTextLength(h);
            if (len == 0) return true;
            var sb = new StringBuilder(len + 1);
            GetWindowText(h, sb, sb.Capacity);
            if (sb.ToString().IndexOf(titlePart, StringComparison.OrdinalIgnoreCase) >= 0) found.Add(h);
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // El rect "visual" de DWM, no el de GetWindowRect: este ultimo incluye el
    // borde invisible de redimension y la captura sale con marco muerto.
    public static RECT VisualRect(IntPtr h) {
        RECT r;
        DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, out r, Marshal.SizeOf(typeof(RECT)));
        return r;
    }
}
"@
}

[void][WinCap]::SetProcessDPIAware()

$handles = [WinCap]::Find($TitleLike)
if ($handles.Count -eq 0) { throw "No encontre ninguna ventana cuyo titulo contenga '$TitleLike'" }
$hwnd = $handles[0]

# Al frente, sin excepcion.
[void][WinCap]::ShowWindow($hwnd, 9)  # SW_RESTORE
[void][WinCap]::SetWindowPos($hwnd, [WinCap]::HWND_TOPMOST, 0, 0, 0, 0, [WinCap]::SWP_NOMOVE -bor [WinCap]::SWP_NOSIZE -bor [WinCap]::SWP_SHOWWINDOW)
[void][WinCap]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 450
[void][WinCap]::SetWindowPos($hwnd, [WinCap]::HWND_NOTOPMOST, 0, 0, 0, 0, [WinCap]::SWP_NOMOVE -bor [WinCap]::SWP_NOSIZE -bor [WinCap]::SWP_SHOWWINDOW)
Start-Sleep -Milliseconds 250

$r = [WinCap]::VisualRect($hwnd)
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { throw "Rect invalido: ${w}x${h}" }

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $h)))
$g.Dispose()

if ($w -gt $MaxWidth) {
    $scale = $MaxWidth / $w
    $nw = [int]($w * $scale); $nh = [int]($h * $scale)
    $small = New-Object System.Drawing.Bitmap($nw, $nh)
    $g2 = [System.Drawing.Graphics]::FromImage($small)
    $g2.InterpolationMode = 'HighQualityBicubic'
    $g2.DrawImage($bmp, 0, 0, $nw, $nh)
    $g2.Dispose(); $bmp.Dispose(); $bmp = $small
}

$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "capturado ${w}x${h} -> $Out (guardado $($bmp.Width)x$($bmp.Height))"
$bmp.Dispose()
