// Wheel tab: pick a saved color, see a 12-hue wheel built around it.
// The generation strategy is the shelved v1 engine (src/shelf/palette.ts):
// keep the picked color's OKLCH lightness and chroma, swing the hue through
// the twelve canonical positions — perceptually even, so every slot reads
// as "the same color, elsewhere on the wheel". The picked color's own slot
// carries it verbatim. Click a wedge (or its swatch below) to save.

import {
  angularDistance,
  hexToRgb,
  hslToRgb,
  oklchToRgbClamped,
  rgbToHex,
  rgbToOklch,
} from "./oklch";
import { buildSavedPicker } from "./ui";

export interface WheelPanel {
  el: HTMLElement;
  refresh(): void;
}

// Twelve canonical RGB hues (every 30°), each mapped once into OKLCH hue
// space so wedge targets are perceptually placed (matches the v1 engine).
const SLOT_OKLCH_HUES: number[] = Array.from({ length: 12 }, (_, i) => {
  const rgb = hslToRgb({ h: i * 30, s: 100, l: 50 });
  return rgbToOklch(rgb).h;
});

function generate(rootHex: string): { slots: string[]; rootSlot: number } {
  const rgb = hexToRgb(rootHex);
  if (!rgb) return { slots: Array(12).fill(rootHex), rootSlot: 0 };
  const o = rgbToOklch(rgb);

  let rootSlot = 0;
  let best = Infinity;
  SLOT_OKLCH_HUES.forEach((h, i) => {
    const d = angularDistance(o.h, h);
    if (d < best) { best = d; rootSlot = i; }
  });

  const slots = SLOT_OKLCH_HUES.map((h, i) =>
    i === rootSlot
      ? rootHex.toLowerCase()
      : rgbToHex(oklchToRgbClamped({ L: o.L, c: o.c, h })),
  );
  return { slots, rootSlot };
}

export function buildWheelPanel(
  getSaved: () => string[],
  onSave: (hex: string) => void,
): WheelPanel {
  const el = document.createElement("section");
  el.className = "panel panel-wheel";
  el.hidden = true;

  const picker = buildSavedPicker(getSaved, () => renderWheel());

  const ring = document.createElement("button");
  ring.type = "button";
  ring.className = "wheel-ring";
  ring.title = "Click a wedge to save that color";

  const strip = document.createElement("div");
  strip.className = "wheel-strip";

  const hint = document.createElement("p");
  hint.className = "panel-hint";
  hint.textContent =
    "Pick a saved color · twelve hues at its lightness and chroma · click a wedge to save";

  el.append(picker.el, ring, strip, hint);

  let slots: string[] = [];
  let rootSlot = 0;

  function renderWheel(): void {
    const root = picker.selected();
    strip.replaceChildren();
    if (!root) {
      ring.hidden = true;
      return;
    }
    ring.hidden = false;
    ({ slots, rootSlot } = generate(root));

    const wedge = 360 / slots.length;
    const stops = slots
      .map((c, i) => `${c} ${i * wedge}deg ${(i + 1) * wedge}deg`)
      .join(", ");
    // Wedge 0 centered at 12 o'clock, matching the click math below.
    ring.style.background = `conic-gradient(from ${-wedge / 2}deg, ${stops})`;

    slots.forEach((c, i) => {
      const cell = document.createElement("div");
      cell.className = "wheel-cell";
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "wheel-swatch";
      sw.style.background = c;
      sw.title = `Save ${c}`;
      if (i === rootSlot) sw.dataset.root = "true";
      sw.addEventListener("click", () => onSave(c));
      const label = document.createElement("span");
      label.className = "wheel-hex mono";
      label.textContent = c;
      cell.append(sw, label);
      strip.appendChild(cell);
    });
  }

  ring.addEventListener("click", (e) => {
    if (slots.length === 0) return;
    const r = ring.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    // Ignore clicks in the donut hole.
    if (Math.hypot(dx, dy) < r.width * 0.22) return;
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI; // 0° at 12 o'clock, clockwise
    if (deg < 0) deg += 360;
    const wedge = 360 / slots.length;
    const idx = Math.floor(((deg + wedge / 2) % 360) / wedge);
    onSave(slots[idx]);
  });

  return {
    el,
    refresh: () => {
      picker.refresh();
      renderWheel();
    },
  };
}
