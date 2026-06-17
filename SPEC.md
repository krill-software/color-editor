# Color Editor — Spec (v4)

A calm palette editor for Linux. Browse, pick, and extract colors; derive
shades and harmonies; organize and name them; and save the set as a portable
palette you can open anywhere. Think a stripped-down coolors.co whose document
is a palette — not a stylesheet.

> **History.** v1 was an OKLCH hue-wheel generator (shelved under `src/shelf/`;
> its engine powers the Wheel tab). v2 was a named-CSS-variable editor — the
> `.css` was the document. v3 added Discover/Picker/Image/Shades/Wheel feeding a
> separate **saved-colors pool**, leaving the app with two parallel color
> collections (pool + theme) and two formats (`.gpl` + `.css`). **v4 unifies
> them:** there is one palette, it is the document (`.gpl`), and CSS is an
> export.

## Identity

| Field | Value |
|---|---|
| Slug (directory) | `color-editor` |
| productName | `Color Editor` |
| Binary | `krill-color-editor` |
| Identifier | `software.krill.color-editor` |
| Document format | **GIMP Palette (`.gpl`)** — the portable krill palette format |
| Exports | CSS (`:root { --name: #hex }`); more later (hex list, JSON, `.ase`) |
| Icon glyph | Lucide `palette` |

## The model — one palette, it is the document

```ts
interface PaletteColor { id: string; name: string; hex: string }  // name optional ("")
interface Palette      { name: string; colors: PaletteColor[] }    // name = document name
```

- **One collection.** The v3 "saved pool" and "theme rows" merge into a single
  ordered `Palette`. Every generator/deriver adds to it; the Palette tab edits
  it. There is no separate, hidden pool.
- **Names are optional metadata.** A color can be unnamed (a swatch you're just
  keeping) or named (`accent`, `brand-500`) for CSS export and organization.
  `.gpl` carries names, so they round-trip through the document.
- **The palette is the document.** `.gpl` is what New/Open/Save/Save As operate
  on; the titlebar and dirty marker track it.

## File handling — the `.gpl` is the document

- **New** (`Ctrl+N`): empty untitled palette.
- **Open** (`Ctrl+O`): parse a `.gpl` (shared `parseGpl` from desktop-ui) into
  colors, names included. CLI arg + drag-drop open too.
- **Save / Save As** (`Ctrl+S` / `Ctrl+Shift+S`): serialize to `.gpl`
  (`serializeGpl`), default name `palette.gpl`.
- **Dirty:** hash of the palette vs. last-saved.
- **Auto-restore:** the unsaved working palette is mirrored to app state and
  restored on launch, so collecting colors never loses work before you Save —
  an untitled scratch that becomes a file when you save it.

## Exports — projections of the palette

- **Export to CSS…** — one-way write of `:root { --name: #hex; }`. Unnamed
  colors are auto-named `--color-1`, `--color-2`, … on export (the Palette tab
  nudges you to name the ones you care about first).
- Future, all one-way: a flat hex list, JSON design tokens, Adobe `.ase`. The
  palette stays the single source; each export is a projection.

## Layout — desktop-ui app layout

`mountChrome({ layout: "app" })`: no titlebar / status line. The aux pane leads
with the hamburger (menu) and the tab switcher; the main pane carries the
window controls strip and the active panel. No filename in the chrome — the
document name lives in the WM title; the dirty bullet rides the Palette tab.

The aux pane is **grouped**: the Palette document sits on top, then a
**Discover** group (ways to get a color) and a **Tools** group (pull a color
from outside). Group labels are 11px uppercase mono, matching the suite.

```
+----------------+---------------------------------------------+
| ☰              |                              ─  ▢  ✕        |
|   Palette •    |                                             |
|                |                                             |
|   DISCOVER     |        (active panel)                       |
|   Picker       |                                             |
|   Wheel        |                                             |
|   Shades       |                                             |
|   Randomize    |                                             |
|                |                                             |
|   TOOLS        |                                             |
|   Image        |                                             |
|   Screen       |                                             |
+----------------+---------------------------------------------+
```

