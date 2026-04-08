/**
 * FocusTracker — tracks the last non-SaberSpeak foreground window HWND.
 *
 * Runs a persistent PowerShell process that calls GetForegroundWindow()
 * every 200 ms and reports the HWND + owning PID.  We ignore our own PID
 * so that opening the widget doesn't clobber the saved target.
 */
import { spawn, ChildProcess } from 'node:child_process';

// Inline PowerShell — compiles the P/Invoke type once, then polls in a loop.
const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SS_Focus {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@ -Language CSharp 2>$null
while ($true) {
    $h = [SS_Focus]::GetForegroundWindow()
    $pid = [uint32]0
    [SS_Focus]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null
    Write-Output "$($h.ToInt64()),$pid"
    Start-Sleep -Milliseconds 200
}
`;

export class FocusTracker {
  private proc: ChildProcess | null = null;
  private lastHwnd: bigint = BigInt(0);
  private readonly ourPid = process.pid;

  start(): void {
    if (this.proc) return;
    this.proc = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command', PS_SCRIPT,
    ], { windowsHide: true });

    let buf = '';
    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const [hwndStr, pidStr] = line.trim().split(',');
        if (!hwndStr || !pidStr) continue;
        const pid = parseInt(pidStr, 10);
        const hwnd = BigInt(hwndStr);
        if (!isNaN(pid) && pid !== this.ourPid && hwnd !== BigInt(0)) {
          this.lastHwnd = hwnd;
        }
      }
    });
  }

  /** Returns the HWND of the last focused non-SaberSpeak window, or 0n if none. */
  getLastHwnd(): bigint {
    return this.lastHwnd;
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}
