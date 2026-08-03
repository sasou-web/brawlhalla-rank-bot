/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 1/10
   État global, helpers DOM, icônes SVG, thème, modales, sélecteurs
   ────────────────────────────────────────────────────────────────────────
   ⚠️ SCRIPT CLASSIQUE, PAS un module ES — et l'ORDRE DE CHARGEMENT COMPTE.

   Pourquoi pas de modules ES : catgirl.js se greffe sur des fonctions
   globales (toast, renderApp, renderOverview, showLogin). Passer en modules
   les rendrait inaccessibles et casserait la surcouche.

   Comment ça tient : les déclarations `function` deviennent des propriétés
   globales (donc appelables depuis n'importe quel fichier, et remplaçables
   par catgirl.js), et les `let`/`const` de premier niveau vivent dans
   l'environnement lexical global, partagé entre tous les scripts classiques.
   Un fichier ne peut donc lire les `const` que des fichiers chargés AVANT lui.

   L'ordre est fixé dans index.html. `boot()` est appelé en dernier, depuis
   dash-boot.js, une fois tous les fichiers évalués.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";
// ═══════════════════ 1. État global & helpers ═══════════════════
let ME = null;
let GUILD = null;
let CONFIG = {};
let current = "overview";
let dirty = false;
let appHooked = false;
let logTimer = null;
let navFilter = "";
let suppressHash = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const errorMessages = {
  notadmin: "Tu n'es pas administrateur de ce serveur.",
  token: "Échec de l'authentification Discord.",
  oauth: "Erreur OAuth. Réessaie.",
  nocode: "Connexion annulée.",
  state: "Session de connexion expirée ou invalide. Relance la connexion.",
};

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) n.setAttribute(k, v);
  }
  for (const c of kids) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
}

function toast(msg, kind = "ok") {
  const t = $("#toast");
  t.innerHTML = "";
  t.append(icon(kind === "err" ? "alert" : "check", 17), el("span", {}, msg));
  t.className = "show " + kind;
  setTimeout(() => (t.className = ""), 2800);
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
  return res.json();
}

// Indicateur « modifications non enregistrées » : bouton pulsé + libellé de la barre d'action.
function setDirty(v) {
  dirty = v;
  $$("#content .btn-save").forEach((b) => b.classList.toggle("dirty", v));
  $$("#content .sb-hint").forEach((h) => {
    h.classList.toggle("dirty", v);
    h.innerHTML = "";
    h.append(
      icon(v ? "alert" : "check", 14),
      el("span", {}, v ? "Modifications non enregistrées" : "Tout est enregistré"),
    );
  });
}

