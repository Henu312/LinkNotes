import { app } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { buildWebDavUrl, loadWebDavSettings, type WebDavSettings } from './ipc/settings';

type SyncStateEntry = {
  localHash: string;
  remoteHash: string;
  syncedAt: number;
};

type SyncStateFile = {
  workspaces: Record<string, Record<string, SyncStateEntry>>;
};

type RemoteEntry = {
  href: string;
  isDirectory: boolean;
  relativePath: string;
};

type WebDavRequestResult = {
  body: Buffer;
  headers: http.IncomingHttpHeaders;
  statusCode: number;
  statusMessage: string;
};

export type WebDavSyncSummary = {
  conflicts: string[];
  downloaded: number;
  message: string;
  skipped: number;
  uploaded: number;
};

const syncStatePath = (): string => path.join(app.getPath('userData'), 'webdav-sync-state.json');
const syncableExtensions = new Set([
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

const normalizeWorkspaceKey = (rootPath: string): string => path.resolve(rootPath).replaceAll('\\', '/').toLocaleLowerCase();
const normalizeRelativePath = (relativePath: string): string => relativePath.replaceAll('\\', '/');
const hashContent = (content: Buffer | string): string => createHash('sha1').update(content).digest('hex');
const getSyncFileContentType = (relativePath: string): string => {
  const extension = path.extname(relativePath).toLocaleLowerCase();

  switch (extension) {
    case '.md':
    case '.markdown':
    case '.mdown':
      return 'text/markdown; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.bmp':
      return 'image/bmp';
    case '.ico':
      return 'image/x-icon';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
};

const createWebDavHeaders = (settings: WebDavSettings): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': 'LinkNotes'
  };

  if (settings.username || settings.password) {
    headers.Authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`).toString('base64')}`;
  }

  return headers;
};

const performWebDavRequest = (
  url: URL,
  settings: WebDavSettings,
  method: 'DELETE' | 'GET' | 'HEAD' | 'MKCOL' | 'MOVE' | 'OPTIONS' | 'PROPFIND' | 'PUT',
  options?: {
    body?: Buffer | string;
    headers?: Record<string, string>;
    redirectCount?: number;
  }
): Promise<WebDavRequestResult> =>
  new Promise((resolve, reject) => {
    const headers = {
      ...createWebDavHeaders(settings),
      ...(options?.headers ?? {})
    };
    const requestBody = options?.body;
    if (requestBody !== undefined) {
      headers['Content-Length'] = String(Buffer.byteLength(requestBody));
    }

    const isHttps = url.protocol === 'https:';
    const requestFactory = isHttps ? https.request : http.request;
    const request = requestFactory(
      {
        headers,
        host: url.hostname,
        method,
        path: `${url.pathname}${url.search}`,
        port: url.port ? Number(url.port) : isHttps ? 443 : 80,
        protocol: url.protocol,
        rejectUnauthorized: isHttps ? !settings.allowInsecureTls : undefined
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const statusCode = response.statusCode ?? 0;
          const redirectLocation = response.headers.location;
          const redirectCount = options?.redirectCount ?? 0;
          if (redirectLocation && [301, 302, 307, 308].includes(statusCode) && redirectCount < 4) {
            try {
              const nextUrl = new URL(redirectLocation, url);
              void performWebDavRequest(nextUrl, settings, method, {
                ...options,
                redirectCount: redirectCount + 1
              })
                .then(resolve)
                .catch(reject);
              return;
            } catch (error) {
              reject(error);
              return;
            }
          }

          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            statusCode,
            statusMessage: response.statusMessage ?? ''
          });
        });
      }
    );

    request.on('error', (error) => {
      reject(error);
    });

    if (requestBody !== undefined) {
      request.write(requestBody);
    }

    request.end();
  });

const loadSyncState = async (): Promise<SyncStateFile> => {
  try {
    const raw = await fs.readFile(syncStatePath(), 'utf8');
    return JSON.parse(raw) as SyncStateFile;
  } catch {
    return { workspaces: {} };
  }
};

const saveSyncState = async (state: SyncStateFile): Promise<void> => {
  const targetPath = syncStatePath();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(state, null, 2), 'utf8');
};

