import type { IpcMain } from 'electron';
import { syncWorkspacePull, syncWorkspacePush, type WebDavSyncSummary } from '../webdav-core';
import { getWorkspaceSnapshot, type WorkspaceSnapshot } from './workspace';

export type WebDavSyncResult = WebDavSyncSummary & {
  snapshot: WorkspaceSnapshot;
};

const buildSyncResult = async (rootPath: string, summary: WebDavSyncSummary): Promise<WebDavSyncResult> => ({
  ...summary,
  snapshot: await getWorkspaceSnapshot(rootPath)
});

export const registerWebDavIpc = (ipcMain: IpcMain): void => {
  ipcMain.handle('webdav:push', async (_event, rootPath: string): Promise<WebDavSyncResult> => {
    return buildSyncResult(rootPath, await syncWorkspacePush(rootPath));
  });

  ipcMain.handle('webdav:pull', async (_event, rootPath: string): Promise<WebDavSyncResult> => {
    return buildSyncResult(rootPath, await syncWorkspacePull(rootPath));
  });
};
