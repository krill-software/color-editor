import "@krill-software/desktop-ui/styles";
import "./styles.css";

import { mountChrome, showBootError, checkForUpdates } from "@krill-software/desktop-ui";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { cssToPairs, themeToCss } from "./css";
import { oklchToRgbClamped, rgbToHex } from "./oklch";
import {
  addRow,
  doc,
  isDirty,
  markSaved,
  newTheme,
  removeRow,
  setRowHex,
  setRowName,
  setTheme,
  subscribe,
  themeFromPairs,
} from "./state";

interface CssRead {
  path: string;
  contents: string;
}

interface AppState {
  window?: { width: number; height: number; x: number; y: number };
  recent?: string[];
  saved?: string[];
}

type Tab = "discover" | "saved" | "edit";

// ---- DOM refs ---------------------------------------------------------

let viewportEl: HTMLElement;
let railEl: HTMLElement;
let titleLabelEl: HTMLElement;

let panelDiscover: HTMLElement;
let panelSaved: HTMLElement;
let panelEdit: HTMLElement;

let discoverChip: HTMLElement;
let discoverHexEl: HTMLElement;
let savedGridEl: HTMLElement;
let rowsEl: HTMLElement;
let emptyHintEl: HTMLElement;
let stripEl: HTMLElement;
let cssOutEl: HTMLElement;

// ---- App state --------------------------------------------------------

let tab: Tab = "discover";
let persisted: AppState = {};

// Discovered colors: a browser-style history. → at the tip mints a new one;
// ← steps back through what you've already seen.
let history: string[] = [];
let histPos = -1;

// Bookmarked colors — cross-document, persisted to app state.
let saved: string[] = [];

// ---- Color generation -------------------------------------------------

/** A vivid-but-calm random color via OKLCH: random hue, lightness and chroma
 *  kept in pleasant mid ranges so nothing comes out muddy or neon. */
function randomColor(): string {
  const h = Math.random() * 360;
  const L = 0.58 + Math.random() * 0.22; // 0.58–0.80
  const c = 0.10 + Math.random() * 0.13; // 0.10–0.23
  return rgbToHex(oklchToRgbClamped({ L, c, h }));
}

function currentDiscover(): string | null {
  return histPos >= 0 && histPos < history.length ? history[histPos] : null;
}

function discoverNext(): void {
  if (histPos < history.length - 1) {
    histPos++;
  } else {
    history.push(randomColor());
    histPos = history.length - 1;
  }
  renderDiscover();
}

function discoverPrev(): void {
  if (histPos > 0) {
    histPos--;
    renderDiscover();
  }
}

// ---- Helpers ----------------------------------------------------------

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function normalizeHexForInput(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return null;
}

function confirmDiscard(): boolean {
  return !isDirty() || window.confirm("Discard unsaved changes?");
}

// ---- Tabs -------------------------------------------------------------

function setTab(t: Tab): void {
  tab = t;
  panelDiscover.hidden = t !== "discover";
  panelSaved.hidden = t !== "saved";
  panelEdit.hidden = t !== "edit";
  for (const b of railEl.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    b.dataset.active = b.dataset.tab === t ? "true" : "false";
  }
  if (t === "discover" && history.length === 0) discoverNext();
  if (t === "saved") renderSaved();
}

// ---- Discover panel ---------------------------------------------------

function renderDiscover(): void {
  const c = currentDiscover();
  if (!c) return;
  discoverChip.style.background = c;
  discoverHexEl.textContent = c;
}

function saveCurrentColor(): void {
  const c = currentDiscover();
  if (!c || saved.includes(c)) return;
  saved.unshift(c);
  persistSaved();
  renderSaved();
}

// ---- Saved panel ------------------------------------------------------

function renderSaved(): void {
  savedGridEl.replaceChildren();
  if (saved.length === 0) {
    const hint = document.createElement("p");
    hint.className = "panel-hint";
    hint.textContent = "No saved colors yet. Discover one and press Save.";
    savedGridEl.appendChild(hint);
    return;
  }
  for (const c of saved) {
    const cell = document.createElement("div");
    cell.className = "saved-cell";
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "saved-swatch";
    sw.style.background = c;
    sw.title = `Add ${c} to theme`;
    sw.addEventListener("click", () => seedTheme(c));
    const label = document.createElement("span");
    label.className = "saved-hex mono";
    label.textContent = c;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "saved-del";
    del.title = "Remove";
    del.textContent = "✕";
    del.addEventListener("click", () => {
      saved = saved.filter((x) => x !== c);
      persistSaved();
      renderSaved();
    });
    cell.append(sw, label, del);
    savedGridEl.appendChild(cell);
  }
}

