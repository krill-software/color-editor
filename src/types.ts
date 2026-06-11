// A theme is an ordered list of named colors. Each row becomes one CSS
// custom property: `--<name>: <hex>;`. The var name is the designer's call.

export interface ColorRow {
  id: string;
  /** Variable name WITHOUT the leading `--`, e.g. "accent". */
  name: string;
  /** The value, normally a hex color like "#dd7596". */
  hex: string;
}

export interface Theme {
  /** Document display name (titlebar only) — not part of the CSS output. */
  name: string;
  rows: ColorRow[];
}
