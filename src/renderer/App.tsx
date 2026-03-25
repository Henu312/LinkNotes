import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import MarkdownIt from 'markdown-it';
import type { AppearanceSettings, BehaviorSettings, WebDavSettings, WebDavTestResult } from '../main/ipc/settings';
import FileTreePane from './components/file-tree/FileTreePane';
import EditorPane from './components/editor/EditorPane';
import PreviewPane from './components/preview/PreviewPane';
import EditorSearchBar from './components/search/EditorSearchBar';
import SearchDialog from './components/search/SearchDialog';
import Toolbar from './components/toolbar/Toolbar';
import StatusBar from './components/status-bar/StatusBar';
import TerminalDrawer from './components/terminal/TerminalDrawer';
import type { WorkspaceNode, WorkspaceSearchResult } from '../main/ipc/workspace';
import type { EditorController, EditorSearchSummary } from './components/editor/EditorPane';

const initialMarkdown = `# LinkNotes\n\n欢迎使用 LinkNotes。\n\n## 快速开始\n\n- 左侧打开工作区\n- 中间编辑 Markdown\n- 右侧查看实时预览\n- 底部预留终端面板\n\n## 快捷命令\n\n- /h1\n- /h2\n- /h3\n- /dmk\n- /todo\n- /quote\n`;

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

const topMenus = ['File', 'Edit', 'View', 'Window', 'Help'];
const windowControls = ['minimize', 'maximize', 'close'] as const;
type TopMenu = (typeof topMenus)[number];
type MenuItem = {
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void | Promise<void>;
  shortcut?: string;
};

const getFileName = (targetPath: string | null): string =>
  targetPath ? targetPath.split(/[\\/]/).pop() ?? '未命名笔记.md' : '未打开文件';

