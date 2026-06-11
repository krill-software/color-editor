// Small shared UI helpers for the tab panels: inline stroke icons, the round
// pill button, and the "pick a saved color" strip that Shades and Wheel lead
// with. All chrome-colored (krill palette); the colors *shown* are content.

export function svgIcon(kind: string, size = 16): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  const paths: Record<string, string[]> = {
    "chevron-left": ["M15 18l-6-6 6-6"],
    "chevron-right": ["M9 18l6-6-6-6"],
    plus: ["M12 5v14", "M5 12h14"],
    bookmark: ["M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"],
    sparkles: [
      "M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z",
      "M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
    ],
    pencil: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"],
    pipette: [
      "m2 22 1-1h3l9-9",
      "M3 21v-3l9-9",
      "m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z",
    ],
    layers: [
      "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",
      "m22 12.18-9.17 4.16a2 2 0 0 1-1.66 0L2 12.18",
      "m22 17.18-9.17 4.16a2 2 0 0 1-1.66 0L2 17.18",
    ],
    wheel: [
      "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20",
      "M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7",
      "M12 2v6.5", "M21.5 9l-6.2 2", "M17.9 19.5l-3.8-5.2",
      "M6.1 19.5l3.8-5.2", "M2.5 9l6.2 2",
    ],
  };
  for (const d of paths[kind] ?? []) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

export function pillBtn(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pill-btn";
  b.title = title;
  b.append(svgIcon(icon, 16));
  b.addEventListener("click", onClick);
  return b;
}

// ---- Saved-color picker strip ------------------------------------------

export interface SavedPicker {
  el: HTMLElement;
  /** Re-read the saved pool and re-render. Keeps the selection if the color
   *  is still in the pool; otherwise falls back to the first saved color. */
  refresh(): void;
  selected(): string | null;
}

/** A horizontal strip of the saved colors; click selects one. Shades and
 *  Wheel lead with this — they both derive from a chosen saved color. */
export function buildSavedPicker(
  getSaved: () => string[],
  onSelect: (hex: string) => void,
): SavedPicker {
  const el = document.createElement("div");
  el.className = "saved-pick";
  let current: string | null = null;

  function refresh(): void {
    const pool = getSaved();
    if (current === null || !pool.includes(current)) current = pool[0] ?? null;
    el.replaceChildren();
    if (pool.length === 0) {
      const hint = document.createElement("p");
      hint.className = "panel-hint";
      hint.textContent = "No saved colors yet. Save one from Discover or the Picker first.";
      el.appendChild(hint);
      return;
    }
    for (const c of pool) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "saved-pick-swatch";
      b.style.background = c;
      b.title = c;
      b.dataset.selected = String(c === current);
      b.addEventListener("click", () => {
        current = c;
        refresh();
        onSelect(c);
      });
      el.appendChild(b);
    }
  }

  return { el, refresh, selected: () => current };
}

/** Ink color for a label sitting ON a content color: the palette's own
 *  Ghost White or Space Cadet, whichever reads. (Content rule: the bar is
 *  content; the label just has to be legible on it.) */
export function inkOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#30343f";
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 140 ? "#30343f" : "#fafaff";
}
