import React, { useEffect, useRef } from 'react';

type PreviewPaneProps = {
  actions?: React.ReactNode;
  assetBasePath?: string | null;
  externalScrollRequest?: {
    ratio: number;
    token: number;
  } | null;
  focusOccurrence?: number;
  focusToken?: number;
  highlightQuery?: string;
  html: string;
  onScrollChange?: (ratio: number) => void;
  resourcePreview?: boolean;
  syncScrollEnabled?: boolean;
  title?: string;
};

const highlightClassName = 'preview-search-highlight';
const activeHighlightClassName = 'preview-search-highlight--active';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const localFileProtocolPattern = /^(?:file:|https?:|data:|mailto:|\/\/)/iu;
const windowsAbsolutePathPattern = /^[a-z]:[\\/]/iu;

const toFileUrl = (targetPath: string, treatAsDirectory = false): string => {
  const normalizedPath = targetPath.replaceAll('\\', '/');
  const absolutePath = treatAsDirectory && !normalizedPath.endsWith('/') ? `${normalizedPath}/` : normalizedPath;

  if (windowsAbsolutePathPattern.test(absolutePath)) {
    return encodeURI(`file:///${absolutePath}`);
  }

  return encodeURI(`file://${absolutePath.startsWith('/') ? '' : '/'}${absolutePath}`);
};

const resolveLocalResourceUrl = (targetPath: string, assetBasePath?: string | null): string | null => {
  const trimmedPath = targetPath.trim();
  if (!trimmedPath || trimmedPath.startsWith('#') || localFileProtocolPattern.test(trimmedPath)) {
    return null;
  }

  if (windowsAbsolutePathPattern.test(trimmedPath)) {
    return toFileUrl(trimmedPath);
  }

  if (!assetBasePath) {
    return null;
  }

  try {
    return new URL(trimmedPath.replaceAll('\\', '/'), toFileUrl(assetBasePath, true)).toString();
  } catch {
    return null;
  }
};

const clearHighlights = (container: HTMLElement): void => {
  const highlights = container.querySelectorAll(`.${highlightClassName}`);
  highlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    if (!parent) {
      return;
    }

    parent.replaceChild(document.createTextNode(highlight.textContent ?? ''), highlight);
    parent.normalize();
  });
};

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

const PreviewPane = ({
  actions = null,
  html,
  assetBasePath = null,
  onScrollChange,
  externalScrollRequest = null,
  syncScrollEnabled = true,
  highlightQuery = '',
  focusOccurrence = 0,
  focusToken = 0,
  resourcePreview = false,
  title = '预览'
}: PreviewPaneProps): React.JSX.Element => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const onScrollChangeRef = useRef(onScrollChange);
  const syncScrollEnabledRef = useRef(syncScrollEnabled);
  const suppressScrollEventRef = useRef<boolean>(false);
  const appliedScrollTokenRef = useRef<number | null>(null);

  useEffect(() => {
    onScrollChangeRef.current = onScrollChange;
  }, [onScrollChange]);

  useEffect(() => {
    syncScrollEnabledRef.current = syncScrollEnabled;
  }, [syncScrollEnabled]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) {
      return;
    }

    const handleScroll = (): void => {
      if (!syncScrollEnabledRef.current || suppressScrollEventRef.current) {
        return;
      }

      onScrollChangeRef.current?.(getScrollRatio(container));
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) {
      return;
    }

    const resourceNodes = container.querySelectorAll<HTMLElement>('img[src], a[href]');
    resourceNodes.forEach((node) => {
      const attributeName = node.tagName === 'IMG' ? 'src' : 'href';
      const currentValue = node.getAttribute(attributeName);
      if (!currentValue) {
        return;
      }

      const resolvedUrl = resolveLocalResourceUrl(currentValue, assetBasePath);
      if (resolvedUrl) {
        node.setAttribute(attributeName, resolvedUrl);
      }
    });
  }, [assetBasePath, html]);

  useEffect(() => {
    if (!resourcePreview) {
      return;
    }

    const container = bodyRef.current;
    if (!container) {
      return;
    }

    const handleClick = (event: MouseEvent): void => {
      const image = (event.target as HTMLElement | null)?.closest<HTMLImageElement>('img[data-preview-zoomable="true"]');
      if (!image) {
        return;
      }

      image.classList.toggle('preview-resource-image--zoomed');
    };

    container.addEventListener('click', handleClick);
    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [html, resourcePreview]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container) {
      return;
    }

    clearHighlights(container);

    const query = highlightQuery.trim();
    if (!query) {
      return;
    }

    const matcher = new RegExp(escapeRegExp(query), 'ig');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.textContent?.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parentElement = node.parentElement;
        if (!parentElement || parentElement.closest(`.${highlightClassName}`)) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const textNodes: Text[] = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      textNodes.push(currentNode as Text);
      currentNode = walker.nextNode();
    }

    const highlightElements: HTMLElement[] = [];

    textNodes.forEach((textNode) => {
      const text = textNode.textContent ?? '';
      matcher.lastIndex = 0;
      const matches = Array.from(text.matchAll(matcher));
      if (matches.length === 0) {
        return;
      }

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      matches.forEach((match, index) => {
        const matchIndex = match.index ?? 0;
        if (matchIndex > lastIndex) {
          fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
        }

        const mark = document.createElement('mark');
        mark.className = highlightClassName;
        mark.textContent = text.slice(matchIndex, matchIndex + match[0].length);
        fragment.appendChild(mark);
        highlightElements.push(mark);

        lastIndex = matchIndex + match[0].length;
      });

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    });

    const targetHighlight = highlightElements[Math.min(Math.max(focusOccurrence, 0), highlightElements.length - 1)];
    if (targetHighlight) {
      targetHighlight.classList.add(activeHighlightClassName);
      window.requestAnimationFrame(() => {
        targetHighlight.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      });
    }
  }, [focusOccurrence, focusToken, highlightQuery, html]);

  useEffect(() => {
    const container = bodyRef.current;
    if (!container || !externalScrollRequest || appliedScrollTokenRef.current === externalScrollRequest.token) {
      return;
    }

    appliedScrollTokenRef.current = externalScrollRequest.token;
    suppressScrollEventRef.current = true;
    setScrollRatio(container, externalScrollRequest.ratio);

    const releaseTimer = window.setTimeout(() => {
      suppressScrollEventRef.current = false;
    }, 0);

    return () => {
      window.clearTimeout(releaseTimer);
    };
  }, [externalScrollRequest]);

  return (
    <section className="panel panel--preview">
      <div className="panel__header panel__header--row">
        <span>{title}</span>
        {actions ? <div className="preview-panel__actions">{actions}</div> : null}
      </div>
      <div className="preview-body" dangerouslySetInnerHTML={{ __html: html }} ref={bodyRef} />
    </section>
  );
};

export default PreviewPane;
