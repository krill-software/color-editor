// HSL slider picker + hex input.
//
// The sliders are the user's input device; we never write back to them on every
// state notify (HSL ↔ hex round-trips lose precision and would jiggle the UI).
// Display elements (swatch, hex input) DO follow state. External state changes
// — e.g. opening a palette file — should call syncSlidersFromState().

import { hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from "./oklch";
import { doc, setPrimary } from "./state";

let hueInput: HTMLInputElement;
let satInput: HTMLInputElement;
let litInput: HTMLInputElement;
let hexInput: HTMLInputElement;
let swatch: HTMLDivElement;
let hexFocused = false;

export function mountPicker(host: HTMLElement) {
  host.replaceChildren();
  const wrap = document.createElement("div");
  wrap.className = "picker";

  swatch = document.createElement("div");
  swatch.className = "picker-swatch";

  const sliders = document.createElement("div");
  sliders.className = "picker-sliders";

  hueInput = makeSlider(0, 360);
  satInput = makeSlider(0, 100);
  litInput = makeSlider(0, 100);

  sliders.appendChild(wrapField("Hue", hueInput));
  sliders.appendChild(wrapField("Sat", satInput));
  sliders.appendChild(wrapField("Lit", litInput));

  hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.spellcheck = false;
  hexInput.className = "picker-hex";
  hexInput.placeholder = "#rrggbb";
  const hexWrap = document.createElement("label");
  hexWrap.className = "picker-hex-wrap";
  const hexLab = document.createElement("span");
  hexLab.textContent = "Hex";
  hexWrap.appendChild(hexLab);
  hexWrap.appendChild(hexInput);

  wrap.appendChild(swatch);
  wrap.appendChild(sliders);
  wrap.appendChild(hexWrap);
  host.appendChild(wrap);

  for (const el of [hueInput, satInput, litInput]) {
    el.addEventListener("input", onSlider);
  }
  hexInput.addEventListener("focus", () => { hexFocused = true; });
  hexInput.addEventListener("blur", () => { hexFocused = false; onHexCommit(); });
  hexInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
  });

  syncSlidersFromState();
  syncDisplayFromState();
}

/** Push state into sliders. Use only when state changed from outside the picker
 *  (e.g. opening a palette file). */
export function syncSlidersFromState() {
  const rgb = hexToRgb(doc.palette.primary) ?? { r: 0, g: 0, b: 0 };
  const { h, s, l } = rgbToHsl(rgb);
  hueInput.value = String(Math.round(h));
  satInput.value = String(Math.round(s));
  litInput.value = String(Math.round(l));
}

/** Update swatch + hex input. Safe to call on every notify. */
export function syncDisplayFromState() {
  swatch.style.background = doc.palette.primary;
  if (!hexFocused) hexInput.value = doc.palette.primary;
}

function onSlider() {
  const h = +hueInput.value;
  const s = +satInput.value;
  const l = +litInput.value;
  const hex = rgbToHex(hslToRgb({ h, s, l }));
  setPrimary(hex);
}

function onHexCommit() {
  const v = hexInput.value.trim();
  const rgb = hexToRgb(v);
  if (rgb) {
    const normalized = v.startsWith("#") ? v.toLowerCase() : `#${v.toLowerCase()}`;
    setPrimary(normalized);
    syncSlidersFromState();
  } else {
    syncDisplayFromState();
  }
}

function makeSlider(min: number, max: number): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "range";
  i.min = String(min); i.max = String(max); i.step = "1";
  return i;
}

function wrapField(label: string, child: HTMLInputElement): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "picker-field";
  const span = document.createElement("span");
  span.textContent = label;
  wrap.appendChild(span);
  wrap.appendChild(child);
  return wrap;
}
