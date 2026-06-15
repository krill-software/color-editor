import "@krill-software/desktop-ui/styles";
import "./styles.css";

import { mountChrome, parseGpl, serializeGpl, showBootError } from "@krill-software/desktop-ui";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { cssToPairs, themeToCss } from "./css";
import { extractPalette, type Extraction } from "./extract";
import { oklchToRgbClamped, rgbToHex } from "./oklch";
import { buildPickerPanel, type PickerPanel } from "./picker";
import { buildShadesPanel, type ShadesPanel } from "./shades";
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
import { pillBtn, svgIcon } from "./ui";
import { buildWheelPanel, type WheelPanel } from "./wheel";

interface CssRead {
  path: string;
  contents: string;
}

interface AppState {
  window?: { width: number; height: number; x: number; y: number };
  recent?: string[];
  saved?: string[];
}

type Tab = "discover" | "picker" | "image" | "saved" | "shades" | "wheel" | "edit";

// ---- DOM refs ---------------------------------------------------------

let auxEl: HTMLElement;

let panelDiscover: HTMLElement;
let panelImage: HTMLElement;
let panelSaved: HTMLElement;
let panelEdit: HTMLElement;
let imageThumb: HTMLImageElement;
let imageHintEl: HTMLElement;
let imageGroupsEl: HTMLElement;
let pickerPanel: PickerPanel;
let shadesPanel: ShadesPanel;
let wheelPanel: WheelPanel;

let discoverChip: HTMLElement;
let discoverHexInput: HTMLInputElement;
let savedGridEl: HTMLElement;
let rowsEl: HTMLElement;
let emptyHintEl: HTMLElement;
let stripEl: HTMLElement;
let cssOutEl: HTMLElement;

// ---- App state --------------------------------------------------------

let tab: Tab = "discover";
let persisted: AppState = {};

// Discovered colors: a browser-style history. → at the tip mints a new one;
// ← steps back through what you've already seen. Typing a hex pushes it at
// the tip, same as discovering it.
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

function pushDiscover(hex: string): void {
  history.splice(histPos + 1);
  history.push(hex);
  histPos = history.length - 1;
  renderDiscover();
}

function discoverNext(): void {
  if (histPos < history.length - 1) {
    histPos++;
    renderDiscover();
  } else {
    pushDiscover(randomColor());
  }
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
  pickerPanel.el.hidden = t !== "picker";
  panelImage.hidden = t !== "image";
  panelSaved.hidden = t !== "saved";
  shadesPanel.el.hidden = t !== "shades";
  wheelPanel.el.hidden = t !== "wheel";
  panelEdit.hidden = t !== "edit";
  for (const b of auxEl.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    b.dataset.active = b.dataset.tab === t ? "true" : "false";
  }
  if (t === "discover" && history.length === 0) discoverNext();
  if (t === "saved") renderSaved();
  if (t === "shades") shadesPanel.refresh();
  if (t === "wheel") wheelPanel.refresh();
}

// ---- Saved pool -------------------------------------------------------

/** Bookmark a color (newest first). Every tab's Save lands here. */
function saveColor(hex: string): void {
  const norm = normalizeHexForInput(hex);
  if (!norm || saved.includes(norm)) return;
  saved.unshift(norm);
  persistSaved();
  renderSaved();
  // Generator tabs lead with the saved strip — keep them current so the
  // save is visible immediately.
  shadesPanel.refresh();
  wheelPanel.refresh();
}

// ---- Discover panel ---------------------------------------------------

function renderDiscover(): void {
  const c = currentDiscover();
  if (!c) return;
  discoverChip.style.background = c;
  if (document.activeElement !== discoverHexInput) discoverHexInput.value = c;
}

function commitDiscoverHex(): void {
  const norm = normalizeHexForInput(discoverHexInput.value);
  if (norm && norm !== currentDiscover()) pushDiscover(norm);
  else renderDiscover();
  discoverHexInput.blur();
}

function saveCurrentColor(): void {
  const c = currentDiscover();
  if (c) saveColor(c);
}

// ---- Saved panel ------------------------------------------------------

