import { app, type IpcMain } from 'electron';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

export type AppearanceSettings = {
  editorBackground: string;
  editorForeground: string;
  previewBackground: string;
  previewForeground: string;
};

export type BehaviorSettings = {
  syncScroll: boolean;
};

export type WebDavSettings = {
  allowInsecureTls: boolean;
  autoSyncOnSave: boolean;
  enabled: boolean;
  password: string;
  remotePath: string;
  serverUrl: string;
  username: string;
};

export type WebDavTestResult = {
  message: string;
  ok: boolean;
  status?: number;
};

const defaultAppearanceSettings: AppearanceSettings = {
  editorBackground: '#2b303b',
  editorForeground: '#dbe3f1',
  previewBackground: '#fcfdfe',
  previewForeground: '#1f2937'
};

const defaultBehaviorSettings: BehaviorSettings = {
  syncScroll: true
};

const defaultWebDavSettings: WebDavSettings = {
  allowInsecureTls: false,
  autoSyncOnSave: false,
  enabled: false,
  password: '',
  remotePath: '/LinkNotes',
  serverUrl: '',
  username: ''
};

type SettingsFilePayload = {
  appearance?: AppearanceSettings;
  behavior?: BehaviorSettings;
  webdav?: WebDavSettings;
};

const getSettingsPath = (): string => path.join(app.getPath('userData'), 'settings.json');

const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isString = (value: unknown): value is string => typeof value === 'string';

const normalizeAppearanceSettings = (input: unknown): AppearanceSettings => {
  const candidate = (input ?? {}) as Partial<AppearanceSettings>;

  return {
    editorBackground: isHexColor(candidate.editorBackground)
      ? candidate.editorBackground
      : defaultAppearanceSettings.editorBackground,
    editorForeground: isHexColor(candidate.editorForeground)
      ? candidate.editorForeground
      : defaultAppearanceSettings.editorForeground,
    previewBackground: isHexColor(candidate.previewBackground)
      ? candidate.previewBackground
      : defaultAppearanceSettings.previewBackground,
    previewForeground: isHexColor(candidate.previewForeground)
      ? candidate.previewForeground
      : defaultAppearanceSettings.previewForeground
  };
};

const normalizeBehaviorSettings = (input: unknown): BehaviorSettings => {
  const candidate = (input ?? {}) as Partial<BehaviorSettings>;

  return {
    syncScroll: isBoolean(candidate.syncScroll) ? candidate.syncScroll : defaultBehaviorSettings.syncScroll
  };
};

export const normalizeWebDavSettings = (input: unknown): WebDavSettings => {
  const candidate = (input ?? {}) as Partial<WebDavSettings>;

  return {
    allowInsecureTls: isBoolean(candidate.allowInsecureTls)
      ? candidate.allowInsecureTls
      : defaultWebDavSettings.allowInsecureTls,
    autoSyncOnSave: isBoolean(candidate.autoSyncOnSave)
      ? candidate.autoSyncOnSave
      : defaultWebDavSettings.autoSyncOnSave,
    enabled: isBoolean(candidate.enabled) ? candidate.enabled : defaultWebDavSettings.enabled,
    password: isString(candidate.password) ? candidate.password : defaultWebDavSettings.password,
    remotePath: isString(candidate.remotePath) ? candidate.remotePath.trim() : defaultWebDavSettings.remotePath,
    serverUrl: isString(candidate.serverUrl) ? candidate.serverUrl.trim() : defaultWebDavSettings.serverUrl,
    username: isString(candidate.username) ? candidate.username.trim() : defaultWebDavSettings.username
  };
};

const loadSettingsPayload = async (): Promise<SettingsFilePayload> => {
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf8');
    return JSON.parse(raw) as SettingsFilePayload;
  } catch {
    return {};
  }
};

const saveSettingsPayload = async (payload: SettingsFilePayload): Promise<void> => {
  const targetPath = getSettingsPath();
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
};

const loadAppearanceSettings = async (): Promise<AppearanceSettings> => {
  const payload = await loadSettingsPayload();
  return normalizeAppearanceSettings(payload.appearance);
};

const saveAppearanceSettings = async (appearance: AppearanceSettings): Promise<AppearanceSettings> => {
  const current = await loadSettingsPayload();
  const normalized = normalizeAppearanceSettings(appearance);
  await saveSettingsPayload({
    appearance: normalized,
    behavior: normalizeBehaviorSettings(current.behavior),
    webdav: normalizeWebDavSettings(current.webdav)
  });
  return normalized;
};

const loadBehaviorSettings = async (): Promise<BehaviorSettings> => {
  const payload = await loadSettingsPayload();
  return normalizeBehaviorSettings(payload.behavior);
};

const saveBehaviorSettings = async (behavior: BehaviorSettings): Promise<BehaviorSettings> => {
  const current = await loadSettingsPayload();
  const normalized = normalizeBehaviorSettings(behavior);
  await saveSettingsPayload({
    appearance: normalizeAppearanceSettings(current.appearance),
    behavior: normalized,
    webdav: normalizeWebDavSettings(current.webdav)
  });
  return normalized;
};

export const loadWebDavSettings = async (): Promise<WebDavSettings> => {
  const payload = await loadSettingsPayload();
  return normalizeWebDavSettings(payload.webdav);
};

