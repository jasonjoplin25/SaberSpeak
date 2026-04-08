<div align="center">

<svg width="640" height="120" viewBox="0 0 640 120" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" style="stop-color:#ef4444;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#facc15;stop-opacity:1" />
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
      <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="640" height="120" rx="12" fill="#0c0a09"/>
  <text x="320" y="78" text-anchor="middle"
    font-family="'Segoe UI', Arial, sans-serif"
    font-size="58" font-weight="800" letter-spacing="3"
    fill="url(#sg)" filter="url(#glow)">SaberSpeak</text>
</svg>

**On-Device Voice Dictation for Windows**

![Electron](https://img.shields.io/badge/Electron-Desktop-47848F?style=flat-square&logo=electron&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Moonshine](https://img.shields.io/badge/STT-Moonshine-red?style=flat-square)
![Windows](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white)
![Offline](https://img.shields.io/badge/100%25-Offline-green?style=flat-square)

</div>

---

SaberSpeak is a Windows desktop dictation app that transcribes your voice directly into any focused application — no cloud, no API keys, no internet required. It runs entirely on-device using the Moonshine speech-to-text model bundled with the app.

Speak into any text field, document, or editor and your words appear instantly.

## Features

- **100% on-device** — Moonshine STT runs locally, nothing leaves your machine
- **System-wide text injection** — dictates into any focused window (browser, IDE, Office, etc.)
- **Wake word detection** — hands-free activation
- **Command processor** — voice commands for punctuation, formatting, and control
- **Focus tracker** — automatically targets the active application window
- **Floating widget** — minimal always-on-top overlay showing dictation state
- **State machine** — reliable idle / listening / processing / injecting states
- **Audio capture** — low-latency microphone input pipeline

## Architecture

```
src/
├── main/
│   ├── index.ts              # Electron main process
│   ├── audio-capture.ts      # Microphone input
│   ├── stt-bridge.ts         # Moonshine STT interface
│   ├── wake-word-detector.ts # Hands-free activation
│   ├── command-processor.ts  # Voice command parsing
│   ├── text-injector.ts      # System-wide text injection
│   ├── focus-tracker.ts      # Active window detection
│   ├── widget-window.ts      # Floating overlay window
│   ├── state-machine.ts      # App state management
│   └── preload.ts            # IPC bridge
└── renderer/
    ├── index.ts              # UI entry point
    ├── index.html
    └── styles.css
```

## Tech Stack

| | |
|---|---|
| Shell | Electron |
| Language | TypeScript |
| STT | Moonshine (bundled, offline) |
| Build | tsup |
| Tests | Vitest |
| Packaging | electron-builder |

## Getting Started

```bash
pnpm install
pnpm dev          # Run in development
pnpm build        # Build distributable
```

See [SETUP.md](SETUP.md) for bundled Python / Moonshine model configuration.
