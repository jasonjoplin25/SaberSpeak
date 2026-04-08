/**
 * SaberSpeak — Electron main process entry point.
 *
 * Orchestrates: setup → STT bridges → focus tracker → text injector
 * and responds to audio chunks from the renderer.
 */
import { app, ipcMain, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { createWidgetWindow } from './widget-window.js';
import { StateMachine } from './state-machine.js';
import { AudioCapture } from './audio-capture.js';
import { SttBridge } from './stt-bridge.js';
import { FocusTracker } from './focus-tracker.js';
import { TextInjector } from './text-injector.js';
import { isWakeWord, isStopCommand, stripWakeWord, detectAllCapsCommands } from './wake-word-detector.js';
import { buildInsertionText } from './command-processor.js';
import { IPC } from '../shared/ipc-types.js';
import type { AppState, SetupProgressPayload } from '../shared/ipc-types.js';

// ── Paths ────────────────────────────────────────────────────────────────────

const DATA_DIR = app.getPath('userData');

function getPythonExe(): string {
  // Production: extraResources lands next to app.asar in process.resourcesPath
  const prodPath = join(
    (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? '',
    'bundled-python', 'python.exe',
  );
  if (existsSync(prodPath)) return prodPath;

  // Development: bundled-python sits at the project root (two levels above dist/main/)
  const devPath = join(app.getAppPath(), 'bundled-python', 'python.exe');
  if (existsSync(devPath)) return devPath;

  return process.platform === 'win32' ? 'python' : 'python3';
}

// ── First-time setup ─────────────────────────────────────────────────────────

async function ensureMoonshineInstalled(
  pythonExe: string,
  onProgress: (p: SetupProgressPayload) => void,
): Promise<void> {
  // Check if moonshine_voice is already importable
  const isInstalled = await new Promise<boolean>((resolve) => {
    const check = spawn(pythonExe, ['-c', 'import moonshine_voice; print("ok")'], {
      windowsHide: true,
    });
    let out = '';
    check.stdout?.on('data', (d: Buffer) => { out += d.toString(); });
    check.on('close', (code) => resolve(code === 0 && out.includes('ok')));
    check.on('error', () => resolve(false));
  });

  if (isInstalled) return;

  onProgress({ stage: 'installing-deps', label: 'Installing voice engine (one-time setup)…', pct: 5 });

  await new Promise<void>((resolve, reject) => {
    const pip = spawn(pythonExe, ['-m', 'pip', 'install', '--upgrade', 'moonshine-voice'], {
      windowsHide: true,
    });

    let stderr = '';
    pip.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    // Simulate progress from 5 → 90 over the install duration
    let pct = 5;
    const ticker = setInterval(() => {
      pct = Math.min(pct + 3, 88);
      onProgress({ stage: 'installing-deps', label: 'Installing voice engine (one-time setup)…', pct });
    }, 2_000);

    pip.on('close', (code) => {
      clearInterval(ticker);
      if (code === 0) resolve();
      else reject(new Error(`pip install failed:\n${stderr.slice(-500)}`));
    });
    pip.on('error', reject);
  });

  onProgress({ stage: 'installing-deps', label: 'Voice engine installed.', pct: 95 });
}

// ── App bootstrap ─────────────────────────────────────────────────────────────

app.on('ready', async () => {
  await mkdir(DATA_DIR, { recursive: true });

  const win = createWidgetWindow();
  const state = new StateMachine();
  const audio = new AudioCapture();
  const focusTracker = new FocusTracker();
  const injector = new TextInjector();
  const pythonExe = getPythonExe();

  let scanBridge:  SttBridge | null = null;
  let transcBridge: SttBridge | null = null;
  let tray: Tray | null = null;
  let dragOriginWin = { x: 0, y: 0 };
  let dragOriginMouse = { x: 0, y: 0 };

  // ── Helpers ──────────────────────────────────────────────────────────

  function sendState(s: AppState) {
    win.webContents.send(IPC.STATE_CHANGED, s);
  }

  function sendProgress(p: SetupProgressPayload) {
    win.webContents.send(IPC.SETUP_PROGRESS, p);
  }

  function sendTranscript(text: string) {
    win.webContents.send(IPC.TRANSCRIPT_LINE, text);
  }

  function sendError(message: string) {
    win.webContents.send(IPC.ERROR_MSG, message);
  }

  // ── State machine → audio mode ────────────────────────────────────────

  state.on('transition', (next: AppState, _prev: AppState) => {
    sendState(next);
    switch (next) {
      case 'scanning':
        audio.setMode('scan');
        break;
      case 'listening':
        audio.setMode('listen');
        break;
      case 'inactive':
      case 'error':
      case 'setup':
      case 'processing':
        audio.setMode('off');
        break;
    }
  });

  // ── Audio chunk from renderer ─────────────────────────────────────────

  let audioChunkCount = 0;
  ipcMain.on(IPC.AUDIO_CHUNK, (_e, buffer: ArrayBuffer) => {
    audioChunkCount++;
    if (audioChunkCount === 1) console.log('[audio] First chunk received from renderer ✓');
    audio.push(new Float32Array(buffer));
  });

  // ── Scan chunk → wake word detection ─────────────────────────────────

  audio.on('scan-chunk', async (wav: Buffer) => {
    console.log(`[scan] chunk ready — scanBridge.ready=${scanBridge?.ready}`);
    if (!scanBridge?.ready) return;
    try {
      const text = await scanBridge.transcribe(wav, 8_000);
      console.log(`[scan] STT result: "${text}"`);
      if (isWakeWord(text)) {
        state.dispatch({ type: 'WAKE_WORD' });
      }
    } catch (err) {
      console.error('[scan] STT error:', err instanceof Error ? err.message : err);
    }
  });

  // ── Utterance → transcribe + inject ──────────────────────────────────

  audio.on('utterance', async (wav: Buffer) => {
    if (!transcBridge?.ready) return;

    try {
      const raw = await transcBridge.transcribe(wav, 30_000);

      // Stop command
      if (isStopCommand(raw)) {
        state.dispatch({ type: 'STOP_LISTENING' });
        sendTranscript('[stopped]');
        return;
      }

      // Strip leading wake word repetition (user may have repeated it)
      let text = stripWakeWord(raw);

      // All-caps command detection
      const caps = detectAllCapsCommands(text);
      if (caps.allCapsOn) { state.allCapsActive = true; text = caps.text; }
      if (caps.allCapsOff) { state.allCapsActive = false; text = caps.text; }

      const insertion = buildInsertionText(text, state.allCapsActive, caps.allCapsThat);
      if (!insertion.trim()) {
        state.dispatch({ type: 'UTTERANCE', text: '' });
        state.dispatch({ type: 'INJECT_DONE' });
        return;
      }

      sendTranscript(insertion);
      state.dispatch({ type: 'UTTERANCE', text: insertion });

      if (process.platform === 'win32') {
        const hwnd = focusTracker.getLastHwnd();
        await injector.inject(insertion, hwnd);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      state.dispatch({ type: 'ERROR', message: msg });
      sendError(msg);
    } finally {
      state.dispatch({ type: 'INJECT_DONE' });
    }
  });

  // ── Toggle button ─────────────────────────────────────────────────────

  ipcMain.on(IPC.TOGGLE_ACTIVE, () => {
    state.dispatch({ type: 'TOGGLE' });
  });

  // ── Dragging ──────────────────────────────────────────────────────────

  ipcMain.on(IPC.DRAG_START, (_e, { startX, startY }: { startX: number; startY: number }) => {
    const [wx, wy] = win.getPosition();
    dragOriginWin = { x: wx!, y: wy! };
    dragOriginMouse = { x: startX, y: startY };
  });

  ipcMain.on(IPC.DRAG_MOVE, (_e, { x, y }: { x: number; y: number }) => {
    const dx = x - dragOriginMouse.x;
    const dy = y - dragOriginMouse.y;
    win.setPosition(dragOriginWin.x + dx, dragOriginWin.y + dy);
  });

  // ── Renderer ready → run setup then start bridges ────────────────────

  ipcMain.once(IPC.RENDERER_READY, async () => {
    // First-time setup
    state.dispatch({ type: 'SETUP_START' });
    sendState('setup');

    console.log(`[setup] pythonExe=${pythonExe}`);
    try {
      await ensureMoonshineInstalled(pythonExe, sendProgress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[setup] FAILED:', msg);
      sendError(`Setup failed: ${msg}`);
      state.dispatch({ type: 'ERROR', message: msg });
      return;
    }

    // Start bridges (models download here if not cached, shown in widget)
    sendProgress({ stage: 'downloading-model-tiny', label: 'Loading wake-word model…', pct: 30 });
    scanBridge = new SttBridge(pythonExe, DATA_DIR, 'tiny');
    scanBridge.on('log', (m) => sendTranscript(m));
    await scanBridge.start().catch((err) => {
      console.error('[scanBridge] start failed:', err.message);
      sendError(`Wake-word model failed: ${err.message}`);
    });

    sendProgress({ stage: 'downloading-model-base', label: 'Loading dictation model…', pct: 65 });
    transcBridge = new SttBridge(pythonExe, DATA_DIR, 'base');
    transcBridge.on('log', (m) => { console.log('[transcBridge]', m); sendTranscript(m); });
    await transcBridge.start().catch((err) => {
      console.error('[transcBridge] start failed:', err.message);
      sendError(`Dictation model failed: ${err.message}`);
    });

    // Start focus tracker and injector (Windows only — requires PowerShell + Win32)
    if (process.platform === 'win32') {
      focusTracker.start();
      await injector.start().catch((err) => {
        sendError(`Text injector failed to start: ${err.message}`);
      });
    }

    console.log(`[setup] Done. scanBridge.ready=${scanBridge?.ready} transcBridge.ready=${transcBridge?.ready}`);
    sendProgress({ stage: 'ready', label: 'Ready', pct: 100 });
    state.dispatch({ type: 'SETUP_DONE' });
    sendState('inactive');
  });

  // ── Tray icon ─────────────────────────────────────────────────────────

  // Create a simple tray icon so users can quit from the system tray
  const trayIcon = nativeImage.createEmpty();
  try {
    tray = new Tray(join(RESOURCES_DIR, '..', 'assets', 'icon.ico'));
  } catch {
    tray = new Tray(trayIcon);
  }
  tray.setToolTip('SaberSpeak');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'SaberSpeak', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));

  // ── Quit cleanup ──────────────────────────────────────────────────────

  app.on('before-quit', () => {
    scanBridge?.stop();
    transcBridge?.stop();
    focusTracker.stop();
    injector.stop();
  });
});

// Prevent multiple instances
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on('window-all-closed', () => {
  // Keep running in tray — don't quit when window closes
});