const getWorkspaceState = (state: SyncStateFile, rootPath: string): Record<string, SyncStateEntry> => {
  const workspaceKey = normalizeWorkspaceKey(rootPath);
  state.workspaces[workspaceKey] ??= {};
  return state.workspaces[workspaceKey];
};

const collectLocalSyncableFiles = async (
  rootPath: string,
  currentPath = rootPath
): Promise<Array<{ absolutePath: string; relativePath: string }>> => {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  const results: Array<{ absolutePath: string; relativePath: string }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectLocalSyncableFiles(rootPath, absolutePath)));
      continue;
    }

    if (!syncableExtensions.has(path.extname(entry.name).toLocaleLowerCase())) {
      continue;
    }

    results.push({
      absolutePath,
      relativePath: normalizeRelativePath(path.relative(rootPath, absolutePath))
    });
  }

  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
};

const buildResourceUrl = (rootUrl: URL, relativePath = '', trailingSlash = false): URL => {
  const targetUrl = new URL(rootUrl.toString());
  const normalizedRelativePath = normalizeRelativePath(relativePath)
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const basePath = targetUrl.pathname.replace(/\/+$/u, '');
  const combinedPath = normalizedRelativePath ? `${basePath}/${normalizedRelativePath}` : basePath || '/';
  targetUrl.pathname =
    combinedPath === '/'
      ? combinedPath
      : trailingSlash
        ? `${combinedPath.replace(/\/+$/u, '')}/`
        : combinedPath.replace(/\/+$/u, '');

  return targetUrl;
};

const decodeHtmlEntities = (value: string): string =>
  value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");

const parsePropfindEntries = (xml: string, directoryUrl: URL, rootUrl: URL): RemoteEntry[] => {
  const responsePattern = /<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/giu;
  const hrefPattern = /<(?:[\w-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?href>/iu;
  const collectionPattern = /<(?:[\w-]+:)?collection\s*\/>/iu;
  const rootPathname = buildResourceUrl(rootUrl, '', true).pathname;
  const entries: RemoteEntry[] = [];

  let match: RegExpExecArray | null;
  while ((match = responsePattern.exec(xml)) !== null) {
    const block = match[1];
    const hrefMatch = block.match(hrefPattern);
    if (!hrefMatch) {
      continue;
    }

    const href = decodeHtmlEntities(hrefMatch[1]).trim();
    const targetUrl = new URL(href, directoryUrl);
    const pathname = decodeURIComponent(targetUrl.pathname);
    if (!pathname.startsWith(rootPathname)) {
      continue;
    }

    const relativePath = pathname.slice(rootPathname.length).replace(/^\/+/u, '').replace(/\/+$/u, '');
    const isDirectory = collectionPattern.test(block);

    if (!relativePath) {
      continue;
    }

    entries.push({
      href: targetUrl.toString(),
      isDirectory,
      relativePath: normalizeRelativePath(relativePath)
    });
  }

  return entries;
};

const listRemoteSyncableFiles = async (settings: WebDavSettings, rootUrl: URL): Promise<RemoteEntry[]> => {
  const queue: string[] = [''];
  const visitedDirectories = new Set<string>();
  const remoteFiles: RemoteEntry[] = [];
  const propfindBody =
    '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>';

  while (queue.length > 0) {
    const relativeDirectory = queue.shift() ?? '';
    if (visitedDirectories.has(relativeDirectory)) {
      continue;
    }
    visitedDirectories.add(relativeDirectory);

    const directoryUrl = buildResourceUrl(rootUrl, relativeDirectory, true);
    const response = await performWebDavRequest(directoryUrl, settings, 'PROPFIND', {
      body: propfindBody,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        Depth: '1'
      }
    });

    if (response.statusCode === 404) {
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`列出远程目录失败：${response.statusCode} ${response.statusMessage}`.trim());
    }

    const entries = parsePropfindEntries(response.body.toString('utf8'), directoryUrl, rootUrl);
    for (const entry of entries) {
      if (entry.isDirectory) {
        queue.push(entry.relativePath);
        continue;
      }

      if (!syncableExtensions.has(path.extname(entry.relativePath).toLocaleLowerCase())) {
        continue;
      }

      remoteFiles.push(entry);
    }
  }

  return remoteFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'));
};

