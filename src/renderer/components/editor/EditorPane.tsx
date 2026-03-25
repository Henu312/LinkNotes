import React, { useEffect, useRef } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, type ViewUpdate, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { autocompletion } from '@codemirror/autocomplete';
import { oneDark } from '@codemirror/theme-one-dark';
import { slashCommandExtension } from '../../features/commands/slashCommands';

export type EditorSearchSummary = {
  current: number;
  total: number;
};

export type EditorController = {
  clearSearch: () => void;
  findNext: (query: string) => EditorSearchSummary;
  findPrevious: (query: string) => EditorSearchSummary;
  focus: () => void;
  insertText: (text: string) => void;
  redo: () => boolean;
  replaceAll: (query: string, replacement: string) => EditorSearchSummary;
  replaceCurrent: (query: string, replacement: string) => EditorSearchSummary;
  selectAll: () => void;
  setSearchQuery: (query: string, preferredIndex?: number) => EditorSearchSummary;
  undo: () => boolean;
};

type EditorPaneProps = {
  externalScrollRequest?: {
    ratio: number;
    token: number;
  } | null;
  onImportAttachment?: (kind: 'file' | 'image') => Promise<string | null>;
  onImportAttachmentData?: (files: File[]) => Promise<string | null>;
  onScrollChange?: (ratio: number) => void;
  onReady?: (controller: EditorController) => void;
  onChange: (value: string) => void;
  syncScrollEnabled?: boolean;
  value: string;
};

type SearchMatch = {
  from: number;
  to: number;
};

const setSearchDecorationsEffect = StateEffect.define<{
  decorations: DecorationSet;
}>();

const searchDecorationsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (value, transaction) => {
    let nextValue = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setSearchDecorationsEffect)) {
        nextValue = effect.value.decorations;
      }
    }
    return nextValue;
  },
  provide: (field) => EditorView.decorations.from(field)
});

const searchMatchDecoration = Decoration.mark({
  class: 'cm-searchMatch'
});

const activeSearchMatchDecoration = Decoration.mark({
  class: 'cm-searchMatch cm-searchMatch--active'
});

const normalizeSearchQuery = (value: string): string => value.toLocaleLowerCase();

const findMatches = (content: string, query: string): SearchMatch[] => {
  if (!query) {
    return [];
  }

  const normalizedContent = normalizeSearchQuery(content);
  const normalizedQuery = normalizeSearchQuery(query);
  const matches: SearchMatch[] = [];
  let startIndex = 0;

  while (startIndex <= normalizedContent.length - normalizedQuery.length) {
    const nextIndex = normalizedContent.indexOf(normalizedQuery, startIndex);
    if (nextIndex < 0) {
      break;
    }

    matches.push({
      from: nextIndex,
      to: nextIndex + normalizedQuery.length
    });
    startIndex = nextIndex + normalizedQuery.length;
  }

  return matches;
};

const getSummary = (matches: SearchMatch[], activeIndex: number): EditorSearchSummary => ({
  current: matches.length === 0 || activeIndex < 0 ? 0 : activeIndex + 1,
  total: matches.length
});

const getScrollRatio = (element: HTMLElement): number => {
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  if (maxScrollTop <= 0) {
    return 0;
  }

  return element.scrollTop / maxScrollTop;
};

const setScrollRatio = (element: HTMLElement, ratio: number): void => {
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  if (maxScrollTop <= 0) {
    element.scrollTop = 0;
    return;
  }

  const nextRatio = Math.min(Math.max(ratio, 0), 1);
  element.scrollTop = maxScrollTop * nextRatio;
};

