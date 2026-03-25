import { BrowserWindow, dialog, type IpcMain } from 'electron';
import { promises as fs } from 'node:fs';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
});

const buildHtmlDocument = (title: string, markdown: string): string => {
  const body = md.render(markdown);

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
        color: #1f2937;
        background: #ffffff;
      }
      body {
        margin: 0;
        padding: 40px;
        line-height: 1.75;
      }
      main {
        max-width: 880px;
        margin: 0 auto;
      }
      h1, h2, h3, h4, h5, h6 {
        margin-top: 1.4em;
        margin-bottom: 0.6em;
      }
      code {
        background: #edf2f7;
        border-radius: 6px;
        padding: 2px 6px;
      }
      pre {
        background: #0f1723;
        color: #e2e8f0;
        border-radius: 12px;
        padding: 16px;
        overflow: auto;
      }
      img {
        max-width: 100%;
      }
      table {
        border-collapse: collapse;
      }
      th, td {
        border: 1px solid #d8e0ec;
        padding: 8px 10px;
      }
      blockquote {
        margin: 0;
        padding-left: 16px;
        border-left: 4px solid #cbd5e1;
        color: #475569;
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
};

const getSavePath = async (title: string, extension: 'html' | 'pdf'): Promise<string | null> => {
  const result = await dialog.showSaveDialog({
    defaultPath: `${title}.${extension}`,
    filters: [
      {
        extensions: [extension],
        name: extension.toUpperCase()
      }
    ]
  });

  return result.canceled || !result.filePath ? null : result.filePath;
};

export const registerExportIpc = (ipcMain: IpcMain): void => {
  ipcMain.handle('export:html', async (_event, title: string, markdown: string) => {
    const filePath = await getSavePath(title, 'html');
    if (!filePath) {
      return { canceled: true };
    }

    await fs.writeFile(filePath, buildHtmlDocument(title, markdown), 'utf8');
    return {
      canceled: false,
      filePath
    };
  });

  ipcMain.handle('export:pdf', async (_event, title: string, markdown: string) => {
    const filePath = await getSavePath(title, 'pdf');
    if (!filePath) {
      return { canceled: true };
    }

    const exportWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: false
      }
    });

    try {
      const html = buildHtmlDocument(title, markdown);
      await exportWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await exportWindow.webContents.printToPDF({
        printBackground: true
      });
      await fs.writeFile(filePath, pdf);

      return {
        canceled: false,
        filePath
      };
    } finally {
      exportWindow.destroy();
    }
  });
};