## Tabs

The **Discover** and **Tools** entries all **Add to palette**; the **Palette**
tab is the document.

- **Palette** *(the document — merges v3's Saved + Edit)* — the palette as a
  grid of color cards: each card is a rounded color box (click to recolor), the
  hex under it, and a name input (names are bare — no `--`; CSS export adds
  them). A swatch strip of the whole set sits above. `+ Add color`, a
  collapsible **CSS** preview, and **Export to CSS…**. This is what Save writes
  as `.gpl`.

**Discover** — ways to get a color:

- **Picker** — saturation/value plane + hue slider + synced hex; Add to palette.
- **Wheel** — pick a palette color → twelve hues at its OKLCH lightness/chroma
  (the v1 engine). Click a wedge to add it.
- **Shades** — pick a palette color → an OKLCH lightness ramp (lighter above,
  darker below). Click a bar to add it.
- **Randomize** *(v3's "Discover" tab, renamed)* — full-bleed chip; Space/→
  mints a random OKLCH color (history, ← steps back); the hex readout is an
  input. `S` / the bookmark pill adds the color to the palette.

**Tools** — pull a color from outside:

- **Image** — a file drop zone (drop an image or click to browse; no default
  image); its colors are quantized and **grouped by hue family** (Red…Pink +
  Neutrals). Click a swatch to add it to the palette. The drop zone is the
  shared `buildDropZone` from desktop-ui.
- **Screen** — pick a color from any pixel on screen, via the XDG desktop
  portal (`Screenshot.PickColor`). *Note: this is the eyedropper shelved in v3
  (git `21c4c4d`) because the portal pick returned nothing here — it needs the
  portal interaction working (suspect: a missing parent-window handle) before
  it's real. Tracked as its own task.*

## Keybindings

| Action | Key |
|---|---|
| New / Open / Save / Save As | canonical (registry) |
| Discover: next / back / add | `Space` or `→` / `←` / `S` |
| Picker: add | `S` |
| Add color row (Palette) | `Ctrl+Enter` |

## Non-goals (v4)

- No alpha / `rgba()` editing; values are `#rgb` / `#rrggbb`.
- No contrast / accessibility linting yet.
- The document is `.gpl` only; CSS/JSON/ASE are **exports**, not save targets.
- No multi-window; no settings panel; no telemetry.
- The app stays domain-agnostic — no built-in knowledge of krill `--fm-*` roles.

## Stack

Tauri 2 + TypeScript + Vite + pnpm. Chrome, palette tokens, and the shared
`.gpl` parser from [`@krill-software/desktop-ui`](https://github.com/krill-software/desktop-ui)
(`parseGpl` / `serializeGpl`). Rust is `krill-desktop-core` one-liners
(`read_css`/`write_css` couriers reused for `.gpl` text, state, dev fixture,
`read_image` for the Image tab). Color math in `src/oklch.ts`.

## Window

Canonical krill dimensions: 1296 × 800 default, 720 × 445 minimum, centered.

## Milestones

1. **M4 — unify.** *(this pass)* One `Palette` document model; `.gpl` as the
   document (New/Open/Save/Save As + auto-restore); merge pool + theme into the
   Palette tab; CSS demoted to **Export to CSS…**; titlebar/dirty track the
   palette. Generators/derivers add to the palette.
2. **M5 — comfort.** Drag-reorder, duplicate warnings, contrast readout,
   copy-on-click, more export formats (hex/JSON).
3. **M6 — polish.** Whatever use teaches; candidates: shades step count, wheel
   mode (3/6/12), `rgba` support.

> color-editor shipped a first alpha (v0.3.0) on the document=`.css` model.
> v4 is a model change; cut it as **v0.4.0**. Still graduated (not on the PoC
> skip-list).
