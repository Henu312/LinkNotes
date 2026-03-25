import { type IpcMain, type WebContents } from 'electron';
import { execFile, spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { IPty } from 'node-pty';
import { safeError } from '../logger';

type TerminalMode = 'fallback' | 'pty';
type NodePtyModule = typeof import('node-pty');
type PtyCapability =
  | {
      available: false;
      reason: string;
    }
  | {
      available: true;
      useConpty: boolean;
    };

type ShellRuntime = {
  args: string[];
  command: string;
  label: string;
};

type TerminalSessionBase = {
  cwd: string;
  id: string;
  mode: TerminalMode;
  shell: string;
  webContents: WebContents;
};

type PtySession = TerminalSessionBase & {
  mode: 'pty';
  process: IPty;
};

type RunningFallbackCommand = {
  interrupted: boolean;
  process: ChildProcessWithoutNullStreams;
};

type FallbackSession = TerminalSessionBase & {
  activeCommand: RunningFallbackCommand | null;
  inputBuffer: string;
  mode: 'fallback';
  runtime: ShellRuntime;
};

type TerminalSession = FallbackSession | PtySession;

export type TerminalSessionPayload = {
  cwd: string;
  mode: TerminalMode;
  sessionId: string;
  shell: string;
  warning?: string;
};

export type TerminalDataPayload = {
  data: string;
  sessionId: string;
};

export type TerminalExitPayload = {
  exitCode: number;
  sessionId: string;
  signal?: number;
};

const shellCandidates: ShellRuntime[] = [
  { command: 'pwsh.exe', label: 'PowerShell 7', args: ['-NoLogo', '-NoProfile'] },
  { command: 'powershell.exe', label: 'Windows PowerShell', args: ['-NoLogo', '-NoProfile'] }
];

const projectRequire = createRequire(path.join(path.resolve(__dirname, '..', '..'), 'package.json'));
const sessions = new Map<string, TerminalSession>();
let nodePtyModuleCache: NodePtyModule | null = null;
let ptyCapabilityCache: PtyCapability | null = null;
let runtimeCache: ShellRuntime | null = null;
let sessionCounter = 0;

const ensureDirectory = async (targetPath?: string | null): Promise<string> => {
  const fallbackPath = process.cwd();
  if (!targetPath?.trim()) {
    return fallbackPath;
  }

  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      return path.resolve(targetPath);
    }
  } catch {
    return fallbackPath;
  }

  return fallbackPath;
};

