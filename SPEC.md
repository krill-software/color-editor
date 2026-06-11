# Color Editor — Spec (v3)

A calm color workbench for Linux. Browse for colors you like, pick them
precisely, keep the keepers, derive shades and harmonies from them — and when
a set is worth keeping together, name the colors and save the set as a plain
`.css` file of custom properties. Think a stripped-down coolors.co whose
artifact is a `colors.css`.

> **History.** v1 was an OKLCH categorical hue-wheel generator (shelved under
> `src/shelf/`; its generation engine returned in the Wheel tab). v2 was the
> named-CSS-variable row editor (now the Edit tab). v3 wraps both in a tabbed
> workbench centered on a persistent pool of **saved colors**.

## Identity

| Field | Value |
|---|---|
| Slug (directory) | `color-editor` |
| productName | `Color Editor` |
| Binary | `krill-color-editor` |
| Identifier | `software.krill.color-editor` |
| Document format | CSS (`.css`, `text/css`) — a `:root { … }` of custom properties |
| Icon glyph | Lucide `palette` (unchanged) |

## The model

Two layers, deliberately separate:

- **Saved colors** — a flat, ordered pool of hexes, persisted in app state
  (`$XDG_STATE_HOME/krill-color-editor/`), independent of any document.
  Bookmarks, not a document. Every tab's "save" lands here.
- **The theme document** — the v2 model, unchanged: ordered named rows
  (`--name: #hex`), round-tripping to a `.css` file. Lives in the Edit tab.
  The `.css` is the document; saved colors feed it via "add to theme".

```ts
interface ColorRow { id: string; name: string; hex: string }  // name w/o leading --
interface Theme    { name: string; rows: ColorRow[] }          // name = doc title only
```

## Layout — desktop-ui app layout

`mountChrome({ layout: "app" })`: no titlebar, no status line. The aux pane
(left) leads with the hamburger strip and carries the tab switcher; the main
pane carries the window controls strip and the active panel. **No filename
anywhere in the chrome** — the document name lives in the window-manager
title only; the dirty bullet rides the Edit tab's label.

```
+----------------+---------------------------------------------+
| ☰              |                              ─  ▢  ✕        |
|   Discover     |                                             |
|   Picker       |        (active panel)                       |
|   Saved        |                                             |
|   Shades       |                                             |
|   Wheel        |                                             |
|   Edit •       |                                             |
+----------------+---------------------------------------------+
```

## Tabs

- **Discover** — full-bleed color chip; Space/→ mints a random OKLCH color
  (browser-style history, ← steps back). The hex readout is an **input**:
  type any hex to see it on the chip and join the history. `S` / bookmark
  pill saves to the pool; `+` seeds it into the theme.
- **Picker** — a saturation/value plane plus hue slider (conventional HSV
  picker geometry) with a synced hex field, and a screen eyedropper: the
  pipette asks the XDG desktop portal (`Screenshot.PickColor`) to let you
  pick any pixel on screen — the compositor runs the crosshair UI, so it
  works on Wayland and X11 alike. Save bookmarks the color.
- **Saved** — the pool. Click a swatch to add it to the theme; hover-✕
  removes it.
- **Shades** — pick a saved color; it renders mid-ramp with lighter tints
  above and darker shades below (OKLCH lightness steps, chroma tapering at
  the extremes). Click any bar to save that shade.
- **Wheel** — pick a saved color; twelve hues at its OKLCH lightness and
  chroma render as a donut wheel (the v1 engine). The picked color holds its
  own slot verbatim. Click a wedge or its swatch to save.
- **Edit** — the v2 named-variable editor, unchanged: rows of
  `--name | hex | swatch | ✕`, live palette strip, collapsed CSS disclosure,
  New / Open / Save / Save As via the canonical action registry.

## File handling — the `.css` is the document

Unchanged from v2: Open parses custom properties (lenient), Save writes
`:root { … }`, default name `colors.css`, dirty = hash vs last saved, CLI
arg + drag-drop open. The saved-colors pool is **not** part of the document.

## Keybindings

| Action | Key |
|---|---|
| New / Open / Save / Save As | canonical (registry) |
| Discover: next / back / save | `Space` or `→` / `←` / `S` |
| Picker: save | `S` |
| Add color row (Edit) | `Ctrl+Enter` |

## Non-goals (v3)

- No alpha / `rgba()` editing; values are `#rgb` / `#rrggbb`.
- No contrast / accessibility linting yet.
- No SCSS/LESS, Tailwind, Figma tokens, or JSON formats — CSS only.
- No multi-window; no settings panel; no telemetry.
- The app stays **theme-agnostic** — no built-in knowledge of `--fm-*` roles.

## Stack

Tauri 2 + TypeScript + Vite + pnpm. Chrome and palette from
[`@krill-software/desktop-ui`](https://github.com/krill-software/desktop-ui)
(pinned tag); Rust side is `krill-desktop-core` one-liners (`read_css` /
`write_css` / state / dev fixture). Color math in `src/oklch.ts`.

## Window

Canonical krill dimensions: 1296 × 800 default, 720 × 445 minimum, centered.

## Milestones

1. **M3 — the workbench.** *(this pass)* Six tabs, saved pool feeding
   Shades/Wheel, hex entry in Discover, desktop-ui app layout, no filename
   in chrome. First alpha.
2. **M4 — comfort.** Reorder saved colors and theme rows (drag), duplicate
   warnings, contrast readout, copy-on-click affordances.
3. **M5 — alpha polish.** Whatever the alpha teaches; candidate: shades
   step-count control, wheel mode (3/6/12), `rgba` support.

> color-editor is a release candidate for its **first alpha**. Remove it from
> the proof-of-concept skip-list in CLAUDE.md when the user confirms it has
> graduated; until then, don't release.