const EditorPane = ({
  value,
  onChange,
  onImportAttachment,
  onImportAttachmentData,
  onReady,
  onScrollChange,
  externalScrollRequest = null,
  syncScrollEnabled = true
}: EditorPaneProps): React.JSX.Element => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onScrollChangeRef = useRef(onScrollChange);
  const onImportAttachmentRef = useRef(onImportAttachment);
  const onImportAttachmentDataRef = useRef(onImportAttachmentData);
  const searchQueryRef = useRef<string>('');
  const matchesRef = useRef<SearchMatch[]>([]);
  const activeMatchIndexRef = useRef<number>(-1);
  const syncScrollEnabledRef = useRef(syncScrollEnabled);
  const suppressScrollEventRef = useRef<boolean>(false);
  const appliedScrollTokenRef = useRef<number | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onScrollChangeRef.current = onScrollChange;
  }, [onScrollChange]);

  useEffect(() => {
    onImportAttachmentRef.current = onImportAttachment;
  }, [onImportAttachment]);

  useEffect(() => {
    onImportAttachmentDataRef.current = onImportAttachmentData;
  }, [onImportAttachmentData]);

  useEffect(() => {
    syncScrollEnabledRef.current = syncScrollEnabled;
  }, [syncScrollEnabled]);

  const insertImportedText = (view: EditorView, text: string, from: number, to: number): void => {
    if (!text) {
      return;
    }

    view.dispatch({
      changes: {
        from,
        to,
        insert: text
      },
      selection: {
        anchor: from + text.length
      }
    });
    view.focus();
  };

  const updateSearchDecorations = (
    view: EditorView,
    query: string,
    preferredIndex?: number,
    anchorPosition?: number
  ): EditorSearchSummary => {
    const matches = findMatches(view.state.doc.toString(), query);
    matchesRef.current = matches;

    if (!query || matches.length === 0) {
      activeMatchIndexRef.current = -1;
      view.dispatch({
        effects: setSearchDecorationsEffect.of({
          decorations: Decoration.none
        })
      });
      return getSummary(matches, -1);
    }

    let activeIndex = activeMatchIndexRef.current;

    if (typeof preferredIndex === 'number') {
      activeIndex = ((preferredIndex % matches.length) + matches.length) % matches.length;
    } else if (typeof anchorPosition === 'number') {
      const nextIndex = matches.findIndex((match) => match.from >= anchorPosition || match.to >= anchorPosition);
      activeIndex = nextIndex >= 0 ? nextIndex : 0;
    } else if (activeIndex < 0 || activeIndex >= matches.length) {
      activeIndex = 0;
    }

    activeMatchIndexRef.current = activeIndex;

    const decorations = Decoration.set(
      matches.map((match, index) =>
        (index === activeIndex ? activeSearchMatchDecoration : searchMatchDecoration).range(match.from, match.to)
      )
    );

    view.dispatch({
      effects: setSearchDecorationsEffect.of({
        decorations
      })
    });

    return getSummary(matches, activeIndex);
  };

  const moveToMatch = (view: EditorView, nextIndex: number): EditorSearchSummary => {
    const matches = matchesRef.current;
    if (matches.length === 0) {
      return getSummary(matches, -1);
    }

    const activeIndex = ((nextIndex % matches.length) + matches.length) % matches.length;
    const target = matches[activeIndex];
    activeMatchIndexRef.current = activeIndex;

    view.dispatch({
      selection: EditorSelection.single(target.from, target.to),
      scrollIntoView: true
    });

    return updateSearchDecorations(view, searchQueryRef.current, activeIndex);
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host || viewRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        autocompletion(),
        placeholder('在这里写下你的 Markdown 笔记...'),
        slashCommandExtension({
          onImportFile: (view, from, to) => {
            const requestImportAttachment = onImportAttachmentRef.current;
            if (!requestImportAttachment) {
              return;
            }

            void requestImportAttachment('file').then((insertedText) => {
              if (!insertedText || viewRef.current !== view) {
                return;
              }

              insertImportedText(view, insertedText, from, to);
            });
          },
          onImportImage: (view, from, to) => {
            const requestImportAttachment = onImportAttachmentRef.current;
            if (!requestImportAttachment) {
              return;
            }

            void requestImportAttachment('image').then((insertedText) => {
              if (!insertedText || viewRef.current !== view) {
                return;
              }

              insertImportedText(view, insertedText, from, to);
            });
          }
        }),
        searchDecorationsField,
        EditorView.lineWrapping,
        oneDark,
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
            if (searchQueryRef.current) {
              updateSearchDecorations(update.view, searchQueryRef.current, undefined, update.state.selection.main.from);
            }
          }
        })
      ]
    });

    viewRef.current = new EditorView({
      state,
      parent: host
    });

    const scrollElement = viewRef.current.scrollDOM;
    const handleScroll = (): void => {
      if (!syncScrollEnabledRef.current || suppressScrollEventRef.current) {
        return;
      }

      onScrollChangeRef.current?.(getScrollRatio(scrollElement));
    };
    const handlePaste = (event: ClipboardEvent): void => {
      const requestImportAttachmentData = onImportAttachmentDataRef.current;
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.size > 0);
      if (!requestImportAttachmentData || files.length === 0) {
        return;
      }

      event.preventDefault();
      const selection = viewRef.current?.state.selection.main;
      const from = selection?.from ?? 0;
      const to = selection?.to ?? from;

      void requestImportAttachmentData(files).then((insertedText) => {
        const currentView = viewRef.current;
        if (!currentView || !insertedText) {
          return;
        }
        insertImportedText(currentView, insertedText, from, to);
      });
    };
    const handleDragOver = (event: DragEvent): void => {
      if ((event.dataTransfer?.files.length ?? 0) > 0) {
        event.preventDefault();
      }
    };
    const handleDrop = (event: DragEvent): void => {
      const requestImportAttachmentData = onImportAttachmentDataRef.current;
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.size > 0);
      if (!requestImportAttachmentData || files.length === 0) {
        return;
      }

      event.preventDefault();
      const currentView = viewRef.current;
      if (!currentView) {
        return;
      }

      const dropPosition = currentView.posAtCoords({ x: event.clientX, y: event.clientY });
      const from = dropPosition ?? currentView.state.selection.main.from;
      const to = dropPosition ?? currentView.state.selection.main.to;

      void requestImportAttachmentData(files).then((insertedText) => {
        const nextView = viewRef.current;
        if (!nextView || !insertedText) {
          return;
        }
        insertImportedText(nextView, insertedText, from, to);
      });
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    viewRef.current.dom.addEventListener('paste', handlePaste);
    viewRef.current.dom.addEventListener('dragover', handleDragOver);
    viewRef.current.dom.addEventListener('drop', handleDrop);

    onReadyRef.current?.({
      clearSearch: () => {
        searchQueryRef.current = '';
        matchesRef.current = [];
        activeMatchIndexRef.current = -1;
        if (viewRef.current) {
          viewRef.current.dispatch({
            effects: setSearchDecorationsEffect.of({
              decorations: Decoration.none
            })
          });
        }
      },
      findNext: (query) => {
        const view = viewRef.current;
        if (!view) {
          return { current: 0, total: 0 };
        }

        const nextQuery = query.trim();
        if (!nextQuery) {
          searchQueryRef.current = '';
          return updateSearchDecorations(view, '');
        }

        const shouldReset = searchQueryRef.current !== nextQuery || matchesRef.current.length === 0;
        searchQueryRef.current = nextQuery;

        if (shouldReset) {
          const summary = updateSearchDecorations(view, nextQuery, undefined, view.state.selection.main.to);
          return summary.total > 0 ? moveToMatch(view, activeMatchIndexRef.current) : summary;
        }

        return moveToMatch(view, activeMatchIndexRef.current + 1);
      },
      findPrevious: (query) => {
        const view = viewRef.current;
        if (!view) {
          return { current: 0, total: 0 };
        }

        const nextQuery = query.trim();
        if (!nextQuery) {
          searchQueryRef.current = '';
          return updateSearchDecorations(view, '');
        }

        const shouldReset = searchQueryRef.current !== nextQuery || matchesRef.current.length === 0;
        searchQueryRef.current = nextQuery;

        if (shouldReset) {
          const summary = updateSearchDecorations(view, nextQuery, undefined, view.state.selection.main.from);
          return summary.total > 0 ? moveToMatch(view, activeMatchIndexRef.current) : summary;
        }

        return moveToMatch(view, activeMatchIndexRef.current - 1);
      },
      focus: () => {
        viewRef.current?.focus();
      },
      insertText: (text) => {
        const view = viewRef.current;
        if (!view || !text) {
          return;
        }

        const selection = view.state.selection.main;
        view.dispatch({
          changes: {
            from: selection.from,
            to: selection.to,
            insert: text
          },
          selection: {
            anchor: selection.from + text.length
          }
        });
        view.focus();
      },
      redo: () => {
        const view = viewRef.current;
        return view ? redo(view) : false;
      },
      replaceAll: (query, replacement) => {
        const view = viewRef.current;
        if (!view) {
          return { current: 0, total: 0 };
        }

        const nextQuery = query.trim();
        if (!nextQuery) {
          searchQueryRef.current = '';
          return updateSearchDecorations(view, '');
        }

        const matches = findMatches(view.state.doc.toString(), nextQuery);
        if (matches.length === 0) {
          searchQueryRef.current = nextQuery;
          return updateSearchDecorations(view, nextQuery);
        }

        view.dispatch({
          changes: matches
            .slice()
            .reverse()
            .map((match) => ({
              from: match.from,
              to: match.to,
              insert: replacement
            }))
        });

        searchQueryRef.current = nextQuery;
        view.focus();
        return updateSearchDecorations(view, nextQuery);
      },
      replaceCurrent: (query, replacement) => {
        const view = viewRef.current;
        if (!view) {
          return { current: 0, total: 0 };
        }

        const nextQuery = query.trim();
        if (!nextQuery) {
          searchQueryRef.current = '';
          return updateSearchDecorations(view, '');
        }

        if (searchQueryRef.current !== nextQuery || matchesRef.current.length === 0) {
          searchQueryRef.current = nextQuery;
          updateSearchDecorations(view, nextQuery, undefined, view.state.selection.main.from);
        }

        const matches = matchesRef.current;
        const activeIndex = activeMatchIndexRef.current;
        if (matches.length === 0 || activeIndex < 0) {
          return getSummary(matches, activeIndex);
        }

        const activeMatch = matches[activeIndex];
        view.dispatch({
          changes: {
            from: activeMatch.from,
            to: activeMatch.to,
            insert: replacement
          }
        });

        searchQueryRef.current = nextQuery;
        const summary = updateSearchDecorations(view, nextQuery, activeIndex, activeMatch.from + replacement.length);
        return summary.total > 0 ? moveToMatch(view, activeMatchIndexRef.current) : summary;
      },
      selectAll: () => {
        const view = viewRef.current;
        if (!view) {
          return;
        }

        view.dispatch({
          selection: {
            anchor: 0,
            head: view.state.doc.length
          }
        });
        view.focus();
      },
      setSearchQuery: (query, preferredIndex) => {
        const view = viewRef.current;
        if (!view) {
          return { current: 0, total: 0 };
        }

        const nextQuery = query.trim();
        searchQueryRef.current = nextQuery;
        if (!nextQuery) {
          return updateSearchDecorations(view, '');
        }

        const summary = updateSearchDecorations(
          view,
          nextQuery,
          preferredIndex,
          typeof preferredIndex === 'number' ? undefined : view.state.selection.main.from
        );
        if (summary.total > 0 && activeMatchIndexRef.current >= 0) {
          const match = matchesRef.current[activeMatchIndexRef.current];
          view.dispatch({
            selection: EditorSelection.single(match.from, match.to),
            scrollIntoView: true
          });
        }
        return summary;
      },
      undo: () => {
        const view = viewRef.current;
        return view ? undo(view) : false;
      }
    });

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
      viewRef.current?.dom.removeEventListener('paste', handlePaste);
      viewRef.current?.dom.removeEventListener('dragover', handleDragOver);
      viewRef.current?.dom.removeEventListener('drop', handleDrop);
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const current = view.state.doc.toString();
    if (current === value) {
      return;
    }

    view.dispatch({
      changes: {
        from: 0,
        to: current.length,
        insert: value
      }
    });

    if (searchQueryRef.current) {
      updateSearchDecorations(view, searchQueryRef.current, undefined, view.state.selection.main.from);
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !externalScrollRequest || appliedScrollTokenRef.current === externalScrollRequest.token) {
      return;
    }

    appliedScrollTokenRef.current = externalScrollRequest.token;
    suppressScrollEventRef.current = true;
    setScrollRatio(view.scrollDOM, externalScrollRequest.ratio);

    const releaseTimer = window.setTimeout(() => {
      suppressScrollEventRef.current = false;
    }, 0);

    return () => {
      window.clearTimeout(releaseTimer);
    };
  }, [externalScrollRequest]);

  return (
    <section className="panel panel--editor">
      <div className="panel__header">编辑</div>
      <div className="editor-host" ref={hostRef} />
    </section>
  );
};

export default EditorPane;
