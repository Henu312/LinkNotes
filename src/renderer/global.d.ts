import type { LinkNotesApi } from '../preload/index';

declare global {
  interface Window {
    linkNotes: LinkNotesApi;
  }
}

export {};
