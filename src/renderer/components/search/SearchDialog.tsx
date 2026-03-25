import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceSearchResult } from '../../../main/ipc/workspace';

type SearchDialogProps = {
  loading: boolean;
  onClose: () => void;
  onOpenResult: (result: WorkspaceSearchResult) => void;
  onSearch: (query: string) => void;
  open: boolean;
  query: string;
  results: WorkspaceSearchResult[];
  workspaceOpened: boolean;
};

type SearchGroup = {
  fileName: string;
  filePath: string;
  relativePath: string;
  results: WorkspaceSearchResult[];
};

const getMatchTypeLabel = (matchType: WorkspaceSearchResult['matchType']): string => {
  if (matchType === 'both') {
    return '文件名 + 内容';
  }

  return matchType === 'fileName' ? '文件名' : '内容';
};

const getLocationLabel = (result: WorkspaceSearchResult): string | null => {
  if (result.lineNumber === null || result.columnNumber === null) {
    return null;
  }

  return `第 ${result.lineNumber} 行，第 ${result.columnNumber} 列`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const renderHighlightedText = (text: string, query: string): React.ReactNode => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return text;
  }

  const matcher = new RegExp(`(${escapeRegExp(trimmedQuery)})`, 'ig');
  const segments = text.split(matcher);

  return segments.map((segment, index) =>
    segment.toLocaleLowerCase() === trimmedQuery.toLocaleLowerCase() ? (
      <mark className="search-highlight" key={`${segment}-${index}`}>
        {segment}
      </mark>
    ) : (
      <React.Fragment key={`${segment}-${index}`}>{segment}</React.Fragment>
    )
  );
};

const SearchDialog = ({
  loading,
  onClose,
  onOpenResult,
  onSearch,
  open,
  query,
  results,
  workspaceOpened
}: SearchDialogProps): React.JSX.Element | null => {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const groups = useMemo<SearchGroup[]>(() => {
    const grouped = new Map<string, SearchGroup>();

    results.forEach((result) => {
      const currentGroup = grouped.get(result.filePath);
      if (currentGroup) {
        currentGroup.results.push(result);
        return;
      }

      grouped.set(result.filePath, {
        fileName: result.fileName,
        filePath: result.filePath,
        relativePath: result.relativePath,
        results: [result]
      });
    });

    return Array.from(grouped.values());
  }, [results]);
  const visibleResults = useMemo(
    () => groups.flatMap((group) => (collapsedGroups.has(group.filePath) ? [] : group.results)),
    [collapsedGroups, groups]
  );
  const allExpanded = groups.length > 0 && collapsedGroups.size === 0;
  const allCollapsed = groups.length > 0 && collapsedGroups.size === groups.length;
  const resultCountText = useMemo(() => {
    if (!hasQuery) {
      return '输入关键词后搜索文件名和正文';
    }

    if (loading) {
      return '搜索中...';
    }

    return `共 ${results.length} 条命中，分布在 ${groups.length} 个文件`;
  }, [groups.length, hasQuery, loading, results.length]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
    setCollapsedGroups(new Set());
  }, [query, results]);

  useEffect(() => {
    setActiveIndex((current) => {
      if (visibleResults.length === 0) {
        return 0;
      }

      return Math.min(current, visibleResults.length - 1);
    });
  }, [visibleResults]);

  if (!open) {
    return null;
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (visibleResults.length === 0 ? 0 : (current + 1) % visibleResults.length));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (visibleResults.length === 0 ? 0 : (current - 1 + visibleResults.length) % visibleResults.length));
      return;
    }

    if (event.key === 'Enter' && visibleResults[activeIndex]) {
      event.preventDefault();
      onOpenResult(visibleResults[activeIndex]);
    }
  };

  return (
    <div className="search-dialog-backdrop" onClick={onClose} role="presentation">
      <section
        aria-label="全局搜索"
        aria-modal="true"
        className="search-dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
      >
        <div className="search-dialog__header">
          <div>
            <div className="search-dialog__title">全局搜索</div>
            <div className="search-dialog__meta">{workspaceOpened ? resultCountText : '请先打开工作区'}</div>
          </div>
          <button className="search-dialog__close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="search-dialog__body">
          <div className="search-dialog__toolbar">
            <input
              className="search-dialog__input"
              disabled={!workspaceOpened}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="搜索文件名或 Markdown 内容"
              ref={inputRef}
              type="text"
              value={query}
            />
            {groups.length > 1 ? (
              <div className="search-dialog__actions">
                <button
                  className="search-dialog__action"
                  disabled={allExpanded}
                  onClick={() => setCollapsedGroups(new Set())}
                  type="button"
                >
                  全部展开
                </button>
                <button
                  className="search-dialog__action"
                  disabled={allCollapsed}
                  onClick={() => setCollapsedGroups(new Set(groups.map((group) => group.filePath)))}
                  type="button"
                >
                  全部折叠
                </button>
              </div>
            ) : null}
          </div>
          <div className="search-dialog__results">
            {!workspaceOpened ? (
              <div className="search-dialog__empty">打开工作区后才能搜索。</div>
            ) : !hasQuery ? (
              <div className="search-dialog__empty">支持搜索文件名和正文内容，按 Enter 打开结果。</div>
            ) : loading ? (
              <div className="search-dialog__empty">正在搜索，请稍候...</div>
            ) : results.length === 0 ? (
              <div className="search-dialog__empty">没有找到与“{trimmedQuery}”相关的内容。</div>
            ) : (
              (() => {
                let visibleIndex = -1;

                return groups.map((group) => {
                  const collapsed = collapsedGroups.has(group.filePath);
                  return (
                    <div className="search-group" key={group.filePath}>
                      <button
                        className="search-group__header"
                        onClick={() =>
                          setCollapsedGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group.filePath)) {
                              next.delete(group.filePath);
                            } else {
                              next.add(group.filePath);
                            }
                            return next;
                          })
                        }
                        type="button"
                      >
                        <div className="search-group__title-row">
                          <span
                            className={`search-group__chevron ${collapsed ? '' : 'search-group__chevron--expanded'}`}
                          >
                            ▸
                          </span>
                          <span className="search-group__title">
                            {renderHighlightedText(group.fileName, trimmedQuery)}
                          </span>
                          <span className="search-group__count">{group.results.length} 条</span>
                        </div>
                        <div className="search-group__path">{renderHighlightedText(group.relativePath, trimmedQuery)}</div>
                      </button>
                      {!collapsed ? (
                        <div className="search-group__items">
                          {group.results.map((result) => {
                            visibleIndex += 1;
                            return (
                              <button
                                className={`search-result ${visibleIndex === activeIndex ? 'search-result--active' : ''}`}
                                key={result.resultId}
                                onClick={() => onOpenResult(result)}
                                onMouseEnter={() => setActiveIndex(visibleIndex)}
                                type="button"
                              >
                                <div className="search-result__header">
                                  <span className="search-result__title">
                                    {renderHighlightedText(result.fileName, trimmedQuery)}
                                  </span>
                                  <span className="search-result__tag">{getMatchTypeLabel(result.matchType)}</span>
                                </div>
                                {getLocationLabel(result) ? (
                                  <div className="search-result__location">{getLocationLabel(result)}</div>
                                ) : null}
                                <div className="search-result__preview">
                                  {renderHighlightedText(result.preview, trimmedQuery)}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                });
              })()
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

export default SearchDialog;
