# Color Editor — Spec (v2)

A minimal CSS color-theme editor for Linux. Build a set of named colors —
`--accent`, `--green`, whatever you call them — see each rendered live, tweak
the values, and save the result as a plain `.css` file of custom properties.
The output is just CSS variables, so it drops into any project (the krill
theme included), but the app itself is **theme-agnostic** — it doesn't know
or care what the variables are for. Think a stripped-down coolors.co whose
artifact is a `colors.css`.

> **v1 → v2 note.** v1 was an OKLCH categorical hue-wheel generator (pick one
> color → a wheel of named hues). That design is shelved under `src/shelf/`
> (see its README). v2 is this named-variable editor. `oklch.ts` survives as
> the color-math home.

## Identity

| Field | Value |
|---|---|
| Slug (directory) | `color-editor` |
| productName | `Color Editor` |
| Binary | `krill-color-editor` |
| Identifier | `software.krill.color-editor` |
| Document format | CSS (`.css`, `text/css`) — a `:root { … }` of custom properties |
| Icon glyph | Lucide `palette` (unchanged) |

## Goals

- Edit a list of **named colors**: each is a CSS custom-property name + a value.
- **Add color** appends a row: `name | hex | rendered swatch`. Edit any cell;
  the swatch and the live CSS update as you type.
- Names are the **designer's** call — `--accent`, `--green`, `--brand-500`.
  No imposed taxonomy.
- **The `.css` is the document.** Save writes `:root { --name: #hex; … }`;
  Open parses a `.css`'s custom properties back into rows. Round-trips.
- Visualize the whole theme at a glance (a swatch strip) while editing.
- The output is consumable anywhere — paste it into desktop-ui's
  `palette.css`, a web project, anything. The app stays generic.

## Non-goals (v1/v2)

- **Not a krill-palette tool.** It can *produce* the krill palette, but has no
  built-in knowledge of `--fm-*` names, roles, or derivations.
- No per-row HSL/OKLCH wheels, harmonious-color generation, or auto-derived
  ramps (tints/shades). Shelved; possible later as an optional "suggest" button.
- No alpha / `rgba()` editing in v1 — values are `#rgb` / `#rrggbb`. (Other
  values survive a round-trip as raw text, but aren't swatch-editable yet.)
- No contrast / accessibility linting (v2+).
- No SCSS/LESS, Tailwind config, Figma tokens, or JSON token formats — CSS
  custom properties only.
- No multi-window; no settings panel; no telemetry.

## Stack

- Tauri 2 + TypeScript + Vite, like every krill app.
- Chrome + palette via [`@krill-software/desktop-ui`](https://github.com/krill-software/desktop-ui)
  (git dep): standard `mountChrome()` — titlebar, **File menu** (New / Open /
  Save / Save As wired via the canonical action registry), status line, aux pane.
- Color math: `oklch.ts` (kept from v1) — used for hex validation / conversion.
- Rust is file I/O + state only: `read_css` / `write_css` (plain text via
  `krill-desktop-core::fs`), plus state + dev-fixture probe.

## The model

```ts
interface ColorRow { id: string; name: string; hex: string }  // name w/o leading --
interface Theme    { name: string; rows: ColorRow[] }          // name = doc title only
```

- `rows` is ordered (insertion order); order is preserved in the CSS output.
- `name` on the Theme is the document's display name (titlebar), **not** part
  of the CSS — the CSS is purely the `:root` block.
- Duplicate / empty var-names are allowed while editing (you're mid-thought);
  rows with an empty name are simply omitted from the CSS output.

## Layout (standard krill chrome)

```
+--------------------------------------------+------------------+
| ⋮ titlebar:  name •            _  □  ✕      |                  |
+--------------------------------------------+   PALETTE        |
|                                            |  ▢ ▢ ▢ ▢ ▢ …    |
|   --accent     #dd7596   ▣   ✕            |                  |
|   --green      #34d058   ▣   ✕            |------------------|
|   --ink        #30343f   ▣   ✕            |   CSS            |
|                                            |  :root {         |
|            [ + Add color ]                 |    --accent: #…  |
|                                            |    --green:  #…  |
|                                            |  }               |
+--------------------------------------------+------------------+
| vX.Y.Z                              3 colors                  |
+--------------------------------------------------------------+
```

- **Main (viewport):** the editable row list + **Add color** button. Each row:
  `--`-prefixed **name** input · **hex** input (mono) · **swatch** (a native
  color input — click to pick) · **delete**. Name and hex two-way-sync the swatch.
- **Aux pane:** a live **palette strip** (every row as a swatch) above the live
  **CSS** output (`<pre>`, selectable — select + Ctrl+C, no copy button, per the
  suite convention).
- **Status line:** left = app version `vX.Y.Z` (suite convention); right =
  `N colors`. Dirty marker rides `body[data-dirty]` on the centered filename.

## File handling — the `.css` is the document

- **New** (`Ctrl+N`): empty theme (the Add button is the whole UI).
- **Open** (`Ctrl+O`): read a `.css`, parse every `--name: value;` (lenient
  regex, inside or outside `:root`) into rows. Non-hex values load as raw text.
- **Save / Save As** (`Ctrl+S` / `Ctrl+Shift+S`): write `:root {\n  --name: #hex;\n…}\n`.
  Default filename `colors.css`. `Ctrl+S` re-writes the open path; else prompts.
- **Dirty tracking:** hash of the theme vs. last-saved hash. Clears on save.
- CLI arg + drag-drop open a `.css`.

## Keybindings (v1)

| Action | Key |
|---|---|
| New / Open | `Ctrl+N` / `Ctrl+O` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` |
| Add color | `Ctrl+Enter` |
| Quit | `Ctrl+Q` |

(File shortcuts come from desktop-ui's action registry; Add color is app-local.)

## Linux integration

- Binary: `krill-color-editor`. State: `$XDG_STATE_HOME/krill-color-editor/`.
- `.desktop` MIME: `text/css`. AppImage primary, `.deb` secondary.

## Milestones

1. **M1 — Editor + round-trip.** *(this pass)* Row list (add / edit name+hex /
   delete), native-swatch picking, live palette strip + CSS output, New / Open /
   Save / Save As as `.css`, CLI + drag-drop, dirty tracking.
2. **M2 — Comfort.** Reorder rows (drag), duplicate-name warning, contrast
   readout (value-on-white / value-on-black), `#rgba` / alpha support.
3. **M3 — Optional generate.** Resurrect the shelved OKLCH engine as a
   "suggest a harmonious color" button that proposes a new row.

> color-editor remains a proof-of-concept (on the no-release list) until the
> design bar is signed off. Do not release until it graduates.