// ═══════════════════ 2. Icônes SVG (stroke, currentColor) ═══════════════════
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.6V21h14V9.6"/>',
  chart: '<path d="M3 21h18"/><path d="M6 21V11M11 21V4M16 21v-6"/>',
  pulse: '<path d="M2 12h4l3-8 4 16 3-8h6"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13.5 15H17"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15 8.5a5 5 0 0 1 0 7"/><path d="M18 6a9 9 0 0 1 0 12"/>',
  bell: '<path d="M18 8.5a6 6 0 1 0-12 0c0 7-3 8.5-3 8.5h18s-3-1.5-3-8.5"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
  userplus: '<path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 7v6M22 10h-6"/>',
  users: '<path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.1a4 4 0 0 1 0 7.75"/>',
  star: '<path d="m12 3 2.9 5.9 6.6.9-4.8 4.6 1.2 6.5L12 17.8l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9L12 3Z"/>',
  link: '<path d="m9.5 14.5 5-5"/><path d="M11 6.5 12.5 5a4.2 4.2 0 0 1 6 6L17 12.5"/><path d="M13 17.5 11.5 19a4.2 4.2 0 0 1-6-6L7 11.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8.2-8 9-4.5-.8-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
  refresh: '<path d="M20.5 12a8.5 8.5 0 1 1-2.8-6.3"/><path d="M21 4v5h-5"/>',
  gift: '<rect x="3" y="8.5" width="18" height="12.5" rx="2"/><path d="M3 13h18M12 8.5V21"/><path d="M12 8.5S10.6 3.5 8.2 4.9 9.2 8.5 12 8.5Zm0 0s1.4-5 3.8-3.6S14.8 8.5 12 8.5Z"/>',
  medal: '<circle cx="12" cy="14.5" r="5.5"/><path d="M8.3 9.4 5 3.5h5.6l1.3 2.6M15.7 9.4 19 3.5h-5.6"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M16 4v16M3 9.3h18M3 14.7h18"/>',
  flame: '<path d="M12 22c4 0 7-2.7 7-6.5 0-4.5-4.5-6-5.6-11.5-3 2-5.4 5-5.4 9C8 15 6 15 6 15c-.7 1.2-1 2.1-1 2.8C5 20.2 7.7 22 12 22Z"/>',
  mic: '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18.5V21.5M9 21.5h6"/>',
  volume: '<path d="M11 4.5 6.5 9H3v6h3.5L11 19.5V4.5Z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M18.5 7a7 7 0 0 1 0 10"/>',
  trophy: '<path d="M8 4h8v5.5a4 4 0 0 1-8 0V4Z"/><path d="M8 5.5H5.2A3 3 0 0 0 8 9.5M16 5.5h2.8A3 3 0 0 1 16 9.5"/><path d="M12 13.5V17M9 21h6M10.2 21c0-2 .9-4 1.8-4s1.8 2 1.8 4"/>',
  sprout: '<path d="M12 21v-9.5"/><path d="M12 11.5C12 7.6 9 5.5 5 5.5c0 3.9 3 6 7 6Z"/><path d="M12 11.5c0-3.4 3-5 7-5 0 3.4-3 5-7 5Z"/>',
  ticket: '<path d="M3 9.5V6.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2.5 2.5 0 0 0 0 5v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2.5 2.5 0 0 0 0-5Z"/><path d="M13.5 4.5v15"/>',
  sliders: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  music: '<circle cx="6.5" cy="17.5" r="3"/><circle cx="18" cy="15.5" r="3"/><path d="M9.5 17.5V6l11.5-2.5v12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2 6 6M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
  moon: '<path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3Z"/>',
  droplet: '<path d="M12 3s6.3 6.4 6.3 10.2A6.3 6.3 0 0 1 5.7 13.2C5.7 9.4 12 3 12 3Z"/>',
  logout: '<path d="M14.5 3H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3.5"/><path d="m10 16.5-4.5-4.5L10 7.5M5.5 12h9"/>',
  check: '<path d="m4.5 12.5 5 5L20 7"/>',
  alert: '<path d="M12 9.5v4M12 17.2h.01"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  external: '<path d="M7 17 17 7M9.5 7H17v7.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkles: '<path d="m12 3.5 1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7L12 3.5Z"/><path d="m18.5 15.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
  command: '<path d="M6 9a3 3 0 1 1 3-3v12a3 3 0 1 1-3-3h12a3 3 0 1 1-3 3V6a3 3 0 1 1 3 3H6Z"/>',
  swords: '<path d="M14.5 3H21v6.5"/><path d="M21 3 12 12"/><path d="m3.5 14.5 6 6-2.5 2.5-6-6 2.5-2.5Z"/><path d="M9.5 3H3v6.5"/><path d="m3 3 9 9"/><path d="m20.5 14.5-6 6 2.5 2.5 6-6-2.5-2.5Z"/>',
};

// Fabrique un élément SVG à partir du jeu d'icônes.
function icon(name, size = 18, strokeWidth = 1.8) {
  const span = el("span", { class: "svg-ico", "aria-hidden": "true" });
  span.innerHTML =
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
    `stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" ` +
    `stroke-linejoin="round">${ICONS[name] || ICONS.sparkles}</svg>`;
  return span;
}

// ═══════════════════ Thème & couleur d'accent ═══════════════════
function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  localStorage.setItem("bh_theme", theme);
}

const ACCENT_PRESETS = {
  violet: { a: "#7c5cff", b: "#4ea1ff" },
  bleu: { a: "#4ea1ff", b: "#2ecc71" },
  cyan: { a: "#22d3ee", b: "#4ea1ff" },
  vert: { a: "#2ecc71", b: "#4ea1ff" },
  or: { a: "#f1c40f", b: "#ff8a3d" },
  orange: { a: "#ff8a3d", b: "#ff4d5e" },
  rouge: { a: "#ff4d5e", b: "#ff8a3d" },
  rose: { a: "#ff5ca8", b: "#7c5cff" },
};