const resolveDirectoryCandidate = async (basePath: string, targetPath?: string): Promise<string | null> => {
  if (!targetPath?.trim()) {
    const homePath = process.env.USERPROFILE ?? process.env.HOME;
    return homePath ? ensureDirectory(homePath) : basePath;
  }

  const normalizedTarget = targetPath.trim().replace(/^['"]|['"]$/g, '');
  const candidatePath = path.isAbsolute(normalizedTarget)
    ? normalizedTarget
    : path.resolve(basePath, normalizedTarget);

  try {
    const stat = await fs.stat(candidatePath);
    if (stat.isDirectory()) {
      return path.resolve(candidatePath);
    }
  } catch {
    return null;
  }

  return null;
};

const probeShell = (runtime: ShellRuntime): Promise<boolean> =>
  new Promise((resolve) => {
    execFile(
      runtime.command,
      [...runtime.args, '-Command', '$PSVersionTable.PSVersion.ToString()'],
      { windowsHide: true },
      (error) => {
        resolve(!error);
      }
    );
  });

const resolveShellRuntime = async (): Promise<ShellRuntime> => {
  if (runtimeCache) {
    return runtimeCache;
  }

  for (const candidate of shellCandidates) {
    if (await probeShell(candidate)) {
      runtimeCache = candidate;
      return candidate;
    }
  }

  runtimeCache = shellCandidates[shellCandidates.length - 1];
  return runtimeCache;
};

const loadNodePtyModule = (): NodePtyModule => {
  if (!nodePtyModuleCache) {
    nodePtyModuleCache = projectRequire('node-pty') as NodePtyModule;
  }
  return nodePtyModuleCache;
};

const probePtyCapability = async (): Promise<PtyCapability> =>
  new Promise((resolve) => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const probeScript = `
process.on('uncaughtException', (error) => {
  console.log(JSON.stringify({ available: false, reason: String(error && error.message ? error.message : error) }));
  process.exit(0);
});
const { createRequire } = require('node:module');
const path = require('node:path');
const projectRequire = createRequire(path.join(${JSON.stringify(projectRoot)}, 'package.json'));
const { spawn } = projectRequire('node-pty');
const command = process.env.COMSPEC || 'cmd.exe';
const baseOptions = {
  cols: 80,
  rows: 24,
  cwd: ${JSON.stringify(projectRoot)},
  env: { ...process.env, TERM: 'xterm-256color' },
  name: 'xterm-256color'
};
const attempt = (useConpty) =>
  new Promise((attemptResolve) => {
    let terminal;
    try {
      terminal = spawn(command, [], { ...baseOptions, useConpty });
    } catch (error) {
      attemptResolve({ ok: false, reason: String(error && error.message ? error.message : error) });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        terminal.kill();
      } catch {}
      attemptResolve(result);
    };
    terminal.onData(() => finish({ ok: true }));
    terminal.onExit(() => finish({ ok: true }));
    setTimeout(() => finish({ ok: true }), 250);
  });
(async () => {
  const conpty = await attempt(true);
  if (conpty.ok) {
    console.log(JSON.stringify({ available: true, useConpty: true }));
    return;
  }
  const winpty = await attempt(false);
  if (winpty.ok) {
    console.log(JSON.stringify({ available: true, useConpty: false }));
    return;
  }
  console.log(JSON.stringify({ available: false, reason: winpty.reason || conpty.reason || 'PTY probe failed' }));
})();
`;

    execFile(process.execPath, ['-e', probeScript], { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          available: false,
          reason: stderr.trim() || stdout.trim() || error.message
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as PtyCapability;
        resolve(parsed);
      } catch {
        resolve({
          available: false,
          reason: stdout.trim() || stderr.trim() || 'PTY probe failed'
        });
      }
    });
  });

const resolvePtyCapability = async (): Promise<PtyCapability> => {
  if (!ptyCapabilityCache) {
    ptyCapabilityCache = await probePtyCapability();
  }

  return ptyCapabilityCache;
};

const safeSend = (webContents: WebContents, channel: string, payload: TerminalDataPayload | TerminalExitPayload): void => {
  if (!webContents.isDestroyed()) {
    webContents.send(channel, payload);
  }
};

const sendTerminalData = (session: TerminalSession, data: string): void => {
  safeSend(session.webContents, 'terminal:data', {
    data,
    sessionId: session.id
  });
};

const getPromptText = (cwd: string): string => `\x1b[90m${cwd}\x1b[0m> `;

const normalizeOutput = (value: string): string => value.replace(/\r?\n/g, '\r\n');

const getFallbackWarning = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message.includes('Failed to load native module')) {
      return 'node-pty 原生模块加载失败，已自动切换到兼容终端模式。';
    }

    if (error.message.includes('EPERM')) {
      return '当前环境限制了 PTY 管道创建，已自动切换到兼容终端模式。';
    }

    return `PTY 终端启动失败，已自动切换到兼容终端模式：${error.message}`;
  }

  return 'PTY 终端启动失败，已自动切换到兼容终端模式。';
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return '终端执行失败。';
};

const isFallbackSession = (session: TerminalSession): session is FallbackSession => session.mode === 'fallback';

const emitFallbackPrompt = (session: FallbackSession): void => {
  sendTerminalData(session, getPromptText(session.cwd));
};

const disposeSession = (sessionId: string): void => {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  if (isFallbackSession(session)) {
    if (session.activeCommand) {
      session.activeCommand.process.kill();
      session.activeCommand = null;
    }
  } else {
    try {
      session.process.kill();
    } catch {
      // 进程可能已经退出，这里忽略即可。
    }
  }

  sessions.delete(sessionId);
};