const getRemoteFile = async (
  settings: WebDavSettings,
  rootUrl: URL,
  relativePath: string
): Promise<{ content: Buffer; exists: boolean }> => {
  const response = await performWebDavRequest(buildResourceUrl(rootUrl, relativePath, false), settings, 'GET');

  if (response.statusCode === 404) {
    return {
      content: Buffer.alloc(0),
      exists: false
    };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`读取远程文件失败：${response.statusCode} ${response.statusMessage}`.trim());
  }

  return {
    content: response.body,
    exists: true
  };
};

const ensureRemoteDirectories = async (
  settings: WebDavSettings,
  rootUrl: URL,
  localFiles: Array<{ absolutePath: string; relativePath: string }>
): Promise<void> => {
  const directories = new Set<string>();

  for (const file of localFiles) {
    const parts = file.relativePath.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      directories.add(current);
    }
  }

  const sortedDirectories = Array.from(directories).sort(
    (left, right) => left.split('/').length - right.split('/').length
  );

  for (const relativeDirectory of sortedDirectories) {
    const response = await performWebDavRequest(buildResourceUrl(rootUrl, relativeDirectory, true), settings, 'MKCOL');
    if ([200, 201, 301, 405].includes(response.statusCode)) {
      continue;
    }
    if (response.statusCode === 409) {
      throw new Error(`创建远程目录失败：${relativeDirectory}`);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`创建远程目录失败：${response.statusCode} ${response.statusMessage}`.trim());
    }
  }
};

const putRemoteFile = async (
  settings: WebDavSettings,
  rootUrl: URL,
  relativePath: string,
  content: Buffer
): Promise<void> => {
  const response = await performWebDavRequest(buildResourceUrl(rootUrl, relativePath, false), settings, 'PUT', {
    body: content,
    headers: {
      'Content-Type': getSyncFileContentType(relativePath)
    }
  });

  if (![200, 201, 204].includes(response.statusCode)) {
    throw new Error(`上传远程文件失败：${response.statusCode} ${response.statusMessage}`.trim());
  }
};

const deleteRemotePath = async (
  settings: WebDavSettings,
  rootUrl: URL,
  relativePath: string,
  isDirectory: boolean
): Promise<void> => {
  const response = await performWebDavRequest(
    buildResourceUrl(rootUrl, relativePath, isDirectory),
    settings,
    'DELETE'
  );

  if ([200, 202, 204, 404].includes(response.statusCode)) {
    return;
  }

  throw new Error(`删除远程路径失败：${response.statusCode} ${response.statusMessage}`.trim());
};

const moveRemotePath = async (
  settings: WebDavSettings,
  rootUrl: URL,
  sourceRelativePath: string,
  targetRelativePath: string,
  isDirectory: boolean
): Promise<void> => {
  const sourceUrl = buildResourceUrl(rootUrl, sourceRelativePath, isDirectory);
  const destinationUrl = buildResourceUrl(rootUrl, targetRelativePath, isDirectory);
  const response = await performWebDavRequest(sourceUrl, settings, 'MOVE', {
    headers: {
      Destination: destinationUrl.toString(),
      Overwrite: 'T'
    }
  });

  if ([201, 204, 404].includes(response.statusCode)) {
    return;
  }

  throw new Error(`重命名远程路径失败：${response.statusCode} ${response.statusMessage}`.trim());
};

const createConflictCopy = async (rootPath: string, relativePath: string, remoteContent: Buffer): Promise<string> => {
  const originalPath = path.join(rootPath, relativePath);
  const parsed = path.parse(originalPath);
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 14);
  let index = 0;

  while (true) {
    const suffix = index === 0 ? timestamp : `${timestamp}-${index}`;
    const targetPath = path.join(parsed.dir, `${parsed.name}.conflict-${suffix}${parsed.ext}`);
    try {
      await fs.access(targetPath);
      index += 1;
    } catch {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, remoteContent);
      return normalizeRelativePath(path.relative(rootPath, targetPath));
    }
  }
};

