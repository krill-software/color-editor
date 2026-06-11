import {
  angularDistance,
  hexToRgb,
  hslToRgb,
  oklchToRgbClamped,
  rgbToHex,
  rgbToOklch,
} from "./oklch";
import {
  MODE_INDICES,
  SLOT_NAMES_12,
  SLOT_RGB_HUES_12,
  type Mode,
  type Palette,
} from "./types";

// Precomputed once: each canonical 12-slot RGB-hue mapped into OKLCH-hue space.
// Generation pins targets to these so wedge labels stay perceptually true.
const SLOT_OKLCH_HUES_12: number[] = SLOT_RGB_HUES_12.map((rgbHue) => {
  const rgb = hslToRgb({ h: rgbHue, s: 100, l: 50 });
  return rgbToOklch(rgb).h;
});

export function slotIndicesForMode(mode: Mode): number[] {
  return MODE_INDICES[mode];
}

export function slotNamesForMode(mode: Mode): string[] {
  return slotIndicesForMode(mode).map((i) => SLOT_NAMES_12[i]);
}

export function slotRgbHuesForMode(mode: Mode): number[] {
  return slotIndicesForMode(mode).map((i) => SLOT_RGB_HUES_12[i]);
}

/**
 * Generate a palette from a primary hex.
 *
 * 1. Convert primary to OKLCH → (L, c, h).
 * 2. Find the active slot whose OKLCH-hue is closest to h.
 * 3. That slot is the primary verbatim. Others use (L, c) at their canonical hue.
 */
export function generate(primaryHex: string, mode: Mode): string[] {
  const rgb = hexToRgb(primaryHex);
  if (!rgb) return Array(mode).fill(primaryHex);

  const o = rgbToOklch(rgb);
  const indices = slotIndicesForMode(mode);

  let bestSlot = indices[0];
  let bestDist = Infinity;
  for (const idx of indices) {
    const d = angularDistance(o.h, SLOT_OKLCH_HUES_12[idx]);
    if (d < bestDist) { bestDist = d; bestSlot = idx; }
  }

  return indices.map((idx) => {
    if (idx === bestSlot) return primaryHex.toLowerCase();
    const out = oklchToRgbClamped({ L: o.L, c: o.c, h: SLOT_OKLCH_HUES_12[idx] });
    return rgbToHex(out);
  });
}

/** Find which slot index (in the active mode) the primary lands in. */
export function activeSlotIndex(primaryHex: string, mode: Mode): number {
  const rgb = hexToRgb(primaryHex);
  if (!rgb) return 0;
  const o = rgbToOklch(rgb);
  const indices = slotIndicesForMode(mode);
  let bestPos = 0;
  let bestDist = Infinity;
  indices.forEach((idx, pos) => {
    const d = angularDistance(o.h, SLOT_OKLCH_HUES_12[idx]);
    if (d < bestDist) { bestDist = d; bestPos = pos; }
  });
  return bestPos;
}

export function defaultPalette(): Palette {
  const primary = "#dd7596";
  return {
    version: 1,
    name: "untitled",
    mode: 12,
    primary,
    slots: generate(primary, 12),
  };
}
