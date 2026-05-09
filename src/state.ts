import { defaultPalette, generate } from "./palette";
import type { Mode, Palette } from "./types";

interface DocState {
  palette: Palette;
  path: string | null;
  savedHash: number;
}

export const doc: DocState = {
  palette: defaultPalette(),
  path: null,
  savedHash: 0,
};
doc.savedHash = hashPalette(doc.palette);

const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() { for (const fn of listeners) fn(); }

export function setPrimary(hex: string) {
  const next: Palette = {
    ...doc.palette,
    primary: hex.toLowerCase(),
    slots: generate(hex, doc.palette.mode),
  };
  doc.palette = next;
  notify();
}

export function setMode(mode: Mode) {
  if (doc.palette.mode === mode) return;
  doc.palette = {
    ...doc.palette,
    mode,
    slots: generate(doc.palette.primary, mode),
  };
  notify();
}

export function setPalette(p: Palette, path: string | null) {
  doc.palette = p;
  doc.path = path;
  doc.savedHash = hashPalette(p);
  notify();
}

export function markSaved(path: string) {
  doc.path = path;
  doc.savedHash = hashPalette(doc.palette);
  notify();
}

export function isDirty(): boolean {
  return hashPalette(doc.palette) !== doc.savedHash;
}

function hashPalette(p: Palette): number {
  let h = 2166136261 >>> 0;
  const s = JSON.stringify(p);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