const shouldCreateConflict = (
  localHash: string,
  remoteHash: string,
  stateEntry?: SyncStateEntry
): boolean => {
  if (localHash === remoteHash) {
    return false;
  }

  if (!stateEntry) {
    return true;
  }

  const localChanged = stateEntry.localHash !== localHash;
  const remoteChanged = stateEntry.remoteHash !== remoteHash;
  return localChanged && remoteChanged;
};

const ensureEnabledSettings = async (): Promise<{ rootUrl: URL; settings: WebDavSettings }> => {
  const settings = await loadWebDavSettings();
  if (!settings.enabled) {
    throw new Error('请先在设置中启用 WebDAV 同步');
  }
  return {
    rootUrl: buildWebDavUrl(settings),
    settings
  };
};

const isSyncableLocalPath = (targetPath: string, isDirectory: boolean): boolean =>
  isDirectory || syncableExtensions.has(path.extname(targetPath).toLocaleLowerCase());

const updateStateAfterDelete = (workspaceState: Record<string, SyncStateEntry>, relativePath: string): void => {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  Object.keys(workspaceState).forEach((key) => {
    if (key === normalizedRelativePath || key.startsWith(`${normalizedRelativePath}/`)) {
      delete workspaceState[key];
    }
  });
};

const updateStateAfterRename = (
  workspaceState: Record<string, SyncStateEntry>,
  sourceRelativePath: string,
  targetRelativePath: string
): void => {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
  const normalizedTargetPath = normalizeRelativePath(targetRelativePath);
  const nextEntries: Array<[string, SyncStateEntry]> = [];

  Object.entries(workspaceState).forEach(([key, value]) => {
    if (key === normalizedSourcePath) {
      nextEntries.push([normalizedTargetPath, value]);
      delete workspaceState[key];
      return;
    }

    if (key.startsWith(`${normalizedSourcePath}/`)) {
      nextEntries.push([`${normalizedTargetPath}${key.slice(normalizedSourcePath.length)}`, value]);
      delete workspaceState[key];
    }
  });

  nextEntries.forEach(([key, value]) => {
    workspaceState[key] = value;
  });
};

export const syncWorkspacePush = async (rootPath: string): Promise<WebDavSyncSummary> => {
  const { rootUrl, settings } = await ensureEnabledSettings();
  const syncState = await loadSyncState();
  const workspaceState = getWorkspaceState(syncState, rootPath);
  const localFiles = await collectLocalSyncableFiles(rootPath);
  const conflicts: string[] = [];
  let skipped = 0;
  let uploaded = 0;

  await ensureRemoteDirectories(settings, rootUrl, localFiles);

  for (const localFile of localFiles) {
    const localContent = await fs.readFile(localFile.absolutePath);
    const localHash = hashContent(localContent);
    const stateEntry = workspaceState[localFile.relativePath];
    const remoteFile = await getRemoteFile(settings, rootUrl, localFile.relativePath);

    if (!remoteFile.exists) {
      await putRemoteFile(settings, rootUrl, localFile.relativePath, localContent);
      workspaceState[localFile.relativePath] = {
        localHash,
        remoteHash: localHash,
        syncedAt: Date.now()
      };
      uploaded += 1;
      continue;
    }

    const remoteHash = hashContent(remoteFile.content);
    if (remoteHash === localHash) {
      workspaceState[localFile.relativePath] = {
        localHash,
        remoteHash,
        syncedAt: Date.now()
      };
      skipped += 1;
      continue;
    }

    if (shouldCreateConflict(localHash, remoteHash, stateEntry)) {
      const conflictPath = await createConflictCopy(rootPath, localFile.relativePath, remoteFile.content);
      conflicts.push(conflictPath);
      skipped += 1;
      continue;
    }

    await putRemoteFile(settings, rootUrl, localFile.relativePath, localContent);
    workspaceState[localFile.relativePath] = {
      localHash,
      remoteHash: localHash,
      syncedAt: Date.now()
    };
    uploaded += 1;
  }

  await saveSyncState(syncState);

  const messageParts = [`上传完成：${uploaded} 个文件已同步`];
  if (conflicts.length > 0) {
    messageParts.push(`${conflicts.length} 个冲突已生成副本`);
  }
  if (skipped > 0) {
    messageParts.push(`${skipped} 个文件跳过`);
  }

  return {
    conflicts,
    downloaded: 0,
    message: messageParts.join('，'),
    skipped,
    uploaded
  };
};

