import { dialog, shell, type IpcMain } from 'electron';
import { Dirent, promises as fs } from 'node:fs';
import path from 'node:path';
import { syncRemoteDeleteForLocalChange, syncRemoteRenameForLocalChange } from '../webdav-core';

export type WorkspaceNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WorkspaceNode[];
};

export type WorkspaceSnapshot = {
  rootPath: string;
  tree: WorkspaceNode[];
};

export type FileOperationPayload = {
  snapshot: WorkspaceSnapshot;
  syncWarning?: string;
  targetPath: string;
};

export type DeleteOperationPayload = {
  snapshot: WorkspaceSnapshot;
  syncWarning?: string;
};

export type ImportAttachmentPayload = {
  insertedText: string;
  targetPath: string;
};

export type ImportAttachmentKind = 'auto' | 'file' | 'image';
export type ImportAttachmentDataPayload = {
  content: Uint8Array;
  currentFilePath: string;
  fileName?: string;
  mimeType?: string;
};

export type WorkspaceSearchResult = {
  filePath: string;
  fileName: string;
  lineNumber: number | null;
  matchType: 'fileName' | 'content' | 'both';
  occurrenceIndex: number;
  preview: string;
  relativePath: string;
  resultId: string;
  columnNumber: number | null;
};

const maxSearchResults = 120;
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const visibleFileExtensions = new Set([
  '.md',
  '.markdown',
  '.mdown',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
  '.pdf',
  '.txt',
  '.json'
]);
const textSearchableExtensions = new Set(['.md', '.markdown', '.mdown', '.txt', '.json']);
const mimeExtensionMap: Record<string, string> = {
  'application/json': '.json',
  'application/pdf': '.pdf',
  'image/bmp': '.bmp',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
  'text/markdown': '.md',
  'text/plain': '.txt'
};

const isVisibleEntry = (entry: Dirent): boolean =>
  entry.isDirectory() || visibleFileExtensions.has(path.extname(entry.name).toLocaleLowerCase());
const isTextSearchableFile = (filePath: string): boolean =>
  textSearchableExtensions.has(path.extname(filePath).toLocaleLowerCase());

const ensureRelativeMarkdownPath = (targetPath: string): string => {
  const normalizedPath = targetPath.replaceAll('\\', '/');
  if (normalizedPath.startsWith('./') || normalizedPath.startsWith('../')) {
    return normalizedPath;
  }
  return `./${normalizedPath}`;
};

const createUniqueFilePath = async (baseDir: string, originalName: string): Promise<string> => {
  const parsed = path.parse(originalName);
  const baseName = parsed.name || '附件';
  const extension = parsed.ext;
  let index = 0;

  while (true) {
    const nextName = index === 0 ? `${baseName}${extension}` : `${baseName}-${index}${extension}`;
    const targetPath = path.join(baseDir, nextName);

    try {
      await fs.access(targetPath);
      index += 1;
    } catch {
      return targetPath;
    }
  }
};

const inferExtensionFromMimeType = (mimeType?: string): string => {
  const normalizedMimeType = mimeType?.trim().toLocaleLowerCase() ?? '';
  return mimeExtensionMap[normalizedMimeType] ?? '';
};

const sanitizeAttachmentName = (fileName?: string, mimeType?: string): string => {
  const normalizedName = (fileName ?? '').trim().replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '-');
  if (normalizedName) {
    const parsed = path.parse(normalizedName);
    const baseName = parsed.name.trim() || '附件';
    const extension = parsed.ext || inferExtensionFromMimeType(mimeType);
    return `${baseName}${extension}`;
  }

  const fallbackExtension = inferExtensionFromMimeType(mimeType) || '.bin';
  return `附件-${Date.now()}${fallbackExtension}`;
};

const buildAttachmentInsertedText = (targetPath: string, noteDirectory: string): string => {
  const relativePath = ensureRelativeMarkdownPath(path.relative(noteDirectory, targetPath));
  const extension = path.extname(targetPath).toLocaleLowerCase();
  const baseName = path.parse(targetPath).name;
  return imageExtensions.has(extension) ? `![${baseName}](${relativePath})` : `[${baseName}](${relativePath})`;
};

const saveImportedAttachment = async (
  currentFilePath: string,
  source: { content: Uint8Array; fileName?: string; mimeType?: string } | { sourcePath: string }
): Promise<ImportAttachmentPayload> => {
  const noteDirectory = path.dirname(currentFilePath);
  const attachmentsDirectory = path.join(noteDirectory, 'attachments');
  await fs.mkdir(attachmentsDirectory, { recursive: true });

  if ('sourcePath' in source) {
    const targetPath = await createUniqueFilePath(attachmentsDirectory, path.basename(source.sourcePath));
    await fs.copyFile(source.sourcePath, targetPath);
    return {
      insertedText: buildAttachmentInsertedText(targetPath, noteDirectory),
      targetPath
    };
  }

  const targetPath = await createUniqueFilePath(
    attachmentsDirectory,
    sanitizeAttachmentName(source.fileName, source.mimeType)
  );
  await fs.writeFile(targetPath, source.content);
  return {
    insertedText: buildAttachmentInsertedText(targetPath, noteDirectory),
    targetPath
  };
};

