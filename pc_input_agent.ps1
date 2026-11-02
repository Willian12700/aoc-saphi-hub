Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinInput {
    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT lpPoint);
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    public struct POINT { public int X; public int Y; }

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
}
"@

Write-Host "🎮 Controle Remoto / Mouse / Teclado do Celular ATIVO!" -ForegroundColor Green
while ($true) {
    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:8080/pc/poll-input" -TimeoutSec 2
        if ($resp -and $resp.Count -gt 0) {
            foreach ($cmd in $resp) {
                if ($cmd.type -eq "move") {
                    $pt = New-Object WinInput+POINT
                    [WinInput]::GetCursorPos([ref]$pt) | Out-Null
                    [WinInput]::SetCursorPos($pt.X + [int]$cmd.dx, $pt.Y + [int]$cmd.dy) | Out-Null
                }
                elseif ($cmd.type -eq "click") {
                    if ($cmd.btn -eq "right") {
                        [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)
                        [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)
                    } else {
                        [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
                        [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
                    }
                }
                elseif ($cmd.type -eq "scroll") {
                    [WinInput]::mouse_event([WinInput]::MOUSEEVENTF_WHEEL, 0, 0, [int]$cmd.dir, 0)
                }
                elseif ($cmd.type -eq "key") {
                    $k = $cmd.key
                    $map = @{
                        "SPACE" = " "; "ENTER" = "{ENTER}"; "ESCAPE" = "{ESC}";
                        "BACKSPACE" = "{BS}"; "TAB" = "{TAB}"; "F11" = "{F11}";
                        "UP" = "{UP}"; "DOWN" = "{DOWN}"; "LEFT" = "{LEFT}"; "RIGHT" = "{RIGHT}"
                    }
                    if ($map.ContainsKey($k)) {
                        [System.Windows.Forms.SendKeys]::SendWait($map[$k])
                    } else {
                        [System.Windows.Forms.SendKeys]::SendWait($k)
                    }
                }
                elseif ($cmd.type -eq "text") {
                    [System.Windows.Forms.SendKeys]::SendWait($cmd.text)
                }
            }
        }
    } catch {}
    Start-Sleep -Milliseconds 45
}