export const syncWorkspacePull = async (rootPath: string): Promise<WebDavSyncSummary> => {
  const { rootUrl, settings } = await ensureEnabledSettings();
  const syncState = await loadSyncState();
  const workspaceState = getWorkspaceState(syncState, rootPath);
  const remoteFiles = await listRemoteSyncableFiles(settings, rootUrl);
  const conflicts: string[] = [];
  let downloaded = 0;
  let skipped = 0;

  for (const remoteFile of remoteFiles) {
    const localPath = path.join(rootPath, remoteFile.relativePath);
    const remoteContent = (await getRemoteFile(settings, rootUrl, remoteFile.relativePath)).content;
    const remoteHash = hashContent(remoteContent);
    const stateEntry = workspaceState[remoteFile.relativePath];

    let localContent: Buffer | null = null;
    try {
      localContent = await fs.readFile(localPath);
    } catch {
      localContent = null;
    }

    if (!localContent) {
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, remoteContent);
      workspaceState[remoteFile.relativePath] = {
        localHash: remoteHash,
        remoteHash,
        syncedAt: Date.now()
      };
      downloaded += 1;
      continue;
    }

    const localHash = hashContent(localContent);
    if (localHash === remoteHash) {
      workspaceState[remoteFile.relativePath] = {
        localHash,
        remoteHash,
        syncedAt: Date.now()
      };
      skipped += 1;
      continue;
    }

    if (shouldCreateConflict(localHash, remoteHash, stateEntry)) {
      const conflictPath = await createConflictCopy(rootPath, remoteFile.relativePath, remoteContent);
      conflicts.push(conflictPath);
      skipped += 1;
      continue;
    }

    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, remoteContent);
    workspaceState[remoteFile.relativePath] = {
      localHash: remoteHash,
      remoteHash,
      syncedAt: Date.now()
    };
    downloaded += 1;
  }

  await saveSyncState(syncState);

  const messageParts = [`拉取完成：${downloaded} 个文件已更新到本地`];
  if (conflicts.length > 0) {
    messageParts.push(`${conflicts.length} 个冲突已生成副本`);
  }
  if (skipped > 0) {
    messageParts.push(`${skipped} 个文件跳过`);
  }

  return {
    conflicts,
    downloaded,
    message: messageParts.join('，'),
    skipped,
    uploaded: 0
  };
};

export const syncRemoteDeleteForLocalChange = async (
  rootPath: string,
  targetPath: string,
  isDirectory: boolean
): Promise<void> => {
  if (!isSyncableLocalPath(targetPath, isDirectory)) {
    return;
  }

  const settings = await loadWebDavSettings();
  if (!settings.enabled) {
    return;
  }

  const rootUrl = buildWebDavUrl(settings);
  const relativePath = normalizeRelativePath(path.relative(rootPath, targetPath));
  await deleteRemotePath(settings, rootUrl, relativePath, isDirectory);

  const syncState = await loadSyncState();
  const workspaceState = getWorkspaceState(syncState, rootPath);
  updateStateAfterDelete(workspaceState, relativePath);
  await saveSyncState(syncState);
};

export const syncRemoteRenameForLocalChange = async (
  rootPath: string,
  sourcePath: string,
  targetPath: string,
  isDirectory: boolean
): Promise<void> => {
  if (!isSyncableLocalPath(sourcePath, isDirectory)) {
    return;
  }

  const settings = await loadWebDavSettings();
  if (!settings.enabled) {
    return;
  }

  const rootUrl = buildWebDavUrl(settings);
  const sourceRelativePath = normalizeRelativePath(path.relative(rootPath, sourcePath));
  const targetRelativePath = normalizeRelativePath(path.relative(rootPath, targetPath));

  await moveRemotePath(settings, rootUrl, sourceRelativePath, targetRelativePath, isDirectory);

  const syncState = await loadSyncState();
  const workspaceState = getWorkspaceState(syncState, rootPath);
  updateStateAfterRename(workspaceState, sourceRelativePath, targetRelativePath);
  await saveSyncState(syncState);
};
