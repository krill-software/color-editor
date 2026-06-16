import "@krill-software/desktop-ui/styles";
import "./styles.css";

import { mountChrome, parseGpl, serializeGpl, showBootError } from "@krill-software/desktop-ui";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { confirm, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { paletteToCss } from "./css";
import { extractPalette, type Extraction } from "./extract";
import { oklchToRgbClamped, rgbToHex } from "./oklch";
import { buildPickerPanel, type PickerPanel } from "./picker";
import { buildShadesPanel, type ShadesPanel } from "./shades";
import {
  addColor,
  doc,
  isDirty,
  markSaved,
  newPalette,
  paletteFromColors,
  removeColor,
  setColorHex,
  setColorName,
  setPalette,
  subscribe,
} from "./state";
import { pillBtn, svgIcon } from "./ui";
import { buildWheelPanel, type WheelPanel } from "./wheel";

interface TextRead {
  path: string;
  contents: string;
}

interface ImageRead {
  path: string;
  bytes: number[];
}

interface AppState {
  window?: unknown;
  palette?: { name: string; colors: Array<{ name: string; hex: string }> };
  path?: string;
}

type Tab = "palette" | "picker" | "wheel" | "shades" | "randomize" | "image";

// ---- DOM refs ---------------------------------------------------------

let auxEl: HTMLElement;

let panelPalette: HTMLElement;
let panelRandomize: HTMLElement;
let panelImage: HTMLElement;
let pickerPanel: PickerPanel;
let shadesPanel: ShadesPanel;
let wheelPanel: WheelPanel;

let randomChip: HTMLElement;
let randomHexInput: HTMLInputElement;
let rowsEl: HTMLElement;
let emptyHintEl: HTMLElement;
let stripEl: HTMLElement;
let cssOutEl: HTMLElement;
let imageThumb: HTMLImageElement;
let imageHintEl: HTMLElement;
let imageGroupsEl: HTMLElement;

// ---- App state --------------------------------------------------------

let tab: Tab = "palette";
let persisted: AppState = {};

// Randomize: a browser-style history. → at the tip mints a new color;
// ← steps back through what you've seen. Typing a hex pushes it at the tip.
let history: string[] = [];
let histPos = -1;

// ---- Color generation -------------------------------------------------

/** A vivid-but-calm random color via OKLCH. */
function randomColor(): string {
  const h = Math.random() * 360;
  const L = 0.58 + Math.random() * 0.22;
  const c = 0.10 + Math.random() * 0.13;
  return rgbToHex(oklchToRgbClamped({ L, c, h }));
}

function currentRandom(): string | null {
  return histPos >= 0 && histPos < history.length ? history[histPos] : null;
}

function pushRandom(hex: string): void {
  history.splice(histPos + 1);
  history.push(hex);
  histPos = history.length - 1;
  renderRandom();
}

function randomNext(): void {
  if (histPos < history.length - 1) {
    histPos++;
    renderRandom();
  } else {
    pushRandom(randomColor());
  }
}

function randomPrev(): void {
  if (histPos > 0) {
    histPos--;
    renderRandom();
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

// window.confirm() is unreliable in WebKitGTK; use the Tauri dialog.
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  try {
    return await confirm("Discard unsaved changes?", { title: "Color Editor", kind: "warning" });
  } catch {
    return true; // not under tauri (vite dev) — don't block
  }
}

// ---- The palette: add colors ------------------------------------------

/** Every generator/deriver lands here. Dedupes by hex so the palette doesn't
 *  fill with repeats; the manual "+ Add color" in the Palette tab is separate. */
function addToPalette(hex: string): void {
  const norm = normalizeHexForInput(hex);
  if (!norm) return;
  addColor("", norm, true);
  renderRows();
  shadesPanel.refresh();
  wheelPanel.refresh();
}

// ---- Tabs -------------------------------------------------------------

function setTab(t: Tab): void {
  tab = t;
  panelPalette.hidden = t !== "palette";
  pickerPanel.el.hidden = t !== "picker";
  wheelPanel.el.hidden = t !== "wheel";
  shadesPanel.el.hidden = t !== "shades";
  panelRandomize.hidden = t !== "randomize";
  panelImage.hidden = t !== "image";
  for (const b of auxEl.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
    b.dataset.active = b.dataset.tab === t ? "true" : "false";
  }
  if (t === "randomize" && history.length === 0) randomNext();
  if (t === "shades") shadesPanel.refresh();
  if (t === "wheel") wheelPanel.refresh();
}

// ---- Randomize panel --------------------------------------------------

function renderRandom(): void {
  const c = currentRandom();
  if (!c) return;
  randomChip.style.background = c;
  if (document.activeElement !== randomHexInput) randomHexInput.value = c;
}

function commitRandomHex(): void {
  const norm = normalizeHexForInput(randomHexInput.value);
  if (norm && norm !== currentRandom()) pushRandom(norm);
  else renderRandom();
  randomHexInput.blur();
}

function addCurrentRandom(): void {
  const c = currentRandom();
  if (c) addToPalette(c);
}

function buildRandomizePanel(): HTMLElement {
  panelRandomize = document.createElement("section");
  panelRandomize.className = "panel panel-discover";
  panelRandomize.hidden = true;

  randomChip = document.createElement("div");
  randomChip.className = "discover-chip";

  randomHexInput = document.createElement("input");
  randomHexInput.type = "text";
  randomHexInput.spellcheck = false;
  randomHexInput.className = "discover-hex mono";
  randomHexInput.placeholder = "#rrggbb";
  randomHexInput.setAttribute("aria-label", "Hex color");
  randomHexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitRandomHex(); }
    if (e.key === "Escape") { e.preventDefault(); renderRandom(); randomHexInput.blur(); }
  });
  randomHexInput.addEventListener("blur", () => commitRandomHex());

  const actions = document.createElement("div");
  actions.className = "discover-actions";
  const back = pillBtn("chevron-left", "Back (←)", () => randomPrev());
  const add = pillBtn("plus", "Add to palette (S)", () => addCurrentRandom());
  add.classList.add("pill-accent");
  const next = pillBtn("chevron-right", "Next (Space / →)", () => randomNext());
  actions.append(back, add, next);

  const hint = document.createElement("p");
  hint.className = "panel-hint";
  hint.textContent = "Space or → for a new color · ← to step back · S to add · or type a hex";

  panelRandomize.append(randomChip, randomHexInput, actions, hint);
  return panelRandomize;
}

