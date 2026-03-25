# LinkNotes

LinkNotes 是一款本地优先的个人 Markdown 笔记软件，当前项目骨架基于以下技术栈：

- Electron
- React
- TypeScript
- CodeMirror 6
- markdown-it

## 当前完成内容

- Electron Forge 项目骨架
- 左侧文件树区域
- 中间 CodeMirror 6 编辑器
- 右侧 Markdown 实时预览
- `/h1`、`/h2`、`/dmk` 等快捷命令补全与 Tab 展开
- 底部终端抽屉占位结构
- 主进程工作区选择 IPC

## 启动方式

```bash
npm install
npm start
```

## 下一步建议

1. 接入文件读取、保存和重命名能力
2. 接入 xterm.js + node-pty 真正终端
3. 接入搜索和导出
4. 完善状态栏、主题和设置页