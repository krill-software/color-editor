// Wheel rendering. The wheel is a circular conic-gradient masked to a donut shape;
// labels are absolutely positioned around the ring; a marker indicates the active slot.

import { activeSlotIndex, slotNamesForMode } from "./palette";
import { doc } from "./state";

interface Refs {
  ring: HTMLElement;       // #wheel
  labels: HTMLElement;     // #wheel-labels
  marker: HTMLElement;     // #wheel-marker
}

let refs: Refs | null = null;

export function mountWheel(ring: HTMLElement, labels: HTMLElement, marker: HTMLElement) {
  refs = { ring, labels, marker };
}

export function renderWheel() {
  if (!refs) return;
  const { ring, labels, marker } = refs;
  const { slots, mode, primary } = doc.palette;
  const n = slots.length;
  const wedge = 360 / n;
  const offset = -wedge / 2;

  const stops = slots.map((c, i) => `${c} ${i * wedge}deg ${(i + 1) * wedge}deg`).join(", ");
  ring.style.background = `conic-gradient(from ${offset}deg, ${stops})`;

  // Labels at the center of each wedge.
  labels.replaceChildren();
  const names = slotNamesForMode(mode);
  for (let i = 0; i < n; i++) {
    const el = document.createElement("span");
    el.className = "wheel-label";
    el.textContent = names[i];
    el.style.transform = `rotate(${i * wedge}deg) translateY(calc(var(--wheel-r) * -1)) rotate(${-i * wedge}deg)`;
    labels.appendChild(el);
  }

  // Active-slot marker (small ring at the active slice's center).
  const active = activeSlotIndex(primary, mode);
  marker.style.transform = `rotate(${active * wedge}deg) translateY(calc(var(--wheel-r) * -1))`;
  marker.style.background = primary;
}
