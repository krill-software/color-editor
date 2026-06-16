// The document is a palette: an ordered list of colors, each with an OPTIONAL
// name. Named colors export cleanly to CSS custom properties; unnamed ones are
// just swatches you're keeping. `.gpl` carries names, so they round-trip.

export interface PaletteColor {
  id: string;
  /** Optional name (no leading `--`), e.g. "accent". Empty = unnamed. */
  name: string;
  /** The value, normally a hex color like "#dd7596". */
  hex: string;
}

export interface Palette {
  /** Document display name (WM title + .gpl "Name:"). */
  name: string;
  colors: PaletteColor[];
}
