# ============================================================
#  Capa nativa DWM acotada por PID.
#
#  Sounde usa esto SOLO para el modo 'acrylic-always'. El acrilico del
#  sistema (BrowserWindow.setBackgroundMaterial) es mejor en todo menos en
#  una cosa: Windows lo apaga cuando la ventana pierde el foco. Esta via
#  usa ACCENT_ENABLE_ACRYLICBLURBEHIND, que se queda difuminado siempre.
#
#  USO:
#    powershell -NoProfile -File acrylic-native.ps1 -TargetPid 1234 -Mode Acrylic -Tint '#0E1116' -Alpha 96
#    powershell -NoProfile -File acrylic-native.ps1 -TargetPid 1234 -Mode Off
# ============================================================

param(
    [Parameter(Mandatory)][int]$TargetPid,
    [ValidateSet('Acrylic', 'Blur', 'Mica', 'Tabbed', 'Off')][string]$Mode = 'Acrylic',
    [string]$Tint = '#0E1116',
    [ValidateRange(0, 255)][int]$Alpha = 96
)

$ErrorActionPreference = 'Stop'

if (-not ("SoundeAcrylic" -as [type])) {
    Add-Type -Language CSharp @"
using System;
using System.Runtime.InteropServices;

public static class SoundeAcrylic {
    [StructLayout(LayoutKind.Sequential)]
    struct AccentPolicy { public int AccentState; public int AccentFlags; public uint GradientColor; public int AnimationId; }
    [StructLayout(LayoutKind.Sequential)]
    struct WinCompAttrData { public int Attribute; public IntPtr Data; public int SizeOfData; }
    [StructLayout(LayoutKind.Sequential)]
    struct MARGINS { public int l, r, t, b; }

    [DllImport("user32.dll")] static extern int SetWindowCompositionAttribute(IntPtr hwnd, ref WinCompAttrData data);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int val, int size);
    [DllImport("dwmapi.dll")] static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS m);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    const int WCA_ACCENT_POLICY = 19;
    const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    const int DWMWA_SYSTEMBACKDROP_TYPE = 38;

    // Se filtra SOLO por PID. Nada de exigir titulo ni visibilidad: los menus
    // y popups de la app no tienen texto de titulo y tambien deben recibir el
    // efecto, o se ven como parches opacos flotando sobre el vidrio.
    public static int Apply(uint targetPid, int state, uint gradient, int backdrop, bool resetFrame) {
        int count = 0;
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid != targetPid) return true;

            int dark = 1;
            DwmSetWindowAttribute(h, DWMWA_USE_IMMERSIVE_DARK_MODE, ref dark, 4);

            var accent = new AccentPolicy { AccentState = state, AccentFlags = 0x20, GradientColor = gradient, AnimationId = 0 };
            int size = Marshal.SizeOf(accent);
            IntPtr ptr = Marshal.AllocHGlobal(size);
            Marshal.StructureToPtr(accent, ptr, false);
            var data = new WinCompAttrData { Attribute = WCA_ACCENT_POLICY, Data = ptr, SizeOfData = size };
            SetWindowCompositionAttribute(h, ref data);
            Marshal.FreeHGlobal(ptr);

            if (resetFrame) {
                // Apagado real: recoger el marco. Dejarlo extendido en -1 mantiene
                // la ventana compuesta como cristal aunque el acento este en 0, y
                // entonces el Off no restaura nada.
                var m0 = new MARGINS { l = 0, r = 0, t = 0, b = 0 };
                DwmExtendFrameIntoClientArea(h, ref m0);
                int none = 1;
                DwmSetWindowAttribute(h, DWMWA_SYSTEMBACKDROP_TYPE, ref none, 4);
            } else if (backdrop > 0) {
                var m = new MARGINS { l = -1, r = -1, t = -1, b = -1 };
                DwmExtendFrameIntoClientArea(h, ref m);
                int bt = backdrop;
                DwmSetWindowAttribute(h, DWMWA_SYSTEMBACKDROP_TYPE, ref bt, 4);
            }

            int corner = 2; // redondeado
            DwmSetWindowAttribute(h, DWMWA_WINDOW_CORNER_PREFERENCE, ref corner, 4);
            count++;
            return true;
        }, IntPtr.Zero);
        return count;
    }
}
"@
}

$hex = $Tint.TrimStart('#')
if ($hex.Length -ne 6) { throw "Tint debe ser #RRGGBB, recibi '$Tint'" }
$r = [Convert]::ToInt32($hex.Substring(0, 2), 16)
$g = [Convert]::ToInt32($hex.Substring(2, 2), 16)
$b = [Convert]::ToInt32($hex.Substring(4, 2), 16)

# El color del acento va en ABGR, no en RGB. En RGB sale con los canales
# cruzados y el azul aparece naranja.
$gradient = ([uint32]$Alpha -shl 24) -bor ([uint32]$b -shl 16) -bor ([uint32]$g -shl 8) -bor [uint32]$r

$state = switch ($Mode) { 'Acrylic' { 4 } 'Blur' { 3 } default { 0 } }
$backdropType = switch ($Mode) { 'Mica' { 2 } 'Tabbed' { 4 } default { 0 } }
$reset = ($Mode -eq 'Off')

$n = [SoundeAcrylic]::Apply([uint32]$TargetPid, $state, [uint32]$gradient, $backdropType, $reset)
Write-Output "ventanas=$n modo=$Mode"