const buildTree = async (targetPath: string): Promise<WorkspaceNode[]> => {
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const nodes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith('.') && isVisibleEntry(entry))
      .map(async (entry) => {
        const fullPath = path.join(targetPath, entry.name);
        if (entry.isDirectory()) {
          return {
            name: entry.name,
            path: fullPath,
            type: 'directory' as const,
            children: await buildTree(fullPath)
          };
        }

        return {
          name: entry.name,
          path: fullPath,
          type: 'file' as const
        };
      })
  );

  return nodes.sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN');
  });
};

export const getWorkspaceSnapshot = async (rootPath: string): Promise<WorkspaceSnapshot> => ({
  rootPath,
  tree: await buildTree(rootPath)
});

const createUniqueNotePath = async (baseDir: string): Promise<string> => {
  let index = 1;
  while (true) {
    const fileName = index === 1 ? '未命名笔记.md' : `未命名笔记 ${index}.md`;
    const filePath = path.join(baseDir, fileName);
    try {
      await fs.access(filePath);
      index += 1;
    } catch {
      return filePath;
    }
  }
};

const createUniqueFolderPath = async (baseDir: string, folderName: string): Promise<string> => {
  let index = 1;
  while (true) {
    const name = index === 1 ? folderName : `${folderName} ${index}`;
    const folderPath = path.join(baseDir, name);
    try {
      await fs.access(folderPath);
      index += 1;
    } catch {
      return folderPath;
    }
  }
};

const buildSearchPreview = (content: string, keyword: string, matchIndex: number): string => {
  const fallbackLine = content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);

  if (matchIndex < 0) {
    return fallbackLine ?? '文件名命中';
  }

  const snippetStart = Math.max(0, matchIndex - 28);
  const snippetEnd = Math.min(content.length, matchIndex + keyword.length + 48);
  const prefix = snippetStart > 0 ? '…' : '';
  const suffix = snippetEnd < content.length ? '…' : '';
  return `${prefix}${content.slice(snippetStart, snippetEnd).replace(/\s+/gu, ' ').trim()}${suffix}`;
};

const collectMatchIndexes = (content: string, keyword: string): number[] => {
  if (!keyword) {
    return [];
  }

  const normalizedContent = content.toLocaleLowerCase();
  const indexes: number[] = [];
  let startIndex = 0;

  while (startIndex <= normalizedContent.length - keyword.length) {
    const nextIndex = normalizedContent.indexOf(keyword, startIndex);
    if (nextIndex < 0) {
      break;
    }

    indexes.push(nextIndex);
    startIndex = nextIndex + keyword.length;
  }

  return indexes;
};

const getLineAndColumn = (content: string, matchIndex: number): { columnNumber: number; lineNumber: number } => {
  const prefix = content.slice(0, matchIndex);
  const lines = prefix.split(/\r?\n/u);
  const lineNumber = lines.length;
  const columnNumber = (lines.at(-1)?.length ?? 0) + 1;

  return { columnNumber, lineNumber };
};

const compareEntries = (left: Dirent, right: Dirent): number => {
  if (left.isDirectory() !== right.isDirectory()) {
    return left.isDirectory() ? -1 : 1;
  }
  return left.name.localeCompare(right.name, 'zh-CN');
};

const searchWorkspace = async (
  rootPath: string,
  targetPath: string,
  keyword: string,
  results: WorkspaceSearchResult[]
): Promise<void> => {
  if (results.length >= maxSearchResults) {
    return;
  }

  const entries = (await fs.readdir(targetPath, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith('.') && isVisibleEntry(entry))
    .sort(compareEntries);

  for (const entry of entries) {
    if (results.length >= maxSearchResults) {
      return;
    }

    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      await searchWorkspace(rootPath, fullPath, keyword, results);
      continue;
    }

    const fileName = entry.name;
    const fileNameMatch = fileName.toLocaleLowerCase().includes(keyword);
    const canSearchContent = isTextSearchableFile(fullPath);
    if (!canSearchContent) {
      if (!fileNameMatch) {
        continue;
      }

      results.push({
        columnNumber: null,
        fileName,
        filePath: fullPath,
        lineNumber: null,
        matchType: 'fileName',
        occurrenceIndex: 0,
        preview: '附件文件',
        relativePath: path.relative(rootPath, fullPath) || fileName,
        resultId: `${fullPath}#file`
      });
      continue;
    }

    const content = await fs.readFile(fullPath, 'utf8');
    const matchIndexes = collectMatchIndexes(content, keyword);
    const contentMatch = matchIndexes.length > 0;

    if (!fileNameMatch && !contentMatch) {
      continue;
    }

    const relativePath = path.relative(rootPath, fullPath) || fileName;

    if (matchIndexes.length === 0 && fileNameMatch) {
      results.push({
        columnNumber: null,
        fileName,
        filePath: fullPath,
        lineNumber: null,
        matchType: 'fileName',
        occurrenceIndex: 0,
        preview: buildSearchPreview(content, keyword, -1),
        relativePath,
        resultId: `${fullPath}#file`
      });
      continue;
    }

    matchIndexes.forEach((matchIndex, occurrenceIndex) => {
      if (results.length >= maxSearchResults) {
        return;
      }

      const { columnNumber, lineNumber } = getLineAndColumn(content, matchIndex);
      results.push({
        columnNumber,
        fileName,
        filePath: fullPath,
        lineNumber,
        matchType: fileNameMatch && occurrenceIndex === 0 ? 'both' : 'content',
        occurrenceIndex,
        preview: buildSearchPreview(content, keyword, matchIndex),
        relativePath,
        resultId: `${fullPath}#${occurrenceIndex}`
      });
    });
  }
};

