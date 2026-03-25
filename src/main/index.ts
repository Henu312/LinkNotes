import { app, BrowserWindow, clipboard, ipcMain } from 'electron';
import { registerExportIpc } from './ipc/export';
import { registerSettingsIpc } from './ipc/settings';
import { registerTerminalIpc } from './ipc/terminal';
import { registerWebDavIpc } from './ipc/webdav';
import { installIoErrorGuards, safeError } from './logger';
import createWindow from './window';
import { registerWorkspaceIpc } from './ipc/workspace';

let mainWindow: ReturnType<typeof createWindow> | null = null;

installIoErrorGuards();

const registerWindowIpc = (): void => {
  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    if (window.isMaximized()) {
      window.unmaximize();
      return false;
    }

    window.maximize();
    return true;
  });

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:toggleAlwaysOnTop', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return false;
    }

    const nextState = !window.isAlwaysOnTop();
    window.setAlwaysOnTop(nextState);
    return nextState;
  });

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text);
  });
};

const bootstrap = async (): Promise<void> => {
  await app.whenReady();

  registerExportIpc(ipcMain);
  registerSettingsIpc(ipcMain);
  registerTerminalIpc(ipcMain);
  registerWebDavIpc(ipcMain);
  registerWorkspaceIpc(ipcMain);
  registerWindowIpc();
  mainWindow = createWindow();

  app.on('activate', () => {
    if (mainWindow === null) {
      mainWindow = createWindow();
    }
  });
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

bootstrap().catch((error) => {
  safeError('应用启动失败', error);
  app.quit();
});
