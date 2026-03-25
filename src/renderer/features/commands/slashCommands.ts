import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { EditorView, keymap } from '@codemirror/view';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';

type SlashCommandOptions = {
  onImportFile?: (view: EditorView, from: number, to: number) => void;
  onImportImage?: (view: EditorView, from: number, to: number) => void;
};

const createCommands = (options?: SlashCommandOptions): Completion[] => [
  { label: '/h1', detail: '一级标题', apply: '# ' },
  { label: '/h2', detail: '二级标题', apply: '## ' },
  { label: '/h3', detail: '三级标题', apply: '### ' },
  { label: '/todo', detail: '待办项', apply: '- [ ] ' },
  { label: '/quote', detail: '引用', apply: '> ' },
  { label: '/code', detail: '代码块', apply: '```text\n\n```' },
  { label: '/dmk', detail: '代码块', apply: '```text\n\n```' },
  { label: '/table', detail: '表格', apply: '| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |' },
  { label: '/link', detail: '链接', apply: '[标题](https://example.com)' },
  {
    label: '/img',
    detail: '导入图片',
    apply: (view, _completion, from, to) => {
      options?.onImportImage?.(view, from, to);
    }
  },
  {
    label: '/file',
    detail: '导入附件',
    apply: (view, _completion, from, to) => {
      options?.onImportFile?.(view, from, to);
    }
  }
];

const applyCompletion = (
  view: EditorView,
  command: Completion,
  from: number,
  to: number
): boolean => {
  if (typeof command.apply === 'string') {
    view.dispatch({
      changes: {
        from,
        to,
        insert: command.apply
      },
      selection: {
        anchor: from + command.apply.length
      }
    });
    return true;
  }

  if (typeof command.apply === 'function') {
    command.apply(view, command, from, to);
    return true;
  }

  return false;
};

const slashCommandSource = (context: CompletionContext) => {
  const word = context.matchBefore(/\/[\w-]*/);
  if (!word || (word.from === word.to && !context.explicit)) {
    return null;
  }

  return {
    from: word.from,
    options: createCommands(),
    validFor: /^\/[\w-]*$/
  };
};

export const slashCommandExtension = (options?: SlashCommandOptions) => [
  autocompletion({
    override: [
      (context) => {
        const source = slashCommandSource(context);
        return source
          ? {
              ...source,
              options: createCommands(options)
            }
          : null;
      }
    ],
    icons: false,
    defaultKeymap: false,
    activateOnTyping: true
  }),
  keymap.of(completionKeymap),
  keymap.of([
    {
      key: 'Tab',
      run(view) {
        const selection = view.state.selection.main;
        const line = view.state.doc.lineAt(selection.from);
        const beforeCursor = line.text.slice(0, selection.from - line.from);
        const match = beforeCursor.match(/\/[\w-]+$/);

        if (!match) {
          return false;
        }

        const commands = createCommands(options);
        const command = commands.find((item) => item.label === match[0]);
        if (!command) {
          return false;
        }

        const from = selection.from - match[0].length;
        return applyCompletion(view, command, from, selection.from);
      }
    }
  ])
];
