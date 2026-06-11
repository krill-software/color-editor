# Shelved modules

These were the core of color-editor's first design — an OKLCH categorical
hue-wheel generator (pick one color → 3/6/12 perceptually-even named hues).
That design was shelved (2026-06) when color-editor was repurposed into a
general **named-CSS-variable theme editor** (see `../../SPEC.md`).

Kept here, out of the build (`tsconfig.json` excludes `src/shelf`), in case
the wheel / harmonious-color generation is wanted later as an optional
"suggest a color" helper. `oklch.ts` stayed in `src/` — the color math is
still useful and is the natural home for any future generator.

- `wheel.ts` — circular wheel render
- `palette.ts` — `generate()` / `defaultPalette()` / slot names
- `picker.ts` — HSL slider picker for the single primary
- `panels.ts` — hex / rgb / css output for the wheel slots