/** Drop a color into the theme as a new row, and jump to Edit so it's seen. */
function seedTheme(hex: string): void {
  addRow("", hex);
  renderRows();
  setTab("edit");
  const last = rowsEl.lastElementChild?.querySelector<HTMLInputElement>(".row-name-input");
  last?.focus();
}

// ---- Edit panel: rows -------------------------------------------------

function renderRows(): void {
  rowsEl.replaceChildren();
  for (const row of doc.theme.rows) rowsEl.appendChild(buildRowEl(row));
  emptyHintEl.hidden = doc.theme.rows.length > 0;
}

function buildRowEl(row: { id: string; name: string; hex: string }): HTMLElement {
  const el = document.createElement("div");
  el.className = "row";

  const nameWrap = document.createElement("label");
  nameWrap.className = "row-name";
  const dashes = document.createElement("span");
  dashes.className = "row-dashes";
  dashes.textContent = "--";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.spellcheck = false;
  nameInput.className = "row-name-input mono";
  nameInput.placeholder = "name";
  nameInput.value = row.name;
  nameInput.addEventListener("input", () => setRowName(row.id, nameInput.value));
  nameWrap.append(dashes, nameInput);

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.spellcheck = false;
  hexInput.className = "row-hex-input mono";
  hexInput.placeholder = "#rrggbb";
  hexInput.value = row.hex;

  const swatch = document.createElement("input");
  swatch.type = "color";
  swatch.className = "row-swatch";
  const initial = normalizeHexForInput(row.hex);
  swatch.value = initial ?? "#000000";
  if (!initial) swatch.dataset.unknown = "true";

  hexInput.addEventListener("input", () => {
    setRowHex(row.id, hexInput.value);
    const norm = normalizeHexForInput(hexInput.value);
    if (norm) {
      swatch.value = norm;
      delete swatch.dataset.unknown;
    } else {
      swatch.dataset.unknown = "true";
    }
  });
  swatch.addEventListener("input", () => {
    hexInput.value = swatch.value;
    delete swatch.dataset.unknown;
    setRowHex(row.id, swatch.value);
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "row-del";
  del.title = "Delete";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    removeRow(row.id);
    renderRows();
  });

  el.append(nameWrap, hexInput, swatch, del);
  return el;
}

function addColorRow(): void {
  addRow("", currentDiscover() ?? "#dd7596");
  renderRows();
  const last = rowsEl.lastElementChild?.querySelector<HTMLInputElement>(".row-name-input");
  last?.focus();
}

// ---- Derived (CSS + strip + title) ------------------------------------

function renderOutputs(): void {
  cssOutEl.textContent = themeToCss(doc.theme);
  renderStrip();
  updateTitle();
}

function renderStrip(): void {
  stripEl.replaceChildren();
  for (const row of doc.theme.rows) {
    const sw = document.createElement("div");
    sw.className = "strip-swatch";
    const norm = normalizeHexForInput(row.hex);
    if (norm) sw.style.background = norm;
    else sw.dataset.unknown = "true";
    sw.title = `--${row.name || "?"}: ${row.hex}`;
    stripEl.appendChild(sw);
  }
}

function updateTitle(): void {
  const name = doc.theme.name || "untitled";
  titleLabelEl.textContent = name;
  document.body.dataset.dirty = String(isDirty());
  const label = `${isDirty() ? "• " : ""}${name} — Color Editor`;
  document.title = label;
  getCurrentWindow().setTitle(label).catch(() => {});
}

// ---- Persisted app state ----------------------------------------------

function persistSaved(): void {
  persisted.saved = saved;
  void invoke("save_state", { state: persisted }).catch(() => {});
}

// ---- File I/O ---------------------------------------------------------