// ---- Palette panel (the document) -------------------------------------

function renderRows(): void {
  rowsEl.replaceChildren();
  for (const c of doc.palette.colors) rowsEl.appendChild(buildColorRow(c));
  emptyHintEl.hidden = doc.palette.colors.length > 0;
}

function buildColorRow(row: { id: string; name: string; hex: string }): HTMLElement {
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
  nameInput.addEventListener("input", () => setColorName(row.id, nameInput.value));
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
    setColorHex(row.id, hexInput.value);
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
    setColorHex(row.id, swatch.value);
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "row-del";
  del.title = "Remove";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    removeColor(row.id);
    renderRows();
    shadesPanel.refresh();
    wheelPanel.refresh();
  });

  el.append(nameWrap, hexInput, swatch, del);
  return el;
}

function addColorRow(): void {
  addColor("", currentRandom() ?? "#dd7596");
  renderRows();
  shadesPanel.refresh();
  wheelPanel.refresh();
  const last = rowsEl.lastElementChild?.querySelector<HTMLInputElement>(".row-name-input");
  last?.focus();
}

function buildPalettePanel(): HTMLElement {
  panelPalette = document.createElement("section");
  panelPalette.className = "panel panel-edit";

  stripEl = document.createElement("div");
  stripEl.id = "strip";

  const editor = document.createElement("div");
  editor.id = "editor";
  rowsEl = document.createElement("div");
  rowsEl.id = "rows";
  emptyHintEl = document.createElement("p");
  emptyHintEl.id = "empty-hint";
  emptyHintEl.textContent = "No colors yet. Add one, or pull colors from Discover / Tools.";
  const addBtn = document.createElement("button");
  addBtn.id = "add-btn";
  addBtn.type = "button";
  addBtn.textContent = "+ Add color";
  addBtn.addEventListener("click", () => addColorRow());
  editor.append(rowsEl, emptyHintEl, addBtn);

  // CSS export — a collapsed preview + an explicit "Export to CSS…".
  const details = document.createElement("details");
  details.className = "css-details";
  const summary = document.createElement("summary");
  const summaryLabel = document.createElement("span");
  summaryLabel.textContent = "CSS export";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "css-export-btn";
  exportBtn.textContent = "Export to CSS…";
  exportBtn.addEventListener("click", (e) => { e.preventDefault(); void exportCss(); });
  summary.append(summaryLabel, exportBtn);
  cssOutEl = document.createElement("pre");
  cssOutEl.id = "out-css";
  details.append(summary, cssOutEl);

  panelPalette.append(stripEl, editor, details);
  return panelPalette;
}

// ---- Derived (CSS preview + strip + title) ----------------------------

