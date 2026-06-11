// Shades tab: pick a saved color, see it as the root of a vertical ramp —
// lighter tints stacked above, darker shades below, the root in the middle.
// Click any bar to save that shade into the saved pool.
//
// The ramp steps lightness in OKLCH so the spacing is perceptually even,
// with a gentle chroma taper toward both ends (very light and very dark
// colors carry less chroma before they look muddy or neon).

import { hexToRgb, oklchToRgbClamped, rgbToHex, rgbToOklch } from "./oklch";
import { buildSavedPicker, inkOn, svgIcon } from "./ui";

export interface ShadesPanel {
  el: HTMLElement;
  refresh(): void;
}

const STEPS = 4;        // bars on each side of the root
const L_LIGHT = 0.96;   // lightness ceiling for the top tint
const L_DARK = 0.16;    // lightness floor for the bottom shade
const C_TAPER = 0.35;   // how much chroma falls away at the extremes

interface Bar { hex: string; isRoot: boolean }

function ramp(rootHex: string): Bar[] {
  const rgb = hexToRgb(rootHex);
  if (!rgb) return [{ hex: rootHex, isRoot: true }];
  const o = rgbToOklch(rgb);
  const bars: Bar[] = [];
  for (let i = STEPS; i >= 1; i--) {
    const t = i / (STEPS + 1);
    const L = o.L + (L_LIGHT - o.L) * t;
    const c = o.c * (1 - C_TAPER * t);
    bars.push({ hex: rgbToHex(oklchToRgbClamped({ L, c, h: o.h })), isRoot: false });
  }
  bars.push({ hex: rootHex.toLowerCase(), isRoot: true });
  for (let i = 1; i <= STEPS; i++) {
    const t = i / (STEPS + 1);
    const L = o.L + (L_DARK - o.L) * t;
    const c = o.c * (1 - C_TAPER * t);
    bars.push({ hex: rgbToHex(oklchToRgbClamped({ L, c, h: o.h })), isRoot: false });
  }
  return bars;
}

export function buildShadesPanel(
  getSaved: () => string[],
  onSave: (hex: string) => void,
): ShadesPanel {
  const el = document.createElement("section");
  el.className = "panel panel-shades";
  el.hidden = true;

  const picker = buildSavedPicker(getSaved, () => renderRamp());

  const rampEl = document.createElement("div");
  rampEl.className = "shade-ramp";

  const hint = document.createElement("p");
  hint.className = "panel-hint";
  hint.textContent = "Pick a saved color · lighter above, darker below · click a bar to save it";

  el.append(picker.el, rampEl, hint);

  function renderRamp(): void {
    rampEl.replaceChildren();
    const root = picker.selected();
    if (!root) return;
    for (const bar of ramp(root)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "shade-bar mono";
      b.style.background = bar.hex;
      b.style.color = inkOn(bar.hex);
      if (bar.isRoot) b.dataset.root = "true";
      b.title = `Save ${bar.hex}`;
      const label = document.createElement("span");
      label.textContent = bar.hex;
      b.appendChild(label);
      if (!bar.isRoot) {
        const mark = document.createElement("span");
        mark.className = "shade-save";
        mark.append(svgIcon("bookmark", 13));
        b.appendChild(mark);
      }
      b.addEventListener("click", () => onSave(bar.hex));
      rampEl.appendChild(b);
    }
  }

  return {
    el,
    refresh: () => {
      picker.refresh();
      renderRamp();
    },
  };
}
