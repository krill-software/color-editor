// The .css IS the document. themeToCss renders the editable rows to a
// :root block of custom properties; cssToPairs parses any .css back into
// name/value pairs (lenient — inside or outside :root, any --x: y;).

import type { Theme } from "./types";

/** Render the theme to `:root { --name: value; … }`. Rows with an empty
 *  (trimmed) name are skipped — they're mid-edit, not yet real vars. */
export function themeToCss(theme: Theme): string {
  const lines = theme.rows
    .filter((r) => r.name.trim().length > 0)
    .map((r) => `  --${r.name.trim()}: ${r.hex};`);
  return `:root {\n${lines.join("\n")}${lines.length ? "\n" : ""}}\n`;
}

const VAR_RE = /--([A-Za-z0-9_-]+)\s*:\s*([^;}]+)\s*;/g;

/** Parse every custom-property declaration in a stylesheet into name/value
 *  pairs, in source order. Tolerant of comments, whitespace, and props that
 *  live outside :root. Values are trimmed; hex values are lowercased. */
export function cssToPairs(text: string): Array<{ name: string; hex: string }> {
  // Strip block comments so a commented-out `--x: y;` isn't picked up.
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Array<{ name: string; hex: string }> = [];
  for (const m of stripped.matchAll(VAR_RE)) {
    const name = m[1];
    let value = m[2].trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) value = value.toLowerCase();
    out.push({ name, hex: value });
  }
  return out;
}
