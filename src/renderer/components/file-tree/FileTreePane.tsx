import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceNode } from '../../../main/ipc/workspace';

type FileTreePaneProps = {
  canInsertReference: boolean;
  onCreateFolder: (targetDir: string) => void;
  onCreateNote: (targetDir: string) => void;
  onCopyRelativePath: (targetPath: string) => void;
  onDeleteEntry: (targetPath: string) => void;
  onInsertReference: (targetPath: string) => void;
  onOpenInSystem: (targetPath: string) => void;
  onRenameEntry: (targetPath: string) => void;
  rootPath: string;
  selectedPath: string | null;
  tree: WorkspaceNode[];
  onSelectFile: (filePath: string) => void;
};

type ContextMenuState = {
  node: WorkspaceNode;
  x: number;
  y: number;
} | null;

type TreeNodeProps = {
  expandedDirectories: Set<string>;
  onContextMenu: (event: React.MouseEvent, node: WorkspaceNode) => void;
  depth: number;
  node: WorkspaceNode;
  onSelectFile: (filePath: string) => void;
  selectedPath: string | null;
  onToggleDirectory: (targetPath: string) => void;
};

const collectDirectoryPaths = (nodes: WorkspaceNode[]): string[] => {
  return nodes.flatMap((node) =>
    node.type === 'directory' ? [node.path, ...collectDirectoryPaths(node.children ?? [])] : []
  );
};

const normalizeSearchQuery = (value: string): string => value.trim().toLocaleLowerCase();

const filterTreeNodes = (nodes: WorkspaceNode[], keyword: string): WorkspaceNode[] => {
  return nodes.flatMap((node) => {
    const selfMatches = normalizeSearchQuery(node.name).includes(keyword);

    if (node.type === 'file') {
      return selfMatches ? [node] : [];
    }

    const children = node.children ?? [];
    const filteredChildren = filterTreeNodes(children, keyword);

    if (selfMatches) {
      return [{ ...node, children }];
    }

    if (filteredChildren.length > 0) {
      return [{ ...node, children: filteredChildren }];
    }

    return [];
  });
};

const collectAncestorDirectories = (nodes: WorkspaceNode[], targetPath: string): string[] => {
  for (const node of nodes) {
    if (node.type === 'file' && node.path === targetPath) {
      return [];
    }

    if (node.type === 'directory') {
      if (node.path === targetPath) {
        return [node.path];
      }

      const nested = collectAncestorDirectories(node.children ?? [], targetPath);
      if (nested.length > 0 || node.children?.some((child) => child.path === targetPath)) {
        return [node.path, ...nested];
      }
    }
  }

  return [];
};

const TreeNode = ({
  node,
  depth,
  expandedDirectories,
  onContextMenu,
  onSelectFile,
  selectedPath,
  onToggleDirectory
}: TreeNodeProps): React.JSX.Element => {
  const paddingLeft = 12 + depth * 16;
  const isExpanded = expandedDirectories.has(node.path);

  if (node.type === 'directory') {
    return (
      <div>
        <button
          className="tree-node tree-node--directory"
          onClick={() => onToggleDirectory(node.path)}
          onContextMenu={(event) => onContextMenu(event, node)}
          style={{ paddingLeft }}
          type="button"
        >
          <span className={`tree-node__chevron ${isExpanded ? 'tree-node__chevron--expanded' : ''}`}>▸</span>
          <span>{node.name}</span>
        </button>
        {isExpanded
          ? node.children?.map((child) => (
              <TreeNode
                expandedDirectories={expandedDirectories}
                key={child.path}
                depth={depth + 1}
                node={child}
                onContextMenu={onContextMenu}
                onSelectFile={onSelectFile}
                onToggleDirectory={onToggleDirectory}
                selectedPath={selectedPath}
              />
            ))
          : null}
      </div>
    );
  }

  return (
    <button
      className={`tree-node tree-node--file ${selectedPath === node.path ? 'tree-node--active' : ''}`}
      onClick={() => onSelectFile(node.path)}
      onContextMenu={(event) => onContextMenu(event, node)}
      style={{ paddingLeft }}
      type="button"
    >
      {node.name}
    </button>
  );
};

