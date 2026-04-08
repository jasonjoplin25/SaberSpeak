// IPC channel names and payload types shared between main and renderer processes.

export const IPC = {
  // Renderer → Main
  AUDIO_CHUNK:    'audio:chunk',       // ArrayBuffer of Float32 PCM at 16kHz mono
  TOGGLE_ACTIVE:  'app:toggle-active', // User clicked the status button
  DRAG_START:     'window:drag-start', // { startX, startY } screen coords
  DRAG_MOVE:      'window:drag-move',  // { x, y } screen coords
  RENDERER_READY: 'renderer:ready',

  // Main → Renderer
  STATE_CHANGED:    'state:changed',    // AppState string
  TRANSCRIPT_LINE:  'transcript:line',  // { text: string } — show in widget
  SETUP_PROGRESS:   'setup:progress',   // SetupProgressPayload
  ERROR_MSG:        'app:error',        // { message: string }
} as const;

export type IpcChannel = typeof IPC[keyof typeof IPC];

// States shown in the widget
export type AppState =
  | 'inactive'    // mic off, grey
  | 'setup'       // first-time install running, grey spinner
  | 'scanning'    // mic on, waiting for wake word, amber pulse
  | 'listening'   // heard wake word, recording, green pulse
  | 'processing'  // running STT, blue pulse
  | 'error';      // something went wrong, red

export interface SetupProgressPayload {
  stage: 'installing-deps' | 'downloading-model-tiny' | 'downloading-model-base' | 'ready';
  label: string;
  pct: number; // 0–100
}

export interface AudioChunkMessage {
  buffer: ArrayBuffer; // Float32 samples at 16 kHz mono
}
