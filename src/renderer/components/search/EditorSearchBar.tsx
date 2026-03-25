import React from 'react';
import type { EditorSearchSummary } from '../editor/EditorPane';

type EditorSearchBarProps = {
  onChangeQuery: (value: string) => void;
  onChangeReplacement: (value: string) => void;
  onClose: () => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onReplaceAll: () => void;
  onReplaceCurrent: () => void;
  onToggleReplace: () => void;
  open: boolean;
  query: string;
  replacement: string;
  replaceVisible: boolean;
  summary: EditorSearchSummary;
};

const EditorSearchBar = ({
  onChangeQuery,
  onChangeReplacement,
  onClose,
  onFindNext,
  onFindPrevious,
  onReplaceAll,
  onReplaceCurrent,
  onToggleReplace,
  open,
  query,
  replacement,
  replaceVisible,
  summary
}: EditorSearchBarProps): React.JSX.Element | null => {
  if (!open) {
    return null;
  }

  return (
    <div className="editor-search-bar">
      <div className="editor-search-bar__main">
        <input
          className="editor-search-bar__input"
          onChange={(event) => onChangeQuery(event.target.value)}
          placeholder="查找"
          type="text"
          value={query}
        />
        <div className="editor-search-bar__summary">
          {query.trim() ? `${summary.current}/${summary.total}` : '输入关键词'}
        </div>
        <button className="toolbar__button" onClick={onFindPrevious} type="button">
          上一个
        </button>
        <button className="toolbar__button" onClick={onFindNext} type="button">
          下一个
        </button>
        <button className="toolbar__button" onClick={onToggleReplace} type="button">
          {replaceVisible ? '隐藏替换' : '替换'}
        </button>
        <button className="toolbar__button" onClick={onClose} type="button">
          关闭
        </button>
      </div>
      {replaceVisible ? (
        <div className="editor-search-bar__replace">
          <input
            className="editor-search-bar__input"
            onChange={(event) => onChangeReplacement(event.target.value)}
            placeholder="替换为"
            type="text"
            value={replacement}
          />
          <button className="toolbar__button" onClick={onReplaceCurrent} type="button">
            替换当前
          </button>
          <button className="toolbar__button" onClick={onReplaceAll} type="button">
            全部替换
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default EditorSearchBar;
