import React, { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

type TerminalDrawerProps = {
  open: boolean;
  targetCwd: string | null;
};

type SessionState = {
  cwd: string;
  mode: 'fallback' | 'pty';
  sessionId: string;
  shell: string;
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.message.includes('EPERM')) {
      return '当前环境限制了 PTY 管道创建，node-pty 无法启动。';
    }

    return error.message;
  }

  return '终端初始化失败。';
};

const TerminalDrawer = ({ open, targetCwd }: TerminalDrawerProps): React.JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<SessionState | null>(null);
  const openRef = useRef<boolean>(open);
  const bootingRef = useRef<boolean>(false);
  const targetCwdRef = useRef<string | null>(targetCwd);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const closeSessionRef = useRef<() => Promise<void>>(async () => {});
  const fitFrameRef = useRef<number | null>(null);
  const lastMeasuredSizeRef = useRef<{ height: number; width: number } | null>(null);
  const autoBootedRef = useRef<boolean>(false);
  const [shellLabel, setShellLabel] = useState<string>('PowerShell');
  const [cwdLabel, setCwdLabel] = useState<string>(targetCwd ?? '未设置目录');
  const [booting, setBooting] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'warning' } | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    bootingRef.current = booting;
  }, [booting]);

  useEffect(() => {
    targetCwdRef.current = targetCwd;
    if (!sessionRef.current) {
      setCwdLabel(targetCwd ?? '未设置目录');
    }
  }, [targetCwd]);

  const fitTerminal = (): void => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const session = sessionRef.current;
    const host = hostRef.current;
    if (!terminal || !fitAddon || !host || !openRef.current) {
      return;
    }

    if (host.clientWidth <= 0 || host.clientHeight <= 0) {
      return;
    }

    fitAddon.fit();
    if (session) {
      void window.linkNotes.resizeTerminalSession(session.sessionId, terminal.cols, terminal.rows);
    }
  };

  const scheduleFitTerminal = (): void => {
    const host = hostRef.current;
    if (!host || !openRef.current) {
      return;
    }

    const nextSize = {
      width: host.clientWidth,
      height: host.clientHeight
    };

    if (nextSize.width <= 0 || nextSize.height <= 0) {
      return;
    }

    const lastSize = lastMeasuredSizeRef.current;
    if (lastSize && lastSize.width === nextSize.width && lastSize.height === nextSize.height && fitFrameRef.current !== null) {
      return;
    }

    lastMeasuredSizeRef.current = nextSize;
    if (fitFrameRef.current !== null) {
      window.cancelAnimationFrame(fitFrameRef.current);
    }

    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null;
      fitTerminal();
    });
  };

  const closeSession = async (): Promise<void> => {
    if (!sessionRef.current) {
      return;
    }

    const currentSessionId = sessionRef.current.sessionId;
    sessionRef.current = null;
    try {
      await window.linkNotes.closeTerminalSession(currentSessionId);
    } catch (error) {
      console.error('关闭终端会话失败', error);
    }
  };
  closeSessionRef.current = closeSession;

  const bootSession = async (initialCwd?: string | null, silent = false): Promise<void> => {
    const terminal = terminalRef.current;
    if (!terminal || !openRef.current) {
      return;
    }

    setBooting(true);
    bootingRef.current = true;
    setNotice(null);
    try {
      fitTerminal();
      await closeSession();
      const session = await window.linkNotes.createTerminalSession(initialCwd, terminal.cols, terminal.rows);
      sessionRef.current = {
        cwd: session.cwd,
        mode: session.mode,
        sessionId: session.sessionId,
        shell: session.shell
      };
      setShellLabel(session.mode === 'fallback' ? `${session.shell} · 兼容模式` : session.shell);
      setCwdLabel(session.cwd);
      setNotice(session.warning ? { message: session.warning, tone: 'warning' } : null);

      if (!silent) {
        if (session.mode === 'pty') {
          terminal.writeln(`\x1b[36mLinkNotes PTY 终端已连接\x1b[0m`);
          terminal.writeln(`Shell: ${session.shell}`);
          terminal.writeln(`启动目录: ${session.cwd}`);
          terminal.writeln('');
        }
      }
    } catch (error) {
      console.error('创建终端会话失败', error);
      const message = getErrorMessage(error);
      setNotice({ message, tone: 'error' });
      terminal.writeln(`\x1b[31m${message}\x1b[0m`);
      terminal.writeln('\x1b[33m你可以保留当前编辑/预览使用，终端需在非受限环境下再启用。\x1b[0m');
    } finally {
      setBooting(false);
      bootingRef.current = false;
    }
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || terminalRef.current) {
      return;
    }

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 13,
      rows: 12,
      theme: {
        background: '#0f1723',
        foreground: '#e5edf8',
        cursor: '#f8fafc',
        black: '#0b1220',
        brightBlack: '#475569',
        brightBlue: '#7dd3fc',
        brightCyan: '#67e8f9',
        brightGreen: '#86efac',
        brightMagenta: '#f9a8d4',
        brightRed: '#fca5a5',
        brightWhite: '#f8fafc',
        brightYellow: '#fde68a',
        blue: '#60a5fa',
        cyan: '#22d3ee',
        green: '#4ade80',
        magenta: '#f472b6',
        red: '#f87171',
        white: '#e2e8f0',
        yellow: '#facc15'
      }
    });

    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const unsubscribeData = window.linkNotes.onTerminalData(({ sessionId, data }) => {
      if (sessionRef.current?.sessionId !== sessionId) {
        return;
      }

      terminal.write(data);
    });

    const unsubscribeExit = window.linkNotes.onTerminalExit(({ sessionId, exitCode, signal }) => {
      if (sessionRef.current?.sessionId !== sessionId) {
        return;
      }

      sessionRef.current = null;
      terminal.writeln('');
      terminal.writeln(`\x1b[33m终端已退出，退出码 ${exitCode}${typeof signal === 'number' ? `，信号 ${signal}` : ''}\x1b[0m`);
    });

    const disposable = terminal.onData((data) => {
      const session = sessionRef.current;
      if (!session || bootingRef.current) {
        return;
      }

      void window.linkNotes.writeTerminalInput(session.sessionId, data);
    });

    const resizeObserver = new ResizeObserver(() => {
      scheduleFitTerminal();
    });
    resizeObserver.observe(host);
    resizeObserverRef.current = resizeObserver;

    if (openRef.current) {
      window.requestAnimationFrame(() => {
        scheduleFitTerminal();
        autoBootedRef.current = true;
        void bootSession(targetCwdRef.current);
        terminal.focus();
      });
    }

    return () => {
      unsubscribeData();
      unsubscribeExit();
      disposable.dispose();
      resizeObserver.disconnect();
      resizeObserverRef.current = null;
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      void closeSessionRef.current();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    window.requestAnimationFrame(() => {
      scheduleFitTerminal();
      if (!sessionRef.current && terminalRef.current && !autoBootedRef.current) {
        autoBootedRef.current = true;
        void bootSession(targetCwdRef.current, true);
      }
      terminalRef.current?.focus();
    });
  }, [open, targetCwd]);

  return (
    <section className={`terminal-drawer ${open ? 'terminal-drawer--open' : ''}`}>
      <div className="terminal-drawer__header">
        <div className="terminal-drawer__meta">
          <span>终端</span>
          <span>{shellLabel}</span>
          <span className="terminal-drawer__cwd">启动目录: {cwdLabel}</span>
        </div>
        <div className="terminal-drawer__actions">
          <button
            className="panel__action"
            disabled={booting}
            onClick={() => {
              terminalRef.current?.clear();
            }}
            type="button"
          >
            清屏
          </button>
          <button
            className="panel__action"
            disabled={booting}
            onClick={() => {
              autoBootedRef.current = true;
              void bootSession(targetCwdRef.current ?? sessionRef.current?.cwd ?? null);
            }}
            type="button"
          >
            重置
          </button>
        </div>
      </div>
      <div className="terminal-drawer__body">
        {notice ? (
          <div
            className={`terminal-drawer__notice ${
              notice.tone === 'warning' ? 'terminal-drawer__notice--warning' : 'terminal-drawer__notice--error'
            }`}
          >
            {notice.message}
          </div>
        ) : null}
        <div className="terminal-drawer__host" ref={hostRef} />
      </div>
    </section>
  );
};

export default TerminalDrawer;
