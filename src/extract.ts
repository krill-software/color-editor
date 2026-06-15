// Image → palette: decode an image in the webview, quantize its pixels to a
// coarse set of colors, and group those by hue family (Red … Pink, plus a
// Neutrals bucket for blacks / whites / grays). Within each family colors are
// ordered by how much of the image they cover.

import { rgbToHex, rgbToHsl } from "./oklch";

export interface FamilyColor {
  hex: string;
  /** Fraction of sampled (opaque) pixels this quantized color covers. */
  share: number;
}

export interface FamilyGroup {
  name: string;
  colors: FamilyColor[];
}

export interface Extraction {
  thumbnailUrl: string;
  width: number;
  height: number;
  groups: FamilyGroup[];
}

// Fixed display order; empty families are dropped when rendering.
const FAMILY_ORDER = [
  "Red", "Orange", "Yellow", "Green", "Cyan", "Blue", "Purple", "Pink", "Neutral",
];

const PER_FAMILY = 8;   // most-covering colors kept per family
const QUANT_BITS = 3;   // drop low 3 bits/channel → 5-bit (32-level) buckets
const SAMPLE_MAX = 240; // longest side the image is downsampled to before counting

/** Which family a 0–255 RGB triple belongs to. Low-saturation or near-black /
 *  near-white colors are Neutral (their hue is meaningless); everything else
 *  falls into a hue band. */
function familyOf(r: number, g: number, b: number): string {
  const { h, s, l } = rgbToHsl({ r: r / 255, g: g / 255, b: b / 255 });
  if (s < 12 || l < 6 || l > 97) return "Neutral";
  if (h < 15 || h >= 345) return "Red";
  if (h < 45) return "Orange";
  if (h < 65) return "Yellow";
  if (h < 150) return "Green";
  if (h < 195) return "Cyan";
  if (h < 255) return "Blue";
  if (h < 290) return "Purple";
  return "Pink";
}

export async function extractPalette(bytes: Uint8Array<ArrayBuffer>): Promise<Extraction> {
  const blob = new Blob([bytes]);
  const bmp = await createImageBitmap(blob);
  const ow = bmp.width;
  const oh = bmp.height;

  // Downsample so we count a bounded number of pixels regardless of image size.
  const k = Math.min(1, SAMPLE_MAX / Math.max(ow, oh));
  const w = Math.max(1, Math.round(ow * k));
  const h = Math.max(1, Math.round(oh * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const thumbnailUrl = c.toDataURL("image/png");
  const data = ctx.getImageData(0, 0, w, h).data;

  // Count quantized colors over opaque pixels.
  const counts = new Map<number, number>();
  let total = 0;
  const mask = (0xff >> QUANT_BITS) << QUANT_BITS;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue; // skip transparent
    const r = data[i] & mask;
    const g = data[i + 1] & mask;
    const b = data[i + 2] & mask;
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }

  // Bucket by family.
  const byFamily = new Map<string, FamilyColor[]>();
  for (const [key, count] of counts) {
    const r = (key >> 16) & 0xff;
    const g = (key >> 8) & 0xff;
    const b = key & 0xff;
    const fam = familyOf(r, g, b);
    const arr = byFamily.get(fam) ?? [];
    arr.push({ hex: rgbToHex({ r: r / 255, g: g / 255, b: b / 255 }), share: count / Math.max(1, total) });
    byFamily.set(fam, arr);
  }

  const groups: FamilyGroup[] = [];
  for (const name of FAMILY_ORDER) {
    const arr = byFamily.get(name);
    if (!arr || arr.length === 0) continue;
    arr.sort((a, b) => b.share - a.share);
    groups.push({ name, colors: arr.slice(0, PER_FAMILY) });
  }

  return { thumbnailUrl, width: ow, height: oh, groups };
}