export const registerWorkspaceIpc = (ipcMain: IpcMain): void => {
  ipcMain.handle('workspace:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return getWorkspaceSnapshot(result.filePaths[0]);
  });

  ipcMain.handle('workspace:refresh', async (_event, rootPath: string) => getWorkspaceSnapshot(rootPath));

  ipcMain.handle('workspace:search', async (_event, rootPath: string, query: string): Promise<WorkspaceSearchResult[]> => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) {
      return [];
    }

    const results: WorkspaceSearchResult[] = [];
    await searchWorkspace(rootPath, rootPath, keyword, results);
    return results;
  });

  ipcMain.handle('file:read', async (_event, filePath: string) => {
    return fs.readFile(filePath, 'utf8');
  });

  ipcMain.handle('file:save', async (_event, filePath: string, content: string) => {
    await fs.writeFile(filePath, content, 'utf8');
    return {
      savedAt: Date.now()
    };
  });

  ipcMain.handle(
    'file:importAttachment',
    async (
      _event,
      _rootPath: string,
      currentFilePath: string,
      kind: ImportAttachmentKind = 'auto'
    ): Promise<ImportAttachmentPayload | null> => {
      const filters =
        kind === 'image'
          ? [
              {
                extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'],
                name: '图片文件'
              }
            ]
          : kind === 'file'
            ? [
                {
                  extensions: ['pdf', 'txt', 'json', 'zip', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', '*'],
                  name: '附件文件'
                }
              ]
            : [
                {
                  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'pdf', 'txt', 'json', '*'],
                  name: '支持的附件'
                }
              ];

      const result = await dialog.showOpenDialog({
        filters,
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      return saveImportedAttachment(currentFilePath, {
        sourcePath: result.filePaths[0]
      });
    }
  );

  ipcMain.handle('file:importAttachmentData', async (_event, payload: ImportAttachmentDataPayload) => {
    return saveImportedAttachment(payload.currentFilePath, {
      content: payload.content,
      fileName: payload.fileName,
      mimeType: payload.mimeType
    });
  });

  ipcMain.handle('file:openInSystem', async (_event, targetPath: string) => {
    const errorMessage = await shell.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });

  ipcMain.handle('file:createNote', async (_event, rootPath: string) => {
    const filePath = await createUniqueNotePath(rootPath);
    await fs.writeFile(filePath, '', 'utf8');

    return {
      filePath,
      snapshot: await getWorkspaceSnapshot(rootPath)
    };
  });

  ipcMain.handle('file:createFolder', async (_event, rootPath: string, folderName: string): Promise<FileOperationPayload> => {
    const targetPath = await createUniqueFolderPath(rootPath, folderName);
    await fs.mkdir(targetPath, { recursive: true });

    return {
      snapshot: await getWorkspaceSnapshot(rootPath),
      targetPath
    };
  });

  ipcMain.handle(
    'file:rename',
    async (_event, rootPath: string, oldPath: string, newName: string): Promise<FileOperationPayload> => {
      const stat = await fs.stat(oldPath);
      const targetPath = path.join(path.dirname(oldPath), newName);
      await fs.rename(oldPath, targetPath);
      let syncWarning: string | undefined;

      try {
        await syncRemoteRenameForLocalChange(rootPath, oldPath, targetPath, stat.isDirectory());
      } catch (error) {
        syncWarning = error instanceof Error ? error.message : 'WebDAV 重命名同步失败';
      }

      return {
        snapshot: await getWorkspaceSnapshot(rootPath),
        syncWarning,
        targetPath
      };
    }
  );

  ipcMain.handle('file:delete', async (_event, rootPath: string, targetPath: string): Promise<DeleteOperationPayload> => {
    const stat = await fs.stat(targetPath);
    await fs.rm(targetPath, { force: true, recursive: true });
    let syncWarning: string | undefined;

    try {
      await syncRemoteDeleteForLocalChange(rootPath, targetPath, stat.isDirectory());
    } catch (error) {
      syncWarning = error instanceof Error ? error.message : 'WebDAV 删除同步失败';
    }

    return {
      snapshot: await getWorkspaceSnapshot(rootPath),
      syncWarning
    };
  });
};
