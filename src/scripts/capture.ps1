# capture.ps1 — Captures a window screenshot using .NET System.Drawing + user32.dll P/Invoke
# Usage: powershell -ExecutionPolicy Bypass -File capture.ps1 -ProcessId 1234 -SavePath "C:\screenshots\test.png"
# Output: JSON with { "success", "path", "base64", "width", "height", "error" }

param(
    [Parameter(Mandatory=$false)]
    [string]$WindowTitle,

    [Parameter(Mandatory=$false)]
    [int]$ProcessId = 0,

    [Parameter(Mandatory=$true)]
    [string]$SavePath,

    [Parameter(Mandatory=$false)]
    [switch]$BringToFront,

    [Parameter(Mandatory=$false)]
    [switch]$PartialMatch
)

# Ensure output is UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Load assemblies
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# Define P/Invoke signatures
$pinvoke = @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class WinCapture {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetProcessDPIAware();

    [DllImport("dwmapi.dll")]
    public static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public const int SW_RESTORE = 9;
    public const int SW_SHOW = 5;
    public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_TOPMOST = 0x00000008;
    public const uint SWP_NOSIZE = 0x0001;
    public const uint SWP_NOMOVE = 0x0002;
    public const uint SWP_SHOWWINDOW = 0x0040;
    public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public static IntPtr FindWindowByPartialTitle(string partialTitle) {
        IntPtr found = IntPtr.Zero;
        string lowerPartial = partialTitle.ToLower();

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) return true;

            int length = GetWindowTextLength(hWnd);
            if (length == 0) return true;

            StringBuilder sb = new StringBuilder(length + 1);
            GetWindowText(hWnd, sb, sb.Capacity);
            string title = sb.ToString();

            if (title.ToLower().Contains(lowerPartial)) {
                found = hWnd;
                return false; // stop enumeration
            }
            return true;
        }, IntPtr.Zero);

        return found;
    }

    public static IntPtr FindWindowByProcessId(int processId, string titleFilter) {
        IntPtr found = IntPtr.Zero;
        IntPtr fallback = IntPtr.Zero;
        string lowerFilter = String.IsNullOrWhiteSpace(titleFilter) ? null : titleFilter.ToLowerInvariant();

        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) return true;

            uint windowProcessId;
            GetWindowThreadProcessId(hWnd, out windowProcessId);
            if (windowProcessId != (uint)processId) return true;

            int length = GetWindowTextLength(hWnd);
            string title = "";
            if (length > 0) {
                StringBuilder sb = new StringBuilder(length + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                title = sb.ToString();
            }

            if (lowerFilter != null && !title.ToLowerInvariant().Contains(lowerFilter)) {
                return true;
            }

            if (title.Length > 0) {
                found = hWnd;
                return false; // prefer the first visible titled window for the process
            }

            if (fallback == IntPtr.Zero) {
                fallback = hWnd;
            }
            return true;
        }, IntPtr.Zero);

        return found != IntPtr.Zero ? found : fallback;
    }

    public static bool IsTopMost(IntPtr hWnd) {
        return (GetWindowLong(hWnd, GWL_EXSTYLE) & WS_EX_TOPMOST) == WS_EX_TOPMOST;
    }
}
"@

try {
    Add-Type -TypeDefinition $pinvoke -ErrorAction Stop
} catch {
    # Type may already be loaded in this session
    if ($_.Exception.Message -notmatch "already exists") {
        throw
    }
}

# Make this process DPI-aware for accurate coordinates
[WinCapture]::SetProcessDPIAware() | Out-Null

function Write-JsonResult {
    param(
        [bool]$Success,
        [string]$Path = "",
        [string]$Base64 = "",
        [int]$Width = 0,
        [int]$Height = 0,
        [string]$Error = ""
    )

    $result = @{
        success = $Success
        path    = $Path
        base64  = $Base64
        width   = $Width
        height  = $Height
        error   = $Error
    }

    $json = $result | ConvertTo-Json -Compress
    Write-Output $json
}

