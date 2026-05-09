import "@krill-software/desktop-ui/styles";
import "./styles.css";

import { mountChrome } from "@krill-software/desktop-ui";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { renderPanels, mountPanels } from "./panels";
import { mountPicker, syncDisplayFromState, syncSlidersFromState } from "./picker";
import { doc, isDirty, setMode, subscribe } from "./state";
import { MODES } from "./types";
import { mountWheel, renderWheel } from "./wheel";

function initChrome() {
  const chrome = mountChrome({
    productName: "Color Editor",
    // No File-menu actions specific to color-editor — close-window / quit
    // are auto-included so users still get a proper File menu.
    actions: {},
    // Slot-mode shortcuts surface as inline mode-bar buttons rather than
    // menu items; bound here so power users can flip modes from the keyboard.
    bindings: {
      "Ctrl+3": () => setMode(3),
      "Ctrl+6": () => setMode(6),
      // Note: Ctrl+0 / Ctrl+1 are krill-canonical for zoom, but color-editor
      // doesn't zoom — using Alt+0 to avoid the convention clash.
      "Alt+0":  () => setMode(12),
    },
    showStatusLine: true,
  });
  chrome.viewport.id = "app";

  // Left column: wheel + picker + mode bar.
  const left = document.createElement("section");
  left.id = "left";
  left.innerHTML = `
    <div id="wheel-wrap">
      <div id="wheel"></div>
      <div id="wheel-hole"></div>
      <div id="wheel-marker" aria-hidden="true"></div>
      <div id="wheel-labels"></div>
    </div>
    <div id="picker"></div>
    <div id="mode-bar"></div>
  `;
  chrome.viewport.appendChild(left);

  // Right column: hex / rgb / css output panels.
  const right = document.createElement("aside");
  right.id = "right";
  right.innerHTML = `
    <section class="output">
      <h3>Hex</h3>
      <pre id="out-hex"></pre>
    </section>
    <section class="output">
      <h3>RGB</h3>
      <pre id="out-rgb"></pre>
    </section>
    <section class="output">
      <h3>CSS</h3>
      <pre id="out-css"></pre>
    </section>
  `;
  chrome.viewport.appendChild(right);

  // Status line: name, dirty indicator, mode label.
  const sl = chrome.statusLine!;
  for (const id of ["status-name", "status-dirty", "status-mode"]) {
    const span = document.createElement("span");
    span.id = id;
    if (id === "status-dirty") span.setAttribute("aria-hidden", "true");
    sl.appendChild(span);
  }
}

function installModeBar() {
  const host = document.getElementById("mode-bar");
  if (!host) return;
  host.replaceChildren();
  const label = document.createElement("span");
  label.className = "mode-label";
  label.textContent = "slots";
  host.appendChild(label);
  for (const m of MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mode-btn";
    btn.dataset.mode = String(m);
    btn.textContent = String(m);
    btn.addEventListener("click", () => setMode(m));
    host.appendChild(btn);
  }
}

function syncModeBar() {
  const cur = doc.palette.mode;
  for (const el of document.querySelectorAll<HTMLButtonElement>(".mode-btn")) {
    el.dataset.active = String(+el.dataset.mode! === cur);
  }
}

function updateTitle() {
  const name = doc.palette.name || "untitled";
  const mark = isDirty() ? " •" : "";
  const label = `${name}${mark} — Color Editor`;
  document.title = label;
  getCurrentWindow().setTitle(label).catch(() => {});
}

function updateStatus() {
  const set = (id: string, v: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set("status-name", doc.palette.name || "untitled");
  set("status-mode", `${doc.palette.mode} slots`);
  const dirty = document.getElementById("status-dirty");
  if (dirty) dirty.dataset.dirty = String(isDirty());
}

function boot() {
  initChrome();
  installModeBar();

  const ring   = document.getElementById("wheel")!;
  const labels = document.getElementById("wheel-labels")!;
  const marker = document.getElementById("wheel-marker")!;
  mountWheel(ring, labels, marker);

  mountPanels(
    document.getElementById("out-hex")!,
    document.getElementById("out-rgb")!,
    document.getElementById("out-css")!,
  );

  mountPicker(document.getElementById("picker")!);

  subscribe(() => {
    renderWheel();
    renderPanels();
    syncDisplayFromState();
    syncModeBar();
    updateTitle();
    updateStatus();
  });

  // initial paint
  renderWheel();
  renderPanels();
  syncSlidersFromState();
  syncDisplayFromState();
  syncModeBar();
  updateTitle();
  updateStatus();
}

boot();
