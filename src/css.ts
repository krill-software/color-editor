// CSS is an EXPORT, not the document. paletteToCss renders the palette to a
// :root block of custom properties. Unnamed colors are auto-named --color-N
// (in order) so the export is always valid; name the ones you care about in
// the Palette tab first.

import type { Palette } from "./types";

export function paletteToCss(palette: Palette): string {
  let auto = 0;
  const lines = palette.colors.map((c) => {
    const name = c.name.trim() || `color-${++auto}`;
    return `  --${name}: ${c.hex};`;
  });
  return `:root {\n${lines.join("\n")}${lines.length ? "\n" : ""}}\n`;
}
