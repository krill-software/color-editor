// sRGB ↔ OKLab ↔ OKLCH conversions (Björn Ottosson's OKLab).
// All RGB channels are linear-to-display: 0..1 floats. Hex helpers do the byte conversion.

export interface RGB { r: number; g: number; b: number; }   // 0..1
export interface HSL { h: number; s: number; l: number; }   // h 0..360, s/l 0..100
export interface OKLCH { L: number; c: number; h: number; } // L 0..1, c 0..~0.4, h 0..360

const srgbToLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const linearToSrgb = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

interface OKLab { L: number; a: number; b: number; }

function rgbToOklab({ r, g, b }: RGB): OKLab {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

function oklabToRgb({ L, a, b }: OKLab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return {
    r: linearToSrgb( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  };
}

export function rgbToOklch(rgb: RGB): OKLCH {
  const { L, a, b } = rgbToOklab(rgb);
  const c = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, c, h };
}

export function oklchToRgbRaw(o: OKLCH): RGB {
  const a = o.c * Math.cos((o.h * Math.PI) / 180);
  const b = o.c * Math.sin((o.h * Math.PI) / 180);
  return oklabToRgb({ L: o.L, a, b });
}

const inGamut = (rgb: RGB) =>
  rgb.r >= -1e-4 && rgb.r <= 1 + 1e-4 &&
  rgb.g >= -1e-4 && rgb.g <= 1 + 1e-4 &&
  rgb.b >= -1e-4 && rgb.b <= 1 + 1e-4;

// Bisect on chroma until the result fits in sRGB. Returns a clamped 0..1 RGB.
export function oklchToRgbClamped(o: OKLCH): RGB {
  let raw = oklchToRgbRaw(o);
  if (inGamut(raw)) return clamp01(raw);
  let lo = 0, hi = o.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    raw = oklchToRgbRaw({ L: o.L, c: mid, h: o.h });
    if (inGamut(raw)) lo = mid;
    else hi = mid;
  }
  return clamp01(oklchToRgbRaw({ L: o.L, c: lo, h: o.h }));
}

function clamp01(rgb: RGB): RGB {
  return {
    r: Math.max(0, Math.min(1, rgb.r)),
    g: Math.max(0, Math.min(1, rgb.g)),
    b: Math.max(0, Math.min(1, rgb.b)),
  };
}

// HSL ↔ RGB (standard formulae; HSL is just for the picker UI).
export function hslToRgb({ h, s, l }: HSL): RGB {
  const sn = s / 100, ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

export function rgbToHsl(rgb: RGB): HSL {
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: s * 100, l: l * 100 };
}

// Hex helpers
export function hexToRgb(hex: string): RGB | null {
  const m = hex.replace(/^#/, "");
  const expanded = m.length === 3 ? m.split("").map(c => c + c).join("") : m;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return {
    r: parseInt(expanded.slice(0, 2), 16) / 255,
    g: parseInt(expanded.slice(2, 4), 16) / 255,
    b: parseInt(expanded.slice(4, 6), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const t = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0");
  return `#${t(r)}${t(g)}${t(b)}`;
}

export function rgb255(rgb: RGB): [number, number, number] {
  return [
    Math.round(Math.max(0, Math.min(1, rgb.r)) * 255),
    Math.round(Math.max(0, Math.min(1, rgb.g)) * 255),
    Math.round(Math.max(0, Math.min(1, rgb.b)) * 255),
  ];
}

// Smallest signed angular distance between two hue degrees, 0..180.
export function angularDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}
