import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';

export function createWidgetWindow(): BrowserWindow {
  const { width: sw } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
    width: 300,
    height: 72,
    x: Math.round(sw / 2 - 150),
    y: 16,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,          // dragging is handled manually via IPC
    hasShadow: false,
    show: false,             // show after ready-to-show
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.js'),
    },
  });

  // Keep it above everything including full-screen apps
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.once('ready-to-show', () => win.show());

  if (process.env['NODE_ENV'] === 'development') {
    void win.loadURL('http://localhost:3000');
  } else {
    void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }

  return win;
}