function renderOutputs(): void {
  cssOutEl.textContent = paletteToCss(doc.palette);
  renderStrip();
  updateTitle();
  persist();
}

function renderStrip(): void {
  stripEl.replaceChildren();
  for (const c of doc.palette.colors) {
    const sw = document.createElement("div");
    sw.className = "strip-swatch";
    const norm = normalizeHexForInput(c.hex);
    if (norm) sw.style.background = norm;
    else sw.dataset.unknown = "true";
    sw.title = c.name ? `--${c.name}: ${c.hex}` : c.hex;
    stripEl.appendChild(sw);
  }
}

/** The document name lives in the WM title; the dirty bullet rides the
 *  Palette tab (body[data-dirty]). */
function updateTitle(): void {
  const name = doc.palette.name || "untitled";
  document.body.dataset.dirty = String(isDirty());
  const label = `${isDirty() ? "• " : ""}${name} — Color Editor`;
  document.title = label;
  try {
    getCurrentWindow().setTitle(label).catch(() => {});
  } catch {
    /* not under tauri */
  }
}

// ---- Persisted app state (auto-restore the working palette) -----------

let persistTimer: number | undefined;
function persist(): void {
  persisted.palette = {
    name: doc.palette.name,
    colors: doc.palette.colors.map((c) => ({ name: c.name, hex: c.hex })),
  };
  persisted.path = doc.path ?? undefined;
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    try {
      void invoke("save_state", { state: persisted }).catch(() => {});
    } catch {
      /* not under tauri */
    }
  }, 400);
}

// ---- File I/O — the .gpl is the document ------------------------------

async function openPath(path: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  let read: TextRead;
  try {
    read = await invoke<TextRead>("read_css", { path }); // read_css = plain-text courier
  } catch (e) {
    console.error("open failed:", e);
    return;
  }
  const parsed = parseGpl(read.contents);
  const name = parsed.name || stripExt(basename(read.path));
  setPalette(paletteFromColors(name, parsed.colors), read.path);
  renderRows();
  shadesPanel.refresh();
  wheelPanel.refresh();
  setTab("palette");
}

async function openViaDialog(): Promise<void> {
  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "GIMP Palette", extensions: ["gpl"] }],
  });
  if (typeof selected === "string") await openPath(selected);
}

async function save(): Promise<void> {
  if (doc.path) await writeGpl(doc.path);
  else await saveAs();
}

async function saveAs(): Promise<void> {
  const base = stripExt(doc.palette.name) || "palette";
  const chosen = await saveDialog({
    title: "Save palette as…",
    defaultPath: `${base}.gpl`,
    filters: [{ name: "GIMP Palette", extensions: ["gpl"] }],
  });
  if (typeof chosen !== "string") return;
  await writeGpl(chosen);
}

async function writeGpl(path: string): Promise<void> {
  const text = serializeGpl({
    name: doc.palette.name,
    colors: doc.palette.colors.map((c) => ({ hex: c.hex, name: c.name || undefined })),
  });
  try {
    const abs = await invoke<string>("write_css", { path, contents: text });
    markSaved(abs, stripExt(basename(abs)));
  } catch (e) {
    console.error("save failed:", e);
  }
}

async function newDoc(): Promise<void> {
  if (!(await confirmDiscard())) return;
  newPalette();
  renderRows();
  shadesPanel.refresh();
  wheelPanel.refresh();
  setTab("palette");
}

// ---- CSS export -------------------------------------------------------

async function exportCss(): Promise<void> {
  if (doc.palette.colors.length === 0) return;
  const base = stripExt(doc.palette.name) || "colors";
  const chosen = await saveDialog({
    title: "Export to CSS…",
    defaultPath: `${base}.css`,
    filters: [{ name: "CSS", extensions: ["css"] }],
  });
  if (typeof chosen !== "string") return;
  try {
    await invoke<string>("write_css", { path: chosen, contents: paletteToCss(doc.palette) });
  } catch (e) {
    console.error("export CSS failed:", e);
  }
}

// ---- Keyboard ---------------------------------------------------------

function installKeyboard(): void {
  window.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.code === "Enter") { e.preventDefault(); addColorRow(); return; }
    if (mod || typing) return;

    if (tab === "randomize") {
      if (e.code === "Space" || e.code === "ArrowRight") { e.preventDefault(); randomNext(); return; }
      if (e.code === "ArrowLeft") { e.preventDefault(); randomPrev(); return; }
      if (e.code === "KeyS") { e.preventDefault(); addCurrentRandom(); return; }
    }
  });
}

// ---- Drag-drop --------------------------------------------------------

