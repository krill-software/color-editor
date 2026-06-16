import type { Palette, PaletteColor } from "./types";

interface DocState {
  palette: Palette;
  /** The .gpl on disk, or null for an unsaved (untitled) palette. */
  path: string | null;
  savedHash: number;
}

let idCounter = 0;
function nextId(): string {
  return `c${++idCounter}`;
}

export function emptyPalette(): Palette {
  return { name: "untitled", colors: [] };
}

/** Build a Palette (with fresh ids) from parsed name/hex pairs. */
export function paletteFromColors(
  name: string,
  colors: Array<{ name?: string; hex: string }>,
): Palette {
  return {
    name,
    colors: colors.map((c) => ({ id: nextId(), name: c.name ?? "", hex: c.hex })),
  };
}

export const doc: DocState = {
  palette: emptyPalette(),
  path: null,
  savedHash: 0,
};
doc.savedHash = hashPalette(doc.palette);

const listeners = new Set<() => void>();

/** Subscribe to any palette change (add/remove/edit/load). */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

/** Add a color. Generators dedupe by hex (pass `dedupe`); the manual
 *  "+ Add color" in the Palette tab allows duplicates. Returns the color, or
 *  the existing one when deduped. */
export function addColor(name = "", hex = "#000000", dedupe = false): PaletteColor {
  if (dedupe) {
    const existing = doc.palette.colors.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
    if (existing) return existing;
  }
  const color: PaletteColor = { id: nextId(), name, hex };
  doc.palette.colors.push(color);
  notify();
  return color;
}

export function removeColor(id: string) {
  doc.palette.colors = doc.palette.colors.filter((c) => c.id !== id);
  notify();
}

export function setColorName(id: string, name: string) {
  const c = doc.palette.colors.find((x) => x.id === id);
  if (!c) return;
  c.name = name;
  notify();
}

export function setColorHex(id: string, hex: string) {
  const c = doc.palette.colors.find((x) => x.id === id);
  if (!c) return;
  c.hex = hex;
  notify();
}

export function setPalette(palette: Palette, path: string | null) {
  doc.palette = palette;
  doc.path = path;
  doc.savedHash = hashPalette(palette);
  notify();
}

export function newPalette() {
  setPalette(emptyPalette(), null);
}

export function markSaved(path: string, name: string) {
  doc.path = path;
  doc.palette.name = name;
  doc.savedHash = hashPalette(doc.palette);
  notify();
}

export function isDirty(): boolean {
  return hashPalette(doc.palette) !== doc.savedHash;
}

/** FNV-1a over the colors (names + hexes). The palette name is excluded so a
 *  rename-on-save doesn't read back as a pending edit. */
function hashPalette(p: Palette): number {
  let h = 2166136261 >>> 0;
  const s = JSON.stringify(p.colors.map((c) => [c.name, c.hex]));
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
