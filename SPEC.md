# Color Scheme Editor — Spec (v1)

A minimal palette generator for Linux. Pick one color, get a perceptually-balanced wheel of named colors around it. Save and load palettes as JSON. Copy individual values out by hand (hex, rgb, css vars).

## Goals

- Generate a balanced color scheme from a single picked color, using **OKLCH** so lightness and chroma stay perceptually equal across slots — yellow stays bright, green doesn't go electric, no per-slot fudge factors.
- Display the scheme as a circular wheel of slices, one per named hue, with the picked color highlighted.
- Show the same scheme as three side-by-side textual blocks — hex list, rgb list, CSS variables. User selects + Ctrl+C; no copy buttons.
- Save and load palettes as plain JSON.
- Three slot counts — 3, 6, 12 — switchable. The smaller wheels are stable subsets of the 12-wheel: same names, same canonical hue degrees.

## Non-goals (v1)

- Per-slot manual editing — you pick *one* color, the wheel derives the rest. Per-slot edit is v2.
- Tints / shades / tones expansion (5 lightness ramps per slot) — v2.
- Contrast / accessibility checking — v2.
- Color-blindness simulation — v2.
- Export to design-tool formats (Figma tokens, Tailwind config, Sketch palette) — v2; CSS variables only in v1.
- Image-color-extraction — v2.
- No multi-window.

## Stack

- Tauri 2 + TypeScript + Vite, like every other krill app.
- Chrome + palette via [`@krill-software/desktop-ui`](https://github.com/krill-software/desktop-ui) (git dep) — `mountChrome()` builds the titlebar, menu bar, and status line; the locked-palette CSS bundle covers the brand colors.
- All color math runs in TypeScript. Rust is only file I/O + state.
- OKLCH ↔ sRGB conversions hand-rolled (~80 lines, no dep) — the math is well-defined and small.

## The model

A palette is N hex strings (N ∈ {3, 6, 12}) plus the **primary** that drove generation.

Slots in 12-mode (canonical RGB-hue degrees → readable names):

| idx | hue | name |
|---|---|---|
| 0 | 0° | red |
| 1 | 30° | orange |
| 2 | 60° | yellow |
| 3 | 90° | lime |
| 4 | 120° | green |
| 5 | 150° | teal |
| 6 | 180° | turquoise |
| 7 | 210° | azure |
| 8 | 240° | blue |
| 9 | 270° | purple |
| 10 | 300° | magenta |
| 11 | 330° | pink |

- **6-mode** = even slots {0, 2, 4, 6, 8, 10} → red, yellow, green, turquoise, blue, magenta. (RGB primaries + secondaries.)
- **3-mode** = every 4th {0, 4, 8} → red, green, blue.

Switching modes never re-derives the wheel — the same primary regenerates 3 / 6 / 12 slots from the same OKLCH (L, c). So toggling is non-destructive.

## Generation algorithm

Given the user's picked color **P**:

1. Convert **P** to OKLCH → (Lₚ, cₚ, hₚ) — perceptual lightness, chroma, and hue.
2. Each canonical slot's hue is precomputed once: `slotHueOklch[i]` = OKLCH-hue of `hsl(slotRgbHue[i]°, 100%, 50%)`.
3. Find slot index s\* whose `slotHueOklch[s*]` is the shortest *angular* distance from hₚ.
4. **Slot s\*** = exactly **P** (no round-trip drift).
5. Every other slot i: `oklch(Lₚ, cₚ, slotHueOklch[i])` → convert back to sRGB → gamut-clamp → hex.

Behavior properties:
- The user's exact picked color is preserved in its named home.
- All other slots inherit the same perceptual L + c, so they feel like a family.
- Hues land on named-color regions because the targets are pinned to canonical names.

For colors that fall outside the sRGB gamut after rotation (more chroma than sRGB can hit at that L/H), gamut-clamp by reducing chroma until in-gamut. This is standard.

## Layout

```
+-----------------------------------+----------------+
|                                   |  HEX           |
|      ┌─────────────────┐          |  red    #...   |
|      │  <color wheel>  │          |  orange #...   |
|      │  (3/6/12 slices)│          |  yellow #...   |
|      └─────────────────┘          |  ...           |
|                                   |                |
|  ┌─────────────────────────┐      |----------------|
|  │ <picker — H/S/L sliders │      |  RGB           |
|  │     + #hex input>       │      |  red    rgb(...|
|  └─────────────────────────┘      |  ...           |
|                                   |                |
|  [3]  [6]  [12]   mode            |----------------|
|                                   |  CSS           |
|                                   |  :root {       |
|                                   |    --red: ...  |
|                                   |    ...         |
|                                   |  }             |
+-----------------------------------+----------------+
| status: filename · dirty · mode (3/6/12)            |
+------------------------------------------------------+
```

Wheel is non-interactive in v1 (display only). Picker drives everything.

## Color picker

- HSL sliders (H 0–360, S 0–100, L 0–100) — tactile, no native picker quirks.
- `#RRGGBB` or `#RGB` text input that round-trips with the sliders.
- The picker is the *single* input; the wheel is a read-only output.

## File format — `.palette.json`

```json
{
  "version": 1,
  "name": "untitled",
  "mode": 12,
  "primary": "#dd7596",
  "slots": [
    "#...", "#...", "#...", "#...", "#...", "#...",
    "#...", "#...", "#...", "#...", "#...", "#..."
  ]
}
```

- `slots.length === mode` always.
- `primary` is the source-of-truth on reopen — `slots` is regenerable from it but stored for portability (so a non-krill reader can use the file directly).

## Output panels

Plain `<pre>` blocks with selectable text, each shows the same N slots in a different syntax:

- **Hex** — `red    #ff6b6b` per line, names padded.
- **RGB** — `red    rgb(255, 107, 107)`.
- **CSS** — `:root { --red: #ff6b6b; --orange: #ffa45b; ... }`.

Manual selection + Ctrl+C is the workflow. No copy buttons.

## Keybindings (v1)

| Action | Key |
|---|---|
| New | `Ctrl+N` |
| Open | `Ctrl+O` |
| Save / Save As | `Ctrl+S` / `Ctrl+Shift+S` |
| Mode 3 / 6 / 12 | `Ctrl+3` / `Ctrl+6` / `Ctrl+0` |
| Quit | `Ctrl+Q` |

## Linux integration

- Binary: `krill-color-editor`.
- Product: `Color Editor`.
- AppImage primary, `.deb` secondary. Same release flow as image-editor.
- `.desktop` MIME association on `application/x-krill-palette+json` (treats the file as JSON for any other editor; the custom MIME just lets us own double-click).
- XDG state (`$XDG_STATE_HOME/krill-color-editor/`) for window geometry + recent files.

## Out of scope / open questions

- Whether the wheel is a true polar slice render (canvas/SVG) or a CSS conic-gradient with masks — decide at impl. Conic-gradient is enough for v1.
- Gamut-clamp method (reduce chroma vs. clip RGB channels) — decide at impl; clamp-chroma is the perceptually correct one.
- Whether to bundle a font — defer; system sans is fine.

## Milestones

1. **M1 — Wheel + picker + generation:** Tauri shell. HSL picker drives a 12-slot wheel via the OKLCH algorithm. Hex/RGB/CSS panels render live. No file I/O yet.
2. **M2 — File I/O + modes:** save / open `.palette.json`, mode switcher (3 / 6 / 12). Window state persistence.
3. **M3 — Polish + packaging:** styling pass (use the krill palette for the editor itself), keybindings, AppImage + .deb build, GitHub release workflow + docs landing page.