async function openPath(path: string): Promise<void> {
  if (!confirmDiscard()) return;
  let read: CssRead;
  try {
    read = await invoke<CssRead>("read_css", { path });
  } catch (e) {
    console.error("read_css failed:", e);
    return;
  }
  const pairs = cssToPairs(read.contents);
  setTheme(themeFromPairs(stripExt(basename(read.path)), pairs), read.path);
  renderRows();
  setTab("edit");
}

async function openViaDialog(): Promise<void> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "CSS", extensions: ["css"] }],
  });
  if (typeof selected === "string") await openPath(selected);
}

async function save(): Promise<void> {
  if (doc.path) await writeCss(doc.path);
  else await saveAs();
}

async function saveAs(): Promise<void> {
  const base = stripExt(doc.theme.name) || "colors";
  const chosen = await saveDialog({
    title: "Save CSS as…",
    defaultPath: `${base}.css`,
    filters: [{ name: "CSS", extensions: ["css"] }],
  });
  if (typeof chosen !== "string") return;
  await writeCss(chosen);
}

async function writeCss(path: string): Promise<void> {
  try {
    const abs = await invoke<string>("write_css", {
      path,
      contents: themeToCss(doc.theme),
    });
    markSaved(abs, stripExt(basename(abs)));
  } catch (e) {
    console.error("write_css failed:", e);
  }
}

function newDoc(): void {
  if (!confirmDiscard()) return;
  newTheme();
  renderRows();
  setTab("edit");
}

// ---- Keyboard ---------------------------------------------------------

function installKeyboard(): void {
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.code === "KeyN") { e.preventDefault(); newDoc(); return; }
    if (mod && e.code === "KeyO") { e.preventDefault(); void openViaDialog(); return; }
    if (mod && e.code === "KeyS" && !e.shiftKey) { e.preventDefault(); void save(); return; }
    if (mod && e.code === "KeyS" && e.shiftKey) { e.preventDefault(); void saveAs(); return; }
    if (mod && e.code === "Enter") { e.preventDefault(); addColorRow(); return; }
    if (mod || typing) return;

    if (tab === "discover") {
      if (e.code === "Space" || e.code === "ArrowRight") { e.preventDefault(); discoverNext(); return; }
      if (e.code === "ArrowLeft") { e.preventDefault(); discoverPrev(); return; }
      if (e.code === "KeyS") { e.preventDefault(); saveCurrentColor(); return; }
    }
  });
}

// ---- Drag-drop --------------------------------------------------------

async function installFileDrop(): Promise<void> {
  const wv = getCurrentWebview();
  await wv.onDragDropEvent(async (e) => {
    if (e.payload.type === "drop") {
      const path = e.payload.paths[0];
      if (path) await openPath(path);
    }
  });
}

// ---- Shell chrome -----------------------------------------------------

function initChrome(): void {
  const chrome = mountChrome({
    productName: "Color Editor",
    actions: {},
    showAuxPane: true,
    showStatusLine: false,
    updater: true,
  });
  viewportEl = chrome.viewport;
  railEl = chrome.aux!;
  railEl.setAttribute("aria-label", "Tabs");

  // MAIN: topbar (window controls) + the per-tab panels.
  const mainTopbar = buildMainTopbar();
  const content = document.createElement("div");
  content.className = "main-content";
  content.append(buildDiscoverPanel(), buildSavedPanel(), buildEditPanel());
  viewportEl.replaceChildren(mainTopbar, content);

  // AUX: topbar (hamburger menu) + the tab switcher.
  railEl.replaceChildren(buildAuxTopbar(), buildTabBar());

  document.body.dataset.aux = "visible";
}

function buildDiscoverPanel(): HTMLElement {
  panelDiscover = document.createElement("section");
  panelDiscover.className = "panel panel-discover";

  discoverChip = document.createElement("div");
  discoverChip.className = "discover-chip";

  discoverHexEl = document.createElement("div");
  discoverHexEl.className = "discover-hex mono";

  const actions = document.createElement("div");
  actions.className = "discover-actions";
  const back = pillBtn("chevron-left", "Back (←)", () => discoverPrev());
  const saveBtn = pillBtn("bookmark", "Save (S)", () => saveCurrentColor());
  saveBtn.classList.add("pill-accent");
  const add = pillBtn("plus", "Add to theme", () => {
    const c = currentDiscover();
    if (c) seedTheme(c);
  });
  const next = pillBtn("chevron-right", "Next (Space / →)", () => discoverNext());
  actions.append(back, saveBtn, add, next);

  const hint = document.createElement("p");
  hint.className = "panel-hint";
  hint.textContent = "Space or → for a new color · ← to step back · S to save";

  panelDiscover.append(discoverChip, discoverHexEl, actions, hint);
  return panelDiscover;
}

