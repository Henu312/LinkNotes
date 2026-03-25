import React from 'react';

type StatusBarProps = {
  currentFileName: string;
  selectedFilePath: string | null;
  workspaceRoot: string;
  wordCount: number;
};

const StatusBar = ({
  currentFileName,
  selectedFilePath,
  workspaceRoot,
  wordCount
}: StatusBarProps): React.JSX.Element => {
  return (
    <footer className="status-bar">
      <span>Markdown</span>
      <span>字数 {wordCount}</span>
      <span>{currentFileName}</span>
      <span>{selectedFilePath ?? workspaceRoot}</span>
    </footer>
  );
};

export default StatusBar;
