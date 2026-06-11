// Picker tab: a saturation/value plane + hue slider + hex readout.
// Pick anywhere, then Save to bookmark the color into the saved pool.
//
// Model is HSV (the conventional picker geometry: white top-left, black
// bottom, pure hue top-right). Conversions are local — oklch.ts carries the
// app's perceptual math, but a picker plane is defined in HSV by convention.

import { pillBtn } from "./ui";

export interface PickerPanel {
  el: HTMLElement;
  refresh(): void;
}

interface HSV { h: number; s: number; v: number } // h 0..360, s/v 0..1

function hsvToHex({ h, s, v }: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

function hexToHsv(hex: string): HSV | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return null;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function buildPickerPanel(onSave: (hex: string) => void): PickerPanel {
  const el = document.createElement("section");
  el.className = "panel panel-picker";
  el.hidden = true;

  let hsv: HSV = { h: 340, s: 0.47, v: 0.87 }; // start near the krill accent

  // SV plane with a draggable thumb.
  const plane = document.createElement("div");
  plane.className = "picker-plane";
  const thumb = document.createElement("div");
  thumb.className = "picker-thumb";
  plane.appendChild(thumb);

  // Hue slider (rainbow track).
  const hue = document.createElement("input");
  hue.type = "range";
  hue.min = "0"; hue.max = "360"; hue.step = "1";
  hue.className = "picker-hue";
  hue.setAttribute("aria-label", "Hue");

  // Readout row: swatch chip + hex input + save.
  const row = document.createElement("div");
  row.className = "picker-row";
  const chip = document.createElement("div");
  chip.className = "picker-chip";
  const hex = document.createElement("input");
  hex.type = "text";
  hex.spellcheck = false;
  hex.className = "picker-hex mono";
  hex.placeholder = "#rrggbb";
  const saveBtn = pillBtn("bookmark", "Save to saved colors (S)", () => save());
  saveBtn.classList.add("pill-accent");
  row.append(chip, hex, saveBtn);

  const hint = document.createElement("p");
  hint.className = "panel-hint";
  hint.textContent = "Drag the plane for saturation and brightness · slider for hue · S to save";

  el.append(plane, hue, row, hint);

  function current(): string {
    return hsvToHex(hsv);
  }

  function save(): void {
    onSave(current());
  }

  function render(skipHexInput = false): void {
    const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    plane.style.background =
      `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pure})`;
    thumb.style.left = `${hsv.s * 100}%`;
    thumb.style.top = `${(1 - hsv.v) * 100}%`;
    const c = current();
    thumb.style.background = c;
    chip.style.background = c;
    hue.value = String(Math.round(hsv.h));
    if (!skipHexInput) hex.value = c;
  }

  function planePick(e: PointerEvent): void {
    const r = plane.getBoundingClientRect();
    hsv.s = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    hsv.v = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    render();
  }

  plane.addEventListener("pointerdown", (e) => {
    plane.setPointerCapture(e.pointerId);
    planePick(e);
    const move = (ev: PointerEvent) => planePick(ev);
    const up = () => {
      plane.removeEventListener("pointermove", move);
      plane.removeEventListener("pointerup", up);
    };
    plane.addEventListener("pointermove", move);
    plane.addEventListener("pointerup", up);
  });

  hue.addEventListener("input", () => {
    hsv.h = +hue.value;
    render();
  });

  hex.addEventListener("input", () => {
    const v = hex.value.trim().toLowerCase();
    const norm = /^#[0-9a-f]{3}$/.test(v)
      ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
      : v;
    const parsed = hexToHsv(norm);
    if (parsed) {
      hsv = parsed;
      render(true);
    }
  });
  hex.addEventListener("blur", () => render());
  hex.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); render(); }
  });

  el.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target && target.tagName === "INPUT" && target !== hue) return;
    if (e.code === "KeyS" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); save(); }
  });

  render();
  return { el, refresh: () => render() };
}