function buildSavedPanel(): HTMLElement {
  panelSaved = document.createElement("section");
  panelSaved.className = "panel panel-saved";
  panelSaved.hidden = true;
  const h = document.createElement("h2");
  h.className = "panel-title";
  h.textContent = "Saved colors";
  savedGridEl = document.createElement("div");
  savedGridEl.className = "saved-grid";
  panelSaved.append(h, savedGridEl);
  return panelSaved;
}

function buildEditPanel(): HTMLElement {
  panelEdit = document.createElement("section");
  panelEdit.className = "panel panel-edit";
  panelEdit.hidden = true;

  stripEl = document.createElement("div");
  stripEl.id = "strip";

  const editor = document.createElement("div");
  editor.id = "editor";
  rowsEl = document.createElement("div");
  rowsEl.id = "rows";
  emptyHintEl = document.createElement("p");
  emptyHintEl.id = "empty-hint";
  emptyHintEl.textContent = "No colors yet. Add one, or seed from Discover / Saved.";
  const addBtn = document.createElement("button");
  addBtn.id = "add-btn";
  addBtn.type = "button";
  addBtn.textContent = "+ Add color";
  addBtn.addEventListener("click", () => addColorRow());
  editor.append(rowsEl, emptyHintEl, addBtn);

  // CSS output — demoted to a collapsed disclosure for now.
  const details = document.createElement("details");
  details.className = "css-details";
  const summary = document.createElement("summary");
  summary.textContent = "CSS";
  cssOutEl = document.createElement("pre");
  cssOutEl.id = "out-css";
  details.append(summary, cssOutEl);

  panelEdit.append(stripEl, editor, details);
  return panelEdit;
}

function buildTabBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "tab-bar";
  const tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: "discover", label: "Discover", icon: "sparkles" },
    { id: "saved", label: "Saved", icon: "bookmark" },
    { id: "edit", label: "Edit", icon: "pencil" },
  ];
  for (const t of tabs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab-btn";
    b.dataset.tab = t.id;
    b.append(svgIcon(t.icon, 16));
    const span = document.createElement("span");
    span.textContent = t.label;
    b.append(span);
    b.addEventListener("click", () => setTab(t.id));
    bar.appendChild(b);
  }
  return bar;
}

// ---- Shell topbars + hamburger (mirrors paint/audio shell layout) -----

function buildMainTopbar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "main-topbar";
  bar.setAttribute("data-tauri-drag-region", "true");

  titleLabelEl = document.createElement("div");
  titleLabelEl.className = "main-title";
  titleLabelEl.setAttribute("data-tauri-drag-region", "true");
  bar.appendChild(titleLabelEl);

  const controls = document.createElement("div");
  controls.className = "main-topbar-controls";
  const min = topbarBtn("Minimize", "minus", () => void getCurrentWindow().minimize());
  const max = topbarBtn("Maximize", "square", () => void getCurrentWindow().toggleMaximize());
  const close = topbarBtn("Close", "x", () => void getCurrentWindow().close());
  close.setAttribute("data-kind", "close");
  controls.append(min, max, close);
  bar.appendChild(controls);
  return bar;
}

function topbarBtn(title: string, icon: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "main-topbar-btn";
  b.type = "button";
  b.title = title;
  b.append(svgIcon(icon, title === "Maximize" ? 12 : 14));
  b.addEventListener("click", onClick);
  return b;
}

function buildAuxTopbar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "aux-topbar";
  bar.setAttribute("data-tauri-drag-region", "true");
  const hamburger = document.createElement("button");
  hamburger.className = "main-topbar-btn";
  hamburger.type = "button";
  hamburger.title = "Menu";
  hamburger.append(svgIcon("menu", 16));
  hamburger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleHamburgerMenu(bar);
  });
  bar.appendChild(hamburger);
  return bar;
}

