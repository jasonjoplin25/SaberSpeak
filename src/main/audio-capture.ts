/**
 * AudioCapture — buffers incoming Float32 PCM chunks from the renderer
 * and emits WAV buffers for the STT bridge.
 *
 * Modes:
 *   scan    — emits 1.5 s WAV chunks continuously (wake-word detection)
 *   listen  — accumulates until 1.5 s of silence, then emits full utterance
 *   off     — drops all input
 */
import { EventEmitter } from 'node:events';

const SAMPLE_RATE = 16_000;
const SCAN_CHUNK_SAMPLES = Math.round(SAMPLE_RATE * 1.5);
const SILENCE_THRESHOLD_RMS = 0.012;
const SILENCE_HOLD_SAMPLES = Math.round(SAMPLE_RATE * 1.5);
const MAX_UTTERANCE_SAMPLES = SAMPLE_RATE * 30;

export type CaptureMode = 'off' | 'scan' | 'listen';

export declare interface AudioCapture {
  on(event: 'scan-chunk', listener: (wav: Buffer) => void): this;
  on(event: 'utterance',  listener: (wav: Buffer) => void): this;
}

export class AudioCapture extends EventEmitter {
  private mode: CaptureMode = 'off';

  // scan buffers
  private scanBuf: Float32Array[] = [];
  private scanBufLen = 0;

  // listen buffers
  private listenBuf: Float32Array[] = [];
  private listenBufLen = 0;
  private silentSamples = 0;
  private hasVoice = false;

  setMode(mode: CaptureMode): void {
    this.mode = mode;
    this.scanBuf = [];
    this.scanBufLen = 0;
    this.listenBuf = [];
    this.listenBufLen = 0;
    this.silentSamples = 0;
    this.hasVoice = false;
  }

  /** Called by main process when a Float32 PCM chunk arrives via IPC. */
  push(samples: Float32Array): void {
    if (this.mode === 'off') return;

    if (this.mode === 'scan') {
      this.scanBuf.push(samples);
      this.scanBufLen += samples.length;
      if (this.scanBufLen >= SCAN_CHUNK_SAMPLES) {
        const flat = flatten(this.scanBuf, this.scanBufLen);
        this.scanBuf = [];
        this.scanBufLen = 0;
        this.emit('scan-chunk', encodeWav(flat.subarray(0, SCAN_CHUNK_SAMPLES)));
      }
      return;
    }

    // listen mode
    this.listenBuf.push(samples);
    this.listenBufLen += samples.length;

    const rms = computeRMS(samples);
    if (rms > SILENCE_THRESHOLD_RMS) {
      this.hasVoice = true;
      this.silentSamples = 0;
    } else if (this.hasVoice) {
      this.silentSamples += samples.length;
      if (this.silentSamples >= SILENCE_HOLD_SAMPLES) {
        this.flushUtterance();
        return;
      }
    }

    if (this.listenBufLen >= MAX_UTTERANCE_SAMPLES) {
      this.flushUtterance();
    }
  }

  private flushUtterance(): void {
    if (!this.hasVoice) return;
    const flat = flatten(this.listenBuf, this.listenBufLen);
    this.listenBuf = [];
    this.listenBufLen = 0;
    this.silentSamples = 0;
    this.hasVoice = false;
    this.emit('utterance', encodeWav(flat));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function flatten(chunks: Float32Array[], totalLen: number): Float32Array {
  const out = new Float32Array(totalLen);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function computeRMS(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

export function encodeWav(samples: Float32Array, sr = SAMPLE_RATE): Buffer {
  const dataLen = samples.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);   // PCM
  buf.writeUInt16LE(1, 22);   // mono
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), 44 + i * 2);
  }
  return buf;
}