const saveWebDavSettings = async (webdav: WebDavSettings): Promise<WebDavSettings> => {
  const current = await loadSettingsPayload();
  const normalized = normalizeWebDavSettings(webdav);
  await saveSettingsPayload({
    appearance: normalizeAppearanceSettings(current.appearance),
    behavior: normalizeBehaviorSettings(current.behavior),
    webdav: normalized
  });
  return normalized;
};

export const buildWebDavUrl = (settings: WebDavSettings): URL => {
  if (!settings.serverUrl) {
    throw new Error('请先填写 WebDAV 地址');
  }

  const url = new URL(settings.serverUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('WebDAV 地址必须以 http:// 或 https:// 开头');
  }

  const basePath = url.pathname.replace(/\/+$/u, '');
  const remoteSegments = settings.remotePath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment));

  const nextPath = `${basePath}${remoteSegments.length > 0 ? `/${remoteSegments.join('/')}` : ''}` || '/';
  url.pathname = nextPath === '/' ? nextPath : `${nextPath.replace(/\/+$/u, '')}/`;
  return url;
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

type WebDavHttpResponse = {
  body: string;
  headers: http.IncomingHttpHeaders;
  statusCode: number;
  statusMessage: string;
};

const performWebDavRequest = (
  url: URL,
  settings: WebDavSettings,
  method: 'OPTIONS' | 'PROPFIND',
  body?: string,
  redirectCount = 0
): Promise<WebDavHttpResponse> =>
  new Promise((resolve, reject) => {
    const headers = { ...createWebDavHeaders(settings) };
    if (method === 'PROPFIND') {
      headers.Depth = '0';
      headers['Content-Type'] = 'application/xml; charset=utf-8';
    }
    if (body) {
      headers['Content-Length'] = String(Buffer.byteLength(body));
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
          if (
            redirectLocation &&
            [301, 302, 307, 308].includes(statusCode) &&
            redirectCount < 4
          ) {
            try {
              const nextUrl = new URL(redirectLocation, url);
              void performWebDavRequest(nextUrl, settings, method, body, redirectCount + 1)
                .then(resolve)
                .catch(reject);
              return;
            } catch (error) {
              reject(error);
              return;
            }
          }

          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
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

    if (body) {
      request.write(body);
    }

    request.end();
  });

const testWebDavSettings = async (input: WebDavSettings): Promise<WebDavTestResult> => {
  const settings = normalizeWebDavSettings(input);

  try {
    const targetUrl = buildWebDavUrl(settings);
    const probeMethods: Array<{ body?: string; method: 'OPTIONS' | 'PROPFIND' }> = [
      {
        body: `<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>`,
        method: 'PROPFIND'
      },
      {
        method: 'OPTIONS'
      }
    ];

    let lastStatus: number | undefined;

    for (const probe of probeMethods) {
      const response = await performWebDavRequest(targetUrl, settings, probe.method, probe.body);
      lastStatus = response.statusCode;

      if (response.statusCode >= 200 && response.statusCode < 300) {
        return {
          message: `连接成功，服务器返回 ${response.statusCode} ${response.statusMessage}`.trim(),
          ok: true,
          status: response.statusCode
        };
      }

      if (response.statusCode === 401 || response.statusCode === 403) {
        return {
          message: '连接失败，账号或密码被服务器拒绝',
          ok: false,
          status: response.statusCode
        };
      }

      if (response.statusCode === 404) {
        return {
          message: '连接失败，远程目录不存在或地址不正确',
          ok: false,
          status: response.statusCode
        };
      }

      if (response.statusCode === 405 || response.statusCode === 501) {
        continue;
      }
    }

    return {
      message: `连接失败，服务器返回 ${lastStatus ?? '未知状态'}`,
      ok: false,
      status: lastStatus
    };
  } catch (error) {
    if (error instanceof Error && /self[- ]signed|DEPTH_ZERO_SELF_SIGNED_CERT|certificate/i.test(error.message)) {
      return {
        message: '连接失败：服务器使用自签名证书，请开启“忽略 HTTPS 证书校验”后重试',
        ok: false
      };
    }

    return {
      message: error instanceof Error ? `连接失败：${error.message}` : '连接失败：未知错误',
      ok: false
    };
  }
};

export const registerSettingsIpc = (ipcMain: IpcMain): void => {
  ipcMain.handle('settings:getAppearance', async () => loadAppearanceSettings());
  ipcMain.handle('settings:saveAppearance', async (_event, appearance: AppearanceSettings) => {
    return saveAppearanceSettings(appearance);
  });
  ipcMain.handle('settings:getBehavior', async () => loadBehaviorSettings());
  ipcMain.handle('settings:saveBehavior', async (_event, behavior: BehaviorSettings) => {
    return saveBehaviorSettings(behavior);
  });
  ipcMain.handle('settings:getWebDav', async () => loadWebDavSettings());
  ipcMain.handle('settings:saveWebDav', async (_event, webdav: WebDavSettings) => {
    return saveWebDavSettings(webdav);
  });
  ipcMain.handle('settings:testWebDav', async (_event, webdav: WebDavSettings) => {
    return testWebDavSettings(webdav);
  });
};

export { defaultAppearanceSettings, defaultBehaviorSettings, defaultWebDavSettings };