function applyAccent(name) {
  const p = ACCENT_PRESETS[name] || ACCENT_PRESETS.violet;
  const root = document.documentElement.style;
  root.setProperty("--accent", p.a);
  root.setProperty("--accent-2", p.b);
  root.setProperty("--accent-grad", `linear-gradient(135deg, ${p.a}, ${p.b})`);
  root.setProperty("--accent-soft", hexToRgba(p.a, 0.14));
  root.setProperty("--accent-ring", hexToRgba(p.a, 0.28));
  root.setProperty("--bg-glow-1", hexToRgba(p.a, 0.16));
  root.setProperty("--bg-glow-2", hexToRgba(p.b, 0.1));
  root.setProperty("--shadow-accent", `0 8px 26px ${hexToRgba(p.a, 0.32)}`);
  localStorage.setItem("bh_accent", name);
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// ═══════════════════ 3. Modales & sélecteurs ═══════════════════

// Modale de confirmation stylée (remplace confirm()).
function confirmModal(message, { title = "Confirmation", danger = false, okLabel = "Confirmer" } = {}) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
    const card = el("div", { class: "modal-card" },
      el("div", { class: "modal-title" }, title),
      el("div", { class: "modal-msg", html: message }));
    const cancel = el("button", { class: "modal-btn" }, "Annuler");
    const ok = el("button", { class: "modal-btn " + (danger ? "danger" : "primary") }, okLabel);
    const done = (v) => {
      document.removeEventListener("keydown", onKey);
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 200);
      resolve(v);
    };
    const onKey = (e) => { if (e.key === "Escape") done(false); };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
    document.addEventListener("keydown", onKey);
    card.append(el("div", { class: "modal-actions" }, cancel, ok));
    overlay.append(card);
    document.body.append(overlay);
    requestAnimationFrame(() => { overlay.classList.add("show"); ok.focus(); });
  });
}

// Modale de saisie de score d'un match.
function scoreModal(nameA, nameB, sa, sb) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
    const inA = el("input", { type: "number", min: 0, value: sa });
    const inB = el("input", { type: "number", min: 0, value: sb });
    const cancel = el("button", { class: "modal-btn" }, "Annuler");
    const ok = el("button", { class: "modal-btn primary" }, "Valider");
    const done = (v) => {
      document.removeEventListener("keydown", onKey);
      overlay.classList.remove("show");
      setTimeout(() => overlay.remove(), 200);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
      if (e.key === "Enter") ok.click();
    };
    cancel.onclick = () => done(null);
    ok.onclick = () => done({ scoreA: Number(inA.value), scoreB: Number(inB.value) });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
    document.addEventListener("keydown", onKey);
    overlay.append(el("div", { class: "modal-card" },
      el("div", { class: "modal-title" }, "Score du match"),
      el("div", { class: "modal-fields" },
        el("div", { style: "text-align:center" }, el("div", { class: "desc", style: "margin-bottom:6px" }, nameA), inA),
        el("span", { class: "vs" }, "—"),
        el("div", { style: "text-align:center" }, el("div", { class: "desc", style: "margin-bottom:6px" }, nameB), inB)),
      el("div", { class: "modal-actions" }, cancel, ok)));
    document.body.append(overlay);
    requestAnimationFrame(() => { overlay.classList.add("show"); inA.focus(); inA.select(); });
  });
}

// Dropdown avec recherche intégrée (pour salons / rôles).
function searchSelect(cfg, key, options, { allowNone = true } = {}) {
  const all = (allowNone ? [{ value: "", label: "— Aucun —" }] : []).concat(options);
  const labelOf = (v) => (all.find((o) => String(o.value) === String(v ?? "")) || {}).label || "— Aucun —";
  const wrap = el("div", { class: "ss-wrap" });
  const btn = el("button", { type: "button", class: "ss-btn" }, labelOf(cfg[key]));
  const search = el("input", { class: "ss-search", placeholder: "Rechercher…" });
  const list = el("div", { class: "ss-list" });
  const panel = el("div", { class: "ss-panel" }, search, list);

  const close = () => panel.classList.remove("open");
  const draw = (q = "") => {
    list.innerHTML = "";
    const f = all.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
    if (!f.length) { list.append(el("div", { class: "ss-empty" }, "Aucun résultat")); return; }
    for (const o of f) {
      list.append(el("div", {
        class: "ss-opt" + (String(o.value) === String(cfg[key] ?? "") ? " sel" : ""),
        onmousedown: (e) => { e.preventDefault(); cfg[key] = o.value; btn.textContent = o.label; setDirty(true); close(); },
      }, o.label));
    }
  };
  btn.addEventListener("click", () => {
    const open = panel.classList.toggle("open");
    if (open) { search.value = ""; draw(); setTimeout(() => search.focus(), 0); }
  });
  search.addEventListener("input", () => draw(search.value));
  search.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); btn.focus(); } });
  search.addEventListener("blur", () => setTimeout(close, 150));
  wrap.append(btn, panel);
  return wrap;
}

function skeletonCards(n = 3) {
  const w = el("div");
  for (let i = 0; i < n; i++) {
    w.append(el("div", { class: "card" },
      el("div", { class: "skel skel-title" }),
      el("div", { class: "skel skel-line" }),
      el("div", { class: "skel skel-line short" })));
  }
  return w;
}
