/**
 * Preload — exposes a minimal, typed API to the renderer via contextBridge.
 * No Node APIs are directly exposed.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-types.js';
import type { AppState, SetupProgressPayload } from '../shared/ipc-types.js';

contextBridge.exposeInMainWorld('saberSpeak', {
  // ── Renderer → Main ──────────────────────────────────────────────────
  ready() {
    ipcRenderer.send(IPC.RENDERER_READY);
  },
  toggleActive() {
    ipcRenderer.send(IPC.TOGGLE_ACTIVE);
  },
  sendAudioChunk(buffer: ArrayBuffer) {
    ipcRenderer.send(IPC.AUDIO_CHUNK, buffer);
  },
  dragStart(startX: number, startY: number) {
    ipcRenderer.send(IPC.DRAG_START, { startX, startY });
  },
  dragMove(x: number, y: number) {
    ipcRenderer.send(IPC.DRAG_MOVE, { x, y });
  },

  // ── Main → Renderer ──────────────────────────────────────────────────
  onStateChanged(cb: (state: AppState) => void) {
    ipcRenderer.on(IPC.STATE_CHANGED, (_e, state: AppState) => cb(state));
  },
  onTranscriptLine(cb: (text: string) => void) {
    ipcRenderer.on(IPC.TRANSCRIPT_LINE, (_e, text: string) => cb(text));
  },
  onSetupProgress(cb: (p: SetupProgressPayload) => void) {
    ipcRenderer.on(IPC.SETUP_PROGRESS, (_e, p: SetupProgressPayload) => cb(p));
  },
  onError(cb: (message: string) => void) {
    ipcRenderer.on(IPC.ERROR_MSG, (_e, message: string) => cb(message));
  },
});
