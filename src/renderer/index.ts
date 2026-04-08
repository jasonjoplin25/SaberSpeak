/**
 * Renderer process — floating widget UI.
 *
 * Responsibilities:
 *  1. Capture microphone audio via Web Audio API and send PCM chunks to main.
 *  2. Display state, transcript, and setup progress.
 *  3. Handle drag-to-move.
 */

import type { AppState, SetupProgressPayload } from '../shared/ipc-types.js';

// ── Type augment for the contextBridge API ───────────────────────────────────

declare global {
  interface Window {
    saberSpeak: {
      ready(): void;
      toggleActive(): void;
      sendAudioChunk(buffer: ArrayBuffer): void;
      dragStart(x: number, y: number): void;
      dragMove(x: number, y: number): void;
      onStateChanged(cb: (state: AppState) => void): void;
      onTranscriptLine(cb: (text: string) => void): void;
      onSetupProgress(cb: (p: SetupProgressPayload) => void): void;
      onError(cb: (message: string) => void): void;
    };
  }
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const btn         = document.getElementById('status-btn')!      as HTMLButtonElement;
const statusLabel = document.getElementById('status-label')!    as HTMLDivElement;
const transcript  = document.getElementById('transcript')!      as HTMLDivElement;
const progressWrap= document.getElementById('progress-bar-wrap')! as HTMLDivElement;
const progressBar = document.getElementById('progress-bar')!    as HTMLDivElement;
const widget      = document.getElementById('widget')!          as HTMLDivElement;

// ── Audio pipeline ────────────────────────────────────────────────────────────

const SAMPLE_RATE   = 16_000;
const CHUNK_FRAMES  = 1_600; // 100 ms at 16 kHz

let audioCtx: AudioContext | null = null;
let micStream: MediaStream | null = null;
let processor:  ScriptProcessorNode | null = null;
let micActive = false;

async function startMic(): Promise<void> {
  if (micActive) return;
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      sampleRate: SAMPLE_RATE,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = audioCtx.createMediaStreamSource(micStream);

  processor = audioCtx.createScriptProcessor(CHUNK_FRAMES, 1, 1);
  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    // Send a copy of the Float32Array as an ArrayBuffer to main
    const copy = new Float32Array(data).buffer;
    window.saberSpeak.sendAudioChunk(copy);
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);
  micActive = true;
}

function stopMic(): void {
  if (!micActive) return;
  processor?.disconnect();
  micStream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  audioCtx = null;
  micStream = null;
  processor = null;
  micActive = false;
}

// ── State → UI ────────────────────────────────────────────────────────────────

const STATE_ICONS: Record<AppState, string> = {
  inactive:   '🎤',
  setup:      '⚙',
  scanning:   '👂',
  listening:  '🔴',
  processing: '💬',
  error:      '⚠',
};

const STATE_LABELS: Record<AppState, string> = {
  inactive:   'Inactive — click mic to start',
  setup:      'Setting up…',
  scanning:   'Listening for "wake up"',
  listening:  'Recording…',
  processing: 'Transcribing…',
  error:      'Error',
};

function applyState(s: AppState): void {
  // Remove all state classes then add the new one
  btn.className = `state-${s}`;
  btn.textContent = STATE_ICONS[s];
  statusLabel.textContent = STATE_LABELS[s];

  const needsMic = s === 'scanning' || s === 'listening';
  if (needsMic) {
    startMic().catch((err) => console.error('mic error:', err));
  } else {
    stopMic();
  }

  if (s !== 'setup') {
    progressWrap.classList.remove('visible');
  }
}

// ── IPC listeners ─────────────────────────────────────────────────────────────

window.saberSpeak.onStateChanged((s) => applyState(s));

window.saberSpeak.onTranscriptLine((text) => {
  transcript.textContent = text;
});

window.saberSpeak.onSetupProgress((p) => {
  statusLabel.textContent = p.label;
  progressWrap.classList.add('visible');
  progressBar.style.width = `${p.pct}%`;
  if (p.stage === 'ready') {
    setTimeout(() => progressWrap.classList.remove('visible'), 800);
  }
});

window.saberSpeak.onError((msg) => {
  statusLabel.textContent = `Error: ${msg.slice(0, 80)}`;
  transcript.textContent = '';
  btn.className = 'state-error';
  btn.textContent = '⚠';
});

// ── Interactions ──────────────────────────────────────────────────────────────

btn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.saberSpeak.toggleActive();
});

// Drag support — track mouse delta and relay to main for setPosition
let dragging = false;
let dragStartScreenX = 0;
let dragStartScreenY = 0;

widget.addEventListener('mousedown', (e) => {
  if (e.target === btn) return; // don't drag when clicking the button
  dragging = true;
  dragStartScreenX = e.screenX;
  dragStartScreenY = e.screenY;
  window.saberSpeak.dragStart(e.screenX, e.screenY);
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  window.saberSpeak.dragMove(e.screenX, e.screenY);
});

window.addEventListener('mouseup', () => { dragging = false; });

// ── Init ──────────────────────────────────────────────────────────────────────

window.saberSpeak.ready();
applyState('inactive');