const FileTreePane = ({
  canInsertReference,
  rootPath,
  selectedPath,
  tree,
  onCreateFolder,
  onCreateNote,
  onCopyRelativePath,
  onDeleteEntry,
  onInsertReference,
  onOpenInSystem,
  onRenameEntry,
  onSelectFile
}: FileTreePaneProps): React.JSX.Element => {
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [searchValue, setSearchValue] = useState<string>('');
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const deferredSearchValue = useDeferredValue(searchValue);
  const normalizedSearchValue = useMemo(() => normalizeSearchQuery(deferredSearchValue), [deferredSearchValue]);
  const directoryPaths = useMemo(() => collectDirectoryPaths(tree), [tree]);
  const filteredTree = useMemo(
    () => (normalizedSearchValue ? filterTreeNodes(tree, normalizedSearchValue) : tree),
    [normalizedSearchValue, tree]
  );
  const selectedAncestors = useMemo(
    () => (selectedPath ? collectAncestorDirectories(tree, selectedPath) : []),
    [selectedPath, tree]
  );
  const filteredDirectoryPaths = useMemo(() => collectDirectoryPaths(filteredTree), [filteredTree]);
  const visibleExpandedDirectories = useMemo(() => {
    const next = new Set(expandedDirectories);
    selectedAncestors.forEach((item) => next.add(item));
    if (normalizedSearchValue) {
      filteredDirectoryPaths.forEach((item) => next.add(item));
    }
    return next;
  }, [expandedDirectories, filteredDirectoryPaths, normalizedSearchValue, selectedAncestors]);
  const workspaceOpened = rootPath !== '未打开工作区';
  const hasSearchValue = normalizedSearchValue.length > 0;

  useEffect(() => {
    const allDirectories = new Set(directoryPaths);

    setExpandedDirectories((previous) => {
      const next = new Set([...previous].filter((item) => allDirectories.has(item)));
      if (next.size === 0 && directoryPaths.length > 0) {
        directoryPaths.forEach((item) => next.add(item));
      }
      return next;
    });
  }, [directoryPaths]);

  useEffect(() => {
    setSearchValue('');
    setContextMenu(null);
  }, [rootPath]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = (event: MouseEvent): void => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setContextMenu(null);
    };
    const closeContextMenuOnScroll = (): void => {
      setContextMenu(null);
    };

    window.addEventListener('mousedown', closeContextMenu);
    window.addEventListener('scroll', closeContextMenuOnScroll, true);
    return () => {
      window.removeEventListener('mousedown', closeContextMenu);
      window.removeEventListener('scroll', closeContextMenuOnScroll, true);
    };
  }, [contextMenu]);

  const handleToggleDirectory = (targetPath: string): void => {
    setExpandedDirectories((previous) => {
      const next = new Set(previous);
      if (next.has(targetPath)) {
        next.delete(targetPath);
      } else {
        next.add(targetPath);
      }
      return next;
    });
  };

  const handleContextMenu = (event: React.MouseEvent, node: WorkspaceNode): void => {
    event.preventDefault();
    const menuWidth = 176;
    const menuHeight = node.type === 'directory' ? 188 : 224;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 12);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 12);

    setContextMenu({
      node,
      x: Math.max(12, x),
      y: Math.max(12, y)
    });
  };

  const handleCreateNoteInDirectory = (targetDir: string): void => {
    setContextMenu(null);
    onCreateNote(targetDir);
  };

  const handleCreateFolderInDirectory = (targetDir: string): void => {
    setContextMenu(null);
    onCreateFolder(targetDir);
  };

  const handleRename = (targetPath: string): void => {
    setContextMenu(null);
    onRenameEntry(targetPath);
  };

  const handleDelete = (targetPath: string): void => {
    setContextMenu(null);
    onDeleteEntry(targetPath);
  };

  const handleCopyRelativePath = (targetPath: string): void => {
    setContextMenu(null);
    onCopyRelativePath(targetPath);
  };

  const handleInsertReference = (targetPath: string): void => {
    setContextMenu(null);
    onInsertReference(targetPath);
  };

  const handleOpenInSystem = (targetPath: string): void => {
    setContextMenu(null);
    onOpenInSystem(targetPath);
  };

  return (
    <section className="panel panel--file-tree">
      <div className="panel__header panel__header--row">
        <span>文件管理</span>
        <button
          className="panel__action"
          disabled={!workspaceOpened}
          onClick={() => onCreateNote(rootPath)}
          type="button"
        >
          新建笔记
        </button>
      </div>
      <div className="panel__search">
        <input
          className="panel__search-input"
          disabled={!workspaceOpened}
          onChange={(event) => setSearchValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && searchValue) {
              event.preventDefault();
              setSearchValue('');
            }
          }}
          placeholder="搜索文件或文件夹"
          type="text"
          value={searchValue}
        />
        {searchValue ? (
          <button className="panel__search-clear" onClick={() => setSearchValue('')} type="button">
            清空
          </button>
        ) : null}
      </div>
      <div className="panel__subtle">{rootPath}</div>
      <div className="tree-list">
        {tree.length === 0 ? (
          <div className="empty-state">打开一个本地文件夹后，这里会显示笔记树。</div>
        ) : filteredTree.length === 0 ? (
          <div className="empty-state">没有匹配“{searchValue.trim()}”的文件或文件夹。</div>
        ) : (
          filteredTree.map((node) => (
            <TreeNode
              expandedDirectories={visibleExpandedDirectories}
              key={node.path}
              depth={0}
              node={node}
              onContextMenu={handleContextMenu}
              onSelectFile={onSelectFile}
              onToggleDirectory={handleToggleDirectory}
              selectedPath={selectedPath}
            />
          ))
        )}
      </div>
      {contextMenu ? (
        <div
          className="tree-context-menu"
          onMouseDown={(event) => event.stopPropagation()}
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.node.type === 'directory' ? (
            <>
              <button
                className="tree-context-menu__item"
                onClick={() => handleCreateNoteInDirectory(contextMenu.node.path)}
                type="button"
              >
                在此新建笔记
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => handleCreateFolderInDirectory(contextMenu.node.path)}
                type="button"
              >
                在此新建文件夹
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => handleOpenInSystem(contextMenu.node.path)}
                type="button"
              >
                系统打开
              </button>
            </>
          ) : (
            <>
              <button
                className="tree-context-menu__item"
                onClick={() => {
                  setContextMenu(null);
                  onSelectFile(contextMenu.node.path);
                }}
                type="button"
              >
                选中
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => handleOpenInSystem(contextMenu.node.path)}
                type="button"
              >
                系统打开
              </button>
              <button
                className="tree-context-menu__item"
                onClick={() => handleCopyRelativePath(contextMenu.node.path)}
                type="button"
              >
                复制相对路径
              </button>
              <button
                className="tree-context-menu__item"
                disabled={!canInsertReference}
                onClick={() => handleInsertReference(contextMenu.node.path)}
                type="button"
              >
                插入到当前笔记
              </button>
            </>
          )}
          <button className="tree-context-menu__item" onClick={() => handleRename(contextMenu.node.path)} type="button">
            重命名
          </button>
          <button
            className="tree-context-menu__item tree-context-menu__item--danger"
            onClick={() => handleDelete(contextMenu.node.path)}
            type="button"
          >
            删除
          </button>
        </div>
      ) : null}
    </section>
  );
};

export default FileTreePane;
