/**
 * SttBridge — manages a persistent Python process for each STT model.
 *
 * Protocol (stdin/stdout JSON lines):
 *   → { "id": string, "wav_b64": string }
 *   ← { "id": string, "text": string }
 *   ← { "id": string, "error": string }
 *   ← { "status": "loading"|"ready"|"error", "model": string, "error"?: string }
 */
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

export type SttModel = 'tiny' | 'base';

interface Pending {
  resolve: (text: string) => void;
  reject:  (err: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
}

// ── Embedded Python script ────────────────────────────────────────────────────

const STT_SCRIPT = /* python */ `#!/usr/bin/env python3
"""SaberSpeak STT Bridge - persistent JSON-line process."""
import argparse, base64, json, os, sys, tempfile

MODEL_MAP = {"tiny": 2, "base": 1, "medium": 5}

def emit(obj):
    print(json.dumps(obj), flush=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="base", choices=list(MODEL_MAP.keys()))
    p.add_argument("--language", default="en")
    p.add_argument("--hf-home")
    args = p.parse_args()

    if args.hf_home:
        os.environ["HF_HOME"] = args.hf_home
        os.environ["HF_HUB_CACHE"] = os.path.join(args.hf_home, "hub")

    emit({"status": "loading", "model": args.model})
    transcriber = None
    try:
        import moonshine_voice as mv
        from moonshine_voice import ModelArch
        from moonshine_voice.transcriber import Transcriber

        arch = ModelArch(MODEL_MAP[args.model])
        model_path, resolved_arch = mv.get_model_for_language(args.language, arch)
        transcriber = Transcriber(str(model_path), resolved_arch)
        emit({"status": "ready", "model": args.model})

        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            try:
                req = json.loads(raw)
            except Exception:
                continue
            rid = req.get("id", "")
            wav_b64 = req.get("wav_b64", "")
            if not wav_b64:
                emit({"id": rid, "error": "missing wav_b64"})
                continue
            try:
                wav_bytes = base64.b64decode(wav_b64)
                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    f.write(wav_bytes)
                    tmp = f.name
                try:
                    audio, sr = mv.load_wav_file(tmp)
                    result = transcriber.transcribe_without_streaming(audio, sr)
                    lines = [ln.text.strip() for ln in result.lines if ln.text.strip()]
                    emit({"id": rid, "text": " ".join(lines)})
                finally:
                    os.unlink(tmp)
            except Exception as exc:
                emit({"id": rid, "error": str(exc)})
    except Exception as exc:
        emit({"status": "error", "error": str(exc)})
        sys.exit(1)
    finally:
        if transcriber:
            try:
                transcriber.close()
            except Exception:
                pass

if __name__ == "__main__":
    main()
`;

// ── SttBridge class ───────────────────────────────────────────────────────────

export declare interface SttBridge {
  on(event: 'log',    listener: (msg: string) => void): this;
  on(event: 'status', listener: (payload: { status: string; model?: string; error?: string }) => void): this;
}

export class SttBridge extends EventEmitter {
  private proc:    ChildProcess | null = null;
  private pending: Map<string, Pending> = new Map();
  private buf:     string = '';
  private _ready = false;
  private scriptPath: string;
  private hfHome:     string;

  constructor(
    private readonly pythonExe: string,
    private readonly dataDir: string,
    private readonly model: SttModel,
  ) {
    super();
    this.scriptPath = join(dataDir, 'scripts', 'stt_bridge.py');
    this.hfHome     = join(dataDir, 'hf_cache');
  }

  get ready(): boolean { return this._ready; }
  get modelName(): SttModel { return this.model; }

  async start(): Promise<void> {
    await mkdir(join(this.dataDir, 'scripts'), { recursive: true });
    await mkdir(this.hfHome, { recursive: true });
    await writeFile(this.scriptPath, STT_SCRIPT, { encoding: 'utf8' });

    return new Promise((resolve, reject) => {
      this.proc = spawn(
        this.pythonExe,
        [this.scriptPath, '--model', this.model, '--language', 'en', '--hf-home', this.hfHome],
        { windowsHide: true },
      );

      this.proc.stdout?.setEncoding('utf8');
      this.proc.stdout?.on('data', (d: string) => this.onData(d));

      this.proc.stderr?.setEncoding('utf8');
      this.proc.stderr?.on('data', (d: string) => this.emit('log', `[stt/${this.model}] ${d.trim()}`));

      this.proc.on('error', reject);

      const onStatus = (payload: { status: string; error?: string }) => {
        if (payload.status === 'ready') {
          this._ready = true;
          this.off('status', onStatus);
          resolve();
        } else if (payload.status === 'error') {
          this.off('status', onStatus);
          reject(new Error(payload.error ?? 'STT process error'));
        }
      };
      this.on('status', onStatus);

      // 10-minute timeout to allow model download
      setTimeout(() => {
        if (!this._ready) {
          this.off('status', onStatus);
          reject(new Error(`STT ${this.model} model load timed out (model download may be in progress)`));
        }
      }, 10 * 60_000);
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    const lines = this.buf.split('\n');
    this.buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const msg = JSON.parse(t) as Record<string, string>;
        if (msg['status']) {
          this.emit('status', msg);
          if (msg['status'] === 'loading') {
            this.emit('log', `Downloading Moonshine ${this.model} model, please wait...`);
          }
        } else if (msg['id']) {
          const p = this.pending.get(msg['id']);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(msg['id']);
            if (msg['error']) p.reject(new Error(msg['error']));
            else p.resolve(msg['text'] ?? '');
          }
        }
      } catch { /* non-JSON line */ }
    }
  }

  transcribe(wavBuf: Buffer, timeoutMs = 30_000): Promise<string> {
    if (!this._ready || !this.proc) {
      return Promise.reject(new Error(`SttBridge(${this.model}) not ready`));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`STT ${this.model} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc!.stdin!.write(JSON.stringify({ id, wav_b64: wavBuf.toString('base64') }) + '\n');
    });
  }

  stop(): void {
    this._ready = false;
    this.proc?.kill();
    this.proc = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('SttBridge stopped'));
    }
    this.pending.clear();
  }
}