# Find the window
$hwnd = [IntPtr]::Zero

if ($ProcessId -gt 0) {
    $hwnd = [WinCapture]::FindWindowByProcessId($ProcessId, $WindowTitle)
} elseif ([string]::IsNullOrWhiteSpace($WindowTitle)) {
    Write-JsonResult -Success $false -Error "Either ProcessId or WindowTitle is required"
    exit 1
} elseif ($PartialMatch) {
    $hwnd = [WinCapture]::FindWindowByPartialTitle($WindowTitle)
} else {
    # Try exact match first
    $hwnd = [WinCapture]::FindWindow([NullString]::Value, $WindowTitle)

    # Fall back to partial match
    if ($hwnd -eq [IntPtr]::Zero) {
        $hwnd = [WinCapture]::FindWindowByPartialTitle($WindowTitle)
    }
}

if ($hwnd -eq [IntPtr]::Zero) {
    if ($ProcessId -gt 0) {
        if ([string]::IsNullOrWhiteSpace($WindowTitle)) {
            Write-JsonResult -Success $false -Error "Could not find a visible window for process id $ProcessId"
        } else {
            Write-JsonResult -Success $false -Error "Could not find a visible window for process id $ProcessId with title matching '$WindowTitle'"
        }
    } else {
        Write-JsonResult -Success $false -Error "Could not find window with title matching '$WindowTitle'"
    }
    exit 1
}

$wasTopMost = $false

# Bring to front if requested
if ($BringToFront) {
    $wasTopMost = [WinCapture]::IsTopMost($hwnd)
    [WinCapture]::ShowWindow($hwnd, [WinCapture]::SW_RESTORE) | Out-Null
    [WinCapture]::ShowWindow($hwnd, [WinCapture]::SW_SHOW) | Out-Null
    [WinCapture]::SetWindowPos(
        $hwnd,
        [WinCapture]::HWND_TOPMOST,
        0,
        0,
        0,
        0,
        [WinCapture]::SWP_NOMOVE -bor [WinCapture]::SWP_NOSIZE -bor [WinCapture]::SWP_SHOWWINDOW
    ) | Out-Null
    [WinCapture]::BringWindowToTop($hwnd) | Out-Null
    [WinCapture]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 500
}

# Get window rect — prefer DWM extended frame bounds (accounts for shadows/DPI)
$rect = New-Object WinCapture+RECT
$dwmResult = [WinCapture]::DwmGetWindowAttribute($hwnd, [WinCapture]::DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect))

if ($dwmResult -ne 0) {
    # Fallback to GetWindowRect
    [WinCapture]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
}

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

if ($width -le 0 -or $height -le 0) {
    Write-JsonResult -Success $false -Error "Window has invalid dimensions: ${width}x${height}. Is it minimized?"
    exit 1
}

# Create bitmap and capture
try {
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)

    # Ensure output directory exists
    $dir = [System.IO.Path]::GetDirectoryName($SavePath)
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    # Save as PNG
    $bitmap.Save($SavePath, [System.Drawing.Imaging.ImageFormat]::Png)

    # Convert to base64
    $memStream = New-Object System.IO.MemoryStream
    $bitmap.Save($memStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bytes = $memStream.ToArray()
    $base64 = [Convert]::ToBase64String($bytes)

    $memStream.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()

    Write-JsonResult -Success $true -Path $SavePath -Base64 $base64 -Width $width -Height $height
} catch {
    Write-JsonResult -Success $false -Error "Screenshot capture failed: $($_.Exception.Message)"
    exit 1
} finally {
    if ($BringToFront -and -not $wasTopMost) {
        [WinCapture]::SetWindowPos(
            $hwnd,
            [WinCapture]::HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            [WinCapture]::SWP_NOMOVE -bor [WinCapture]::SWP_NOSIZE -bor [WinCapture]::SWP_SHOWWINDOW
        ) | Out-Null
    }
}
