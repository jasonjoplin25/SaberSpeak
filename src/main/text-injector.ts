/**
 * TextInjector — writes text to the clipboard and pastes it into the target
 * window using a persistent PowerShell process.
 *
 * No native Node modules required.  Uses Win32 P/Invoke via inline C# to
 * call SetForegroundWindow + SW_RESTORE, then SendKeys("^v") to paste.
 *
 * Lifecycle:
 *   1. Call start() once at app init — compiles the C# type (~1 s on first run)
 *   2. Call inject(text, hwnd) for each dictation result
 *   3. Call stop() on app quit
 */
import { clipboard } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SS_Inject {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@ -Language CSharp 2>$null
Add-Type -AssemblyName System.Windows.Forms 2>$null
Write-Output "READY"
[Console]::Out.Flush()
while ($true) {
    $line = [Console]::ReadLine()
    if ($null -eq $line) { break }
    $line = $line.Trim()
    if ($line -eq "EXIT") { break }
    if ($line -eq "") { continue }
    $hwnd = [IntPtr]::new([long]$line)
    if (-not [SS_Inject]::IsWindow($hwnd)) {
        Write-Output "ERROR:invalid_hwnd"
        [Console]::Out.Flush()
        continue
    }
    [SS_Inject]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
    [SS_Inject]::SetForegroundWindow($hwnd) | Out-Null
    Start-Sleep -Milliseconds 80
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Write-Output "OK"
    [Console]::Out.Flush()
}
`;

export class TextInjector {
  private proc:    ChildProcess | null = null;
  private ready =  false;
  private pending: Array<(ok: boolean) => void> = [];
  private buf =    '';

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.proc = spawn('powershell', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-Command', PS_SCRIPT,
      ], { windowsHide: true });

      this.proc.stdout?.setEncoding('utf8');
      this.proc.stdout?.on('data', (chunk: string) => {
        this.buf += chunk;
        const lines = this.buf.split('\n');
        this.buf = lines.pop() ?? '';
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          if (t === 'READY') {
            this.ready = true;
            resolve();
            continue;
          }
          const cb = this.pending.shift();
          if (cb) cb(t === 'OK');
        }
      });

      this.proc.on('error', (err) => {
        if (!this.ready) reject(err);
      });

      // Safety timeout
      setTimeout(() => {
        if (!this.ready) reject(new Error('TextInjector PowerShell did not start in time'));
      }, 8_000);
    });
  }

  async inject(text: string, hwnd: bigint): Promise<void> {
    if (!this.ready || !this.proc || hwnd === BigInt(0)) return;

    // Write text to clipboard
    clipboard.writeText(text);
    // Small delay to let the clipboard settle
    await sleep(30);

    return new Promise<void>((resolve, reject) => {
      this.pending.push((ok) => {
        if (ok) resolve();
        else reject(new Error('TextInjector: paste failed (invalid HWND or window closed)'));
      });
      this.proc!.stdin!.write(`${hwnd}\n`);
    });
  }

  stop(): void {
    this.proc?.stdin?.write('EXIT\n');
    this.proc?.kill();
    this.proc = null;
    this.ready = false;
    for (const cb of this.pending) cb(false);
    this.pending = [];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
