import type { ColorRow, Theme } from "./types";

interface DocState {
  theme: Theme;
  path: string | null;
  savedHash: number;
}

let idCounter = 0;
function nextId(): string {
  return `c${++idCounter}`;
}

export function emptyTheme(): Theme {
  return { name: "untitled", rows: [] };
}

/** Build a Theme (with fresh row ids) from parsed name/value pairs. */
export function themeFromPairs(
  name: string,
  pairs: Array<{ name: string; hex: string }>,
): Theme {
  return { name, rows: pairs.map((p) => ({ id: nextId(), name: p.name, hex: p.hex })) };
}

export const doc: DocState = {
  theme: emptyTheme(),
  path: null,
  savedHash: 0,
};
doc.savedHash = hashTheme(doc.theme);

const listeners = new Set<() => void>();

/** Subscribe to value changes (edits to names/hexes). Structural changes
 *  (add/remove/load) call the structural render directly — see main.ts. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

export function addRow(name = "", hex = "#000000"): ColorRow {
  const row: ColorRow = { id: nextId(), name, hex };
  doc.theme.rows.push(row);
  notify();
  return row;
}

export function removeRow(id: string) {
  doc.theme.rows = doc.theme.rows.filter((r) => r.id !== id);
  notify();
}

export function setRowName(id: string, name: string) {
  const r = doc.theme.rows.find((x) => x.id === id);
  if (!r) return;
  r.name = name;
  notify();
}

export function setRowHex(id: string, hex: string) {
  const r = doc.theme.rows.find((x) => x.id === id);
  if (!r) return;
  r.hex = hex;
  notify();
}

export function setTheme(theme: Theme, path: string | null) {
  doc.theme = theme;
  doc.path = path;
  doc.savedHash = hashTheme(theme);
  notify();
}

export function newTheme() {
  setTheme(emptyTheme(), null);
}

export function markSaved(path: string, name: string) {
  doc.path = path;
  doc.theme.name = name;
  doc.savedHash = hashTheme(doc.theme);
  notify();
}

export function isDirty(): boolean {
  return hashTheme(doc.theme) !== doc.savedHash;
}

/** FNV-1a over the rows (names + values). The theme name is excluded so a
 *  rename-on-save doesn't read back as a pending edit. */
function hashTheme(t: Theme): number {
  let h = 2166136261 >>> 0;
  const s = JSON.stringify(t.rows.map((r) => [r.name, r.hex]));
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