async function installFileDrop(): Promise<void> {
  const wv = getCurrentWebview();
  await wv.onDragDropEvent(async (e) => {
    if (e.payload.type === "drop") {
      const path = e.payload.paths[0];
      if (path && /\.gpl$/i.test(path)) await openPath(path);
    }
  });
}

// ---- Image panel (Tools ▸ Image) --------------------------------------

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
    "Load an image to pull its colors, grouped by family. Click a swatch to add it to the palette.";

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
    renderExtraction(await extractPalette(new Uint8Array(read.bytes)));
  } catch (e) {
    console.error("extract failed:", e);
  }
}

function renderExtraction(ext: Extraction): void {
  imageThumb.src = ext.thumbnailUrl;
  imageThumb.hidden = false;
  imageHintEl.textContent = `${ext.width} × ${ext.height} · click a swatch to add it`;
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
      b.title = `${col.hex} · ${(col.share * 100).toFixed(1)}% of the image`;
      b.addEventListener("click", () => {
        addToPalette(col.hex);
        b.dataset.saved = "true";
      });
      row.appendChild(b);
    }
    sec.append(h, row);
    imageGroupsEl.appendChild(sec);
  }
}

// ---- Shell chrome -----------------------------------------------------

function initChrome(): void {
  const chrome = mountChrome({
    productName: "Color Editor",
    version: __APP_VERSION__,
    layout: "app",
    showAuxPane: true,
    actions: {
      "new": () => void newDoc(),
      "open": () => void openViaDialog(),
      "save": () => void save(),
      "save-as": () => void saveAs(),
    },
    customMenu: [
      { group: "file", items: [{ label: "Export to CSS…", action: () => void exportCss() }] },
    ],
    updater: true,
  });
  auxEl = chrome.aux!;
  auxEl.setAttribute("aria-label", "Tabs");

  pickerPanel = buildPickerPanel(addToPalette);
  shadesPanel = buildShadesPanel(() => doc.palette.colors.map((c) => c.hex), addToPalette);
  wheelPanel = buildWheelPanel(() => doc.palette.colors.map((c) => c.hex), addToPalette);

  chrome.mainContent!.append(
    buildPalettePanel(),
    pickerPanel.el,
    wheelPanel.el,
    shadesPanel.el,
    buildRandomizePanel(),
    buildImagePanel(),
  );

  auxEl.appendChild(buildTabBar());
}

interface TabDef { id: Tab; label: string; icon: string }

function buildTabBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "tab-bar";

  // The Palette document sits on top, then grouped sources.
  const top: TabDef[] = [{ id: "palette", label: "Palette", icon: "pencil" }];
  const discover: TabDef[] = [
    { id: "picker", label: "Picker", icon: "pipette" },
    { id: "wheel", label: "Wheel", icon: "wheel" },
    { id: "shades", label: "Shades", icon: "layers" },
    { id: "randomize", label: "Randomize", icon: "sparkles" },
  ];
  const tools: TabDef[] = [{ id: "image", label: "Image", icon: "image" }];

  const tabBtn = (t: TabDef) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tab-btn";
    b.dataset.tab = t.id;
    b.append(svgIcon(t.icon, 16));
    const span = document.createElement("span");
    span.textContent = t.label;
    b.append(span);
    b.addEventListener("click", () => setTab(t.id));
    return b;
  };
  const groupLabel = (text: string) => {
    const l = document.createElement("div");
    l.className = "tab-group";
    l.textContent = text;
    return l;
  };

  for (const t of top) bar.appendChild(tabBtn(t));
  bar.appendChild(groupLabel("Discover"));
  for (const t of discover) bar.appendChild(tabBtn(t));
  bar.appendChild(groupLabel("Tools"));
  for (const t of tools) bar.appendChild(tabBtn(t));
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
    /* drop events unavailable */
  }

  try {
    const st = await invoke<AppState | null>("load_state");
    if (st) persisted = st;
  } catch {
    /* first run */
  }

  renderRows();
  renderOutputs();
  setTab("palette");

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

  // Restore the unsaved working palette (auto-restore) when nothing else opened.
  if (!opened && persisted.palette && persisted.palette.colors.length > 0) {
    setPalette(paletteFromColors(persisted.palette.name, persisted.palette.colors), persisted.path ?? null);
    renderRows();
    shadesPanel.refresh();
    wheelPanel.refresh();
    opened = true;
  }

  if (!opened && import.meta.env.DEV) {
    try {
      const dev = await invoke<string | null>("dev_test_file");
      if (dev) await openPath(dev);
    } catch {
      /* no fixture */
    }
  }
  if (import.meta.env.DEV) {
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