function renderSaved(): void {
  savedGridEl.replaceChildren();
  if (saved.length === 0) {
    const hint = document.createElement("p");
    hint.className = "panel-hint";
    hint.textContent = "No saved colors yet. Discover or pick one and press Save.";
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
      shadesPanel.refresh();
      wheelPanel.refresh();
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

/** No in-window filename: the app layout has no titlebar, and the topbar
 *  stays clean. The document name lives in the window-manager title only;
 *  dirty state rides body[data-dirty] (the Edit tab shows the bullet). */
function updateTitle(): void {
  const name = doc.theme.name || "untitled";
  document.body.dataset.dirty = String(isDirty());
  const label = `${isDirty() ? "• " : ""}${name} — Color Editor`;
  document.title = label;
  try {
    getCurrentWindow().setTitle(label).catch(() => {});
  } catch {
    /* not running under tauri (vite dev in a browser) */
  }
}

// ---- Persisted app state ----------------------------------------------

function persistSaved(): void {
  persisted.saved = saved;
  try {
    void invoke("save_state", { state: persisted }).catch(() => {});
  } catch {
    /* not running under tauri (vite dev in a browser) */
  }
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

// ---- Keyboard (app-local; file shortcuts come from the action registry) --

function installKeyboard(): void {
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    const mod = e.ctrlKey || e.metaKey;

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
    version: __APP_VERSION__,
    layout: "app",
    showAuxPane: true,
    actions: {
      "new": () => newDoc(),
      "open": () => void openViaDialog(),
      "save": () => void save(),
      "save-as": () => void saveAs(),
    },
    updater: true,
  });
  auxEl = chrome.aux!;
  auxEl.setAttribute("aria-label", "Tabs");

  pickerPanel = buildPickerPanel(saveColor);
  shadesPanel = buildShadesPanel(() => saved, saveColor);
  wheelPanel = buildWheelPanel(() => saved, saveColor);

  chrome.mainContent!.append(
    buildDiscoverPanel(),
    pickerPanel.el,
    buildImagePanel(),
    buildSavedPanel(),
    shadesPanel.el,
    wheelPanel.el,
    buildEditPanel(),
  );

  // The aux pane already leads with the desktop-ui strip (hamburger menu);
  // the tab switcher rides below it.
  auxEl.appendChild(buildTabBar());
}

function buildDiscoverPanel(): HTMLElement {
  panelDiscover = document.createElement("section");
  panelDiscover.className = "panel panel-discover";

  discoverChip = document.createElement("div");
  discoverChip.className = "discover-chip";

  // The hex readout is editable: type a color to see it on the chip.
  discoverHexInput = document.createElement("input");
  discoverHexInput.type = "text";
  discoverHexInput.spellcheck = false;
  discoverHexInput.className = "discover-hex mono";
  discoverHexInput.placeholder = "#rrggbb";
  discoverHexInput.setAttribute("aria-label", "Hex color");
  discoverHexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitDiscoverHex(); }
    if (e.key === "Escape") { e.preventDefault(); renderDiscover(); discoverHexInput.blur(); }
  });
  discoverHexInput.addEventListener("blur", () => commitDiscoverHex());

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
  hint.textContent = "Space or → for a new color · ← to step back · S to save · or type a hex";

  panelDiscover.append(discoverChip, discoverHexInput, actions, hint);
  return panelDiscover;
}

function buildSavedPanel(): HTMLElement {
  panelSaved = document.createElement("section");
  panelSaved.className = "panel panel-saved";
  panelSaved.hidden = true;

  const head = document.createElement("div");
  head.className = "saved-head";
  const h = document.createElement("h2");
  h.className = "panel-title";
  h.textContent = "Saved colors";
  const actions = document.createElement("div");
  actions.className = "saved-actions";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "saved-action-btn";
  openBtn.textContent = "Open palette…";
  openBtn.addEventListener("click", () => void openPalette());
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "saved-action-btn";
  saveBtn.textContent = "Save palette…";
  saveBtn.addEventListener("click", () => void savePalette());
  actions.append(openBtn, saveBtn);
  head.append(h, actions);

  savedGridEl = document.createElement("div");
  savedGridEl.className = "saved-grid";
  panelSaved.append(head, savedGridEl);
  return panelSaved;
}

// The saved pool is the portable palette: save it as a .gpl (GIMP Palette,
// read by GIMP / Krita / Aseprite and by paint / pixel-editor), or open one
// back into the pool. Rust read_css / write_css are plain-text couriers, so
// they carry .gpl text too.
async function savePalette(): Promise<void> {
  if (saved.length === 0) return;
  const chosen = await saveDialog({
    title: "Save palette as…",
    defaultPath: "palette.gpl",
    filters: [{ name: "GIMP Palette", extensions: ["gpl"] }],
  });
  if (typeof chosen !== "string") return;
  const text = serializeGpl({ name: "krill palette", colors: saved });
  try {
    await invoke<string>("write_css", { path: chosen, contents: text });
  } catch (e) {
    console.error("save palette failed:", e);
  }
}

