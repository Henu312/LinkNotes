import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppearanceSettings, BehaviorSettings, WebDavSettings, WebDavTestResult } from '../main/ipc/settings';
import type { TerminalDataPayload, TerminalExitPayload, TerminalSessionPayload } from '../main/ipc/terminal';
import type { WebDavSyncResult } from '../main/ipc/webdav';
import type {
  ImportAttachmentDataPayload,
  DeleteOperationPayload,
  FileOperationPayload,
  ImportAttachmentKind,
  ImportAttachmentPayload,
  WorkspaceNode,
  WorkspaceSearchResult,
  WorkspaceSnapshot
} from '../main/ipc/workspace';

export type WorkspacePayload = WorkspaceSnapshot | null;
export type FileCreatePayload = {
  filePath: string;
  snapshot: WorkspaceSnapshot;
};
export type FileSavePayload = {
  savedAt: number;
};
export type ExportPayload = {
  canceled: boolean;
  filePath?: string;
};

export type LinkNotesApi = {
  openWorkspace: () => Promise<WorkspacePayload>;
  refreshWorkspace: (rootPath: string) => Promise<WorkspaceSnapshot>;
  searchWorkspace: (rootPath: string, query: string) => Promise<WorkspaceSearchResult[]>;
  readFile: (filePath: string) => Promise<string>;
  saveFile: (filePath: string, content: string) => Promise<FileSavePayload>;
  importAttachment: (
    rootPath: string,
    currentFilePath: string,
    kind?: ImportAttachmentKind
  ) => Promise<ImportAttachmentPayload | null>;
  importAttachmentData: (payload: ImportAttachmentDataPayload) => Promise<ImportAttachmentPayload>;
  openInSystem: (targetPath: string) => Promise<void>;
  writeClipboardText: (text: string) => Promise<void>;
  createNote: (rootPath: string) => Promise<FileCreatePayload>;
  createFolder: (rootPath: string, folderName: string) => Promise<FileOperationPayload>;
  renameEntry: (rootPath: string, oldPath: string, newName: string) => Promise<FileOperationPayload>;
  deleteEntry: (rootPath: string, targetPath: string) => Promise<DeleteOperationPayload>;
  exportHtml: (title: string, content: string) => Promise<ExportPayload>;
  exportPdf: (title: string, content: string) => Promise<ExportPayload>;
  getAppearanceSettings: () => Promise<AppearanceSettings>;
  getBehaviorSettings: () => Promise<BehaviorSettings>;
  getWebDavSettings: () => Promise<WebDavSettings>;
  syncWebDavPull: (rootPath: string) => Promise<WebDavSyncResult>;
  syncWebDavPush: (rootPath: string) => Promise<WebDavSyncResult>;
  createTerminalSession: (cwd?: string | null, cols?: number, rows?: number) => Promise<TerminalSessionPayload>;
  writeTerminalInput: (sessionId: string, data: string) => Promise<void>;
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => Promise<void>;
  closeTerminalSession: (sessionId: string) => Promise<void>;
  onTerminalData: (listener: (payload: TerminalDataPayload) => void) => () => void;
  onTerminalExit: (listener: (payload: TerminalExitPayload) => void) => () => void;
  saveAppearanceSettings: (appearance: AppearanceSettings) => Promise<AppearanceSettings>;
  saveBehaviorSettings: (behavior: BehaviorSettings) => Promise<BehaviorSettings>;
  saveWebDavSettings: (webdav: WebDavSettings) => Promise<WebDavSettings>;
  testWebDavSettings: (webdav: WebDavSettings) => Promise<WebDavTestResult>;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  toggleAlwaysOnTop: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
};

const onChannel = <T>(channel: string, listener: (payload: T) => void): (() => void) => {
  const wrapped = (_event: IpcRendererEvent, payload: T) => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
};

const api: LinkNotesApi = {
  closeWindow: () => ipcRenderer.invoke('window:close'),
  createFolder: (rootPath, folderName) => ipcRenderer.invoke('file:createFolder', rootPath, folderName),
  createNote: (rootPath) => ipcRenderer.invoke('file:createNote', rootPath),
  createTerminalSession: (cwd, cols, rows) => ipcRenderer.invoke('terminal:create', cwd, cols, rows),
  deleteEntry: (rootPath, targetPath) => ipcRenderer.invoke('file:delete', rootPath, targetPath),
  closeTerminalSession: (sessionId) => ipcRenderer.invoke('terminal:close', sessionId),
  exportHtml: (title, content) => ipcRenderer.invoke('export:html', title, content),
  exportPdf: (title, content) => ipcRenderer.invoke('export:pdf', title, content),
  getAppearanceSettings: () => ipcRenderer.invoke('settings:getAppearance'),
  getBehaviorSettings: () => ipcRenderer.invoke('settings:getBehavior'),
  getWebDavSettings: () => ipcRenderer.invoke('settings:getWebDav'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  onTerminalData: (listener) => onChannel('terminal:data', listener),
  onTerminalExit: (listener) => onChannel('terminal:exit', listener),
  openWorkspace: (): Promise<WorkspacePayload> => ipcRenderer.invoke('workspace:open'),
  importAttachment: (rootPath, currentFilePath, kind) =>
    ipcRenderer.invoke('file:importAttachment', rootPath, currentFilePath, kind),
  importAttachmentData: (payload) => ipcRenderer.invoke('file:importAttachmentData', payload),
  openInSystem: (targetPath) => ipcRenderer.invoke('file:openInSystem', targetPath),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard:writeText', text),
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  refreshWorkspace: (rootPath) => ipcRenderer.invoke('workspace:refresh', rootPath),
  searchWorkspace: (rootPath, query) => ipcRenderer.invoke('workspace:search', rootPath, query),
  renameEntry: (rootPath, oldPath, newName) => ipcRenderer.invoke('file:rename', rootPath, oldPath, newName),
  resizeTerminalSession: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  saveFile: (filePath, content) => ipcRenderer.invoke('file:save', filePath, content),
  syncWebDavPull: (rootPath) => ipcRenderer.invoke('webdav:pull', rootPath),
  syncWebDavPush: (rootPath) => ipcRenderer.invoke('webdav:push', rootPath),
  saveAppearanceSettings: (appearance) => ipcRenderer.invoke('settings:saveAppearance', appearance),
  saveBehaviorSettings: (behavior) => ipcRenderer.invoke('settings:saveBehavior', behavior),
  saveWebDavSettings: (webdav) => ipcRenderer.invoke('settings:saveWebDav', webdav),
  testWebDavSettings: (webdav) => ipcRenderer.invoke('settings:testWebDav', webdav),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  writeTerminalInput: (sessionId, data) => ipcRenderer.invoke('terminal:write', sessionId, data)
};

contextBridge.exposeInMainWorld('linkNotes', api);