const getExportTitle = (targetPath: string | null): string => {
  const fileName = getFileName(targetPath);
  return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const ensureMarkdownName = (fileName: string): string => (fileName.endsWith('.md') ? fileName : `${fileName}.md`);
const isMarkdownFile = (targetPath: string): boolean => targetPath.toLowerCase().endsWith('.md');
const imageFileExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const textPreviewExtensions = new Set(['.txt', '.json']);
const normalizePath = (targetPath: string): string => targetPath.replaceAll('\\', '/');
const getDirectoryPath = (targetPath: string): string => targetPath.replace(/[\\/][^\\/]+$/, '');
const splitPathSegments = (targetPath: string): string[] => normalizePath(targetPath).split('/').filter(Boolean);
const ensureRelativeMarkdownPath = (targetPath: string): string =>
  targetPath.startsWith('./') || targetPath.startsWith('../') ? targetPath : `./${targetPath}`;
const getRelativePathBetween = (fromFilePath: string, targetPath: string): string => {
  const fromParts = splitPathSegments(getDirectoryPath(fromFilePath));
  const targetParts = splitPathSegments(targetPath);

  if (
    fromParts.length > 0 &&
    targetParts.length > 0 &&
    /^[a-z]:$/iu.test(fromParts[0]) &&
    /^[a-z]:$/iu.test(targetParts[0]) &&
    fromParts[0].toLocaleLowerCase() !== targetParts[0].toLocaleLowerCase()
  ) {
    return normalizePath(targetPath);
  }

  let sharedIndex = 0;
  while (
    sharedIndex < fromParts.length &&
    sharedIndex < targetParts.length &&
    fromParts[sharedIndex].toLocaleLowerCase() === targetParts[sharedIndex].toLocaleLowerCase()
  ) {
    sharedIndex += 1;
  }

  const parentSegments = new Array(fromParts.length - sharedIndex).fill('..');
  const targetSegments = targetParts.slice(sharedIndex);
  const relativePath = [...parentSegments, ...targetSegments].join('/');
  return relativePath || '.';
};
const getMarkdownReferenceText = (currentFilePath: string, targetPath: string): string => {
  const fileName = getFileName(targetPath);
  const baseName = fileName.replace(/\.[^./\\]+$/u, '');
  const relativePath = ensureRelativeMarkdownPath(getRelativePathBetween(currentFilePath, targetPath));
  const extensionMatch = targetPath.match(/(\.[^./\\]+)$/u);
  const extension = extensionMatch ? extensionMatch[1].toLocaleLowerCase() : '';
  return imageFileExtensions.has(extension) ? `![${baseName}](${relativePath})` : `[${baseName}](${relativePath})`;
};
const toFileUrl = (targetPath: string): string => {
  const normalizedPath = normalizePath(targetPath);
  if (/^[a-z]:\//iu.test(normalizedPath)) {
    return encodeURI(`file:///${normalizedPath}`);
  }
  return encodeURI(`file://${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`);
};
const isSameOrDescendantPath = (candidatePath: string, basePath: string): boolean => {
  const normalizedCandidate = normalizePath(candidatePath);
  const normalizedBase = normalizePath(basePath);
  return normalizedCandidate === normalizedBase || normalizedCandidate.startsWith(`${normalizedBase}/`);
};

const replacePathPrefix = (candidatePath: string, oldBasePath: string, newBasePath: string): string => {
  const normalizedCandidate = normalizePath(candidatePath);
  const normalizedOldBase = normalizePath(oldBasePath);
  const normalizedNewBase = normalizePath(newBasePath);
  const replacedPath =
    normalizedCandidate === normalizedOldBase
      ? normalizedNewBase
      : `${normalizedNewBase}${normalizedCandidate.slice(normalizedOldBase.length)}`;

  return candidatePath.includes('\\') ? replacedPath.replaceAll('/', '\\') : replacedPath;
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

type ScrollSyncRequest = {
  ratio: number;
  source: 'editor' | 'preview';
  token: number;
};

const App = (): React.JSX.Element => {
  const editorControllerRef = useRef<EditorController | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState<string>('未打开工作区');
  const [tree, setTree] = useState<WorkspaceNode[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedEntryPath, setSelectedEntryPath] = useState<string | null>(null);
  const [content, setContent] = useState<string>(initialMarkdown);
  const [resourcePreviewHtml, setResourcePreviewHtml] = useState<string>('');
  const [resourcePreviewTextContent, setResourcePreviewTextContent] = useState<string>('');
  const [resourcePreviewVersion, setResourcePreviewVersion] = useState<number>(0);
  const [terminalOpen, setTerminalOpen] = useState<boolean>(false);
  const [previewVisible, setPreviewVisible] = useState<boolean>(true);
  const [sidebarVisible, setSidebarVisible] = useState<boolean>(true);
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState<boolean>(false);
  const [activeMenu, setActiveMenu] = useState<TopMenu | null>(null);
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(defaultAppearanceSettings);
  const [appearanceDraft, setAppearanceDraft] = useState<AppearanceSettings>(defaultAppearanceSettings);
  const [behaviorSettings, setBehaviorSettings] = useState<BehaviorSettings>(defaultBehaviorSettings);
  const [behaviorDraft, setBehaviorDraft] = useState<BehaviorSettings>(defaultBehaviorSettings);
  const [appearanceOpen, setAppearanceOpen] = useState<boolean>(false);
  const [webDavSettings, setWebDavSettings] = useState<WebDavSettings>(defaultWebDavSettings);
  const [webDavDraft, setWebDavDraft] = useState<WebDavSettings>(defaultWebDavSettings);
  const [webDavTesting, setWebDavTesting] = useState<boolean>(false);
  const [webDavTestResult, setWebDavTestResult] = useState<WebDavTestResult | null>(null);
  const [webDavSyncing, setWebDavSyncing] = useState<boolean>(false);
  const [editorSearchOpen, setEditorSearchOpen] = useState<boolean>(false);
  const [editorReplaceVisible, setEditorReplaceVisible] = useState<boolean>(false);
  const [editorSearchQuery, setEditorSearchQuery] = useState<string>('');
  const [editorReplaceValue, setEditorReplaceValue] = useState<string>('');
  const [editorSearchSummary, setEditorSearchSummary] = useState<EditorSearchSummary>({ current: 0, total: 0 });
  const [previewHighlightQuery, setPreviewHighlightQuery] = useState<string>('');
  const [previewHighlightOccurrence, setPreviewHighlightOccurrence] = useState<number>(0);
  const [previewHighlightToken, setPreviewHighlightToken] = useState<number>(0);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<string>('示例内容');
  const [scrollSyncRequest, setScrollSyncRequest] = useState<ScrollSyncRequest | null>(null);
  const skipNextSaveRef = useRef<boolean>(true);
  const searchRequestIdRef = useRef<number>(0);
  const pendingSearchNavigationRef = useRef<{ occurrenceIndex: number; query: string; token: number } | null>(null);
  const scrollSyncTokenRef = useRef<number>(0);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const pendingScrollSyncRef = useRef<{ ratio: number; source: 'editor' | 'preview' } | null>(null);
  const webDavSyncingRef = useRef<boolean>(false);

  const previewHtml = useMemo(() => md.render(content), [content]);
  const wordCount = useMemo(() => content.trim().length, [content]);
  const currentFileName = useMemo(() => getFileName(selectedFilePath), [selectedFilePath]);
  const activeEntryName = useMemo(
    () => getFileName(selectedEntryPath ?? selectedFilePath),
    [selectedEntryPath, selectedFilePath]
  );
  const isResourceSelection = Boolean(selectedEntryPath && !isMarkdownFile(selectedEntryPath));
  const resourceExtension = useMemo(() => {
    const targetPath = selectedEntryPath ?? '';
    const extensionMatch = targetPath.match(/(\.[^./\\]+)$/u);
    return extensionMatch ? extensionMatch[1].toLocaleLowerCase() : '';
  }, [selectedEntryPath]);
  const resourcePreviewType = useMemo(() => {
    if (!isResourceSelection || !resourceExtension) {
      return 'markdown' as const;
    }
    if (imageFileExtensions.has(resourceExtension)) {
      return 'image' as const;
    }
    if (resourceExtension === '.pdf') {
      return 'pdf' as const;
    }
    if (textPreviewExtensions.has(resourceExtension)) {
      return 'text' as const;
    }
    return 'other' as const;
  }, [isResourceSelection, resourceExtension]);
  const effectivePreviewHtml = useMemo(
    () => (isResourceSelection ? resourcePreviewHtml : previewHtml),
    [isResourceSelection, previewHtml, resourcePreviewHtml]
  );
  const exportTitle = useMemo(() => getExportTitle(selectedFilePath), [selectedFilePath]);

  const syncEditorSearchSummary = (summary: EditorSearchSummary): void => {
    setEditorSearchSummary(summary);
    if (editorSearchOpen) {
      setPreviewHighlightOccurrence(Math.max(0, summary.current - 1));
      setPreviewHighlightToken((current) => current + 1);
    }
  };

  const reloadSelectedFileFromDisk = async (): Promise<void> => {
    if (!selectedFilePath) {
      return;
    }

    try {
      const nextContent = await window.linkNotes.readFile(selectedFilePath);
      skipNextSaveRef.current = true;
      setContent(nextContent);
    } catch {
      setSelectedFilePath(null);
      skipNextSaveRef.current = true;
      setContent(initialMarkdown);
    }
  };

  const runWebDavSync = async (direction: 'pull' | 'push', trigger: 'auto' | 'manual' = 'manual'): Promise<void> => {
    if (workspaceRoot === '未打开工作区') {
      setSaveStatus('请先打开工作区');
      return;
    }

    if (!webDavSettings.enabled) {
      setSaveStatus('请先在设置中启用 WebDAV 同步');
      return;
    }

    if (!webDavSettings.serverUrl.trim()) {
      setSaveStatus('请先填写 WebDAV 地址');
      return;
    }

    if (webDavSyncingRef.current) {
      if (trigger === 'manual') {
        setSaveStatus('WebDAV 同步正在进行中');
      }
      return;
    }

    webDavSyncingRef.current = true;
    setWebDavSyncing(true);
    setSaveStatus(
      trigger === 'auto'
        ? '已保存，正在同步到 WebDAV...'
        : direction === 'push'
          ? '正在上传到 WebDAV...'
          : '正在从 WebDAV 拉取...'
    );

    try {
      if (selectedFilePath) {
        await window.linkNotes.saveFile(selectedFilePath, content);
      }

      const result =
        direction === 'push'
          ? await window.linkNotes.syncWebDavPush(workspaceRoot)
          : await window.linkNotes.syncWebDavPull(workspaceRoot);

      setTree(result.snapshot.tree);
      await reloadSelectedFileFromDisk();
      setSaveStatus(result.message);
    } catch (error) {
      console.error(`WebDAV ${direction === 'push' ? '上传' : '拉取'}失败`, error);
      setSaveStatus(
        error instanceof Error
          ? `WebDAV ${direction === 'push' ? '上传' : '拉取'}失败：${error.message}`
          : `WebDAV ${direction === 'push' ? '上传' : '拉取'}失败`
      );
    } finally {
      webDavSyncingRef.current = false;
      setWebDavSyncing(false);
    }
  };

  useEffect(() => {
    document.title = 'LinkNotes';
  }, []);

  useEffect(() => {
    const loadSettings = async (): Promise<void> => {
      try {
        const [appearance, behavior, webDav] = await Promise.all([
          window.linkNotes.getAppearanceSettings(),
          window.linkNotes.getBehaviorSettings(),
          window.linkNotes.getWebDavSettings()
        ]);
        setAppearanceSettings(appearance);
        setAppearanceDraft(appearance);
        setBehaviorSettings(behavior);
        setBehaviorDraft(behavior);
        setWebDavSettings(webDav);
        setWebDavDraft(webDav);
      } catch (error) {
        console.error('读取设置失败', error);
      }
    };

    void loadSettings();
  }, []);

  useEffect(() => {
    return () => {
      if (scrollSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (editorSearchOpen) {
          handleCloseEditorSearch();
          return;
        }
        setActiveMenu(null);
        return;
      }

      const isPrimary = event.ctrlKey || event.metaKey;
      if (!isPrimary) {
        return;
      }

      const lowerKey = event.key.toLowerCase();
      if (lowerKey === 'o') {
        event.preventDefault();
        void handleOpenWorkspace();
        return;
      }

      if (lowerKey === 'n') {
        event.preventDefault();
        void handleCreateNote();
        return;
      }

      if (lowerKey === 's') {
        event.preventDefault();
        void handleSaveCurrent();
        return;
      }

      if (lowerKey === 'i' && event.shiftKey) {
        event.preventDefault();
        void handleImportAttachment();
        return;
      }

      if (lowerKey === 'z' && !event.shiftKey) {
        event.preventDefault();
        editorControllerRef.current?.undo();
        return;
      }

      if ((lowerKey === 'y') || (lowerKey === 'z' && event.shiftKey)) {
        event.preventDefault();
        editorControllerRef.current?.redo();
        return;
      }

      if (lowerKey === 'a') {
        event.preventDefault();
        editorControllerRef.current?.selectAll();
        return;
      }

      if (lowerKey === 'f' && event.shiftKey) {
        event.preventDefault();
        handleOpenSearch();
        return;
      }

      if (lowerKey === 'f') {
        event.preventDefault();
        handleOpenEditorSearch(false);
        return;
      }

      if (lowerKey === 'h') {
        event.preventDefault();
        handleOpenEditorSearch(true);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editorSearchOpen, searchOpen, workspaceRoot]);

  useEffect(() => {
    if (!searchOpen || workspaceRoot === '未打开工作区') {
      setSearchLoading(false);
      return;
    }

    const nextQuery = searchQuery.trim();
    if (!nextQuery) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchLoading(true);

    const timer = window.setTimeout(() => {
      void window.linkNotes
        .searchWorkspace(workspaceRoot, nextQuery)
        .then((results) => {
          if (searchRequestIdRef.current !== requestId) {
            return;
          }

          startTransition(() => {
            setSearchResults(results);
          });
        })
        .catch((error) => {
          if (searchRequestIdRef.current !== requestId) {
            return;
          }
          console.error('搜索工作区失败', error);
          setSaveStatus('搜索失败');
          setSearchResults([]);
        })
        .finally(() => {
          if (searchRequestIdRef.current === requestId) {
            setSearchLoading(false);
          }
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchOpen, searchQuery, workspaceRoot]);

  useEffect(() => {
    if (!editorSearchOpen) {
      return;
    }

    setPreviewHighlightQuery(editorSearchQuery.trim());
    setPreviewHighlightOccurrence(Math.max(0, editorSearchSummary.current - 1));
    setPreviewHighlightToken((current) => current + 1);
  }, [editorSearchOpen, editorSearchQuery, editorSearchSummary.current]);

  useEffect(() => {
    const pendingNavigation = pendingSearchNavigationRef.current;
    if (!pendingNavigation || !selectedFilePath) {
      return;
    }

    pendingSearchNavigationRef.current = null;
    setPreviewHighlightQuery(pendingNavigation.query);
    setPreviewHighlightOccurrence(pendingNavigation.occurrenceIndex);
    setPreviewHighlightToken(pendingNavigation.token);

    const timer = window.setTimeout(() => {
      setEditorSearchQuery(pendingNavigation.query);
      syncEditorSearchSummary(
        editorControllerRef.current?.setSearchQuery(pendingNavigation.query, pendingNavigation.occurrenceIndex) ?? {
          current: 0,
          total: 0
        }
      );
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [content, selectedFilePath]);

  useEffect(() => {
    setEditorSearchOpen(false);
    setEditorReplaceVisible(false);
    setEditorSearchQuery('');
    setEditorReplaceValue('');
    setEditorSearchSummary({ current: 0, total: 0 });
    setPreviewHighlightQuery('');
    setPreviewHighlightOccurrence(0);
    setPreviewHighlightToken(0);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchLoading(false);
    searchRequestIdRef.current += 1;
  }, [workspaceRoot]);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }

    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }

    setSaveStatus('保存中...');
    const timer = window.setTimeout(async () => {
      try {
        await window.linkNotes.saveFile(selectedFilePath, content);
        setSaveStatus('已保存');
        if (webDavSettings.enabled && webDavSettings.autoSyncOnSave) {
          await runWebDavSync('push', 'auto');
        }
      } catch (error) {
        console.error('保存文件失败', error);
        setSaveStatus('保存失败');
      }
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [content, selectedFilePath, webDavSettings]);

  useEffect(() => {
    if (!selectedEntryPath || isMarkdownFile(selectedEntryPath)) {
      setResourcePreviewHtml('');
      setResourcePreviewTextContent('');
      return;
    }

    const fileUrl = `${toFileUrl(selectedEntryPath)}?preview=${resourcePreviewVersion}`;

    if (resourcePreviewType === 'image') {
      setResourcePreviewTextContent('');
      setResourcePreviewHtml(
        [
          '<div style="display:flex;flex-direction:column;gap:16px;height:100%;">',
          `<div style="font-size:13px;color:var(--preview-fg);opacity:0.72;">图片预览: ${escapeHtml(getFileName(selectedEntryPath))}</div>`,
          '<div style="display:flex;justify-content:center;align-items:flex-start;padding:12px 0 24px;">',
          `<img class="preview-resource-image" data-preview-zoomable="true" src="${fileUrl}" alt="${escapeHtml(getFileName(selectedEntryPath))}" />`,
          '</div>',
          '</div>'
        ].join('')
      );
      return;
    }

    if (resourcePreviewType === 'pdf') {
      setResourcePreviewTextContent('');
      setResourcePreviewHtml(
        [
          '<div style="display:flex;flex-direction:column;gap:16px;height:100%;">',
          `<div style="font-size:13px;color:var(--preview-fg);opacity:0.72;">PDF 预览: ${escapeHtml(getFileName(selectedEntryPath))}</div>`,
          `<iframe class="preview-resource-frame" src="${fileUrl}" title="${escapeHtml(getFileName(selectedEntryPath))}"></iframe>`,
          '</div>'
        ].join('')
      );
      return;
    }

    if (resourcePreviewType === 'other') {
      setResourcePreviewTextContent('');
      setResourcePreviewHtml(
        [
          '<div style="display:flex;flex-direction:column;gap:12px;padding:16px 0;">',
          `<div style="font-size:13px;color:var(--preview-fg);opacity:0.72;">当前文件暂不支持内嵌预览</div>`,
          `<div style="font-weight:600;">${escapeHtml(getFileName(selectedEntryPath))}</div>`,
          '<div style="font-size:13px;opacity:0.72;">可使用右键菜单中的“系统打开”。</div>',
          '</div>'
        ].join('')
      );
      return;
    }

    let canceled = false;
    void window.linkNotes
      .readFile(selectedEntryPath)
      .then((textContent) => {
        if (canceled) {
          return;
        }

        setResourcePreviewTextContent(textContent);
        setResourcePreviewHtml(
          [
            '<div style="display:flex;flex-direction:column;gap:16px;height:100%;">',
            `<div style="font-size:13px;color:var(--preview-fg);opacity:0.72;">文本预览: ${escapeHtml(getFileName(selectedEntryPath))}</div>`,
            `<pre class="preview-resource-text">${escapeHtml(textContent)}</pre>`,
            '</div>'
          ].join('')
        );
      })
      .catch((error) => {
        console.error('读取资源预览失败', error);
        if (!canceled) {
          setResourcePreviewTextContent('');
          setResourcePreviewHtml(
            [
              '<div style="display:flex;flex-direction:column;gap:12px;padding:16px 0;">',
              '<div style="font-size:13px;color:var(--preview-fg);opacity:0.72;">资源预览失败</div>',
              `<div style="font-weight:600;">${escapeHtml(getFileName(selectedEntryPath))}</div>`,
              '</div>'
            ].join('')
          );
        }
      });

    return () => {
      canceled = true;
    };
  }, [resourcePreviewType, resourcePreviewVersion, selectedEntryPath]);

  const handleOpenWorkspace = async (): Promise<void> => {
    const payload = await window.linkNotes.openWorkspace();
    if (!payload) {
      return;
    }

    setWorkspaceRoot(payload.rootPath);
    setTree(payload.tree);
    setSelectedFilePath(null);
    setSelectedEntryPath(null);
    setResourcePreviewHtml('');
    setResourcePreviewTextContent('');
    skipNextSaveRef.current = true;
    setContent(initialMarkdown);
    setEditorSearchSummary({ current: 0, total: 0 });
    setPreviewHighlightQuery('');
    setPreviewHighlightOccurrence(0);
    setPreviewHighlightToken(0);
    setSearchQuery('');
    setSearchResults([]);
    setSaveStatus('工作区已打开');
  };

  const handleSelectFile = async (filePath: string): Promise<void> => {
    setSelectedEntryPath(filePath);
    if (!isMarkdownFile(filePath)) {
      setSaveStatus('当前文件类型暂不支持在编辑区直接打开，可右键选择“系统打开”');
      return;
    }

    try {
      setSaveStatus('加载中...');
      const nextContent = await window.linkNotes.readFile(filePath);
      skipNextSaveRef.current = true;
      setSelectedFilePath(filePath);
      setContent(nextContent);
      setEditorSearchSummary({ current: 0, total: 0 });
      if (!pendingSearchNavigationRef.current) {
        setPreviewHighlightQuery('');
        setPreviewHighlightOccurrence(0);
        setPreviewHighlightToken(0);
      }
      setSaveStatus('已保存');
    } catch (error) {
      console.error('读取文件失败', error);
      setSaveStatus('读取失败');
    }
  };

  const handleCreateNote = async (targetDir?: string): Promise<void> => {
    if (workspaceRoot === '未打开工作区') {
      return;
    }

    try {
      const baseDir = targetDir ?? workspaceRoot;
      const payload = await window.linkNotes.createNote(baseDir);
      setTree(payload.snapshot.tree);
      skipNextSaveRef.current = true;
      setSelectedFilePath(payload.filePath);
      setSelectedEntryPath(payload.filePath);
      setContent('');
      setPreviewHighlightQuery('');
      setPreviewHighlightOccurrence(0);
      setPreviewHighlightToken(0);
      setSaveStatus('已创建');
    } catch (error) {
      console.error('创建笔记失败', error);
      setSaveStatus('创建失败');
    }
  };

  const handleCreateFolder = async (targetDir?: string): Promise<void> => {
    if (workspaceRoot === '未打开工作区') {
      setSaveStatus('请先打开工作区');
      return;
    }

    const folderName = window.prompt('请输入文件夹名称', '新建文件夹')?.trim();
    if (!folderName) {
      return;
    }

    try {
      const baseDir = targetDir ?? workspaceRoot;
      const payload = await window.linkNotes.createFolder(baseDir, folderName);
      setTree(payload.snapshot.tree);
      setSaveStatus(`已创建文件夹: ${payload.targetPath}`);
    } catch (error) {
      console.error('创建文件夹失败', error);
      setSaveStatus('创建文件夹失败');
    }
  };

  const handleSaveCurrent = async (): Promise<void> => {
    if (!selectedFilePath) {
      setSaveStatus('没有可保存文件');
      return;
    }

    try {
      setSaveStatus('保存中...');
      await window.linkNotes.saveFile(selectedFilePath, content);
      setSaveStatus('已保存');
      if (webDavSettings.enabled && webDavSettings.autoSyncOnSave) {
        await runWebDavSync('push', 'auto');
      }
    } catch (error) {
      console.error('手动保存失败', error);
      setSaveStatus('保存失败');
    }
  };

  const importAttachmentFiles = async (files: File[]): Promise<string | null> => {
    if (workspaceRoot === '未打开工作区') {
      setSaveStatus('请先打开工作区');
      return null;
    }

    if (!selectedFilePath || !isMarkdownFile(selectedFilePath)) {
      setSaveStatus('请先打开一个 Markdown 笔记');
      return null;
    }

    if (files.length === 0) {
      return null;
    }

    try {
      const insertedTexts: string[] = [];

      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const payload = await window.linkNotes.importAttachmentData({
          content: new Uint8Array(buffer),
          currentFilePath: selectedFilePath,
          fileName: file.name || undefined,
          mimeType: file.type || undefined
        });
        insertedTexts.push(payload.insertedText);
      }

      setSaveStatus(files.length === 1 ? `已导入附件: ${files[0].name || '附件'}` : `已导入 ${files.length} 个附件`);
      return insertedTexts.join('\n');
    } catch (error) {
      console.error('导入附件数据失败', error);
      setSaveStatus('导入附件失败');
      return null;
    }
  };

  const requestAttachmentInsertion = async (kind: 'auto' | 'file' | 'image' = 'auto'): Promise<string | null> => {
    if (workspaceRoot === '未打开工作区') {
      setSaveStatus('请先打开工作区');
      return null;
    }

    if (!selectedFilePath || !isMarkdownFile(selectedFilePath)) {
      setSaveStatus('请先打开一个 Markdown 笔记');
      return null;
    }

    try {
      const payload = await window.linkNotes.importAttachment(workspaceRoot, selectedFilePath, kind);
      if (!payload) {
        return null;
      }

      setSaveStatus(`已导入附件: ${getFileName(payload.targetPath)}`);
      return payload.insertedText;
    } catch (error) {
      console.error('导入附件失败', error);
      setSaveStatus('导入附件失败');
      return null;
    }
  };

  const handleImportAttachment = async (): Promise<void> => {
    const insertedText = await requestAttachmentInsertion('auto');
    if (!insertedText) {
      return;
    }

    editorControllerRef.current?.insertText(insertedText);
  };

  const handleCopyRelativePath = async (targetPath?: string): Promise<void> => {
    if (!targetPath) {
      setSaveStatus('没有可复制条目');
      return;
    }

    if (!selectedFilePath || !isMarkdownFile(selectedFilePath)) {
      setSaveStatus('请先打开一个 Markdown 笔记');
      return;
    }

    try {
      const relativePath = ensureRelativeMarkdownPath(getRelativePathBetween(selectedFilePath, targetPath));
      await window.linkNotes.writeClipboardText(relativePath);
      setSaveStatus(`已复制相对路径: ${relativePath}`);
    } catch (error) {
      console.error('复制相对路径失败', error);
      setSaveStatus('复制相对路径失败');
    }
  };

  const handleInsertReference = (targetPath?: string): void => {
    if (!targetPath) {
      setSaveStatus('没有可插入条目');
      return;
    }

    if (!selectedFilePath || !isMarkdownFile(selectedFilePath)) {
      setSaveStatus('请先打开一个 Markdown 笔记');
      return;
    }

    const insertedText = getMarkdownReferenceText(selectedFilePath, targetPath);
    editorControllerRef.current?.insertText(insertedText);
    setSaveStatus(`已插入引用: ${getFileName(targetPath)}`);
  };

  const handleCopyResourceContent = async (): Promise<void> => {
    if (resourcePreviewType !== 'text' || !resourcePreviewTextContent) {
      setSaveStatus('当前资源没有可复制的文本内容');
      return;
    }

    try {
      await window.linkNotes.writeClipboardText(resourcePreviewTextContent);
      setSaveStatus(`已复制内容: ${activeEntryName}`);
    } catch (error) {
      console.error('复制资源内容失败', error);
      setSaveStatus('复制资源内容失败');
    }
  };

  const handleOpenEntryInSystem = async (targetPath?: string): Promise<void> => {
    if (!targetPath) {
      setSaveStatus('没有可打开条目');
      return;
    }

    try {
      await window.linkNotes.openInSystem(targetPath);
      setSaveStatus(`已在系统中打开: ${getFileName(targetPath)}`);
    } catch (error) {
      console.error('系统打开失败', error);
      setSaveStatus('系统打开失败');
    }
  };

  const handleRefreshPreview = (): void => {
    if (!isResourceSelection) {
      return;
    }

    setResourcePreviewVersion((current) => current + 1);
    setSaveStatus(`已刷新预览: ${activeEntryName}`);
  };

  const handleRenameEntry = async (targetPath?: string): Promise<void> => {
    if (!targetPath || workspaceRoot === '未打开工作区') {
      setSaveStatus('没有可重命名条目');
      return;
    }

    const currentName = getFileName(targetPath);
    const nextInput = window.prompt('请输入新的文件名', currentName)?.trim();
    if (!nextInput || nextInput === currentName) {
      return;
    }

    const nextName = isMarkdownFile(targetPath) ? ensureMarkdownName(nextInput) : nextInput;

    try {
      const payload = await window.linkNotes.renameEntry(workspaceRoot, targetPath, nextName);
      setTree(payload.snapshot.tree);
      if (selectedFilePath && isSameOrDescendantPath(selectedFilePath, targetPath)) {
        setSelectedFilePath(replacePathPrefix(selectedFilePath, targetPath, payload.targetPath));
      }
      if (selectedEntryPath && isSameOrDescendantPath(selectedEntryPath, targetPath)) {
        setSelectedEntryPath(replacePathPrefix(selectedEntryPath, targetPath, payload.targetPath));
      }
      setSaveStatus(
        payload.syncWarning
          ? `已重命名为: ${getFileName(payload.targetPath)}，但 WebDAV 同步失败：${payload.syncWarning}`
          : `已重命名为: ${getFileName(payload.targetPath)}`
      );
    } catch (error) {
      console.error('重命名条目失败', error);
      setSaveStatus('重命名条目失败');
    }
  };

  const handleDeleteEntry = async (targetPath?: string): Promise<void> => {
    if (!targetPath || workspaceRoot === '未打开工作区') {
      setSaveStatus('没有可删除条目');
      return;
    }

    const confirmed = window.confirm(`确认删除 ${getFileName(targetPath)} 吗？`);
    if (!confirmed) {
      return;
    }

    try {
      const payload = await window.linkNotes.deleteEntry(workspaceRoot, targetPath);
      setTree(payload.snapshot.tree);
      if (selectedFilePath && isSameOrDescendantPath(selectedFilePath, targetPath)) {
        setSelectedFilePath(null);
        skipNextSaveRef.current = true;
        setContent(initialMarkdown);
      }
      if (selectedEntryPath && isSameOrDescendantPath(selectedEntryPath, targetPath)) {
        setSelectedEntryPath(null);
      }
      setSaveStatus(payload.syncWarning ? `已删除条目，但 WebDAV 同步失败：${payload.syncWarning}` : '已删除条目');
    } catch (error) {
      console.error('删除条目失败', error);
      setSaveStatus('删除条目失败');
    }
  };

  const handleExportHtml = async (): Promise<void> => {
    try {
      const result = await window.linkNotes.exportHtml(exportTitle, content);
      if (!result.canceled) {
        setSaveStatus(`已导出 HTML: ${result.filePath}`);
      }
    } catch (error) {
      console.error('导出 HTML 失败', error);
      setSaveStatus('导出 HTML 失败');
    }
  };

  const handleExportPdf = async (): Promise<void> => {
    try {
      const result = await window.linkNotes.exportPdf(exportTitle, content);
      if (!result.canceled) {
        setSaveStatus(`已导出 PDF: ${result.filePath}`);
      }
    } catch (error) {
      console.error('导出 PDF 失败', error);
      setSaveStatus('导出 PDF 失败');
    }
  };

  const handleToggleAlwaysOnTop = async (): Promise<void> => {
    try {
      const nextState = await window.linkNotes.toggleAlwaysOnTop();
      setAlwaysOnTop(nextState);
      setSaveStatus(nextState ? '窗口已置顶' : '已取消置顶');
    } catch (error) {
      console.error('切换窗口置顶失败', error);
      setSaveStatus('窗口操作失败');
    }
  };

  const handleToggleFocusMode = (): void => {
    setFocusMode((current) => {
      const next = !current;
      setSaveStatus(next ? '已进入专注模式' : '已退出专注模式');
      return next;
    });
  };

  const handleOpenEditorSearch = (showReplace: boolean): void => {
    setSearchOpen(false);
    setEditorSearchOpen(true);
    setEditorReplaceVisible(showReplace);
    syncEditorSearchSummary(editorControllerRef.current?.setSearchQuery(editorSearchQuery) ?? { current: 0, total: 0 });
  };

  const handleCloseEditorSearch = (): void => {
    setEditorSearchOpen(false);
    setEditorReplaceVisible(false);
    editorControllerRef.current?.clearSearch();
    setEditorSearchSummary({ current: 0, total: 0 });
  };

  const handleChangeEditorSearchQuery = (value: string): void => {
    setEditorSearchQuery(value);
    syncEditorSearchSummary(editorControllerRef.current?.setSearchQuery(value) ?? { current: 0, total: 0 });
  };

  const handleFindNext = (): void => {
    syncEditorSearchSummary(editorControllerRef.current?.findNext(editorSearchQuery) ?? { current: 0, total: 0 });
  };

  const handleFindPrevious = (): void => {
    syncEditorSearchSummary(editorControllerRef.current?.findPrevious(editorSearchQuery) ?? { current: 0, total: 0 });
  };

  const handleReplaceCurrent = (): void => {
    syncEditorSearchSummary(
      editorControllerRef.current?.replaceCurrent(editorSearchQuery, editorReplaceValue) ?? { current: 0, total: 0 }
    );
  };

  const handleReplaceAll = (): void => {
    syncEditorSearchSummary(
      editorControllerRef.current?.replaceAll(editorSearchQuery, editorReplaceValue) ?? { current: 0, total: 0 }
    );
  };

  const handleOpenSearch = (): void => {
    if (workspaceRoot === '未打开工作区') {
      setSaveStatus('请先打开工作区');
      return;
    }

    setEditorSearchOpen(false);
    editorControllerRef.current?.clearSearch();
    setSearchOpen(true);
  };

  const handleCloseSearch = (): void => {
    setSearchOpen(false);
  };

  const handleChangeSearchQuery = (value: string): void => {
    setSearchQuery(value);
  };

  const handleOpenSearchResult = async (result: WorkspaceSearchResult): Promise<void> => {
    const query = searchQuery.trim();
    if (query) {
      pendingSearchNavigationRef.current = {
        occurrenceIndex: result.occurrenceIndex,
        query,
        token: Date.now()
      };
    }
    await handleSelectFile(result.filePath);
    setSearchOpen(false);
  };

  const handleMenuAction = (action: () => void | Promise<void>) => {
    setActiveMenu(null);
    void action();
  };

  const handleOpenAppearanceSettings = (): void => {
    setAppearanceDraft(appearanceSettings);
    setBehaviorDraft(behaviorSettings);
    setWebDavDraft(webDavSettings);
    setWebDavTestResult(null);
    setAppearanceOpen(true);
  };

  const handleSaveAppearanceSettings = async (): Promise<void> => {
    try {
      const [savedAppearance, savedBehavior, savedWebDav] = await Promise.all([
        window.linkNotes.saveAppearanceSettings(appearanceDraft),
        window.linkNotes.saveBehaviorSettings(behaviorDraft),
        window.linkNotes.saveWebDavSettings(webDavDraft)
      ]);
      setAppearanceSettings(savedAppearance);
      setAppearanceDraft(savedAppearance);
      setBehaviorSettings(savedBehavior);
      setBehaviorDraft(savedBehavior);
      setWebDavSettings(savedWebDav);
      setWebDavDraft(savedWebDav);
      setAppearanceOpen(false);
      setSaveStatus('已保存设置');
    } catch (error) {
      console.error('保存设置失败', error);
      setSaveStatus('保存设置失败');
    }
  };

  const handleTestWebDavSettings = async (): Promise<void> => {
    setWebDavTesting(true);
    setWebDavTestResult(null);

    try {
      const result = await window.linkNotes.testWebDavSettings(webDavDraft);
      setWebDavTestResult(result);
      setSaveStatus(result.ok ? 'WebDAV 连接成功' : 'WebDAV 连接失败');
    } catch (error) {
      console.error('测试 WebDAV 连接失败', error);
      setWebDavTestResult({
        message: error instanceof Error ? `连接失败：${error.message}` : '连接失败：未知错误',
        ok: false
      });
      setSaveStatus('WebDAV 连接失败');
    } finally {
      setWebDavTesting(false);
    }
  };

  const queueScrollSync = (source: 'editor' | 'preview', ratio: number): void => {
    if (!behaviorSettings.syncScroll) {
      return;
    }

    pendingScrollSyncRef.current = { ratio, source };
    if (scrollSyncFrameRef.current !== null) {
      return;
    }

    scrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      scrollSyncFrameRef.current = null;
      const pending = pendingScrollSyncRef.current;
      if (!pending) {
        return;
      }

      scrollSyncTokenRef.current += 1;
      setScrollSyncRequest({
        ratio: pending.ratio,
        source: pending.source,
        token: scrollSyncTokenRef.current
      });
    });
  };

  const handleToggleSyncScroll = async (): Promise<void> => {
    const nextBehavior: BehaviorSettings = {
      ...behaviorSettings,
      syncScroll: !behaviorSettings.syncScroll
    };

    try {
      const saved = await window.linkNotes.saveBehaviorSettings(nextBehavior);
      setBehaviorSettings(saved);
      setBehaviorDraft(saved);
      setSaveStatus(saved.syncScroll ? '已开启同步滚动' : '已关闭同步滚动');
    } catch (error) {
      console.error('切换同步滚动失败', error);
      setSaveStatus('同步滚动设置失败');
    }
  };

  const handleUndo = (): void => {
    editorControllerRef.current?.focus();
    const changed = editorControllerRef.current?.undo() ?? false;
    setSaveStatus(changed ? '已撤销' : '没有可撤销内容');
  };

  const handleRedo = (): void => {
    editorControllerRef.current?.focus();
    const changed = editorControllerRef.current?.redo() ?? false;
    setSaveStatus(changed ? '已重做' : '没有可重做内容');
  };

  const handleSelectAll = (): void => {
    editorControllerRef.current?.selectAll();
    setSaveStatus('已全选');
  };

  const menuItems: Record<TopMenu, MenuItem[]> = {
    File: [
      { label: '打开工作区', onSelect: handleOpenWorkspace, shortcut: 'Ctrl+O' },
      {
        disabled: workspaceRoot === '未打开工作区',
        label: '新建文件夹',
        onSelect: () => handleCreateFolder()
      },
      {
        disabled: workspaceRoot === '未打开工作区',
        label: '新建笔记',
        onSelect: () => handleCreateNote(),
        shortcut: 'Ctrl+N'
      },
      {
        disabled: !selectedFilePath,
        label: '立即保存',
        onSelect: handleSaveCurrent,
        shortcut: 'Ctrl+S'
      },
      {
        disabled: !selectedFilePath,
        label: '插入附件',
        onSelect: handleImportAttachment,
        shortcut: 'Ctrl+Shift+I'
      },
      {
        disabled: workspaceRoot === '未打开工作区' || webDavSyncing,
        label: '上传到 WebDAV',
        onSelect: () => runWebDavSync('push')
      },
      {
        disabled: workspaceRoot === '未打开工作区' || webDavSyncing,
        label: '从 WebDAV 拉取',
        onSelect: () => runWebDavSync('pull')
      },
      {
        label: '导出 HTML',
        onSelect: handleExportHtml
      },
      {
        label: '导出 PDF',
        onSelect: handleExportPdf
      },
      {
        disabled: !selectedFilePath,
        label: '重命名当前笔记',
        onSelect: () => handleRenameEntry(selectedFilePath ?? undefined)
      },
      {
        danger: true,
        disabled: !selectedFilePath,
        label: '删除当前笔记',
        onSelect: () => handleDeleteEntry(selectedFilePath ?? undefined)
      },
      {
        danger: true,
        label: '退出',
        onSelect: () => window.linkNotes.closeWindow(),
        shortcut: 'Alt+F4'
      }
    ],
    Edit: [
      {
        label: '撤销',
        onSelect: handleUndo,
        shortcut: 'Ctrl+Z'
      },
      {
        label: '重做',
        onSelect: handleRedo,
        shortcut: 'Ctrl+Y'
      },
      {
        label: '全选',
        onSelect: handleSelectAll,
        shortcut: 'Ctrl+A'
      },
      {
        label: '查找',
        onSelect: () => handleOpenEditorSearch(false),
        shortcut: 'Ctrl+F'
      },
      {
        label: '替换',
        onSelect: () => handleOpenEditorSearch(true),
        shortcut: 'Ctrl+H'
      },
      {
        disabled: workspaceRoot === '未打开工作区',
        label: '全局搜索',
        onSelect: handleOpenSearch,
        shortcut: 'Ctrl+Shift+F'
      },
      {
        disabled: !selectedFilePath,
        label: '插入附件',
        onSelect: handleImportAttachment,
        shortcut: 'Ctrl+Shift+I'
      }
    ],
    Help: [
      {
        label: 'Markdown 快捷命令',
        onSelect: () =>
          window.alert(
            [
              '当前支持的 Markdown 快捷命令：',
              '',
              '/h1  -> 一级标题',
              '/h2  -> 二级标题',
              '/h3  -> 三级标题',
              '/todo -> 待办项',
              '/quote -> 引用块',
              '/code -> 代码块',
              '/dmk -> 代码块',
              '/table -> 表格',
              '/link -> 链接',
              '/img -> 选择图片并插入 Markdown 图片语法',
              '/file -> 选择附件并插入 Markdown 链接',
              '',
              '使用方式：输入命令后按 Tab。',
              '/img 和 /file 会弹出本地文件选择框，并把文件复制到当前笔记同级目录下的 attachments 文件夹。'
            ].join('\n')
          )
      },
      {
        label: '快捷说明',
        onSelect: () =>
          window.alert(
            [
              '当前可用：',
              'Ctrl+O 打开工作区',
              'Ctrl+N 新建笔记',
              'Ctrl+S 立即保存',
              'Ctrl+Z 撤销',
              'Ctrl+Y 重做',
              'Ctrl+A 全选',
              'Ctrl+F 查找',
              'Ctrl+H 替换',
              'Ctrl+Shift+I 插入附件',
              'Ctrl+Shift+F 全局搜索',
              '拖拽文件到编辑器自动导入',
              '粘贴图片到编辑器自动导入',
              'Esc 关闭菜单'
            ].join('\n')
          )
      },
      {
        label: '关于 LinkNotes',
        onSelect: () => window.alert('LinkNotes\n本地优先的个人 Markdown 笔记软件')
      }
    ],
    View: [
      {
        checked: behaviorSettings.syncScroll,
        label: '同步滚动',
        onSelect: handleToggleSyncScroll
      },
      {
        checked: previewVisible,
        label: '显示/隐藏预览',
        onSelect: () => {
          setPreviewVisible((current) => {
            const next = !current;
            setSaveStatus(next ? '已显示预览' : '已隐藏预览');
            return next;
          });
        }
      },
      {
        checked: terminalOpen,
        label: '显示/隐藏终端',
        onSelect: () => {
          setTerminalOpen((current) => {
            const next = !current;
            setSaveStatus(next ? '已显示终端' : '已隐藏终端');
            return next;
          });
        }
      },
      {
        label: '设置',
        onSelect: () => handleOpenAppearanceSettings()
      }
    ],
    Window: [
      { label: '最小化窗口', onSelect: () => window.linkNotes.minimizeWindow() },
      {
        label: '最大化/还原',
        onSelect: async () => {
          await window.linkNotes.toggleMaximizeWindow();
        }
      },
      {
        checked: alwaysOnTop,
        label: '窗口置顶',
        onSelect: handleToggleAlwaysOnTop
      },
      {
        checked: sidebarVisible,
        label: '显示/隐藏侧边栏',
        onSelect: () => {
          setSidebarVisible((current) => {
            const next = !current;
            setSaveStatus(next ? '已显示侧边栏' : '已隐藏侧边栏');
            return next;
          });
        }
      },
      {
        checked: focusMode,
        label: '专注模式',
        onSelect: handleToggleFocusMode
      },
      {
        danger: true,
        label: '关闭窗口',
        onSelect: () => window.linkNotes.closeWindow()
      }
    ]
  };

  const showSidebar = sidebarVisible && !focusMode;
  const showPreview = previewVisible && !focusMode;
  const showTerminal = terminalOpen && !focusMode;
  const terminalTargetCwd = selectedFilePath
    ? getDirectoryPath(selectedFilePath)
    : workspaceRoot !== '未打开工作区'
      ? workspaceRoot
      : null;
  const previewAssetBasePath = selectedFilePath
    ? getDirectoryPath(selectedFilePath)
    : workspaceRoot !== '未打开工作区'
      ? workspaceRoot
      : null;
  const previewTitle = isResourceSelection ? '资源预览' : '预览';
  const previewActions = isResourceSelection ? (
    <>
      {resourcePreviewType === 'image' ? <span className="toolbar__meta">点击图片可放大/还原</span> : null}
      <button
        className="toolbar__button"
        disabled={!selectedFilePath || !isMarkdownFile(selectedFilePath)}
        onClick={() => void handleCopyRelativePath(selectedEntryPath ?? undefined)}
        type="button"
      >
        复制路径
      </button>
      <button
        className="toolbar__button"
        disabled={!selectedFilePath || !isMarkdownFile(selectedFilePath)}
        onClick={() => handleInsertReference(selectedEntryPath ?? undefined)}
        type="button"
      >
        插入引用
      </button>
      {resourcePreviewType === 'text' ? (
        <button className="toolbar__button" onClick={() => void handleCopyResourceContent()} type="button">
          复制内容
        </button>
      ) : null}
      <button className="toolbar__button" onClick={handleRefreshPreview} type="button">
        刷新预览
      </button>
      <button
        className="toolbar__button"
        onClick={() => void handleOpenEntryInSystem(selectedEntryPath ?? undefined)}
        type="button"
      >
        系统打开
      </button>
    </>
  ) : null;
  const appStyle = {
    ['--editor-bg' as const]: appearanceSettings.editorBackground,
    ['--editor-fg' as const]: appearanceSettings.editorForeground,
    ['--preview-bg' as const]: appearanceSettings.previewBackground,
    ['--preview-fg' as const]: appearanceSettings.previewForeground
  } as React.CSSProperties;

  return (
    <div className="app-shell" style={appStyle}>
      <header className="top-chrome">
        <div className="top-chrome__bar" ref={menuRef}>
          <div className="top-chrome__menu-group">
            <button className="top-chrome__app-button" type="button" aria-label="LinkNotes">
              <span className="top-chrome__app-icon">
                <span className="top-chrome__app-dot top-chrome__app-dot--top" />
                <span className="top-chrome__app-dot top-chrome__app-dot--right" />
                <span className="top-chrome__app-dot top-chrome__app-dot--bottom" />
                <span className="top-chrome__app-dot top-chrome__app-dot--left" />
              </span>
            </button>
            {topMenus.map((menu) => (
              <div className="top-chrome__menu-wrap" key={menu}>
                <button
                  className={`top-chrome__menu-button ${activeMenu === menu ? 'top-chrome__menu-button--active' : ''}`}
                  onClick={() => setActiveMenu((current) => (current === menu ? null : menu))}
                  type="button"
                >
                  {menu}
                </button>
                {activeMenu === menu ? (
                  <div className="top-chrome__dropdown">
                    {menuItems[menu].map((item) => (
                      <button
                        className={`top-chrome__dropdown-item ${item.danger ? 'top-chrome__dropdown-item--danger' : ''}`}
                        disabled={item.disabled}
                        key={item.label}
                        onClick={() => handleMenuAction(item.onSelect)}
                        type="button"
                      >
                        <span className="top-chrome__dropdown-main">
                          <span className="top-chrome__dropdown-check">{item.checked ? '✓' : ''}</span>
                          <span>{item.label}</span>
                        </span>
                        {item.shortcut ? <span className="top-chrome__dropdown-shortcut">{item.shortcut}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="top-chrome__window-controls">
            {windowControls.map((control) => (
              <button
                key={control}
                className={`top-chrome__window-button top-chrome__window-button--${control}`}
                onClick={() => {
                  if (control === 'minimize') {
                    void window.linkNotes.minimizeWindow();
                  } else if (control === 'maximize') {
                    void window.linkNotes.toggleMaximizeWindow();
                  } else {
                    void window.linkNotes.closeWindow();
                  }
                }}
                type="button"
              >
                {control === 'minimize' ? '─' : control === 'maximize' ? '□' : '×'}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className={`workspace-shell ${showSidebar ? '' : 'workspace-shell--sidebar-hidden'}`}>
        {showSidebar ? (
        <aside className="sidebar">
          <button className="sidebar__open" onClick={() => void handleOpenWorkspace()}>
            打开工作区
          </button>
          <FileTreePane
            canInsertReference={Boolean(selectedFilePath && isMarkdownFile(selectedFilePath))}
            onCreateFolder={(targetDir) => void handleCreateFolder(targetDir)}
            onCreateNote={(targetDir) => void handleCreateNote(targetDir)}
            onCopyRelativePath={(targetPath) => void handleCopyRelativePath(targetPath)}
            onDeleteEntry={(targetPath) => void handleDeleteEntry(targetPath)}
            onInsertReference={(targetPath) => handleInsertReference(targetPath)}
            onOpenInSystem={(targetPath) => void handleOpenEntryInSystem(targetPath)}
            onRenameEntry={(targetPath) => void handleRenameEntry(targetPath)}
            onSelectFile={(filePath) => void handleSelectFile(filePath)}
            rootPath={workspaceRoot}
            selectedPath={selectedEntryPath ?? selectedFilePath}
            tree={tree}
          />
        </aside>
        ) : null}
        <main className="main-panel">
          <Toolbar
            importDisabled={!selectedFilePath}
            onImportAttachment={() => void handleImportAttachment()}
            onPullWebDav={() => void runWebDavSync('pull')}
            onOpenEditorSearch={() => handleOpenEditorSearch(true)}
            onOpenSearch={handleOpenSearch}
            onPushWebDav={() => void runWebDavSync('push')}
            title={activeEntryName}
            saveStatus={saveStatus}
            webDavBusy={webDavSyncing}
            onToggleTerminal={() => setTerminalOpen((current) => !current)}
          />
          <EditorSearchBar
            onChangeQuery={handleChangeEditorSearchQuery}
            onChangeReplacement={setEditorReplaceValue}
            onClose={handleCloseEditorSearch}
            onFindNext={handleFindNext}
            onFindPrevious={handleFindPrevious}
            onReplaceAll={handleReplaceAll}
            onReplaceCurrent={handleReplaceCurrent}
            onToggleReplace={() => setEditorReplaceVisible((current) => !current)}
            open={editorSearchOpen}
            query={editorSearchQuery}
            replacement={editorReplaceValue}
            replaceVisible={editorReplaceVisible}
            summary={editorSearchSummary}
          />
          <div className={`workspace-grid ${showPreview ? '' : 'workspace-grid--single'}`}>
            <EditorPane
              externalScrollRequest={
                scrollSyncRequest?.source === 'preview'
                  ? { ratio: scrollSyncRequest.ratio, token: scrollSyncRequest.token }
                  : null
              }
              onChange={setContent}
              onImportAttachment={(kind) => requestAttachmentInsertion(kind)}
              onImportAttachmentData={importAttachmentFiles}
              onScrollChange={(ratio) => queueScrollSync('editor', ratio)}
              onReady={(controller) => {
                editorControllerRef.current = controller;
              }}
              syncScrollEnabled={behaviorSettings.syncScroll}
              value={content}
            />
            {showPreview ? (
              <PreviewPane
                actions={previewActions}
                assetBasePath={previewAssetBasePath}
                externalScrollRequest={
                  scrollSyncRequest?.source === 'editor'
                    ? { ratio: scrollSyncRequest.ratio, token: scrollSyncRequest.token }
                    : null
                }
                focusOccurrence={editorSearchOpen ? Math.max(0, editorSearchSummary.current - 1) : previewHighlightOccurrence}
                focusToken={previewHighlightToken}
                highlightQuery={editorSearchOpen ? editorSearchQuery : previewHighlightQuery}
                html={effectivePreviewHtml}
                onScrollChange={(ratio) => queueScrollSync('preview', ratio)}
                resourcePreview={isResourceSelection}
                syncScrollEnabled={behaviorSettings.syncScroll}
                title={previewTitle}
              />
            ) : null}
          </div>
          <StatusBar
            currentFileName={activeEntryName}
            selectedFilePath={selectedEntryPath ?? selectedFilePath}
            wordCount={wordCount}
            workspaceRoot={workspaceRoot}
          />
          <TerminalDrawer open={showTerminal} targetCwd={terminalTargetCwd} />
        </main>
      </div>
      {appearanceOpen ? (
        <div className="settings-modal-backdrop" onClick={() => setAppearanceOpen(false)} role="presentation">
          <section
            className="settings-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="设置"
          >
            <div className="settings-modal__header">
              <div>
                <div className="settings-modal__title">设置</div>
                <div className="settings-modal__meta">管理界面颜色、编辑行为和 WebDAV 同步参数</div>
              </div>
            </div>
            <div className="settings-modal__body">
              <div className="settings-section">
                <div className="settings-section__title">显示与编辑</div>
              <label className="settings-field">
                <span>编辑区背景色</span>
                <input
                  type="color"
                  value={appearanceDraft.editorBackground}
                  onChange={(event) =>
                    setAppearanceDraft((current) => ({ ...current, editorBackground: event.target.value }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>编辑区文字色</span>
                <input
                  type="color"
                  value={appearanceDraft.editorForeground}
                  onChange={(event) =>
                    setAppearanceDraft((current) => ({ ...current, editorForeground: event.target.value }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>预览区背景色</span>
                <input
                  type="color"
                  value={appearanceDraft.previewBackground}
                  onChange={(event) =>
                    setAppearanceDraft((current) => ({ ...current, previewBackground: event.target.value }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>预览区文字色</span>
                <input
                  type="color"
                  value={appearanceDraft.previewForeground}
                  onChange={(event) =>
                    setAppearanceDraft((current) => ({ ...current, previewForeground: event.target.value }))
                  }
                />
              </label>
              <label className="settings-field">
                <span>编辑区与预览区同步滚动</span>
                <input
                  checked={behaviorDraft.syncScroll}
                  onChange={(event) =>
                    setBehaviorDraft((current) => ({ ...current, syncScroll: event.target.checked }))
                  }
                  type="checkbox"
                />
              </label>
              </div>
              <div className="settings-section">
                <div className="settings-section__title">WebDAV 同步</div>
                <label className="settings-field">
                  <span>启用 WebDAV 同步</span>
                  <input
                    checked={webDavDraft.enabled}
                    onChange={(event) => setWebDavDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    type="checkbox"
                  />
                </label>
                <label className="settings-field settings-field--stack">
                  <span>服务器地址</span>
                  <input
                    className="settings-input"
                    onChange={(event) =>
                      setWebDavDraft((current) => ({ ...current, serverUrl: event.target.value }))
                    }
                    placeholder="https://example.com/webdav"
                    spellCheck={false}
                    type="text"
                    value={webDavDraft.serverUrl}
                  />
                </label>
                <label className="settings-field settings-field--stack">
                  <span>用户名</span>
                  <input
                    className="settings-input"
                    onChange={(event) => setWebDavDraft((current) => ({ ...current, username: event.target.value }))}
                    placeholder="WebDAV 用户名"
                    spellCheck={false}
                    type="text"
                    value={webDavDraft.username}
                  />
                </label>
                <label className="settings-field settings-field--stack">
                  <span>密码</span>
                  <input
                    className="settings-input"
                    onChange={(event) => setWebDavDraft((current) => ({ ...current, password: event.target.value }))}
                    placeholder="WebDAV 密码"
                    type="password"
                    value={webDavDraft.password}
                  />
                </label>
                <label className="settings-field settings-field--stack">
                  <span>远程目录</span>
                  <input
                    className="settings-input"
                    onChange={(event) => setWebDavDraft((current) => ({ ...current, remotePath: event.target.value }))}
                    placeholder="/LinkNotes"
                    spellCheck={false}
                    type="text"
                    value={webDavDraft.remotePath}
                  />
                </label>
                <label className="settings-field">
                  <span>忽略 HTTPS 证书校验</span>
                  <input
                    checked={webDavDraft.allowInsecureTls}
                    onChange={(event) =>
                      setWebDavDraft((current) => ({ ...current, allowInsecureTls: event.target.checked }))
                    }
                    type="checkbox"
                  />
                </label>
                <label className="settings-field">
                  <span>保存时自动同步</span>
                  <input
                    checked={webDavDraft.autoSyncOnSave}
                    onChange={(event) =>
                      setWebDavDraft((current) => ({ ...current, autoSyncOnSave: event.target.checked }))
                    }
                    type="checkbox"
                  />
                </label>
                <div className="settings-inline-actions">
                  <button
                    className="toolbar__button"
                    disabled={webDavTesting}
                    onClick={() => void handleTestWebDavSettings()}
                    type="button"
                  >
                    {webDavTesting ? '测试中...' : '测试连接'}
                  </button>
                  <div className="settings-inline-hint">已支持手动上传、手动拉取，以及保存后自动上传。</div>
                </div>
                {webDavTestResult ? (
                  <div
                    className={`settings-feedback ${
                      webDavTestResult.ok ? 'settings-feedback--success' : 'settings-feedback--error'
                    }`}
                  >
                    {webDavTestResult.message}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="settings-modal__actions">
              <button
                className="toolbar__button"
                onClick={() => {
                  setAppearanceDraft(defaultAppearanceSettings);
                  setBehaviorDraft(defaultBehaviorSettings);
                  setWebDavDraft(defaultWebDavSettings);
                  setWebDavTestResult(null);
                }}
                type="button"
              >
                恢复默认
              </button>
              <button className="toolbar__button" onClick={() => setAppearanceOpen(false)} type="button">
                取消
              </button>
              <button className="toolbar__button" onClick={() => void handleSaveAppearanceSettings()} type="button">
                保存
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <SearchDialog
        loading={searchLoading}
        onClose={handleCloseSearch}
        onOpenResult={(result) => void handleOpenSearchResult(result)}
        onSearch={handleChangeSearchQuery}
        open={searchOpen}
        query={searchQuery}
        results={searchResults}
        workspaceOpened={workspaceRoot !== '未打开工作区'}
      />
    </div>
  );
};

export default App;