async function openPalette(): Promise<void> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "GIMP Palette", extensions: ["gpl"] }],
  });
  if (typeof selected !== "string") return;
  let read: CssRead;
  try {
    read = await invoke<CssRead>("read_css", { path: selected });
  } catch (e) {
    console.error("open palette failed:", e);
    return;
  }
  for (const c of parseGpl(read.contents).colors) saveColor(c.hex);
  setTab("saved");
}

// ---- Image panel: load an image → colors grouped by family ------------

interface ImageRead {
  path: string;
  bytes: number[];
}

function buildImagePanel(): HTMLElement {
  panelImage = document.createElement("section");
  panelImage.className = "panel panel-image";
  panelImage.hidden = true;

  const head = document.createElement("div");
  head.className = "image-head";
  const loadBtn = document.createElement("button");
  loadBtn.type = "button";
  loadBtn.className = "image-load-btn";
  loadBtn.append(svgIcon("image", 16));
  const lbl = document.createElement("span");
  lbl.textContent = "Load image…";
  loadBtn.append(lbl);
  loadBtn.addEventListener("click", () => void loadImageViaDialog());

  imageThumb = document.createElement("img");
  imageThumb.className = "image-thumb";
  imageThumb.alt = "";
  imageThumb.hidden = true;
  head.append(loadBtn, imageThumb);

  imageHintEl = document.createElement("p");
  imageHintEl.className = "panel-hint";
  imageHintEl.textContent =
    "Load an image to pull its colors, grouped by family. Click a swatch to save it.";

  imageGroupsEl = document.createElement("div");
  imageGroupsEl.className = "image-groups";

  panelImage.append(head, imageHintEl, imageGroupsEl);
  return panelImage;
}

async function loadImageViaDialog(): Promise<void> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
  });
  if (typeof selected === "string") await loadImageFromPath(selected);
}

async function loadImageFromPath(path: string): Promise<void> {
  let read: ImageRead;
  try {
    read = await invoke<ImageRead>("read_image", { path });
  } catch (e) {
    console.error("read_image failed:", e);
    return;
  }
  try {
    const ext = await extractPalette(new Uint8Array(read.bytes));
    renderExtraction(ext);
  } catch (e) {
    console.error("extract failed:", e);
  }
}

function renderExtraction(ext: Extraction): void {
  imageThumb.src = ext.thumbnailUrl;
  imageThumb.hidden = false;
  imageHintEl.textContent = `${ext.width} × ${ext.height} · click a swatch to save it`;
  imageGroupsEl.replaceChildren();
  for (const group of ext.groups) {
    const sec = document.createElement("div");
    sec.className = "image-family";
    const h = document.createElement("h3");
    h.className = "image-family-h";
    h.textContent = group.name;
    const count = document.createElement("span");
    count.className = "image-family-count";
    count.textContent = String(group.colors.length);
    h.appendChild(count);
    const row = document.createElement("div");
    row.className = "image-swatches";
    for (const col of group.colors) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "image-swatch";
      b.style.background = col.hex;
      b.dataset.saved = String(saved.includes(col.hex));
      b.title = `${col.hex} · ${(col.share * 100).toFixed(1)}% of the image`;
      b.addEventListener("click", () => {
        saveColor(col.hex);
        b.dataset.saved = "true";
      });
      row.appendChild(b);
    }
    sec.append(h, row);
    imageGroupsEl.appendChild(sec);
  }
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
    { id: "picker", label: "Picker", icon: "pipette" },
    { id: "image", label: "Image", icon: "image" },
    { id: "saved", label: "Saved", icon: "bookmark" },
    { id: "shades", label: "Shades", icon: "layers" },
    { id: "wheel", label: "Wheel", icon: "wheel" },
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

// ---- Boot -------------------------------------------------------------

async function boot(): Promise<void> {
  initChrome();
  subscribe(renderOutputs);
  installKeyboard();
  try {
    await installFileDrop();
  } catch {
    /* webview drop events unavailable — open via dialog still works */
  }

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
    // Dev convenience: if a sample image is present, pre-extract it into the
    // Image tab (without stealing focus from the default tab) so the grouped
    // palette is there when you switch to it.
    try {
      const img = await invoke<string | null>("dev_test_image");
      if (img) await loadImageFromPath(img);
    } catch {
      /* no image fixture */
    }
  }
}

boot().catch((e) => {
  console.error("boot failed:", e);
  showBootError(e);
});
