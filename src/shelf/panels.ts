// Hex / RGB / CSS output panels. Plain <pre> blocks; user selects + Ctrl+C.

import { hexToRgb, rgb255 } from "./oklch";
import { slotNamesForMode } from "./palette";
import { doc } from "./state";

interface Refs {
  hex: HTMLElement;
  rgb: HTMLElement;
  css: HTMLElement;
}

let refs: Refs | null = null;

export function mountPanels(hex: HTMLElement, rgb: HTMLElement, css: HTMLElement) {
  refs = { hex, rgb, css };
}

export function renderPanels() {
  if (!refs) return;
  const { slots, mode } = doc.palette;
  const names = slotNamesForMode(mode);
  const pad = Math.max(...names.map((n) => n.length));

  refs.hex.textContent = slots.map((s, i) => `${names[i].padEnd(pad)}  ${s}`).join("\n");

  refs.rgb.textContent = slots.map((s, i) => {
    const c = hexToRgb(s);
    if (!c) return `${names[i]}  rgb(?, ?, ?)`;
    const [r, g, b] = rgb255(c);
    return `${names[i].padEnd(pad)}  rgb(${r}, ${g}, ${b})`;
  }).join("\n");

  const cssLines = slots.map((s, i) => `  --${names[i]}: ${s};`).join("\n");
  refs.css.textContent = `:root {\n${cssLines}\n}`;
}