type MenuItem =
  | { label: string; shortcut?: string; action: () => void; enabled?: () => boolean }
  | { sep: true };

function toggleHamburgerMenu(anchor: HTMLElement): void {
  const existing = document.querySelector(".menu-popover");
  if (existing) {
    existing.remove();
    return;
  }
  const pop = document.createElement("div");
  pop.className = "menu-popover";
  const items: MenuItem[] = [
    { label: "New", shortcut: "Ctrl+N", action: () => newDoc() },
    { label: "Open…", shortcut: "Ctrl+O", action: () => void openViaDialog() },
    { sep: true },
    { label: "Save", shortcut: "Ctrl+S", action: () => void save() },
    { label: "Save as…", shortcut: "Ctrl+Shift+S", action: () => void saveAs() },
    { sep: true },
    { label: "Check for updates…", action: () => void checkForUpdates("Color Editor") },
    { label: "Quit", shortcut: "Ctrl+Q", action: () => void getCurrentWindow().close() },
  ];
  for (const it of items) {
    if ("sep" in it) {
      const s = document.createElement("div");
      s.className = "menu-popover-sep";
      pop.appendChild(s);
      continue;
    }
    const btn = document.createElement("button");
    btn.className = "menu-popover-item";
    btn.type = "button";
    const label = document.createElement("span");
    label.textContent = it.label;
    btn.appendChild(label);
    if (it.shortcut) {
      const k = document.createElement("span");
      k.className = "menu-popover-shortcut";
      k.textContent = it.shortcut;
      btn.appendChild(k);
    }
    btn.addEventListener("click", () => {
      pop.remove();
      it.action();
    });
    pop.appendChild(btn);
  }
  anchor.parentElement?.appendChild(pop);
  setTimeout(() => {
    const handler = (ev: MouseEvent) => {
      if (!pop.contains(ev.target as Node)) {
        pop.remove();
        document.removeEventListener("click", handler);
      }
    };
    document.addEventListener("click", handler);
  }, 0);
}

// ---- Inline SVG icons -------------------------------------------------

function svgIcon(kind: string, size = 16): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  const isWinSquare = kind === "square" && size <= 12;
  const small = kind === "minus" || kind === "x" || kind === "menu" || isWinSquare;
  svg.setAttribute("viewBox", small ? "0 0 12 12" : "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", small ? "1.2" : "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const paths: Record<string, string[]> = {
    minus: ["M2 6h8"],
    x: ["M3 3l6 6", "M9 3l-6 6"],
    menu: ["M2 3h8", "M2 6h8", "M2 9h8"],
    square: isWinSquare ? ["M2.5 2.5h7v7H2.5z"] : ["M5 5h14v14H5z"],
    "chevron-left": ["M15 18l-6-6 6-6"],
    "chevron-right": ["M9 18l6-6-6-6"],
    plus: ["M12 5v14", "M5 12h14"],
    bookmark: ["M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"],
    sparkles: ["M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z", "M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"],
    pencil: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"],
  };
  for (const d of paths[kind] ?? []) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

function pillBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pill-btn";
  b.title = title;
  b.append(svgIcon(icon, 16));
  b.addEventListener("click", onClick);
  return b;
}

// ---- Boot -------------------------------------------------------------

async function boot(): Promise<void> {
  initChrome();
  subscribe(renderOutputs);
  installKeyboard();
  await installFileDrop();

  try {
    const st = await invoke<AppState | null>("load_state");
    if (st) {
      persisted = st;
      if (Array.isArray(st.saved)) saved = st.saved;
    }
  } catch {
    /* first run */
  }

  renderRows();
  renderOutputs();
  setTab("discover");

  let opened = false;
  try {
    const matches = await getMatches();
    const arg = matches.args.file?.value;
    if (typeof arg === "string" && arg.length > 0) {
      await openPath(arg);
      opened = true;
    }
  } catch {
    /* cli plugin unavailable */
  }

  if (!opened && import.meta.env.DEV) {
    try {
      const dev = await invoke<string | null>("dev_test_file");
      if (dev) await openPath(dev);
    } catch {
      /* no fixture */
    }
  }
}

boot().catch((e) => {
  console.error("boot failed:", e);
  showBootError(e);
});