const disposeSessionsForWebContents = (webContents: WebContents): void => {
  Array.from(sessions.values())
    .filter((session) => session.webContents.id === webContents.id)
    .forEach((session) => {
      disposeSession(session.id);
    });
};

const createSessionId = (): string => {
  sessionCounter += 1;
  return `terminal-${sessionCounter}`;
};

const tryHandleFallbackBuiltin = async (session: FallbackSession, commandLine: string): Promise<boolean> => {
  const trimmed = commandLine.trim();

  if (!trimmed) {
    emitFallbackPrompt(session);
    return true;
  }

  if (/^(cls|clear)$/iu.test(trimmed)) {
    sendTerminalData(session, '\x1bc');
    emitFallbackPrompt(session);
    return true;
  }

  if (/^(pwd|get-location)$/iu.test(trimmed)) {
    sendTerminalData(session, `${session.cwd}\r\n`);
    emitFallbackPrompt(session);
    return true;
  }

  const locationMatch = trimmed.match(/^(cd|chdir|set-location)(?:\s+(.+))?$/iu);
  if (!locationMatch) {
    return false;
  }

  const nextPath = await resolveDirectoryCandidate(session.cwd, locationMatch[2]);
  if (!nextPath) {
    sendTerminalData(session, `找不到路径: ${locationMatch[2] ?? ''}\r\n`);
    emitFallbackPrompt(session);
    return true;
  }

  session.cwd = nextPath;
  emitFallbackPrompt(session);
  return true;
};

const runFallbackCommand = async (session: FallbackSession, commandLine: string): Promise<void> => {
  if (await tryHandleFallbackBuiltin(session, commandLine)) {
    return;
  }

  const child = spawnChildProcess(session.runtime.command, [...session.runtime.args, '-Command', commandLine], {
    cwd: session.cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color'
    },
    windowsHide: true
  });

  const runningCommand: RunningFallbackCommand = {
    interrupted: false,
    process: child
  };

  session.activeCommand = runningCommand;
  let receivedOutput = false;
  let outputEndedWithLineBreak = false;

  const forwardChunk = (chunk: string | Buffer): void => {
    const text = chunk.toString();
    if (!text) {
      return;
    }

    receivedOutput = true;
    outputEndedWithLineBreak = /(?:\r\n|\r|\n)$/.test(text);
    sendTerminalData(session, normalizeOutput(text));
  };

  child.stdout.on('data', forwardChunk);
  child.stderr.on('data', forwardChunk);

  child.on('error', (error) => {
    if (session.activeCommand?.process !== child) {
      return;
    }

    session.activeCommand = null;
    sendTerminalData(session, `${getErrorMessage(error)}\r\n`);
    emitFallbackPrompt(session);
  });

  child.on('close', () => {
    if (session.activeCommand?.process !== child) {
      return;
    }

    const interrupted = session.activeCommand.interrupted;
    session.activeCommand = null;

    if (receivedOutput && !outputEndedWithLineBreak && !interrupted) {
      sendTerminalData(session, '\r\n');
    }

    if (interrupted) {
      emitFallbackPrompt(session);
      return;
    }

    emitFallbackPrompt(session);
  });
};

const handleFallbackInput = async (session: FallbackSession, data: string): Promise<void> => {
  const sanitizedData = data.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');

  for (const char of sanitizedData) {
    if (session.activeCommand) {
      if (char === '\u0003') {
        session.activeCommand.interrupted = true;
        session.activeCommand.process.kill();
        sendTerminalData(session, '^C\r\n');
      }
      continue;
    }

    if (char === '\r') {
      const commandLine = session.inputBuffer;
      session.inputBuffer = '';
      sendTerminalData(session, '\r\n');
      await runFallbackCommand(session, commandLine);
      continue;
    }

    if (char === '\u0003') {
      session.inputBuffer = '';
      sendTerminalData(session, '^C\r\n');
      emitFallbackPrompt(session);
      continue;
    }

    if (char === '\u007f' || char === '\b') {
      if (!session.inputBuffer) {
        continue;
      }

      session.inputBuffer = session.inputBuffer.slice(0, -1);
      sendTerminalData(session, '\b \b');
      continue;
    }
    if (char >= ' ' || char === '\t') {
      session.inputBuffer += char;
      sendTerminalData(session, char);
    }
  }
};

