import "@krill-software/desktop-ui/styles";
import "./styles.css";

import {
  buildDropZone,
  type DropZoneRefs,
  FAMILY_ORDER,
  familyOf,
  mountChrome,
  parseGpl,
  serializeGpl,
  showBootError,
} from "@krill-software/desktop-ui";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getMatches } from "@tauri-apps/plugin-cli";
import { confirm, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { paletteToCss } from "./css";
import { extractPalette, type Extraction } from "./extract";
import { hexToRgb, oklchToRgbClamped, rgbToHex, rgbToOklch } from "./oklch";
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
let imageDrop: DropZoneRefs;
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

// Cards are laid out in labelled hue-family groups (Red … Pink, Neutral, then
// Other for unparseable hexes), each group's colors sorted dark → light. The
// family buckets reuse the image-extractor's familyOf so the labels match that
// feature. Display-only — the document order (and CSS / .gpl export order) is
// left untouched.
function renderRows(): void {
  rowsEl.replaceChildren();

  const byFamily = new Map<string, typeof doc.palette.colors>();
  for (const c of doc.palette.colors) {
    const fam = familyForHex(c.hex);
    const arr = byFamily.get(fam) ?? [];
    arr.push(c);
    byFamily.set(fam, arr);
  }

  for (const fam of [...FAMILY_ORDER, "Other"]) {
    const arr = byFamily.get(fam);
    if (!arr || arr.length === 0) continue;
    arr.sort((a, b) => lightnessOf(a.hex) - lightnessOf(b.hex)); // dark → light

    const group = document.createElement("div");
    group.className = "color-group";
    const heading = document.createElement("h3");
    heading.className = "color-group-h";
    heading.textContent = fam;
    const grid = document.createElement("div");
    grid.className = "color-group-grid";
    for (const c of arr) grid.appendChild(buildColorCard(c));
    group.append(heading, grid);
    rowsEl.appendChild(group);
  }

  emptyHintEl.hidden = doc.palette.colors.length > 0;
}

function familyForHex(hex: string): string {
  const norm = normalizeHexForInput(hex);
  const rgb = norm ? hexToRgb(norm) : null;
  if (!rgb) return "Other";
  return familyOf(rgb.r * 255, rgb.g * 255, rgb.b * 255);
}

function lightnessOf(hex: string): number {
  const norm = normalizeHexForInput(hex);
  const rgb = norm ? hexToRgb(norm) : null;
  return rgb ? rgbToOklch(rgb).L : 0;
}

/** One color = a rounded box (the color itself, click to recolor), the hex
 *  under it (editable), and a name input. Delete reveals on hover. */
function buildColorCard(row: { id: string; name: string; hex: string }): HTMLElement {
  const el = document.createElement("div");
  el.className = "card";

  // The box IS the color; clicking it opens the OS color picker. WebKitGTK
  // won't honor aspect-ratio on a native color input, so a plain wrapper div
  // drives the square and the input fills it.
  const boxWrap = document.createElement("div");
  boxWrap.className = "card-box-wrap";
  const box = document.createElement("input");
  box.type = "color";
  box.className = "card-box";
  box.title = "Pick a color";
  const initial = normalizeHexForInput(row.hex);
  box.value = initial ?? "#000000";
  if (!initial) box.dataset.unknown = "true";
  boxWrap.appendChild(box);

  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.spellcheck = false;
  hexInput.className = "card-hex mono";
  hexInput.placeholder = "#rrggbb";
  hexInput.value = row.hex;
  hexInput.setAttribute("aria-label", "Hex color");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.spellcheck = false;
  nameInput.className = "card-name mono";
  nameInput.placeholder = "name";
  nameInput.value = row.name;
  nameInput.setAttribute("aria-label", "Color name");
  nameInput.addEventListener("input", () => setColorName(row.id, nameInput.value));

  hexInput.addEventListener("input", () => {
    setColorHex(row.id, hexInput.value);
    const norm = normalizeHexForInput(hexInput.value);
    if (norm) {
      box.value = norm;
      delete box.dataset.unknown;
    } else {
      box.dataset.unknown = "true";
    }
  });
  box.addEventListener("input", () => {
    hexInput.value = box.value;
    delete box.dataset.unknown;
    setColorHex(row.id, box.value);
  });

  const del = document.createElement("button");
  del.type = "button";
  del.className = "card-del";
  del.title = "Remove";
  del.textContent = "✕";
  del.addEventListener("click", () => {
    removeColor(row.id);
    renderRows();
    shadesPanel.refresh();
    wheelPanel.refresh();
  });

  el.append(boxWrap, hexInput, nameInput, del);
  return el;
}

function addColorRow(): void {
  addColor("", currentRandom() ?? "#dd7596");
  renderRows();
  shadesPanel.refresh();
  wheelPanel.refresh();
  const card = rowsEl.querySelector<HTMLElement>(".card:last-of-type");
  card?.querySelector<HTMLInputElement>(".card-name")?.focus();
}

function buildPalettePanel(): HTMLElement {
  panelPalette = document.createElement("section");
  panelPalette.className = "panel panel-edit";

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

  // CSS export lives in the File menu (Export to CSS…), not inline here.
  panelPalette.append(editor);
  return panelPalette;
}

// ---- Derived (title + persistence) ------------------------------------

function renderOutputs(): void {
  updateTitle();
  persist();
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

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;

async function installFileDrop(): Promise<void> {
  const wv = getCurrentWebview();
  await wv.onDragDropEvent(async (e) => {
    if (e.payload.type === "enter" || e.payload.type === "over") {
      imageDrop.setDragActive(true);
      return;
    }
    if (e.payload.type === "leave") {
      imageDrop.setDragActive(false);
      return;
    }
    if (e.payload.type === "drop") {
      imageDrop.setDragActive(false);
      const path = e.payload.paths[0];
      if (!path) return;
      if (/\.gpl$/i.test(path)) {
        await openPath(path);
      } else if (IMAGE_RE.test(path)) {
        setTab("image");
        await loadImageFromPath(path);
      }
    }
  });
}

// ---- Image panel (Tools ▸ Image) --------------------------------------

function buildImagePanel(): HTMLElement {
  panelImage = document.createElement("section");
  panelImage.className = "panel panel-image";
  panelImage.hidden = true;

  const title = document.createElement("h2");
  title.className = "panel-title";
  title.textContent = "Import colors from an image";

  imageDrop = buildDropZone({
    label: "Drop an image here",
    hint: "or click to browse",
    icon: svgIcon("image", 28),
    onActivate: () => void loadImageViaDialog(),
  });

  const meta = document.createElement("div");
  meta.className = "image-meta";
  imageThumb = document.createElement("img");
  imageThumb.className = "image-thumb";
  imageThumb.alt = "";
  imageThumb.hidden = true;
  // Empty until an image is loaded, when it shows the image dimensions.
  imageHintEl = document.createElement("p");
  imageHintEl.className = "panel-hint";
  imageHintEl.hidden = true;
  meta.append(imageThumb, imageHintEl);

  imageGroupsEl = document.createElement("div");
  imageGroupsEl.className = "image-groups";

  panelImage.append(title, imageDrop.element, meta, imageGroupsEl);
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
  imageHintEl.hidden = false;
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
}

boot().catch((e) => {
  console.error("boot failed:", e);
  showBootError(e);
});
