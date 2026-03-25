import React from 'react';

type ToolbarProps = {
  onImportAttachment: () => void;
  onPullWebDav: () => void;
  onOpenEditorSearch: () => void;
  onOpenSearch: () => void;
  onPushWebDav: () => void;
  title: string;
  saveStatus: string;
  webDavBusy: boolean;
  importDisabled: boolean;
  onToggleTerminal: () => void;
};

const Toolbar = ({
  title,
  saveStatus,
  onImportAttachment,
  onPullWebDav,
  onOpenEditorSearch,
  onOpenSearch,
  onPushWebDav,
  webDavBusy,
  importDisabled,
  onToggleTerminal
}: ToolbarProps): React.JSX.Element => {
  return (
    <header className="toolbar">
      <div>
        <div className="toolbar__title">{title}</div>
        <div className="toolbar__meta">{saveStatus}</div>
      </div>
      <div className="toolbar__actions">
        <button className="toolbar__button" onClick={onOpenEditorSearch}>
          查找替换
        </button>
        <button className="toolbar__button" disabled={importDisabled} onClick={onImportAttachment}>
          插入附件
        </button>
        <button className="toolbar__button" disabled={webDavBusy} onClick={onPushWebDav}>
          上传同步
        </button>
        <button className="toolbar__button" disabled={webDavBusy} onClick={onPullWebDav}>
          拉取同步
        </button>
        <button className="toolbar__button" onClick={onToggleTerminal}>
          终端
        </button>
        <button className="toolbar__button" onClick={onOpenSearch}>
          搜索
        </button>
      </div>
    </header>
  );
};

export default Toolbar;
