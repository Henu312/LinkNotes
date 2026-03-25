import { BrowserWindow } from 'electron';
import { safeError, safeLog } from './logger';

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    title: 'LinkNotes',
    backgroundColor: '#eef2f8',
    frame: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  window.webContents.on('did-finish-load', () => {
    safeLog('renderer: did-finish-load');
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    safeError('renderer: did-fail-load', errorCode, errorDescription);
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    safeLog(`renderer console [${level}] ${message} (${sourceId}:${line})`);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    safeError('renderer: render-process-gone', details.reason);
  });

  if (!window.isDestroyed()) {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  return window;
};

export default createWindow;