const createFallbackSession = async (
  webContents: WebContents,
  runtime: ShellRuntime,
  cwd: string,
  warning: string
): Promise<TerminalSessionPayload> => {
  const sessionId = createSessionId();
  const session: FallbackSession = {
    activeCommand: null,
    cwd,
    id: sessionId,
    inputBuffer: '',
    mode: 'fallback',
    runtime,
    shell: runtime.label,
    webContents
  };

  sessions.set(sessionId, session);
  sendTerminalData(session, '\x1b[36mLinkNotes 兼容终端已连接\x1b[0m\r\n');
  sendTerminalData(session, `Shell: ${runtime.label}\r\n`);
  sendTerminalData(session, `启动目录: ${cwd}\r\n`);
  sendTerminalData(session, '\x1b[33m当前模式支持常规命令执行，不支持交互式 TUI 程序。\x1b[0m\r\n\r\n');
  emitFallbackPrompt(session);

  return {
    cwd,
    mode: 'fallback',
    sessionId,
    shell: runtime.label,
    warning
  };
};

const createPtySession = async (
  webContents: WebContents,
  runtime: ShellRuntime,
  cwd: string,
  cols: number,
  rows: number,
  useConpty: boolean
): Promise<TerminalSessionPayload> => {
  const { spawn } = loadNodePtyModule();
  const sessionId = createSessionId();
  const ptyProcess = spawn(runtime.command, runtime.args, {
    cols: Math.max(40, cols),
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color'
    },
    name: 'xterm-256color',
    rows: Math.max(12, rows),
    useConpty
  });

  const session: PtySession = {
    cwd,
    id: sessionId,
    mode: 'pty',
    process: ptyProcess,
    shell: runtime.label,
    webContents
  };

  sessions.set(sessionId, session);

  ptyProcess.onData((data) => {
    sendTerminalData(session, data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    sessions.delete(sessionId);
    safeSend(webContents, 'terminal:exit', {
      exitCode,
      sessionId,
      signal
    });
  });

  return {
    cwd,
    mode: 'pty',
    sessionId,
    shell: runtime.label
  };
};

export const registerTerminalIpc = (ipcMain: IpcMain): void => {
  ipcMain.handle(
    'terminal:create',
    async (event, initialCwd?: string | null, cols = 120, rows = 24): Promise<TerminalSessionPayload> => {
      const runtime = await resolveShellRuntime();
      const cwd = await ensureDirectory(initialCwd);
      const ptyCapability = await resolvePtyCapability();

      event.sender.once('destroyed', () => {
        disposeSessionsForWebContents(event.sender);
      });

      if (!ptyCapability.available) {
        return createFallbackSession(event.sender, runtime, cwd, getFallbackWarning(new Error(ptyCapability.reason)));
      }

      try {
        return await createPtySession(event.sender, runtime, cwd, cols, rows, ptyCapability.useConpty);
      } catch (error) {
        ptyCapabilityCache = {
          available: false,
          reason: getErrorMessage(error)
        };
        safeError('terminal:create fallback', getErrorMessage(error));
        return createFallbackSession(event.sender, runtime, cwd, getFallbackWarning(error));
      }
    }
  );

  ipcMain.handle('terminal:write', async (_event, sessionId: string, data: string): Promise<void> => {
    const session = sessions.get(sessionId);
    if (!session) {
      throw new Error('终端会话不存在');
    }

    if (isFallbackSession(session)) {
      await handleFallbackInput(session, data);
      return;
    }

    session.process.write(data);
  });

  ipcMain.handle('terminal:resize', async (_event, sessionId: string, cols: number, rows: number): Promise<void> => {
    const session = sessions.get(sessionId);
    if (!session || isFallbackSession(session)) {
      return;
    }

    session.process.resize(Math.max(40, cols), Math.max(12, rows));
  });

  ipcMain.handle('terminal:close', async (_event, sessionId: string): Promise<void> => {
    disposeSession(sessionId);
  });
};
