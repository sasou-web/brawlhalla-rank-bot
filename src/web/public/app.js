"use strict";

/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard
   ────────────────────────────────────────────────────────────────────────
   Organisation du fichier :
     1. État global & helpers            5. Navigation, topbar, routing
     2. Icônes SVG                       6. Schémas de configuration
     3. Modales & sélecteurs             7. Rendu des sections
     4. Champs & éditeurs                8. Pages spécifiques

   NOTE : `toast`, `renderApp`, `renderOverview` et `showLogin` sont des
   fonctions globales volontairement — `catgirl.js` s'y greffe.
   ════════════════════════════════════════════════════════════════════════ */

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

// ═══════════════════ 4. Champs & éditeurs ═══════════════════

// En-tête de page : pastille d'icône + titre + description + actions optionnelles.
function pageHead(ico, title, sub, actions) {
  const head = el("div", { class: "page-head" },
    el("div", { class: "ph-ico" }, ico),
    el("div", { class: "ph-txt" },
      el("h2", {}, title),
      sub ? el("p", {}, sub) : null));
  if (actions && actions.length) head.append(el("div", { class: "ph-actions" }, ...actions));
  return head;
}

// Titre de bloc (séparateur visuel entre groupes de cartes).
function blockTitle(label) {
  return el("div", { class: "block-title" }, label);
}

// Barre d'action ancrée. `hint` affiche l'état d'enregistrement à gauche.
function actionBar({ hint = false } = {}, ...items) {
  const bar = el("div", { class: "save-bar" });
  if (hint) bar.append(el("div", { class: "sb-hint" }, icon("check", 14), el("span", {}, "Tout est enregistré")));
  for (const i of items) if (i) bar.append(i);
  return bar;
}

// ----- Sources de listes -----
const channelOpts = (kind) => {
  if (kind === "textann" || kind === "text") return [...GUILD.channels.text, ...GUILD.channels.announcement];
  if (kind === "textvoice") return [...GUILD.channels.text, ...GUILD.channels.announcement, ...GUILD.channels.voice];
  return GUILD.channels[kind] || [];
};

function fieldRow(label, desc, control, col = false) {
  return el(
    "div",
    { class: "field" + (col ? " col" : "") },
    el("div", {}, el("div", { class: "label" }, label), desc ? el("div", { class: "desc" }, desc) : null),
    el("div", { class: "control" }, control),
  );
}

function toggle(cfg, key) {
  const input = el("input", { type: "checkbox" });
  input.checked = !!cfg[key];
  input.addEventListener("change", () => (cfg[key] = input.checked));
  return el("label", { class: "toggle" }, input, el("span", { class: "slider" }));
}

function numberInput(cfg, key, min, max) {
  const i = el("input", { type: "number", value: cfg[key] ?? 0 });
  if (min != null) i.min = min;
  if (max != null) i.max = max;
  i.addEventListener("change", () => (cfg[key] = Number(i.value)));
  return i;
}

function textInput(cfg, key, placeholder) {
  const i = el("input", { type: "text", value: cfg[key] ?? "", placeholder: placeholder || "" });
  i.addEventListener("input", () => (cfg[key] = i.value.trim()));
  return i;
}

function selectInput(cfg, key, options, allowNone) {
  const s = el("select");
  if (allowNone) s.append(el("option", { value: "" }, "— Aucun —"));
  for (const o of options) {
    const opt = el("option", { value: o.value }, o.label);
    if (String(cfg[key] ?? "") === String(o.value)) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener("change", () => (cfg[key] = s.value));
  return s;
}

function channelSelect(cfg, key, kind, allowNone = true) {
  const opts = channelOpts(kind).map((c) => ({ value: c.id, label: "# " + c.name }));
  const cur = cfg[key];
  if (cur && !opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: "# salon configuré" });
  return searchSelect(cfg, key, opts, { allowNone });
}

function roleSelect(cfg, key, allowNone = true) {
  return searchSelect(cfg, key, GUILD.roles.map((r) => ({ value: r.id, label: "@ " + r.name })), { allowNone });
}

function colorInput(cfg, key) {
  const i = el("input", { type: "color", value: cfg[key] || "#7c5cff" });
  i.addEventListener("input", () => (cfg[key] = i.value));
  return i;
}

function textareaInput(cfg, key, placeholder) {
  const t = el("textarea", { placeholder: placeholder || "" });
  t.value = cfg[key] ?? "";
  t.addEventListener("input", () => (cfg[key] = t.value));
  return t;
}

// Multi-rôles : dropdown d'ajout + tags supprimables
function multiRole(cfg, key) {
  cfg[key] = Array.isArray(cfg[key]) ? cfg[key] : [];
  const wrap = el("div", { style: "width:100%" });
  const tags = el("div", { class: "tags" });
  const redraw = () => {
    tags.innerHTML = "";
    if (!cfg[key].length) tags.append(el("div", { class: "desc" }, "Aucun rôle sélectionné."));
    for (const id of cfg[key]) {
      const r = GUILD.roles.find((x) => x.id === id);
      tags.append(
        el("span", { class: "tag" }, "@ " + (r ? r.name : id),
          el("button", { title: "Retirer", onclick: () => { cfg[key] = cfg[key].filter((x) => x !== id); redraw(); } }, "✕")),
      );
    }
  };
  const add = el("select");
  add.append(el("option", { value: "" }, "+ Ajouter un rôle"));
  for (const r of GUILD.roles) add.append(el("option", { value: r.id }, "@ " + r.name));
  add.addEventListener("change", () => {
    if (add.value && !cfg[key].includes(add.value)) { cfg[key].push(add.value); redraw(); }
    add.value = "";
  });
  redraw();
  wrap.append(tags, el("div", { style: "margin-top:10px" }, add));
  return wrap;
}

// Multi-salons : dropdown d'ajout + tags supprimables
function multiChannel(cfg, key, kind) {
  cfg[key] = Array.isArray(cfg[key]) ? cfg[key] : [];
  const wrap = el("div", { style: "width:100%" });
  const tags = el("div", { class: "tags" });
  const redraw = () => {
    tags.innerHTML = "";
    if (!cfg[key].length) tags.append(el("div", { class: "desc" }, "Aucun salon sélectionné."));
    for (const id of cfg[key]) {
      const c = channelOpts(kind).find((x) => x.id === id);
      tags.append(
        el("span", { class: "tag" }, "# " + (c ? c.name : id),
          el("button", { title: "Retirer", onclick: () => { cfg[key] = cfg[key].filter((x) => x !== id); redraw(); } }, "✕")),
      );
    }
  };
  const add = el("select");
  add.append(el("option", { value: "" }, "+ Ajouter un salon"));
  for (const c of channelOpts(kind)) add.append(el("option", { value: c.id }, "# " + c.name));
  add.addEventListener("change", () => {
    if (add.value && !cfg[key].includes(add.value)) { cfg[key].push(add.value); redraw(); }
    add.value = "";
  });
  redraw();
  wrap.append(tags, el("div", { style: "margin-top:10px" }, add));
  return wrap;
}

// Réactions : texte + palette d'emojis du serveur
function reactionsEditor(cfg, key) {
  cfg[key] = Array.isArray(cfg[key]) ? cfg[key] : [];
  const wrap = el("div", { style: "width:100%" });
  const input = el("textarea", { placeholder: "🔥 👍 ou emojis du serveur" });
  input.value = cfg[key].join(" ");
  const sync = () => (cfg[key] = input.value.split(/\s+/).filter(Boolean));
  input.addEventListener("input", sync);
  wrap.append(input);
  if (GUILD.emojis.length) {
    const pal = el("div", { class: "emoji-palette" });
    for (const e of GUILD.emojis) {
      pal.append(el("img", { src: e.url, title: e.name, alt: e.name, onclick: () => { input.value = (input.value.trim() + " " + e.token).trim() + " "; sync(); } }));
    }
    wrap.append(el("div", { class: "desc", style: "margin-top:10px" }, "Clique un emoji du serveur pour l'ajouter :"), pal);
  }
  return wrap;
}

function domainsEditor(cfg, key) {
  cfg[key] = Array.isArray(cfg[key]) ? cfg[key] : [];
  const t = el("textarea", { placeholder: "catbox.moe, dubz.gg, monhebergeur.com" });
  t.value = cfg[key].join(", ");
  t.addEventListener("input", () => (cfg[key] = t.value.split(/[\s,;]+/).map((d) => d.trim().toLowerCase()).filter(Boolean)));
  return t;
}

// Récompenses de niveau : lignes (niveau -> rôle)
function rewardsEditor(cfg) {
  cfg.rewards = cfg.rewards && typeof cfg.rewards === "object" ? cfg.rewards : {};
  const wrap = el("div", { style: "width:100%" });
  const list = el("div");
  const redraw = () => {
    list.innerHTML = "";
    const entries = Object.entries(cfg.rewards).sort((a, b) => +a[0] - +b[0]);
    if (!entries.length) list.append(el("div", { class: "empty-row" }, "Aucune récompense. Ajoute un palier pour attribuer un rôle à un niveau."));
    for (const [lvl, roleId] of entries) {
      const lvlIn = el("input", { class: "lvl", type: "number", value: lvl, min: 1 });
      const rSel = roleSelect({ v: roleId }, "v", false);
      const apply = () => {
        delete cfg.rewards[lvl];
        if (lvlIn.value) cfg.rewards[String(parseInt(lvlIn.value, 10))] = rSel.value;
      };
      lvlIn.addEventListener("change", () => { apply(); redraw(); });
      rSel.addEventListener("change", () => (cfg.rewards[String(parseInt(lvlIn.value, 10))] = rSel.value));
      list.append(
        el("div", { class: "reward-row" },
          el("span", { class: "tag", style: "flex-shrink:0" }, "Niveau"),
          lvlIn, rSel,
          el("button", { class: "icon-btn", title: "Supprimer", onclick: () => { delete cfg.rewards[lvl]; redraw(); setDirty(true); } }, "🗑")),
      );
    }
  };
  const addBtn = el("button", { class: "btn-add", onclick: () => {
    let n = 5; while (cfg.rewards[n]) n += 5;
    cfg.rewards[n] = (GUILD.roles[0] && GUILD.roles[0].id) || "";
    redraw();
    setDirty(true);
  } }, "+ Ajouter une récompense");
  redraw();
  wrap.append(list, addBtn);
  return wrap;
}

// Hubs vocaux temporaires
function hubsEditor(cfg) {
  cfg.hubs = cfg.hubs && typeof cfg.hubs === "object" ? cfg.hubs : {};
  const wrap = el("div", { style: "width:100%" });
  const list = el("div");
  const redraw = () => {
    list.innerHTML = "";
    const entries = Object.entries(cfg.hubs);
    if (!entries.length) list.append(el("div", { class: "empty-row" }, "Aucun hub. Choisis un salon vocal ci-dessous : y entrer créera un salon personnel."));
    for (const [chId, h] of entries) {
      const c = GUILD.channels.voice.find((x) => x.id === chId);
      const nameIn = el("input", { type: "text", value: h.nameTemplate || "🎮 {user}", placeholder: "{user} 1v1" });
      const limitIn = el("input", { type: "number", value: h.userLimit || 0, min: 0, max: 99, style: "max-width:90px" });
      nameIn.addEventListener("input", () => (cfg.hubs[chId].nameTemplate = nameIn.value));
      limitIn.addEventListener("change", () => (cfg.hubs[chId].userLimit = Number(limitIn.value)));
      list.append(
        el("div", { class: "hub-row", style: "flex-wrap:wrap" },
          el("span", { class: "tag" }, "🔊 " + (c ? c.name : chId)),
          nameIn, limitIn,
          el("button", { class: "icon-btn", title: "Supprimer", onclick: () => { delete cfg.hubs[chId]; redraw(); setDirty(true); } }, "🗑")),
      );
    }
  };
  const addSel = el("select");
  addSel.append(el("option", { value: "" }, "+ Ajouter un salon hub (vocal)"));
  for (const c of GUILD.channels.voice) addSel.append(el("option", { value: c.id }, "🔊 " + c.name));
  addSel.addEventListener("change", () => {
    if (addSel.value && !cfg.hubs[addSel.value]) { cfg.hubs[addSel.value] = { nameTemplate: "🎮 {user}", userLimit: 0 }; redraw(); }
    addSel.value = "";
  });
  redraw();
  wrap.append(list, el("div", { style: "margin-top:10px" }, addSel));
  return wrap;
}

// Liste de messages de rappel : un textarea par message + ajout/suppression.
function messagesEditor(cfg, key) {
  cfg[key] = Array.isArray(cfg[key]) ? cfg[key] : [];
  const wrap = el("div", { style: "width:100%" });
  const list = el("div");
  const redraw = () => {
    list.innerHTML = "";
    if (!cfg[key].length) list.append(el("div", { class: "empty-row" }, "Aucun message. Ajoute au moins un rappel pour activer la rotation."));
    cfg[key].forEach((msg, i) => {
      const t = el("textarea", { placeholder: "🎙️ Vocaux privés : rejoins le salon..." });
      t.value = msg || "";
      t.addEventListener("input", () => (cfg[key][i] = t.value));
      const del = el("button", { class: "icon-btn", title: "Supprimer", onclick: () => { cfg[key].splice(i, 1); redraw(); setDirty(true); } }, "🗑");
      list.append(
        el("div", { class: "msg-row" },
          el("span", { class: "tag", style: "margin-top:6px" }, "#" + (i + 1)),
          el("div", { style: "flex:1;min-width:0" }, t),
          del),
      );
    });
  };
  const addBtn = el("button", { class: "btn-add", onclick: () => {
    if (cfg[key].length >= 25) return toast("Maximum 25 messages.", "err");
    cfg[key].push("");
    redraw();
    setDirty(true);
  } }, "+ Ajouter un message");
  redraw();
  wrap.append(list, addBtn);
  return wrap;
}

// Champ compact (label au-dessus du contrôle).
function fItem(label, desc, control, full) {
  const f = el("div", { class: "fitem" + (full ? " full" : "") });
  f.append(el("label", {}, label));
  if (desc) f.append(el("div", { class: "desc" }, desc));
  f.append(control);
  return f;
}

function fToggle(label, desc, cfg, key, full) {
  return el("div", { class: "fitem row" + (full ? " full" : "") },
    el("div", {}, el("label", {}, label), desc ? el("div", { class: "desc" }, desc) : null),
    toggle(cfg, key));
}

function sectionCard(ico, title, ...rows) {
  const c = el("div", { class: "card" }, el("div", { class: "card-section-title" }, el("span", { class: "ico" }, ico), title));
  for (const r of rows) c.append(r);
  return c;
}

// Carte avec titre + sous-titre + action optionnelle dans l'en-tête.
function card(title, sub, action) {
  const c = el("div", { class: "card" });
  const head = el("div", { class: "card-head" }, el("h3", {}, title));
  if (action) head.append(action);
  c.append(head);
  if (sub) c.append(el("div", { class: "card-sub" }, sub));
  return c;
}

// ═══════════════════ 5. Navigation, topbar & routing ═══════════════════
/*
  Organisation des sections par intention plutôt que par module technique :
    Pilotage         → observer (état, stats, santé API, logs)
    Liaison & rangs  → le cœur du bot : lier un compte, valider, distribuer les rôles
    Engagement       → faire vivre la communauté (XP, accueil, concours, jeux)
    Contenu          → ce que le bot publie (annonces, rappels, TikTok, clips, combos)
    Vocal            → tout ce qui touche aux salons vocaux
    Compétition      → tournois et seeding
    Support          → tickets
  `cfg` pointe vers la clé de CONFIG dont le champ `enabled` pilote la pastille d'état.
*/
const NAV_GROUPS = [
  {
    label: "Pilotage",
    items: [
      { id: "overview", label: "Vue d'ensemble", icon: "home", ico: "📊", sub: "État du bot et raccourcis" },
      { id: "stats", label: "Statistiques", icon: "chart", ico: "📈", sub: "Comptes liés, XP, répartition par tier" },
      { id: "metrics", label: "Fiabilité API", icon: "pulse", ico: "📡", sub: "Santé de l'API Brawlhalla en direct" },
      { id: "logs", label: "Logs en direct", icon: "terminal", ico: "📜", sub: "Dernières actions du bot" },
    ],
  },
  {
    label: "Liaison & rangs",
    items: [
      { id: "linkpanel", label: "Panneau de liaison", icon: "link", ico: "🔗", sub: "Cadre + bouton « Lier mon compte »", cfg: "linkpanel" },
      { id: "settings", label: "Validation & salons", icon: "shield", ico: "🛡️", sub: "Salons système, auto-validation, preuves", cfg: "settings" },
      { id: "roles", label: "Rôles de rank", icon: "refresh", ico: "🔄", sub: "Resynchroniser tous les membres liés" },
    ],
  },
  {
    label: "Engagement",
    items: [
      { id: "levels", label: "Niveaux", icon: "star", ico: "⭐", sub: "XP, paliers et rôles de récompense", cfg: "levels" },
      { id: "welcome", label: "Bienvenue", icon: "userplus", ico: "👋", sub: "Accueil, auto-rôle et au revoir", cfg: "welcome" },
      { id: "giveaway", label: "Giveaways", icon: "gift", ico: "🎉", sub: "Concours et tirages au sort", cfg: "giveaway" },
      { id: "guessrank", label: "Devine ton rang", icon: "medal", ico: "🏅", sub: "Votes par réactions de rank", cfg: "guessrank" },
    ],
  },
  {
    label: "Contenu & annonces",
    items: [
      { id: "announce", label: "Annonces", icon: "megaphone", ico: "📢", sub: "Composer et publier un message" },
      { id: "reminders", label: "Rappels auto", icon: "bell", ico: "🔔", sub: "Messages récurrents dans un salon", cfg: "reminders" },
      { id: "tiktok", label: "TikTok", icon: "music", ico: "📱", sub: "Notifications des nouvelles vidéos", cfg: "tiktok" },
      { id: "clips", label: "Clips", icon: "film", ico: "🎬", sub: "Réactions automatiques et modération", cfg: "clips" },
      { id: "combos", label: "Combos", icon: "flame", ico: "🥊", sub: "Base de true combos BrawlDatabase" },
    ],
  },
  {
    label: "Vocal",
    items: [
      { id: "tempvoice", label: "Vocaux temporaires", icon: "volume", ico: "🔊", sub: "Rejoindre un hub pour créer un salon", cfg: "tempvoice" },
      { id: "vocrank", label: "Vocaux par rank", icon: "mic", ico: "🎙️", sub: "Un salon vocal par tier, accès vérifié" },
    ],
  },
  {
    label: "Compétition",
    items: [
      { id: "tournament", label: "Tournoi", icon: "trophy", ico: "🏆", sub: "Inscriptions, bracket et scores" },
      { id: "startgg", label: "Seeding start.gg", icon: "sprout", ico: "🌱", sub: "Seeder un événement start.gg" },
    ],
  },
  {
    label: "Support",
    items: [
      { id: "tickets", label: "Tickets", icon: "ticket", ico: "🎫", sub: "Panneau de support et salons privés", cfg: "tickets" },
    ],
  },
  // Section dédiée à League of Legends : `theme: "lol"` applique une identité
  // visuelle distincte (or hextech / bleu Rift) sur toutes ses pages.
  {
    label: "League of Legends",
    theme: "lol",
    items: [
      { id: "lol", label: "Accueil & rôle", icon: "swords", ico: "🎮", sub: "Message quand le rôle LoL est attribué", cfg: "lol" },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label, theme: g.theme || null })));
const pageOf = (id) => NAV.find((p) => p.id === id) || NAV[0];
// Modules dont l'état activé/inactif est pilotable (pastille + grille de l'accueil).
const TOGGLEABLE = NAV.filter((p) => p.cfg && p.cfg !== "settings" && p.cfg !== "linkpanel");
const isEnabled = (p) => !!(p.cfg && CONFIG[p.cfg] && CONFIG[p.cfg].enabled);

// ----- Boot -----
async function boot() {
  applyTheme(localStorage.getItem("bh_theme") || "dark");
  applyAccent(localStorage.getItem("bh_accent") || "violet");
  const err = new URLSearchParams(location.search).get("error");
  try {
    ME = await api("/api/me");
  } catch {
    return showLogin(err);
  }
  if (!ME.isAdmin) return showLogin("notadmin");
  try {
    [GUILD, CONFIG] = await Promise.all([api("/api/guild"), api("/api/config")]);
  } catch (e) {
    return showLogin(err || "oauth");
  }
  const fromHash = pageIdFromHash();
  if (fromHash) current = fromHash;
  renderApp();
}

function showLogin(err) {
  $("#loading").style.display = "none";
  $("#login").style.display = "flex";
  if (err && errorMessages[err]) {
    const b = $("#login-error");
    b.textContent = errorMessages[err];
    b.style.display = "block";
  }
}

// ----- Routing par hash (#/levels) : liens partageables + retour navigateur -----
function pageIdFromHash() {
  const id = (location.hash || "").replace(/^#\/?/, "");
  return NAV.some((p) => p.id === id) ? id : null;
}

async function navigateTo(id, { fromHash = false } = {}) {
  if (id === current) return true;
  if (dirty && !(await confirmModal(
    "Tu as des modifications non enregistrées. Changer de section quand même ?",
    { okLabel: "Quitter sans enregistrer", danger: true },
  ))) {
    if (fromHash) setHash(current);
    return false;
  }
  setDirty(false);
  current = id;
  navFilter = "";
  if (!fromHash) setHash(id);
  closeSidebar();
  renderApp();
  window.scrollTo(0, 0);
  return true;
}

function setHash(id) {
  const target = "#/" + id;
  if (location.hash === target) return;
  suppressHash = true;
  location.hash = target;
}

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#scrim").classList.add("show");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#scrim").classList.remove("show");
}

// ----- Sidebar : navigation filtrable -----
function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  const q = navFilter.trim().toLowerCase();

  const makeItem = (item) => {
    const btn = el("button", {
      class: "nav-item" + (item.id === current ? " active" : ""),
      "aria-current": item.id === current ? "page" : null,
      title: item.sub || item.label,
      onclick: () => navigateTo(item.id),
    },
      el("span", { class: "ico" }, icon(item.icon, 16)),
      el("span", { class: "nav-label" }, item.label));
    if (item.cfg && item.cfg !== "settings" && item.cfg !== "linkpanel") {
      const on = isEnabled(item);
      btn.append(el("span", {
        class: "nav-state" + (on ? " on" : ""),
        title: on ? "Module activé" : "Module inactif",
      }));
    }
    return btn;
  };

  let shown = 0;
  for (const group of NAV_GROUPS) {
    const items = group.items.filter(
      (i) => !q || i.label.toLowerCase().includes(q) || (i.sub || "").toLowerCase().includes(q) || group.label.toLowerCase().includes(q),
    );
    if (!items.length) continue;
    nav.append(el("div", { class: "nav-group" + (group.theme ? " theme-" + group.theme : "") }, group.label));
    for (const item of items) {
      const btn = makeItem(item);
      if (group.theme) btn.classList.add("theme-" + group.theme);
      nav.append(btn);
    }
    shown += items.length;
  }
  if (!shown) nav.append(el("div", { class: "nav-empty" }, "Aucune section ne correspond à « " + navFilter + " »."));
}

// ----- Topbar : fil d'Ariane, recherche, thème, palette de couleurs -----
function renderTopbar() {
  const bar = $("#topbar");
  bar.innerHTML = "";
  const p = pageOf(current);

  const burger = el("button", { class: "menu-toggle", "aria-label": "Ouvrir le menu", onclick: openSidebar }, icon("menu", 19));

  const crumbs = el("div", { class: "crumbs" },
    el("span", { class: "cb-group" }, p.group),
    el("span", { class: "cb-sep" }, icon("chevron", 13)),
    el("span", { class: "cb-cur" }, p.label));

  const search = el("button", { class: "tb-search", title: "Recherche rapide (Ctrl+K)", onclick: () => openPalette() },
    icon("search", 15), el("span", {}, "Rechercher…"), el("kbd", {}, "Ctrl K"));

  const isLight = document.body.classList.contains("light");
  const themeBtn = el("button", {
    class: "tb-icon theme-toggle",
    title: isLight ? "Passer en mode sombre" : "Passer en mode clair",
    "aria-label": "Changer de thème",
    onclick: () => { applyTheme(isLight ? "dark" : "light"); renderTopbar(); },
  }, icon(isLight ? "moon" : "sun", 18));

  // Palette de couleurs d'accent dans un popover.
  const popWrap = el("div", { class: "pop-wrap" });
  const pop = el("div", { class: "pop" }, el("div", { class: "pop-title" }, "Couleur d'accent"));
  const accentRow = el("div", { class: "accent-row" });
  const currentAccent = localStorage.getItem("bh_accent") || "violet";
  for (const [name, preset] of Object.entries(ACCENT_PRESETS)) {
    accentRow.append(el("button", {
      class: "accent-dot" + (name === currentAccent ? " sel" : ""),
      title: name,
      "aria-label": "Accent " + name,
      style: `background:linear-gradient(135deg, ${preset.a}, ${preset.b})`,
      onclick: () => { applyAccent(name); renderTopbar(); },
    }));
  }
  pop.append(accentRow);
  const paletteBtn = el("button", {
    class: "tb-icon",
    title: "Couleur d'accent",
    "aria-label": "Couleur d'accent",
    "aria-expanded": "false",
    onclick: (e) => {
      e.stopPropagation();
      const open = pop.classList.toggle("open");
      paletteBtn.setAttribute("aria-expanded", String(open));
    },
  }, icon("droplet", 18));
  popWrap.append(paletteBtn, pop);
  // La fermeture au clic extérieur est gérée par un unique écouteur global
  // posé dans renderApp (voir `appHooked`) pour éviter d'empiler des listeners.

  const guild = el("div", { class: "tb-guild", title: GUILD.name });
  guild.append(
    GUILD.icon ? el("img", { src: GUILD.icon, alt: "" }) : el("span", { class: "tg-fallback" }, "🎮"),
    el("span", {}, GUILD.name),
  );

  bar.append(burger, crumbs, el("div", { class: "topbar-spacer" }),
    el("div", { class: "topbar-actions" }, search, themeBtn, popWrap, guild));
}

// ----- Palette de commandes (Ctrl+K) -----
function openPalette() {
  if ($(".cmdk")) return;
  const overlay = el("div", { class: "cmdk", role: "dialog", "aria-modal": "true" });
  const input = el("input", { type: "text", placeholder: "Aller à une section, changer de thème…", "aria-label": "Recherche" });
  const list = el("div", { class: "cmdk-list" });
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.classList.remove("show");
    setTimeout(() => overlay.remove(), 180);
  };

  // Commandes = sections + actions globales.
  const commands = NAV.map((p) => ({
    kind: p.group,
    icon: p.icon,
    name: p.label,
    hint: p.sub,
    run: () => navigateTo(p.id),
  }));
  commands.push(
    {
      kind: "Apparence", icon: "sun", name: "Basculer le thème clair / sombre", hint: "Thème",
      run: () => { applyTheme(document.body.classList.contains("light") ? "dark" : "light"); renderTopbar(); },
    },
    {
      kind: "Apparence", icon: "droplet", name: "Couleur d'accent suivante", hint: "Accent",
      run: () => {
        const keys = Object.keys(ACCENT_PRESETS);
        const i = keys.indexOf(localStorage.getItem("bh_accent") || "violet");
        applyAccent(keys[(i + 1) % keys.length]);
        renderTopbar();
      },
    },
    { kind: "Compte", icon: "logout", name: "Se déconnecter", hint: "Quitter le dashboard", run: () => (location.href = "/logout") },
  );

  let matches = commands;
  let sel = 0;

  const draw = () => {
    list.innerHTML = "";
    const q = input.value.trim().toLowerCase();
    matches = commands.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || (c.hint || "").toLowerCase().includes(q) || c.kind.toLowerCase().includes(q),
    );
    if (!matches.length) {
      list.append(el("div", { class: "empty-row", style: "margin:8px" }, "Aucun résultat."));
      return;
    }
    if (sel >= matches.length) sel = matches.length - 1;
    let lastKind = null;
    matches.forEach((c, i) => {
      if (c.kind !== lastKind) { list.append(el("div", { class: "cmdk-group" }, c.kind)); lastKind = c.kind; }
      const opt = el("button", {
        class: "cmdk-opt" + (i === sel ? " sel" : ""),
        onmouseenter: () => { sel = i; paint(); },
        onclick: () => { close(); c.run(); },
      },
        el("span", { class: "ico" }, icon(c.icon, 15)),
        el("span", { class: "co-name" }, c.name),
        c.hint ? el("span", { class: "co-hint" }, c.hint) : null);
      opt.dataset.idx = String(i);
      list.append(opt);
    });
  };
  const paint = () => {
    list.querySelectorAll(".cmdk-opt").forEach((o) => o.classList.toggle("sel", Number(o.dataset.idx) === sel));
    const active = list.querySelector(".cmdk-opt.sel");
    if (active) active.scrollIntoView({ block: "nearest" });
  };
  const onKey = (e) => {
    if (e.key === "Escape") return close();
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, matches.length - 1); paint(); }
    if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
    if (e.key === "Enter" && matches[sel]) { e.preventDefault(); const c = matches[sel]; close(); c.run(); }
  };

  input.addEventListener("input", () => { sel = 0; draw(); });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  overlay.append(el("div", { class: "cmdk-card" },
    el("div", { class: "cmdk-input-wrap" }, icon("search", 18), input),
    list,
    el("div", { class: "cmdk-foot" },
      el("span", {}, el("kbd", {}, "↑↓"), " naviguer"),
      el("span", {}, el("kbd", {}, "↵"), " ouvrir"),
      el("span", {}, el("kbd", {}, "Échap"), " fermer"))));
  document.body.append(overlay);
  draw();
  requestAnimationFrame(() => { overlay.classList.add("show"); input.focus(); });
}

// ----- Rendu de la coquille -----
function renderApp() {
  $("#loading").style.display = "none";
  $("#app").classList.add("active");
  $("#guild-name").textContent = GUILD.name;
  $("#user-name").textContent = ME.username;
  if (ME.avatar) $("#user-avatar").src = ME.avatar;

  // Hooks globaux, une seule fois.
  if (!appHooked) {
    appHooked = true;

    $("#content").addEventListener("input", () => setDirty(true));
    $("#content").addEventListener("change", () => setDirty(true));
    $("#scrim").addEventListener("click", closeSidebar);
    $("#nav-search-ico").append(icon("search", 15));
    $(".sidebar-foot .logout").append(icon("logout", 16));

    // Ferme les popovers de la topbar au clic extérieur.
    document.addEventListener("click", () => {
      $$(".pop.open").forEach((p) => {
        p.classList.remove("open");
        const btn = p.parentElement && p.parentElement.querySelector(".tb-icon");
        if (btn) btn.setAttribute("aria-expanded", "false");
      });
    });

    // Recherche de section dans la sidebar.
    const q = $("#nav-q");
    q.addEventListener("input", () => { navFilter = q.value; renderNav(); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { q.value = ""; navFilter = ""; renderNav(); q.blur(); }
      if (e.key === "Enter") {
        const first = $("#nav .nav-item");
        if (first) first.click();
      }
    });

    // Garde-fou : avertit avant de quitter/recharger avec des modifications en attente.
    window.addEventListener("beforeunload", (e) => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    });

    // Routing : retour/avance du navigateur.
    window.addEventListener("hashchange", () => {
      if (suppressHash) { suppressHash = false; return; }
      const id = pageIdFromHash();
      if (id && id !== current) navigateTo(id, { fromHash: true });
    });

    // Raccourcis clavier globaux.
    window.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "k" || e.key === "K")) { e.preventDefault(); openPalette(); return; }
      if (mod && (e.key === "s" || e.key === "S")) {
        const saveBtn = $("#content .btn-save:not(:disabled)");
        if (saveBtn) { e.preventDefault(); saveBtn.click(); }
      }
    });
  }

  // Thème propre à la section courante (ex. identité League of Legends).
  applySectionTheme(pageOf(current).theme);

  renderNav();
  renderTopbar();
  renderSection(current);
}

// Applique/retire la classe de thème de section sur <body>. Les variables CSS
// posées par cette classe l'emportent sur l'accent global (déclaré en inline
// sur <html>), ce qui donne une identité visuelle propre à chaque univers.
const SECTION_THEMES = ["lol"];
function applySectionTheme(theme) {
  for (const t of SECTION_THEMES) document.body.classList.toggle("theme-" + t, theme === t);
}

// ═══════════════════ 6. Schémas de configuration ═══════════════════
// Chaque section déclarative renvoie { ico, title, sub, cards[] }.
// Une carte = { title, sub?, fields: [[label, desc, control]], extra? }.
function sectionSchema(id, cfg) {
  const tierOpts = GUILD.tiers.map((t) => ({ value: t, label: t }));
  switch (id) {
    case "settings":
      return {
        ico: "🛡️",
        title: "Validation & salons système",
        sub: "Où le bot publie ses messages internes, et comment les demandes de liaison Brawlhalla sont validées.",
        cards: [
          { title: "Salons système", sub: "Les salons dans lesquels le bot travaille au quotidien.", fields: [
            ["Salon de validation", "Où arrivent les demandes de liaison à valider.", channelSelect(cfg, "reviewChannelId", "text")],
            ["Salon d'audit (logs)", "Journal des actions du bot.", channelSelect(cfg, "auditChannelId", "text")],
            ["Salon des annonces", "Annonces de montée de rang.", channelSelect(cfg, "announceChannelId", "text")],
            ["Salon d'alertes (santé du bot)", "Crash, déconnexion Discord, API down. Vide = salon d'audit.", channelSelect(cfg, "alertChannelId", "text")],
            ["Salon des succès", "Annonces des achievements débloqués (sans ping). Vide = désactivé.", channelSelect(cfg, "achievementsChannelId", "text")],
          ] },
          { title: "Validation des liaisons", sub: "Qui valide, et à partir de quel rang une validation humaine est requise.", fields: [
            ["Rôle validateur", "Rôle autorisé à valider/refuser (sinon permission Gérer le serveur).", roleSelect(cfg, "reviewerRoleId")],
            ["Seuil d'auto-validation", "Tout ce qui est ≤ ce tier est validé automatiquement.", selectInput(cfg, "autoApproveTier", tierOpts)],
          ] },
          { title: "Validation par preuve (hauts rangs)", sub: "À partir du rang choisi, un fil privé est créé : le joueur y poste une capture de sa page de profil en jeu (ID + pseudo visibles), le staff valide depuis ce fil.", fields: [
            ["Preuve obligatoire", "Active la demande de capture d'écran pour les hauts rangs.", toggle(cfg, "requireProofScreenshot")],
            ["Rang exigeant une preuve", "À partir de ce tier (inclus), une capture est demandée.", selectInput(cfg, "proofTier", tierOpts)],
            ["Salon des fils de preuve", "⚠️ Doit être VISIBLE par les membres (sinon ils ne peuvent pas être ajoutés au fil privé). Vide = salon où /lier est lancé. Le staff doit avoir « Gérer les fils » pour les voir.", channelSelect(cfg, "proofChannelId", "text")],
          ] },
        ],
      };
    case "levels":
      return {
        ico: "⭐",
        title: "Système de niveaux",
        sub: "Gain d'XP en discutant et en vocal, annonces de montée de niveau et rôles de récompense.",
        cards: [
          { title: "Général", fields: [
            ["Activé", "Active le gain d'XP.", toggle(cfg, "enabled")],
            ["Annonces", "Où annoncer les montées de niveau.", selectInput(cfg, "announceMode", [{ value: "channel", label: "Salon" }, { value: "dm", label: "Message privé" }, { value: "off", label: "Désactivées" }])],
            ["Salon d'annonce", "Si mode Salon (vide = salon du message).", channelSelect(cfg, "announceChannelId", "text")],
          ] },
          { title: "Gain d'XP", sub: "Combien d'XP rapporte un message ou une minute en vocal.", fields: [
            ["Cooldown (s)", "Délai entre deux gains d'XP par message.", numberInput(cfg, "cooldownSec", 0)],
            ["XP min / message", "", numberInput(cfg, "minXp", 1)],
            ["XP max / message", "", numberInput(cfg, "maxXp", 1)],
            ["XP vocal", "Gain d'XP en vocal.", toggle(cfg, "voiceEnabled")],
            ["XP vocal / min", "", numberInput(cfg, "voiceXpPerMin", 0)],
          ] },
          { title: "Bonus & anti-abus", sub: "Multiplicateurs d'XP et garde-fous.", fields: [
            ["Bonus week-end (×)", "Multiplie l'XP le samedi/dimanche (1 = désactivé).", numberInput(cfg, "weekendBonus", 1)],
            ["Rôle bonus", "Ce rôle gagne plus d'XP (ex: booster Nitro).", roleSelect(cfg, "boosterRoleId")],
            ["Multiplicateur du rôle bonus (×)", "", numberInput(cfg, "boosterMultiplier", 1)],
            ["Cap XP / jour", "Plafond d'XP par membre et par jour (0 = illimité).", numberInput(cfg, "dailyXpCap", 0)],
          ], extra: el("div", { style: "margin-top:14px" }, el("div", { class: "card-sub" }, "🚫 Salons sans XP (texte ou vocal)"), multiChannel(cfg, "noXpChannels", "textvoice")) },
          { title: "Récompenses", sub: "Rôle attribué à chaque palier de niveau.", fields: [
            ["Cumuler les rôles", "Oui = garde tous les paliers. Non = seulement le plus haut.", toggle(cfg, "stackRewards")],
          ], extra: rewardsEditor(cfg) },
        ],
      };
    case "tiktok":
      return {
        ico: "📱",
        title: "Notifications TikTok",
        sub: "Poste automatiquement les nouvelles vidéos d'un compte via son flux RSS.",
        cards: [
          { title: "Source", sub: "Le compte à suivre et la fréquence de vérification.", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["URL du flux RSS", "Généré par rss.app, GitHub Pages, etc.", textInput(cfg, "feedUrl", "https://...")],
            ["Pseudo affiché", "Sans le @.", textInput(cfg, "username", "kayagoldforged")],
            ["Photo de profil (URL)", "Affichée à côté du pseudo.", textInput(cfg, "avatarUrl", "https://...")],
            ["Intervalle (min)", "Fréquence de vérification (min. 2).", numberInput(cfg, "pollIntervalMin", 2)],
          ] },
          { title: "Publication", sub: "Où et comment la vidéo est annoncée.", fields: [
            ["Salon", "Où poster les vidéos.", channelSelect(cfg, "channelId", "text")],
            ["Rôle à ping", "Optionnel.", roleSelect(cfg, "roleId")],
            ["Date de la vidéo", "Affiche « TikTok • date/heure » en bas de l'embed.", toggle(cfg, "showDate")],
            ["Message d'annonce", "Phrase postée avec la vidéo. {pseudo} = nom affiché, {url} = lien. Vide = phrase par défaut.", textareaInput(cfg, "message", "Nouvelle vidéo de {pseudo} va la voir tout de suite !")],
          ] },
        ],
      };
    case "clips":
      return {
        ico: "🎬",
        title: "Réactions sur les clips",
        sub: "Le bot réagit automatiquement aux clips vidéo et modère le salon.",
        cards: [
          { title: "Comportement", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Vidéos uniquement", "Ne réagit qu'aux messages avec une vidéo.", toggle(cfg, "requireVideo")],
            ["Supprimer les non-vidéos", "Efface les messages sans vidéo (besoin de Gérer les messages).", toggle(cfg, "deleteNonVideo")],
            ["Ignorer les bots", "", toggle(cfg, "ignoreBots")],
            ["Ignorer les réponses", "", toggle(cfg, "ignoreReplies")],
            ["Épingler à partir de (réactions)", "Épingle le clip quand une réaction atteint ce nombre (0 = off). La réaction du bot compte.", numberInput(cfg, "pinThreshold", 0)],
          ] },
          { title: "Salons surveillés", sub: "Le bot n'agit que dans ces salons.", fields: [], extra: multiChannel(cfg, "channelIds", "textann") },
          { title: "Réactions ajoutées", sub: "Emojis posés automatiquement sur chaque clip.", fields: [], extra: reactionsEditor(cfg, "reactions") },
          { title: "Domaines vidéo acceptés en plus", sub: "Hébergeurs considérés comme des vidéos valides.", fields: [], extra: domainsEditor(cfg, "extraDomains") },
        ],
      };
    case "guessrank":
      return {
        ico: "🏅",
        title: "Devine ton rang",
        sub: "Les membres votent le rang du joueur d'un clip via des réactions emojis de rank.",
        cards: [
          { title: "Comportement", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Un seul vote / membre", "Retire le vote précédent quand on en clique un autre.", toggle(cfg, "singleVote")],
            ["Vidéos uniquement", "", toggle(cfg, "requireVideo")],
            ["Supprimer les non-vidéos", "", toggle(cfg, "deleteNonVideo")],
            ["Ignorer les bots", "", toggle(cfg, "ignoreBots")],
            ["Ignorer les réponses", "", toggle(cfg, "ignoreReplies")],
          ] },
          { title: "Salons surveillés", fields: [], extra: multiChannel(cfg, "channelIds", "textann") },
          { title: "Emojis de rank", sub: "Dans l'ordre Tin → Valhallan.", fields: [], extra: reactionsEditor(cfg, "reactions") },
          { title: "Domaines vidéo acceptés en plus", fields: [], extra: domainsEditor(cfg, "extraDomains") },
        ],
      };
    case "tempvoice":
      return {
        ico: "🔊",
        title: "Vocaux temporaires",
        sub: "Rejoindre un salon « hub » crée un vocal personnel, supprimé automatiquement quand il se vide.",
        cards: [
          { title: "Général", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Catégorie des salons créés", "Vide = celle de chaque hub.", channelSelect(cfg, "categoryId", "category")],
          ] },
          { title: "Hubs (rejoindre pour créer)", sub: "{user} = pseudo du membre. La limite 0 signifie « illimité ».", fields: [], extra: hubsEditor(cfg) },
        ],
      };
    case "reminders":
      return {
        ico: "🔔",
        title: "Rappels automatiques",
        sub: "Le bot poste régulièrement un message d'une liste dans un salon (vocaux privés, règles, liens utiles…).",
        cards: [
          { title: "Général", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Salon des rappels", "Où le bot publie les rappels.", channelSelect(cfg, "channelId", "text")],
            ["Intervalle (minutes)", "Délai entre deux rappels (min. 1, max. 10080 = 7 jours).", numberInput(cfg, "intervalMinutes", 1, 10080)],
            ["Ordre d'envoi", "Rotation = à la suite ; Aléatoire = au hasard.", selectInput(cfg, "mode", [{ value: "rotate", label: "Rotation" }, { value: "random", label: "Aléatoire" }])],
          ] },
          { title: "Messages", sub: "Un rappel par bloc. Les rappels sont postés sans mention (pas de ping en masse).", fields: [], extra: messagesEditor(cfg, "messages") },
        ],
      };
    case "linkpanel":
      return {
        ico: "🔗",
        title: "Panneau de liaison",
        sub: "Un cadre soigné + bouton « Lier mon compte » : au clic, un modal (ID / pseudo) lance la liaison. Plus besoin de taper /lier.",
        cards: [
          { title: "Apparence", fields: [
            ["Titre", "", textInput(cfg, "title", "🔗 Lier ton compte Brawlhalla")],
            ["Texte du bouton", "", textInput(cfg, "buttonLabel", "Lier mon compte")],
            ["Couleur (hex)", "Bordure du cadre. Ex : #4ea1ff", textInput(cfg, "color", "#4ea1ff")],
            ["Vignette (URL image)", "Petite image à droite du titre. Optionnel.", textInput(cfg, "thumbnailUrl", "https://...")],
            ["Bannière (URL image)", "Grande image en haut du cadre. Optionnel.", textInput(cfg, "bannerUrl", "https://...")],
          ] },
          { title: "Texte d'accroche", sub: "Markdown supporté.", fields: [], extra: textareaInput(cfg, "description", "Phrase d'accroche (markdown supporté).") },
          { title: "Avantages de la liaison", sub: "Titre + liste affichée dans le cadre (markdown, une ligne par avantage).", fields: [
            ["Titre de la section", "", textInput(cfg, "benefitsTitle", "✨ Pourquoi lier ton compte ?")],
          ], extra: textareaInput(cfg, "benefits", "🎖️ Rôles de rank automatiques\n🔄 Mise à jour auto...") },
          { title: "Pied de cadre (conseil)", fields: [], extra: textareaInput(cfg, "footerText", "💡 Le plus fiable : ton Brawlhalla ID...") },
          { title: "Publication", sub: "Choisis le salon puis utilise « Publier le panneau » dans la barre du bas.", fields: [
            ["Salon du panneau", "", channelSelect(cfg, "channelId", "text")],
          ] },
        ],
      };
    case "lol":
      if (!cfg.embed) cfg.embed = {};
      return {
        ico: "🎮",
        title: "Accueil & rôle LoL",
        sub: "Quand un membre obtient le rôle League of Legends, le bot l'accueille dans le salon de la section.",
        cards: [
          { title: "Déclencheur", sub: "Le bot surveille l'ajout du rôle, peu importe la source : onboarding Discord, reaction-role ou attribution manuelle par le staff.", fields: [
            ["Activé", "Active l'accueil automatique de la section LoL.", toggle(cfg, "enabled")],
            ["Rôle League of Legends", "Le rôle qui déclenche le message d'accueil.", roleSelect(cfg, "roleId")],
            ["Salon d'accueil", "Où poster le message (idéalement le salon de discussion LoL).", channelSelect(cfg, "channelId", "textann")],
            ["Une seule fois par membre", "Évite de reposter si le rôle est retiré puis redonné.", toggle(cfg, "oncePerMember")],
          ], extra: lolOnboardingHelp() },
          { title: "Message", sub: "Format et contenu de l'accueil.", fields: [
            ["Format", "Carte stylée, texte simple, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Carte (embed)" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + carte" }])],
            ["Mentionner le membre", "Ping le membre accueilli.", toggle(cfg, "pingUser")],
            ["Message texte", "Utilisé si format Texte ou Texte + carte.", textareaInput(cfg, "text", "{user} vient de rejoindre la section LoL 🎮")],
          ] },
          { title: "Apparence de la carte", sub: "Utilisée pour les formats « Carte » et « Texte + carte ».", fields: [
            ["Couleur", "Bordure de la carte.", colorInput(cfg.embed, "color")],
            ["Titre", "", textInput(cfg.embed, "title", "🎮 Bienvenue sur la section LoL, {username} !")],
            ["Description", "Markdown supporté.", textareaInput(cfg.embed, "description", "Ici tu peux parler de League of Legends…")],
            ["Avatar du membre en miniature", "Affiche son avatar à droite du titre.", toggle(cfg.embed, "thumbnailUser")],
            ["Image / bannière (URL)", "Grande image en bas de la carte.", textInput(cfg.embed, "image", "https://...")],
            ["Pied de carte", "", textInput(cfg.embed, "footer", "{server} • Section LoL")],
            ["Icône du serveur dans le pied", "", toggle(cfg.embed, "footerIcon")],
          ] },
          { title: "Variables disponibles", fields: [], extra: el("div", { class: "card-sub", style: "margin:0", html:
            "<code>{user}</code> mention · <code>{username}</code> pseudo affiché · <code>{user.tag}</code> tag complet · " +
            "<code>{server}</code> nom du serveur · <code>{membercount}</code> nombre de membres" }) },
          { title: "Historique d'accueil", sub: "Liste des membres déjà accueillis, utilisée par l'option « une seule fois par membre ».", fields: [], extra: lolGreetedBox() },
        ],
      };
  }
}

// Rappel de la marche à suivre côté Discord : l'attribution du rôle via la question
// d'onboarding se configure dans les paramètres du serveur, pas depuis le bot.
function lolOnboardingHelp() {
  const box = el("div", { class: "callout info", style: "cursor:default;margin:14px 0 0;align-items:flex-start" });
  box.append(
    el("span", { class: "co-ico" }, icon("alert", 18)),
    el("div", { style: "font-weight:500;line-height:1.6" , html:
      "<b>Côté Discord</b> — pour que la réponse « League of Legends » donne le rôle :<br>" +
      "Paramètres du serveur → <b>Intégration</b> → <b>Onboarding</b> → ta question → " +
      "coche le rôle LoL sur la réponse correspondante.<br>" +
      "<span style=\"opacity:.85\">Le bot ne configure pas l'onboarding lui-même : il réagit à l'ajout du rôle. " +
      "Tout ce qui donne ce rôle déclenchera donc l'accueil.</span>" }),
  );
  return box;
}

// Compteur de membres accueillis + réinitialisation.
function lolGreetedBox() {
  const wrap = el("div", { style: "width:100%" });
  const info = el("div", { class: "card-sub", style: "margin:0 0 10px" }, "Chargement…");
  const reset = el("button", { class: "tbtn danger" }, icon("refresh", 15), "Réinitialiser l'historique");

  const load = async () => {
    try {
      const r = await api("/api/lol/greeted");
      info.textContent = r.count
        ? `${r.count} membre(s) déjà accueilli(s) — ils ne recevront plus le message.`
        : "Aucun membre accueilli pour l'instant.";
    } catch {
      info.textContent = "Impossible de lire l'historique.";
    }
  };
  reset.addEventListener("click", async () => {
    if (!(await confirmModal(
      "Réinitialiser l'historique d'accueil LoL ? Les membres qui ont déjà le rôle pourront être accueillis à nouveau lors d'un prochain ajout de rôle.",
      { title: "Réinitialiser", okLabel: "Réinitialiser", danger: true },
    ))) return;
    reset.disabled = true;
    try {
      const r = await api("/api/lol/reset-greeted", "POST", {});
      toast(r.message || "Historique réinitialisé", "ok");
      await load();
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    reset.disabled = false;
  });

  load();
  wrap.append(info, reset);
  return wrap;
}

// ═══════════════════ 7. Rendu d'une section ═══════════════════
const CUSTOM_RENDERERS = {
  overview: (c) => renderOverview(c),
  stats: (c) => renderStats(c),
  metrics: (c) => renderMetrics(c),
  logs: (c) => renderLogs(c),
  announce: (c) => renderAnnounce(c),
  welcome: (c) => renderWelcome(c),
  vocrank: (c) => renderVocRank(c),
  roles: (c) => renderRoles(c),
  tournament: (c) => renderTournament(c),
  startgg: (c) => renderStartggSeed(c),
  combos: (c) => renderCombos(c),
  tickets: (c) => renderTickets(c),
  giveaway: (c) => renderGiveaway(c),
};

function renderSection(id) {
  const content = $("#content");
  content.innerHTML = "";
  setDirty(false);
  if (logTimer) { clearInterval(logTimer); logTimer = null; }

  if (CUSTOM_RENDERERS[id]) return CUSTOM_RENDERERS[id](content);

  const cfg = structuredClone(CONFIG[id] || {});
  const schema = sectionSchema(id, cfg);

  // État du module remonté dans l'en-tête pour les sections activables.
  const headActions = [];
  if ("enabled" in cfg) {
    const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
      el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
      cfg.enabled ? "Module activé" : "Module inactif");
    headActions.push(badge);
  }

  content.append(pageHead(schema.ico, schema.title, schema.sub, headActions));

  for (const c of schema.cards) {
    const box = el("div", { class: "card" }, el("h3", {}, c.title));
    if (c.sub) box.append(el("div", { class: "card-sub" }, c.sub));
    for (const [label, desc, control] of c.fields) box.append(fieldRow(label, desc, control));
    if (c.extra) box.append(c.extra);
    content.append(box);
  }

  // Bouton d'enregistrement de la section.
  const btn = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
      setDirty(false);
      renderNav(); // met à jour la pastille d'état
      toast("Modifications enregistrées", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });

  // Actions secondaires spécifiques à certaines sections (test, publication…).
  const extras = [];
  const secondary = (label, iconName, run) => {
    const b = el("button", { class: "btn-save ghost" }, icon(iconName, 16), label);
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
        setDirty(false);
        await run();
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      b.disabled = false;
    });
    extras.push(b);
  };

  if (id === "tiktok") {
    secondary("Envoyer un test", "sparkles", async () => {
      await api("/api/tiktok/test", "POST", {});
      toast("Test envoyé dans le salon", "ok");
    });
  }
  if (id === "reminders") {
    secondary("Envoyer un rappel test", "sparkles", async () => {
      await api("/api/reminders/test", "POST", {});
      toast("Rappel envoyé dans le salon", "ok");
    });
  }
  if (id === "levels") {
    secondary("Aperçu level up", "sparkles", async () => {
      await api("/api/levels/test", "POST", {});
      toast("Aperçu envoyé", "ok");
    });
  }
  if (id === "lol") {
    secondary("Envoyer un test", "sparkles", async () => {
      await api("/api/lol/test", "POST", {});
      toast("Message d'accueil envoyé dans le salon", "ok");
    });
  }
  if (id === "linkpanel") {
    const pub = el("button", { class: "btn-save ghost" }, icon("megaphone", 16), "Publier le panneau");
    pub.addEventListener("click", async () => {
      if (!cfg.channelId) return toast("Choisis d'abord un salon.", "err");
      pub.disabled = true;
      try {
        CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
        setDirty(false);
        await api("/api/linkpanel/publish", "POST", { channelId: cfg.channelId });
        toast("Panneau publié", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      pub.disabled = false;
    });
    extras.push(pub);
  }

  content.append(actionBar({ hint: true }, ...extras, btn));
}

// ═══════════════════ 8. Pages spécifiques ═══════════════════

// ---------- Accueil : vrai tableau de bord (état + raccourcis + modules) ----------
// NOTE : construit son DOM de façon synchrone (les données arrivent ensuite dans
// les emplacements réservés) car catgirl.js ajoute sa galerie juste après l'appel.
function renderOverview(content) {
  const activeCount = TOGGLEABLE.filter(isEnabled).length;

  // --- Bandeau serveur ---
  const hero = el("div", { class: "hero" });
  hero.append(
    GUILD.icon
      ? el("img", { class: "hero-ico", src: GUILD.icon, alt: "" })
      : el("div", { class: "hero-ico" }, "🎮"),
    el("div", { class: "hero-txt" },
      el("div", { class: "hero-eyebrow" }, "Tableau de bord"),
      el("div", { class: "hero-name" }, GUILD.name),
      el("div", { class: "hero-meta" },
        el("span", { class: "pill" }, icon("users", 14), `${GUILD.memberCount.toLocaleString("fr-FR")} membres`),
        el("span", { class: "pill status ok" }, icon("check", 14), `${activeCount}/${TOGGLEABLE.length} modules actifs`),
        el("span", { class: "pill" }, icon("sliders", 14), `${NAV.length} sections`))),
  );
  content.append(hero);

  // --- Actions rapides ---
  const quicks = [
    { id: "announce", icon: "megaphone", name: "Composer une annonce", sub: "Texte + embed personnalisés" },
    { id: "tournament", icon: "trophy", name: "Piloter le tournoi", sub: "Inscriptions, bracket, scores" },
    { id: "giveaway", icon: "gift", name: "Lancer un giveaway", sub: "Concours et tirage au sort" },
    { id: "linkpanel", icon: "link", name: "Panneau de liaison", sub: "Publier le bouton de liaison" },
    { id: "roles", icon: "refresh", name: "Actualiser les rôles", sub: "Resynchroniser les membres liés" },
    { id: "logs", icon: "terminal", name: "Voir les logs", sub: "Activité du bot en direct" },
  ];
  const quickGrid = el("div", { class: "quick-grid" });
  for (const q of quicks) {
    quickGrid.append(el("button", { class: "quick", onclick: () => navigateTo(q.id) },
      el("span", { class: "q-ico" }, icon(q.icon, 17)),
      el("span", { class: "q-txt" },
        el("span", { class: "q-name" }, q.name),
        el("span", { class: "q-sub" }, q.sub))));
  }
  content.append(blockTitle("Actions rapides"), quickGrid);

  // --- Santé & activité (rempli en asynchrone) ---
  const statBox = el("div", { class: "stats" });
  const mkStat = (iconName, label) => {
    const val = el("div", { class: "val" }, "…");
    statBox.append(el("div", { class: "stat" },
      el("div", { class: "st-top" }, icon(iconName, 15)),
      val,
      el("div", { class: "lbl" }, label)));
    return val;
  };
  const sApi = mkStat("pulse", "Fiabilité API");
  const sLinked = mkStat("link", "Comptes liés");
  const sXpMembers = mkStat("users", "Membres avec XP");
  const sXp = mkStat("star", "XP totale");
  const sTop = mkStat("medal", "Plus haut niveau");
  content.append(blockTitle("Santé & activité"), statBox);

  api("/api/metrics")
    .then((m) => {
      const pct = m.meaningful > 0 ? Math.round(m.successRate * 100) : 100;
      sApi.innerHTML = "";
      sApi.append(
        el("span", { class: "dot " + (pct >= 90 ? "on" : "off"), style: pct >= 90 ? "" : `background:${pct >= 60 ? "var(--yellow)" : "var(--red)"}` }),
        el("span", {}, pct + "%"),
      );
    })
    .catch(() => (sApi.textContent = "—"));

  api("/api/stats")
    .then((s) => {
      sLinked.textContent = String(s.linkedCount);
      sXpMembers.textContent = String(s.xp.members);
      sXp.textContent = s.xp.totalXp.toLocaleString("fr-FR");
      sTop.textContent = String(s.xp.topLevel);
    })
    .catch(() => {
      for (const n of [sLinked, sXpMembers, sXp, sTop]) n.textContent = "—";
    });

  // --- Modules : état + accès direct ---
  const modGrid = el("div", { class: "mod-grid" });
  for (const p of TOGGLEABLE) {
    const on = isEnabled(p);
    modGrid.append(el("button", { class: "mod", onclick: () => navigateTo(p.id) },
      el("div", { class: "m-top" },
        el("span", { class: "m-ico" }, icon(p.icon, 16)),
        el("span", { class: "m-name" }, p.label),
        el("span", { class: "badge-state " + (on ? "on" : "off") }, on ? "Actif" : "Inactif")),
      el("div", { class: "m-sub" }, p.sub)));
  }
  content.append(blockTitle("Modules"), modGrid);

  // --- Outils sans interrupteur ---
  const toolGrid = el("div", { class: "mod-grid" });
  for (const p of NAV.filter((x) => !TOGGLEABLE.includes(x) && x.id !== "overview")) {
    toolGrid.append(el("button", { class: "mod", onclick: () => navigateTo(p.id) },
      el("div", { class: "m-top" },
        el("span", { class: "m-ico" }, icon(p.icon, 16)),
        el("span", { class: "m-name" }, p.label)),
      el("div", { class: "m-sub" }, p.sub)));
  }
  content.append(blockTitle("Outils & pilotage"), toolGrid);
}

// ---------- Statistiques ----------
const TIER_PALETTE = {
  Tin: "#9d9d9d", Bronze: "#b08d57", Silver: "#c0c0c0", Gold: "#f1c40f",
  Platinum: "#4aa3a3", Diamond: "#4ea1ff", Valhallan: "#9b59b6", "Non classé": "#5a606b",
};

async function renderStats(content) {
  content.append(pageHead("📈", "Statistiques", "Vue d'ensemble de l'activité du serveur : comptes liés, XP et répartition des rangs."));
  const loading = skeletonCards(2);
  content.append(loading);

  let s;
  try {
    s = await api("/api/stats");
  } catch (e) {
    loading.remove();
    content.append(el("div", { class: "card" }, el("div", { class: "empty-row" }, "Impossible de charger les statistiques : " + e.message)));
    return;
  }
  loading.remove();

  const stat = (iconName, val, lbl) => el("div", { class: "stat" },
    el("div", { class: "st-top" }, icon(iconName, 15)),
    el("div", { class: "val" }, String(val)),
    el("div", { class: "lbl" }, lbl));

  content.append(
    el("div", { class: "stats" },
      stat("link", s.linkedCount, "Comptes liés"),
      stat("users", s.memberCount ?? "—", "Membres serveur"),
      stat("star", s.xp.members, "Membres avec XP"),
      stat("sparkles", s.xp.totalXp.toLocaleString("fr-FR"), "XP totale"),
      stat("medal", s.xp.topLevel, "Plus haut niveau"),
    ),
  );

  // Répartition par tier 1v1 : camembert (QuickChart) + tableau lisible.
  const entries = Object.entries(s.tierCounts || {}).sort((a, b) => b[1] - a[1]);
  const box = card("Répartition par tier (1v1)", entries.length ? "Basée sur les comptes liés et leur dernier rang connu." : null);
  if (!entries.length) {
    box.append(el("div", { class: "empty-row" }, "Aucun compte lié pour l'instant — la répartition par tier apparaîtra ici."));
  } else {
    const light = document.body.classList.contains("light");
    const chart = {
      type: "doughnut",
      data: {
        labels: entries.map(([t]) => t),
        datasets: [{ data: entries.map(([, n]) => n), backgroundColor: entries.map(([t]) => TIER_PALETTE[t] || "#777") }],
      },
      options: { plugins: { legend: { position: "right", labels: { color: light ? "#14141c" : "#ccc" } } } },
    };
    const url = "https://quickchart.io/chart?bkg=" + encodeURIComponent(light ? "#ffffff" : "#0f0f16") +
      "&w=520&h=320&c=" + encodeURIComponent(JSON.stringify(chart));

    const total = entries.reduce((a, [, n]) => a + n, 0);
    const bars = el("div", { style: "flex:1;min-width:240px;display:flex;flex-direction:column;gap:9px" });
    for (const [tier, n] of entries) {
      const pct = Math.round((n / total) * 100);
      bars.append(el("div", {},
        el("div", { style: "display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px" },
          el("span", {}, tier),
          el("span", { style: "color:var(--muted)" }, `${n} · ${pct}%`)),
        el("div", { style: "height:7px;border-radius:999px;background:var(--surface-3);overflow:hidden" },
          el("div", { style: `height:100%;width:${pct}%;border-radius:999px;background:${TIER_PALETTE[tier] || "#777"}` }))));
    }
    box.append(el("div", { style: "display:flex;gap:24px;flex-wrap:wrap;align-items:center;margin-top:6px" },
      el("img", { src: url, alt: "Répartition par tier", style: "max-width:100%;width:420px;border-radius:14px" }),
      bars));
  }
  content.append(box);
}

// ---------- Logs en direct ----------
function renderLogs(content) {
  const pauseBtn = el("button", { class: "tbtn" }, icon("pulse", 15), "En direct");
  let paused = false;

  content.append(pageHead("📜", "Logs en direct", "Les dernières actions du bot, rafraîchies toutes les 3 secondes.", [pauseBtn]));

  const box = el("pre", { class: "logbox" });
  content.append(el("div", { class: "card" }, box));

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.innerHTML = "";
    pauseBtn.append(icon(paused ? "close" : "pulse", 15), paused ? "En pause" : "En direct");
    pauseBtn.classList.toggle("danger", paused);
  });

  const LEVEL_COLOR = { log: "var(--text-soft)", warn: "var(--yellow)", error: "#ff6b6b" };
  const draw = (lines) => {
    box.innerHTML = "";
    if (!lines.length) { box.append(el("div", { style: "color:var(--muted)" }, "Aucun log récent.")); return; }
    for (const l of lines) {
      const time = new Date(l.ts).toLocaleTimeString("fr-FR");
      box.append(el("div", { style: `color:${LEVEL_COLOR[l.level] || "var(--text-soft)"}` }, `[${time}] ${l.msg}`));
    }
    box.scrollTop = box.scrollHeight;
  };
  const refresh = async () => {
    if (paused) return;
    try {
      const r = await api("/api/logs?limit=200");
      if (current === "logs") draw(r.lines);
    } catch {
      /* silencieux */
    }
  };
  refresh();
  logTimer = setInterval(refresh, 3000);
}

// ---------- Fiabilité API ----------
function renderMetrics(content) {
  content.append(pageHead("📡", "Fiabilité API",
    "Santé de l'API Brawlhalla observée par le bot depuis son démarrage. Rafraîchi toutes les 5 secondes."));

  const statsBox = el("div", { class: "stats" });
  const detail = card("Détail des requêtes", "Répartition des réponses reçues et état de l'index local.");
  content.append(statsBox, detail);

  const fmtMs = (v) => (v == null ? "—" : v < 60000 ? `${Math.round(v / 1000)} s` : `${Math.floor(v / 60000)} min`);
  const stat = (iconName, val, lbl, color) =>
    el("div", { class: "stat" },
      el("div", { class: "st-top" }, icon(iconName, 15)),
      el("div", { class: "val", style: color ? `color:${color}` : null }, String(val)),
      el("div", { class: "lbl" }, lbl));
  const row = (k, v) => fieldRow(k, null, el("b", {}, String(v)));

  const draw = (m) => {
    const pct = m.meaningful > 0 ? Math.round(m.successRate * 100) : 100;
    const pctColor = pct >= 90 ? "#3fb950" : pct >= 60 ? "var(--yellow)" : "#ff6b6b";
    const pending = (m.pendingProfiles || 0) + (m.pendingSearches || 0);

    statsBox.innerHTML = "";
    statsBox.append(
      stat("pulse", `${pct}%`, "Taux de succès", pctColor),
      stat("external", (m.requests || 0).toLocaleString("fr-FR"), "Tentatives HTTP"),
      stat("refresh", (m.retries || 0).toLocaleString("fr-FR"), "Retries"),
      stat("alert", m.cooldownActiveMs > 0 ? fmtMs(m.cooldownActiveMs) : "—", "Cooldown actif", m.cooldownActiveMs > 0 ? "var(--yellow)" : null),
      stat("users", pending, "File de récupération", pending > 0 ? "var(--yellow)" : null),
      stat("chart", (m.index?.count || 0).toLocaleString("fr-FR"), "Index (joueurs)"),
    );

    const body = detail.querySelector(".metrics-body") || el("div", { class: "metrics-body" });
    body.innerHTML = "";
    body.append(
      row("429 (rate-limit)", m.rateLimited || 0),
      row("5xx (erreurs serveur)", m.serverErrors || 0),
      row("Autres 4xx", m.otherClient || 0),
      row("Erreurs réseau", m.networkErrors || 0),
      row("404 (absences légitimes)", m.notFound || 0),
      row("Cooldowns posés", m.cooldowns || 0),
      row("Index — dernière synchro", m.index?.ageMs != null ? `il y a ${fmtMs(m.index.ageMs)}` : "jamais"),
      row("Dernier succès", m.lastSuccessTs ? new Date(m.lastSuccessTs).toLocaleTimeString("fr-FR") : "—"),
    );
    if (m.lastError) {
      const when = new Date(m.lastError.ts).toLocaleTimeString("fr-FR");
      const head = m.lastError.status ? `HTTP ${m.lastError.status} — ` : "";
      body.append(el("div", { class: "callout danger", style: "margin-top:14px;cursor:default" },
        el("span", { class: "co-ico" }, icon("alert", 18)),
        el("span", {}, `Dernière erreur : ${head}${m.lastError.message} (${when})`)));
    }
    if (!detail.contains(body)) detail.append(body);
  };

  const refresh = async () => {
    try {
      const m = await api("/api/metrics");
      if (current === "metrics") draw(m);
    } catch {
      /* silencieux */
    }
  };
  refresh();
  logTimer = setInterval(refresh, 5000);
}

// ---------- Rôles de rank (resynchronisation globale) ----------
function renderRoles(content) {
  setDirty(false);
  content.append(pageHead("🔄", "Rôles de rank", "Resynchronise tous les membres liés avec l'API Brawlhalla."));

  const box = card("Actualiser les rôles de tous les membres",
    "Redistribue à chaque membre lié ses rôles de rank 1v1 et 2v2, corrige ceux qui auraient été retirés par erreur " +
    "(ex. coupure de l'API), et met à jour le rôle « n°1 du serveur ». À lancer après un incident d'API ou pour " +
    "rattraper des rôles manquants.");
  box.append(el("div", { class: "callout info", style: "cursor:default;margin:4px 0 0" },
    el("span", { class: "co-ico" }, icon("alert", 18)),
    el("span", {}, "Traitement séquentiel (un appel API par membre) en arrière-plan : comptez quelques minutes. " +
      "Le bilan détaillé est posté dans le salon d'audit.")));
  content.append(box);

  const btn = el("button", { class: "btn-save" }, icon("refresh", 17), "Actualiser les rôles");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const r = await api("/api/refresh-roles", "POST", {});
      toast(r.message || "Actualisation lancée", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });
  content.append(actionBar({}, btn));
}

// ---------- Vocaux par rank ----------
function renderVocRank(content) {
  setDirty(false);
  const state = { categoryId: "", rangMin: "Bronze", limite: 0 };

  content.append(pageHead("🎙️", "Vocaux par rank",
    "Crée un salon vocal par rank. L'accès est vérifié par le bot à partir des rôles issus de /lier : impossible de tricher."));

  const box = card("Configuration", "Les rangs supérieurs accèdent aussi aux vocaux inférieurs (Valhallan accède à tout).");
  box.append(
    fieldRow("Catégorie", "Où créer les vocaux de rank.", channelSelect(state, "categoryId", "category", false)),
    fieldRow("Rang minimum", "Le rank le plus bas à créer.", selectInput(state, "rangMin", GUILD.tiers.map((t) => ({ value: t, label: t })))),
    fieldRow("Limite par vocal", "Nombre max de membres (0 = illimité).", numberInput(state, "limite", 0, 99)),
  );
  box.append(el("div", { class: "callout info", style: "cursor:default;margin-top:14px" },
    el("span", { class: "co-ico" }, icon("shield", 18)),
    el("span", {}, "Comme les rôles viennent de /lier (vérifié via l'API), personne ne peut mentir sur son rang, " +
      "et un membre non lié n'entre nulle part.")));
  content.append(box);

  const btn = el("button", { class: "btn-save" }, icon("mic", 17), "Créer / mettre à jour les vocaux");
  btn.addEventListener("click", async () => {
    if (!state.categoryId) return toast("Choisis une catégorie d'abord.", "err");
    btn.disabled = true;
    try {
      const r = await api("/api/setup-vocaux-rank", "POST", {
        categoryId: state.categoryId,
        rangMin: state.rangMin,
        limite: Number(state.limite) || 0,
      });
      setDirty(false);
      toast(r.message || "Vocaux prêts", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });
  content.append(actionBar({}, btn));
}

// ---------- Seeding start.gg ----------
function renderStartggSeed(content) {
  setDirty(false);
  const state = { url: "", token: "", phaseId: "", phaseName: "", eventName: "", rows: [], phases: [] };

  content.append(pageHead("🌱", "Seeding start.gg",
    "Seede un tournoi géré sur start.gg d'après le niveau Brawlhalla (rating 1v1), puis réécris le seeding directement sur start.gg."));

  const conn = card("Événement start.gg", "Le lien doit pointer vers un événement (.../event/...).");
  const urlIn = textInput(state, "url", "https://www.start.gg/tournament/<nom>/event/<event>");
  const tokenIn = el("input", { type: "password", placeholder: "Personal Access Token start.gg" });
  tokenIn.addEventListener("input", () => (state.token = tokenIn.value.trim()));
  conn.append(
    fieldRow("Lien de l'événement", "Copie l'URL depuis start.gg.", urlIn),
    fieldRow("Token start.gg", "Settings → Developer → Personal Access Tokens. Doit être ADMIN du tournoi pour réécrire le seeding. Mémorisé après la 1ʳᵉ fois.", tokenIn),
  );
  content.append(conn);

  const resultCard = card("Seeding proposé");
  const info = el("div", { class: "card-sub" }, "Charge les inscrits pour calculer le seeding (rating 1v1 décroissant).");
  const phaseRow = el("div", { style: "margin:10px 0" });
  const tableWrap = el("div", {});
  resultCard.append(info, phaseRow, tableWrap);

  function renderTable() {
    tableWrap.innerHTML = "";
    if (!state.rows.length) return;
    tableWrap.append(el("div", { class: "sg-row sg-head" },
      el("span", {}, "Seed"), el("span", {}, "Joueur"), el("span", {}, "Rating 1v1"), el("span", {}, "Source"), el("span", {}, "Actuel")));
    for (const r of state.rows) {
      tableWrap.append(el("div", { class: "sg-row" },
        el("span", { class: "sg-seed" }, "#" + r.proposedSeed),
        el("span", {}, r.name),
        el("span", {}, r.rating ? String(r.rating) : "—"),
        el("span", { class: "sg-src" }, r.source),
        el("span", { class: "sg-cur" }, "#" + r.currentSeed)));
    }
  }

  function drawPhasePicker() {
    phaseRow.innerHTML = "";
    if (state.phases.length <= 1) return;
    const sel = el("select");
    for (const p of state.phases) {
      const opt = el("option", { value: p.id }, p.name);
      if (p.id === state.phaseId) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => { state.phaseId = sel.value; loadPreview(); });
    phaseRow.append(el("div", { class: "tb-label", style: "margin:0 0 6px" }, "Phase à seeder"), sel);
  }

  async function loadPreview() {
    if (!state.url) return toast("Colle le lien de l'événement start.gg.", "err");
    info.textContent = "⏳ Récupération des inscrits et calcul du seeding…";
    try {
      const r = await api("/api/startgg/preview", "POST", { url: state.url, token: state.token || undefined, phaseId: state.phaseId || undefined });
      state.eventName = r.eventName; state.phaseId = r.phaseId; state.phaseName = r.phaseName;
      state.phases = r.phases || []; state.rows = r.rows || [];
      const matched = state.rows.filter((x) => x.source !== "inconnu").length;
      info.textContent = `${r.eventName} — phase « ${r.phaseName} » : ${state.rows.length} inscrit(s), ${matched} avec rating connu.`;
      drawPhasePicker();
      renderTable();
    } catch (e) {
      info.textContent = "";
      toast("Erreur : " + e.message, "err");
    }
  }

  const loadBtn = el("button", { class: "btn-save ghost" }, icon("refresh", 16), "Charger & calculer");
  loadBtn.addEventListener("click", async () => { loadBtn.disabled = true; await loadPreview(); loadBtn.disabled = false; });

  const applyBtn = el("button", { class: "btn-save" }, icon("check", 17), "Appliquer sur start.gg");
  applyBtn.addEventListener("click", async () => {
    if (!state.rows.length) return toast("Charge d'abord le seeding.", "err");
    if (!(await confirmModal(`Réécrire le seeding de la phase « ${state.phaseName} » sur start.gg (${state.rows.length} joueurs) ?`, { title: "Appliquer le seeding", okLabel: "Appliquer" }))) return;
    applyBtn.disabled = true;
    try {
      const mapping = state.rows.map((r) => ({ seedId: r.seedId, seedNum: r.proposedSeed }));
      const r = await api("/api/startgg/apply", "POST", { token: state.token || undefined, phaseId: state.phaseId, mapping });
      toast(r.message || "Seeding appliqué", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    applyBtn.disabled = false;
  });

  content.append(resultCard, actionBar({}, loadBtn, applyBtn));
}

// ---------- Combos (base BrawlDatabase) ----------
async function renderCombos(content) {
  content.append(pageHead("🥊", "Combos Brawlhalla",
    "Base de true combos (source BrawlDatabase) que les membres parcourent via /combos ou un panneau interactif."));

  const dbCard = card("Base de données", null);
  const body = el("div", { class: "card-sub" }, "Chargement…");
  dbCard.append(body);

  const upd = el("button", { class: "tbtn", style: "margin-top:12px" }, icon("refresh", 15), "Mettre à jour la base");
  upd.addEventListener("click", async () => {
    upd.disabled = true;
    upd.innerHTML = "";
    upd.append(icon("refresh", 15), "Récupération depuis BrawlDB…");
    try {
      const r = await api("/api/combos/refresh", "POST", {});
      toast(`Base mise à jour : ${r.count} combos`, "ok");
      renderSection("combos");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
      upd.disabled = false;
      upd.innerHTML = "";
      upd.append(icon("refresh", 15), "Mettre à jour la base");
    }
  });
  dbCard.append(el("div", {}, upd));
  content.append(dbCard);

  // Panneau interactif à publier dans un salon.
  const pubState = { channelId: "" };
  const pubCard = card("Publier le panneau",
    "Poste un panneau /combos interactif : les membres choisissent l'arme et parcourent les combos (vidéo intégrée).");
  pubCard.append(fieldRow("Salon", "Où publier le panneau.", channelSelect(pubState, "channelId", "textann")));
  const pub = el("button", { class: "tbtn primary", style: "margin-top:10px" }, icon("megaphone", 15), "Publier le panneau");
  pub.addEventListener("click", async () => {
    if (!pubState.channelId) return toast("Choisis un salon.", "err");
    pub.disabled = true;
    try {
      await api("/api/combos/publish", "POST", { channelId: pubState.channelId });
      setDirty(false);
      toast("Panneau publié", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    pub.disabled = false;
  });
  pubCard.append(el("div", {}, pub));
  content.append(pubCard);

  try {
    const info = await api("/api/combos");
    body.innerHTML = "";
    const date = info.scrapedAt ? new Date(info.scrapedAt).toLocaleString("fr-FR") : "—";
    body.append(
      el("div", { class: "stats", style: "margin:0" },
        el("div", { class: "stat" },
          el("div", { class: "st-top" }, icon("flame", 15)),
          el("div", { class: "val" }, String(info.count)),
          el("div", { class: "lbl" }, "Combos en base")),
        el("div", { class: "stat" },
          el("div", { class: "st-top" }, icon("sliders", 15)),
          el("div", { class: "val" }, String(Object.keys(info.byWeapon || {}).length)),
          el("div", { class: "lbl" }, "Armes couvertes")),
        el("div", { class: "stat" },
          el("div", { class: "st-top" }, icon("refresh", 15)),
          el("div", { class: "val", style: "font-size:15px;font-weight:600" }, date),
          el("div", { class: "lbl" }, "Dernière mise à jour"))),
    );
  } catch (e) {
    body.textContent = "Erreur : " + e.message;
  }
}

// ---------- Tickets ----------
// Éditeur de motifs (options du menu déroulant du panneau).
function topicsEditor(cfg) {
  cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  const wrap = el("div", { style: "width:100%" });
  const list = el("div");
  const redraw = () => {
    list.innerHTML = "";
    cfg.topics.forEach((t, i) => {
      const emo = el("input", { type: "text", value: t.emoji || "", placeholder: "🎫", style: "max-width:70px" });
      const lab = el("input", { type: "text", value: t.label || "", placeholder: "Support" });
      const desc = el("input", { type: "text", value: t.description || "", placeholder: "Description courte (affichée dans le menu)" });
      const msg = el("input", { type: "text", value: t.message || "", placeholder: "Message affiché à l'ouverture du ticket (optionnel)", style: "flex:1 1 100%" });
      emo.addEventListener("input", () => (cfg.topics[i].emoji = emo.value.trim()));
      lab.addEventListener("input", () => (cfg.topics[i].label = lab.value));
      desc.addEventListener("input", () => (cfg.topics[i].description = desc.value));
      msg.addEventListener("input", () => (cfg.topics[i].message = msg.value));
      list.append(
        el("div", { class: "hub-row", style: "flex-wrap:wrap" }, emo, lab, desc, msg,
          el("button", { class: "icon-btn", title: "Supprimer", onclick: () => { cfg.topics.splice(i, 1); redraw(); setDirty(true); } }, "🗑")),
      );
    });
    if (!cfg.topics.length) {
      list.append(el("div", { class: "empty-row" }, "Aucun motif : un simple bouton « Ouvrir un ticket » s'affichera."));
    }
  };
  const addBtn = el("button", { class: "btn-add", onclick: () => {
    if (cfg.topics.length >= 25) return toast("Maximum 25 motifs.", "err");
    cfg.topics.push({ label: "Nouveau motif", emoji: "🎫", description: "" });
    redraw();
    setDirty(true);
  } }, "+ Ajouter un motif");
  redraw();
  wrap.append(list, addBtn);
  return wrap;
}

let ticketTab = "config";

function renderTickets(content) {
  const cfg = structuredClone(CONFIG.tickets || {});
  if (!Array.isArray(cfg.topics)) cfg.topics = [];

  const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
    el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
    cfg.enabled ? "Module activé" : "Module inactif");

  content.append(pageHead("🎫", "Tickets de support",
    "Panneau de support : les membres ouvrent un salon privé avec le staff via un menu déroulant de motifs.", [badge]));

  const tabs = [
    { id: "config", ico: "⚙️", label: "Configuration" },
    { id: "panel", ico: "🎨", label: "Panneau" },
    { id: "ticket", ico: "💬", label: "Salon de ticket" },
    { id: "topics", ico: "🗂️", label: "Motifs" },
  ];
  if (!tabs.some((t) => t.id === ticketTab)) ticketTab = "config";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === ticketTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { ticketTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === ticketTab));
    body.innerHTML = "";
    if (ticketTab === "config") drawConfig();
    else if (ticketTab === "panel") drawPanel();
    else if (ticketTab === "ticket") drawTicket();
    else drawTopics();
  }

  function drawConfig() {
    const c1 = card("Général", "Où sont créés les tickets et qui les gère.");
    c1.append(
      fieldRow("Activé", "Active la création de tickets via le panneau.", toggle(cfg, "enabled")),
      fieldRow("Catégorie des tickets", "Où sont créés les salons de ticket.", channelSelect(cfg, "categoryId", "category")),
      fieldRow("Rôle staff", "Voit et gère tous les tickets (prise en charge, fermeture).", roleSelect(cfg, "staffRoleId")),
      fieldRow("Salon des transcripts", "Reçoit le .txt + récap à la fermeture (optionnel).", channelSelect(cfg, "logChannelId", "text")),
    );
    body.append(c1, publishCard());
  }

  function drawPanel() {
    const c = card("Apparence du panneau", "Le message public qui permet d'ouvrir un ticket.");
    c.append(
      fieldRow("Titre", "", textInput(cfg, "panelTitle", "🎫 Support & Tickets")),
      fieldRow("Description", "Texte principal de l'embed.", textareaInput(cfg, "panelDescription", "Besoin d'aide ? Ouvre un ticket via le menu ci-dessous."), true),
      fieldRow("Couleur", "Couleur de la barre de l'embed.", colorInput(cfg, "panelColor")),
      fieldRow("Image bannière (URL)", "Grande image affichée en bas de l'embed.", textInput(cfg, "bannerUrl", "https://…")),
      fieldRow("Vignette / logo (URL)", "Petite image en haut à droite.", textInput(cfg, "thumbnailUrl", "https://…")),
      fieldRow("Lien Terms of Service", "Affiché comme lien dans la description (optionnel).", textInput(cfg, "tosUrl", "https://…")),
    );
    const c2 = card("Textes des sections", "Titres et libellés affichés dans le panneau.");
    c2.append(
      fieldRow("À lire avant d'ouvrir", "Instructions affichées dans l'embed (une ligne par règle).", textareaInput(cfg, "rulesText", "• Explique ton problème directement\n• Reste respectueux et patient\n• Pas de ticket pour rien"), true),
      fieldRow("Titre section « Étapes »", "Titre du bloc des instructions.", textInput(cfg, "rulesTitle", "📋 Étapes à suivre")),
      fieldRow("Titre section « Options »", "Titre du bloc listant les motifs.", textInput(cfg, "optionsTitle", "🎫 Options de ticket")),
      fieldRow("Texte de bas de panneau", "Phrase juste au-dessus du menu déroulant.", textInput(cfg, "footerText", "🚀 Choisis un motif dans le menu ci-dessous.")),
      fieldRow("Texte du menu déroulant", "Placeholder affiché sur le menu de motifs.", textInput(cfg, "selectPlaceholder", "Choisis un motif")),
    );
    body.append(c, c2, publishCard());
  }

  function drawTicket() {
    const c = card("Message du ticket créé",
      "Embed posté dans le salon privé à l'ouverture. La vignette et la couleur sont reprises de l'onglet « Panneau ».");
    c.append(
      fieldRow("Titre du ticket", "", textInput(cfg, "ticketTitle", "🎫 Support Ticket")),
      fieldRow("Message d'accueil", "Affiché en haut du ticket. Le lien Terms of Service est ajouté automatiquement s'il est défini.", textareaInput(cfg, "ticketWelcome", "Merci de patienter, un membre du staff va prendre en charge ton ticket."), true),
      fieldRow("Informations complémentaires", "Bloc « Informations » par défaut (un motif peut le remplacer par son propre message).", textareaInput(cfg, "ticketInfo", ""), true),
    );
    body.append(c);
  }

  function drawTopics() {
    const c = card("Motifs du menu déroulant",
      "Chaque motif = une option du menu (emoji + nom + description). Le champ « message » s'affiche à l'ouverture du ticket pour ce motif. Ex : Buy, Support, Replace.");
    c.append(topicsEditor(cfg));
    body.append(c, publishCard());
  }

  function publishCard() {
    const pubState = { channelId: "" };
    const c = card("Publier le panneau", "Enregistre tes réglages, puis publie le panneau de tickets dans un salon.");
    c.append(fieldRow("Salon", "", channelSelect(pubState, "channelId", "textann")));
    const pub = el("button", { class: "tbtn primary", style: "margin-top:10px" }, icon("megaphone", 15), "Publier le panneau");
    pub.addEventListener("click", async () => {
      if (!pubState.channelId) return toast("Choisis un salon.", "err");
      pub.disabled = true;
      try {
        CONFIG.tickets = await api("/api/config/tickets", "PUT", cfg);
        setDirty(false);
        await api("/api/tickets/publish", "POST", { channelId: pubState.channelId });
        toast("Panneau publié", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      pub.disabled = false;
    });
    c.append(el("div", {}, pub));
    return c;
  }

  draw();

  const btn = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      CONFIG.tickets = await api("/api/config/tickets", "PUT", cfg);
      setDirty(false);
      renderNav();
      toast("Modifications enregistrées", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });
  content.append(actionBar({ hint: true }, btn));
}

// ---------- Giveaways ----------
let gwTab = "manage";

async function renderGiveaway(content) {
  content.innerHTML = "";
  setDirty(false);
  // cfg partagé entre les onglets : éditer les réglages puis basculer sur « Giveaways »
  // ne perd pas les modifications en cours (elles restent en mémoire jusqu'à l'enregistrement).
  const cfg = structuredClone(CONFIG.giveaway || {});

  const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
    el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
    cfg.enabled ? "Module activé" : "Module inactif");

  content.append(pageHead("🎉", "Giveaways",
    "Crée et gère des concours. Les gagnants sont tirés au sort automatiquement à l'échéance.", [badge]));

  const tabs = [
    { id: "manage", ico: "🎁", label: "Concours" },
    { id: "settings", ico: "⚙️", label: "Réglages" },
    { id: "look", ico: "🎨", label: "Apparence" },
  ];
  if (!tabs.some((x) => x.id === gwTab)) gwTab = "manage";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === gwTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { gwTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  const saveCfg = async () => {
    CONFIG.giveaway = await api("/api/config/giveaway", "PUT", cfg);
    setDirty(false);
    renderNav();
  };

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === gwTab));
    body.innerHTML = "";
    if (gwTab === "manage") drawManage();
    else if (gwTab === "look") drawLook();
    else drawSettings();
  }

  function saveBar() {
    const saveBtn = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try { await saveCfg(); toast("Réglages enregistrés", "ok"); }
      catch (e) { toast("Erreur : " + e.message, "err"); }
      saveBtn.disabled = false;
    });
    return actionBar({ hint: true }, saveBtn);
  }

  // ---- Onglet Réglages ----
  function drawSettings() {
    const c1 = card("Général", "Où publier les concours et qui peut participer.");
    c1.append(
      fieldRow("Activé", "Active le système de giveaways (requis pour en créer).", toggle(cfg, "enabled")),
      fieldRow("Salon par défaut", "Salon où sont publiés les giveaways par défaut.", channelSelect(cfg, "defaultChannelId", "textann")),
      fieldRow("Rôle pingé", "Mentionné à la publication d'un giveaway (optionnel).", roleSelect(cfg, "pingRoleId")),
      fieldRow("Rôle requis", "Seuls les membres ayant ce rôle peuvent participer (optionnel).", roleSelect(cfg, "requiredRoleId")),
      fieldRow("MP aux gagnants", "Envoie un message privé à chaque gagnant à la clôture.", toggle(cfg, "dmWinners")),
    );

    const c3 = card("Messages des gagnants", null);
    c3.append(el("div", { class: "card-sub", html:
      "Placeholders : <code>{winners}</code> (mentions), <code>{prize}</code>, <code>{count}</code> (participants), <code>{host}</code> (organisateur)." }));
    c3.append(
      fieldRow("Annonce des gagnants", "Message posté dans le salon quand il y a des gagnants.", textareaInput(cfg, "winnerAnnounce", "🎉 Félicitations {winners} ! Vous remportez **{prize}** 🏆"), true),
      fieldRow("Message privé au gagnant", "MP envoyé à chaque gagnant (si « MP aux gagnants » est activé).", textareaInput(cfg, "winnerDm", "🎉 Tu as gagné **{prize}** dans le giveaway !"), true),
      fieldRow("Aucun participant", "Message posté si personne n'a participé.", textareaInput(cfg, "noWinnerMessage", "😢 Le giveaway **{prize}** se termine sans participant."), true),
    );
    body.append(c1, c3, saveBar());
  }

  // ---- Onglet Apparence ----
  function drawLook() {
    const c2 = card("Apparence de l'embed", "Le rendu visuel du message de giveaway.");
    c2.append(
      fieldRow("Titre", "Affiché en haut du giveaway (mis en majuscules).", textInput(cfg, "embedTitle", "GIVEAWAY")),
      fieldRow("Couleur", "Couleur de la barre de l'embed.", colorInput(cfg, "embedColor")),
      fieldRow("Bannière (URL)", "Grande image intégrée en haut (optionnel).", textInput(cfg, "bannerUrl", "https://…")),
      fieldRow("Texte du bouton", "Libellé du bouton de participation.", textInput(cfg, "buttonLabel", "Participer")),
      fieldRow("Emoji du bouton", "Emoji unicode ou custom (<:nom:id>).", textInput(cfg, "buttonEmoji", "🎉")),
      fieldRow("Pied de page", "Petite phrase en bas de l'embed.", textInput(cfg, "footerText", "Bonne chance à toutes et à tous ! 🍀")),
    );
    body.append(c2, saveBar());
  }

  // ---- Onglet Concours (création + liste) ----
  function drawManage() {
    const form = {
      prize: "", description: "",
      duration: cfg.defaultDuration || "24h",
      winnersCount: cfg.defaultWinners || 1,
      channelId: cfg.defaultChannelId || "",
    };
    const c1 = card("Lancer un giveaway", "Durée : 30m, 2h, 1d, 1w — combinable (ex : 1d12h).");
    c1.append(
      fieldRow("Récompense", "Ce que les gagnants remportent.", textInput(form, "prize", "Nitro classique 1 mois")),
      fieldRow("Description", "Texte additionnel affiché dans l'embed (optionnel).", textareaInput(form, "description", "Détails, conditions, etc."), true),
      fieldRow("Durée", "Ex : 30m, 2h, 1d, 1w.", textInput(form, "duration", "24h")),
      fieldRow("Nombre de gagnants", "Combien de gagnants tirer au sort.", numberInput(form, "winnersCount", 1, 50)),
      fieldRow("Salon", "Où publier (vide = salon par défaut).", channelSelect(form, "channelId", "textann")),
    );
    const createBtn = el("button", { class: "tbtn primary", style: "margin-top:12px" }, icon("gift", 15), "Lancer le giveaway");
    createBtn.addEventListener("click", async () => {
      if (!form.prize || !form.prize.trim()) return toast("Indique une récompense.", "err");
      createBtn.disabled = true;
      try {
        await saveCfg();
        await api("/api/giveaway/create", "POST", {
          prize: form.prize,
          description: form.description,
          duration: form.duration,
          winnersCount: Number(form.winnersCount) || 1,
          channelId: form.channelId || undefined,
        });
        toast("Giveaway lancé 🎉", "ok");
        loadList();
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      createBtn.disabled = false;
    });
    c1.append(el("div", {}, createBtn));
    body.append(c1);

    const refreshBtn = el("button", { class: "tbtn", title: "Rafraîchir la liste et les participants" }, icon("refresh", 15), "Rafraîchir");
    refreshBtn.addEventListener("click", () => loadList());
    const listCard = card("Giveaways en cours", null, refreshBtn);
    const listWrap = el("div", {}, el("div", { class: "card-sub" }, "Chargement…"));
    listCard.append(listWrap);
    body.append(listCard);

    const fmtDate = (ts) => new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    const roleName = (rid) => (GUILD.roles.find((r) => r.id === rid) || {}).name;
    const chanName = (cid) => {
      const all = [...GUILD.channels.text, ...GUILD.channels.announcement];
      return (all.find((c) => c.id === cid) || {}).name;
    };

    const gwRow = (g) => {
      const meta = [`🎟️ ${g.entries} participant(s)`, `🏅 ${g.winnersCount} gagnant(s)`];
      if (chanName(g.channelId)) meta.push(`# ${chanName(g.channelId)}`);
      if (g.requiredRoleId && roleName(g.requiredRoleId)) meta.push(`🔒 @${roleName(g.requiredRoleId)}`);
      const info = el("div", { style: "min-width:0" },
        el("div", { style: "font-weight:600" }, `🎁 ${g.prize}`),
        el("div", { class: "desc", style: "margin-top:4px" }, meta.join(" · ")));
      const head = el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap" }, info);
      const actions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });

      if (g.status === "active") {
        head.append(el("span", { class: "pill status info" }, `Fin : ${fmtDate(g.endsTs)}`));
        const endBtn = el("button", { class: "tbtn" }, "🏁 Terminer");
        endBtn.addEventListener("click", async () => {
          if (!(await confirmModal(`Terminer le giveaway <b>${g.prize}</b> maintenant ?`, { okLabel: "Terminer" }))) return;
          endBtn.disabled = true;
          try { await api("/api/giveaway/end", "POST", { id: g.id }); toast("Giveaway terminé", "ok"); loadList(); }
          catch (e) { toast("Erreur : " + e.message, "err"); endBtn.disabled = false; }
        });
        const cancelBtn = el("button", { class: "tbtn danger" }, "🚫 Annuler");
        cancelBtn.addEventListener("click", async () => {
          if (!(await confirmModal(`Annuler le giveaway <b>${g.prize}</b> (sans tirage) ?`, { okLabel: "Annuler le giveaway", danger: true }))) return;
          cancelBtn.disabled = true;
          try { await api("/api/giveaway/cancel", "POST", { id: g.id }); toast("Giveaway annulé", "ok"); loadList(); }
          catch (e) { toast("Erreur : " + e.message, "err"); cancelBtn.disabled = false; }
        });
        actions.append(endBtn, cancelBtn);
      } else {
        const label = g.status === "cancelled" ? "Annulé" : "Terminé";
        head.append(el("span", { class: "pill" }, label));
        if (g.winnerIds && g.winnerIds.length) {
          info.append(el("div", { class: "desc", style: "margin-top:4px" }, `🥳 Gagnant(s) : ${g.winnerIds.map((w) => "<@" + w + ">").join(", ")}`));
        }
        if (g.status === "ended") {
          const rerollBtn = el("button", { class: "tbtn" }, icon("refresh", 15), "Reroll");
          rerollBtn.addEventListener("click", async () => {
            rerollBtn.disabled = true;
            try { const r = await api("/api/giveaway/reroll", "POST", { id: g.id }); toast("Reroll : " + (r.winners || []).length + " nouveau(x) gagnant(s)", "ok"); }
            catch (e) { toast("Erreur : " + e.message, "err"); }
            rerollBtn.disabled = false;
          });
          actions.append(rerollBtn);
        }
      }
      return el("div", { class: "card nested" }, head, actions.children.length ? el("div", { style: "margin-top:10px" }, actions) : null);
    };

    async function loadList() {
      refreshBtn.disabled = true;
      let data;
      try {
        data = await api("/api/giveaway/list");
      } catch (e) {
        listWrap.innerHTML = "";
        listWrap.append(el("div", { class: "empty-row" }, "Erreur : " + e.message));
        refreshBtn.disabled = false;
        return;
      }
      listWrap.innerHTML = "";
      if (data.active.length) {
        for (const g of data.active) listWrap.append(gwRow(g));
      } else {
        listWrap.append(el("div", { class: "empty-row" }, "Aucun giveaway en cours."));
      }
      const ended = data.recent.filter((g) => g.status !== "active");
      if (ended.length) {
        listWrap.append(blockTitle("Historique récent"));
        for (const g of ended.slice(0, 10)) listWrap.append(gwRow(g));
      }
      refreshBtn.disabled = false;
    }

    loadList();
  }

  draw();
}

// ---------- Aperçus d'embed (bienvenue & annonces) ----------
function previewVars(str) {
  return String(str || "")
    .replaceAll("{user}", "@" + ME.username)
    .replaceAll("{username}", ME.username)
    .replaceAll("{user.name}", ME.username)
    .replaceAll("{user.tag}", ME.username)
    .replaceAll("{server}", GUILD.name)
    .replaceAll("{membercount}", GUILD.memberCount)
    .replaceAll("{count}", GUILD.memberCount);
}

function mdToHtml(str) {
  const esc = String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/\n/g, "<br>");
}

function buildPreview(cfg) {
  const wrap = el("div", { class: "preview-wrap" });
  const wantText = cfg.mode === "text" || cfg.mode === "both";
  const wantEmbed = cfg.mode === "embed" || cfg.mode === "both";

  if (wantText && cfg.text) {
    wrap.append(el("div", { class: "preview-text", html: mdToHtml(previewVars(cfg.text)) }));
  } else if (cfg.pingUser) {
    wrap.append(el("div", { class: "preview-text", html: `<span class="mention">@${ME.username}</span>` }));
  }

  if (wantEmbed) {
    const e = cfg.embed || {};
    const embed = el("div", { class: "preview-embed", style: `border-left-color:${e.color || "#7c5cff"}` });
    const body = el("div", { class: "pe-body" });
    if (e.title) body.append(el("div", { class: "pe-title", html: mdToHtml(previewVars(e.title)) }));
    if (e.description) body.append(el("div", { class: "pe-desc", html: mdToHtml(previewVars(e.description)) }));
    if (e.footer) {
      const f = el("div", { class: "pe-footer" });
      if (e.footerIcon && GUILD.icon) f.append(el("img", { src: GUILD.icon, class: "pe-footer-ico", alt: "" }));
      f.append(document.createTextNode(previewVars(e.footer)));
      body.append(f);
    }
    embed.append(body);
    if (e.thumbnailUser && ME.avatar) embed.append(el("img", { src: ME.avatar, class: "pe-thumb", alt: "" }));
    if (e.image) embed.append(el("img", { src: e.image, class: "pe-image", alt: "" }));
    wrap.append(embed);
  }
  if (!wrap.children.length) wrap.append(el("div", { class: "preview-text", style: "color:var(--muted)" }, "(message vide)"));
  return wrap;
}

// ---------- Bienvenue ----------
let welcomeTab = "message";

function renderWelcome(content) {
  const cfg = structuredClone(CONFIG.welcome || {});
  if (!cfg.embed) cfg.embed = {};

  const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
    el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
    cfg.enabled ? "Module activé" : "Module inactif");

  content.append(pageHead("👋", "Bienvenue & au revoir",
    "Accueille les nouveaux membres avec un embed personnalisé, un auto-rôle, et annonce les départs.", [badge]));

  // Aperçu permanent en haut : on voit le résultat pendant qu'on édite.
  const previewCard = card("Aperçu en direct", "Rendu approximatif avec tes données — se met à jour pendant que tu édites.");
  const previewHolder = el("div");
  previewHolder.append(buildPreview(cfg));
  previewCard.append(previewHolder);
  content.append(previewCard);
  const refreshPreview = () => { previewHolder.innerHTML = ""; previewHolder.append(buildPreview(cfg)); };

  const tabs = [
    { id: "message", ico: "💬", label: "Message" },
    { id: "embed", ico: "🎨", label: "Embed" },
    { id: "roles", ico: "🏷️", label: "Auto-rôle" },
    { id: "goodbye", ico: "🚪", label: "Au revoir" },
  ];
  if (!tabs.some((t) => t.id === welcomeTab)) welcomeTab = "message";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === welcomeTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { welcomeTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  // Aperçu live : un seul écouteur délégué sur le conteneur d'onglets
  // (évite d'empiler des listeners à chaque changement d'onglet).
  body.addEventListener("input", refreshPreview);
  body.addEventListener("change", refreshPreview);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === welcomeTab));
    body.innerHTML = "";
    if (welcomeTab === "message") drawMessage();
    else if (welcomeTab === "embed") drawEmbed();
    else if (welcomeTab === "roles") drawRoles();
    else drawGoodbye();
    refreshPreview();
  }

  function variables() {
    const c = card("Variables disponibles", null);
    c.append(el("div", { class: "card-sub", html:
      "<code>{user}</code> mention · <code>{username}</code> pseudo · <code>{server}</code> nom du serveur · " +
      "<code>{membercount}</code> nombre de membres · <code>{user.tag}</code> tag complet" }));
    return c;
  }

  function drawMessage() {
    const c = card("Message d'arrivée", "Quand et comment le bot accueille un nouveau membre.");
    c.append(
      fieldRow("Activé", "Envoyer un message quand un membre arrive.", toggle(cfg, "enabled")),
      fieldRow("Salon de bienvenue", "", channelSelect(cfg, "channelId", "text")),
      fieldRow("Format", "Embed, texte simple, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Embed" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + Embed" }])),
      fieldRow("Mentionner le membre", "Ping le nouveau membre.", toggle(cfg, "pingUser")),
      fieldRow("Message texte", "Utilisé si format Texte ou Texte+Embed.", textareaInput(cfg, "text"), true),
    );
    body.append(c, variables());
  }

  function drawEmbed() {
    const c = card("Embed d'accueil", "Personnalise l'apparence de l'embed.");
    c.append(
      fieldRow("Couleur", "", colorInput(cfg.embed, "color")),
      fieldRow("Titre", "", textInput(cfg.embed, "title")),
      fieldRow("Description", "", textareaInput(cfg.embed, "description"), true),
      fieldRow("Avatar du membre en miniature", "Affiche l'avatar en haut à droite.", toggle(cfg.embed, "thumbnailUser")),
      fieldRow("Image / bannière (URL)", "Grande image en bas de l'embed.", textInput(cfg.embed, "image", "https://...")),
      fieldRow("Footer", "", textInput(cfg.embed, "footer")),
      fieldRow("Icône du serveur dans le footer", "", toggle(cfg.embed, "footerIcon")),
    );
    body.append(c, variables());
  }

  function drawRoles() {
    const c = card("Auto-rôle", "Donne automatiquement des rôles aux nouveaux membres.");
    c.append(fieldRow("Activé", "", toggle(cfg, "autoRoleEnabled")));
    c.append(multiRole(cfg, "autoRoleIds"));
    body.append(c);
  }

  function drawGoodbye() {
    const c = card("Message d'au revoir", "Publié quand un membre quitte le serveur.");
    c.append(
      fieldRow("Activé", "", toggle(cfg, "goodbyeEnabled")),
      fieldRow("Salon", "", channelSelect(cfg, "goodbyeChannelId", "text")),
      fieldRow("Message", "", textareaInput(cfg, "goodbyeText"), true),
    );
    body.append(c, variables());
  }

  draw();

  const save = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try { CONFIG.welcome = await api("/api/config/welcome", "PUT", cfg); setDirty(false); renderNav(); toast("Enregistré", "ok"); }
    catch (e) { toast("Erreur : " + e.message, "err"); }
    save.disabled = false;
  });
  const test = el("button", { class: "btn-save ghost" }, icon("sparkles", 16), "Envoyer un test");
  test.addEventListener("click", async () => {
    test.disabled = true;
    try { await api("/api/config/welcome", "PUT", cfg); await api("/api/welcome/test", "POST", {}); toast("Test envoyé dans le salon", "ok"); }
    catch (e) { toast("Erreur : " + e.message, "err"); }
    test.disabled = false;
  });
  content.append(actionBar({ hint: true }, test, save));
}

// ---------- Annonces / messages personnalisés ----------
function buildAnnouncePreview(cfg) {
  const wrap = el("div", { class: "preview-wrap" });
  const mode = cfg.mode || "embed";
  const wantText = mode === "text" || mode === "both";
  const wantEmbed = mode === "embed" || mode === "both";

  // Mentions (rôles + everyone) sous forme de pastilles.
  const bits = [];
  if (cfg.mentionEveryone) bits.push("@everyone");
  for (const id of cfg.mentionRoleIds || []) {
    const r = GUILD.roles.find((x) => x.id === id);
    bits.push("@" + (r ? r.name : "rôle"));
  }
  const mentionHtml = bits.map((b) => `<span class="mention">${b}</span>`).join(" ");
  const hasPlaceholder = wantText && cfg.content && cfg.content.includes("{mentions}");

  // Texte du message avec placement du ping.
  let textHtml = "";
  if (wantText && cfg.content) {
    if (mentionHtml && hasPlaceholder) {
      const SENT = "\u0000MENT\u0000";
      const raw = previewVars(cfg.content).replaceAll("{mentions}", SENT);
      textHtml = mdToHtml(raw).replaceAll(SENT, mentionHtml);
    } else {
      textHtml = mdToHtml(previewVars(cfg.content).replaceAll("{mentions}", ""));
    }
  }
  if (mentionHtml && !hasPlaceholder) {
    const pos = cfg.mentionPosition || "top";
    if (pos === "end") textHtml = textHtml ? textHtml + " " + mentionHtml : mentionHtml;
    else textHtml = textHtml ? mentionHtml + "<br>" + textHtml : mentionHtml;
  }
  if (textHtml) wrap.append(el("div", { class: "preview-text", html: textHtml }));

  if (wantEmbed) {
    const e = cfg.embed || {};
    const embed = el("div", { class: "preview-embed", style: `border-left-color:${e.color || "#7c5cff"}` });
    const body = el("div", { class: "pe-body" });
    if (e.author && e.author.name) {
      const a = el("div", { class: "pe-author" });
      if (e.author.iconUrl) a.append(el("img", { src: e.author.iconUrl, class: "pe-author-ico", alt: "" }));
      a.append(document.createTextNode(previewVars(e.author.name)));
      body.append(a);
    }
    if (e.title) body.append(el("div", { class: "pe-title", html: mdToHtml(previewVars(e.title)) }));
    if (e.description) body.append(el("div", { class: "pe-desc", html: mdToHtml(previewVars(e.description)) }));
    const fields = (e.fields || []).filter((f) => f && (f.name || f.value));
    if (fields.length) {
      const grid = el("div", { class: "pe-fields" });
      for (const f of fields) {
        grid.append(el("div", { class: "pe-field" + (f.inline ? " inline" : "") },
          el("div", { class: "pe-field-name", html: mdToHtml(previewVars(f.name || "")) }),
          el("div", { class: "pe-field-value", html: mdToHtml(previewVars(f.value || "")) })));
      }
      body.append(grid);
    }
    if (e.footer || e.footerIcon) {
      const f = el("div", { class: "pe-footer" });
      if (e.footerIcon && GUILD.icon) f.append(el("img", { src: GUILD.icon, class: "pe-footer-ico", alt: "" }));
      f.append(document.createTextNode((previewVars(e.footer) || GUILD.name) + (e.timestamp ? " • aujourd'hui" : "")));
      body.append(f);
    }
    embed.append(body);
    if (e.thumbnail) embed.append(el("img", { src: e.thumbnail, class: "pe-thumb", alt: "" }));
    if (e.image) embed.append(el("img", { src: e.image, class: "pe-image", alt: "" }));
    wrap.append(embed);
  }
  // Image jointe (upload) — affichée comme une pièce jointe, hors embed.
  if (cfg.fileDataUrl) wrap.append(el("img", { src: cfg.fileDataUrl, class: "preview-attach", alt: "" }));
  if (!wrap.children.length) wrap.append(el("div", { class: "preview-text", style: "color:var(--muted)" }, "(message vide)"));
  return wrap;
}

let announceTab = "message";

function renderAnnounce(content) {
  // Config locale (non persistée : page d'action ponctuelle).
  const cfg = {
    channelId: "", messageId: "", mode: "embed", content: "",
    mentionEveryone: false, mentionRoleIds: [], mentionPosition: "top",
    fileDataUrl: "", fileName: "",
    embed: {
      color: "#7c5cff",
      author: { name: "", iconUrl: "", url: "" },
      title: "", url: "", description: "", fields: [],
      thumbnail: "", image: "", footer: "", footerIcon: false, timestamp: false,
    },
  };

  content.append(pageHead("📢", "Annonces & messages perso",
    "Compose un message entièrement personnalisable (texte + embed) et envoie-le — ou modifie un message existant du bot."));

  // Aperçu en direct, toujours visible.
  const previewCard = card("Aperçu en direct", "Rendu approximatif — se met à jour pendant que tu édites.");
  const previewHolder = el("div");
  previewHolder.append(buildAnnouncePreview(cfg));
  previewCard.append(previewHolder);
  content.append(previewCard);
  const refreshPreview = () => { previewHolder.innerHTML = ""; previewHolder.append(buildAnnouncePreview(cfg)); };

  const tabs = [
    { id: "message", ico: "💬", label: "Message" },
    { id: "embed", ico: "🎨", label: "Embed" },
    { id: "fields", ico: "🧩", label: "Champs" },
    { id: "mentions", ico: "🔔", label: "Mentions" },
  ];
  if (!tabs.some((t) => t.id === announceTab)) announceTab = "message";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === announceTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { announceTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  body.addEventListener("input", refreshPreview);
  body.addEventListener("change", refreshPreview);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === announceTab));
    body.innerHTML = "";
    if (announceTab === "message") drawMessage();
    else if (announceTab === "embed") drawEmbed();
    else if (announceTab === "fields") drawFieldsTab();
    else drawMentions();
    refreshPreview();
  }

  function drawMessage() {
    const c = card("Destination & contenu", "Où publier, et le texte affiché hors de l'embed.");
    c.append(
      fieldRow("Salon", "Où publier le message.", channelSelect(cfg, "channelId", "textann", false)),
      fieldRow("ID du message à éditer", "Optionnel : colle l'ID d'un message du bot pour le modifier au lieu d'en envoyer un nouveau.", textInput(cfg, "messageId", "Laisser vide pour un nouveau message")),
      fieldRow("Format", "Texte simple, embed, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Embed" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + Embed" }])),
      fieldRow("Message texte", "Contenu hors embed (markdown supporté).", textareaInput(cfg, "content"), true),
    );

    // Image jointe (upload) — fonctionne avec ou sans embed.
    const fileInput = el("input", { type: "file", accept: "image/*" });
    const fileInfo = el("div", { class: "desc", style: "margin-top:6px" });
    const fileClear = el("button", { class: "btn-mini danger", style: "display:none" }, "✕ Retirer l'image");
    const syncFile = () => {
      fileInfo.textContent = cfg.fileName ? "📎 " + cfg.fileName : "";
      fileClear.style.display = cfg.fileName ? "" : "none";
    };
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast("Image trop lourde (max 8 Mo).", "err"); fileInput.value = ""; return; }
      const reader = new FileReader();
      reader.onload = () => {
        cfg.fileDataUrl = String(reader.result);
        cfg.fileName = f.name;
        syncFile(); refreshPreview(); setDirty(true);
      };
      reader.readAsDataURL(f);
    });
    fileClear.addEventListener("click", () => {
      cfg.fileDataUrl = ""; cfg.fileName = ""; fileInput.value = "";
      syncFile(); refreshPreview();
    });
    syncFile();
    c.append(fieldRow("Image jointe (upload)", "Joins une image (max 8 Mo) — envoyée même sans embed.",
      el("div", { style: "width:100%" }, fileInput, fileInfo, fileClear), true));
    body.append(c, variables());
  }

  function variables() {
    const c = card("Variables disponibles", null);
    c.append(el("div", { class: "card-sub", html:
      "<code>{server}</code> nom du serveur · <code>{membercount}</code> nombre de membres · " +
      "<code>{date}</code> date · <code>{time}</code> heure · <code>{mentions}</code> emplacement du ping" }));
    return c;
  }

  function drawEmbed() {
    const c = card("Embed", "Personnalise entièrement l'apparence de l'embed.");
    c.append(
      fieldRow("Couleur", "Bande latérale de l'embed.", colorInput(cfg.embed, "color")),
      fieldRow("Auteur", "Petit titre tout en haut.", textInput(cfg.embed.author, "name")),
      fieldRow("Icône de l'auteur (URL)", "", textInput(cfg.embed.author, "iconUrl", "https://...")),
      fieldRow("Lien de l'auteur (URL)", "", textInput(cfg.embed.author, "url", "https://...")),
      fieldRow("Titre", "", textInput(cfg.embed, "title")),
      fieldRow("Lien du titre (URL)", "Rend le titre cliquable.", textInput(cfg.embed, "url", "https://...")),
      fieldRow("Description", "Markdown supporté.", textareaInput(cfg.embed, "description"), true),
      fieldRow("Miniature (URL)", "Petite image en haut à droite.", textInput(cfg.embed, "thumbnail", "https://...")),
      fieldRow("Grande image (URL)", "Bannière en bas de l'embed.", textInput(cfg.embed, "image", "https://...")),
      fieldRow("Footer", "Texte de bas d'embed.", textInput(cfg.embed, "footer")),
      fieldRow("Icône du serveur dans le footer", "", toggle(cfg.embed, "footerIcon")),
      fieldRow("Afficher l'horodatage", "Date/heure d'envoi en bas.", toggle(cfg.embed, "timestamp")),
    );
    body.append(c);
  }

  function drawFieldsTab() {
    const c = card("Champs de l'embed", "Jusqu'à 25 champs (titre + valeur). « En ligne » place les champs côte à côte.");
    const holder = el("div");
    const drawFields = () => {
      holder.innerHTML = "";
      if (!cfg.embed.fields.length) holder.append(el("div", { class: "empty-row" }, "Aucun champ pour l'instant."));
      cfg.embed.fields.forEach((f, idx) => {
        const row = el("div", { class: "card nested" });
        row.append(
          fieldRow("Titre du champ", "", textInput(f, "name")),
          fieldRow("Valeur", "", textareaInput(f, "value"), true),
          fieldRow("En ligne", "", toggle(f, "inline")),
        );
        row.append(el("button", { class: "btn-mini danger", onclick: () => { cfg.embed.fields.splice(idx, 1); drawFields(); refreshPreview(); setDirty(true); } }, "🗑 Supprimer ce champ"));
        holder.append(row);
      });
    };
    drawFields();
    c.append(holder, el("button", { class: "btn-add", onclick: () => {
      if (cfg.embed.fields.length >= 25) return toast("25 champs maximum.", "err");
      cfg.embed.fields.push({ name: "", value: "", inline: false });
      drawFields(); setDirty(true);
    } }, "+ Ajouter un champ"));
    body.append(c);
  }

  function drawMentions() {
    const c = card("Mentions", "Ajoute un ping au message. À utiliser avec parcimonie.");
    c.append(
      fieldRow("Mentionner @everyone", "Notifie tout le serveur.", toggle(cfg, "mentionEveryone")),
      fieldRow("Rôles à mentionner", "", multiRole(cfg, "mentionRoleIds"), true),
      fieldRow("Position du ping", "Au début, à la fin, ou n'importe où dans le texte via la variable {mentions}.", selectInput(cfg, "mentionPosition", [
        { value: "top", label: "Au début du message" },
        { value: "end", label: "À la fin du message" },
        { value: "inline", label: "Personnalisé (variable {mentions})" },
      ])),
    );
    body.append(c);
  }

  draw();

  const send = el("button", { class: "btn-save" }, icon("megaphone", 17), "Envoyer le message");
  send.addEventListener("click", async () => {
    if (!cfg.channelId) return toast("Choisis d'abord un salon.", "err");
    const editing = !!(cfg.messageId && cfg.messageId.trim());
    if (cfg.mentionEveryone && !editing) {
      if (!(await confirmModal("Ce message va ping <b>@everyone</b>. Confirmer l'envoi ?", { okLabel: "Envoyer", danger: true }))) return;
    }
    send.disabled = true;
    try {
      const r = await api("/api/announce/send", "POST", cfg);
      setDirty(false);
      toast(r.edited ? "Message modifié" : "Message envoyé", "ok");
      if (!editing && r.messageId) cfg.messageId = r.messageId;
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    send.disabled = false;
  });
  content.append(actionBar({}, send));
}

// ---------- Tournoi ----------
// Cartes groupées du formulaire de tournoi (création OU édition).
function tournamentFormCards(cfg) {
  return [
    sectionCard("📋", "Informations",
      el("div", { class: "fgrid" },
        fItem("Nom du tournoi", "", textInput(cfg, "name"), true),
        fItem("Format", "", selectInput(cfg, "format", [{ value: "1v1", label: "1v1" }, { value: "2v2", label: "2v2 (équipes)" }])),
        fItem("Région", "", textInput(cfg, "region", "EU")),
        fItem("Participants max", "Idéalement 8, 16, 32…", numberInput(cfg, "maxParticipants", 2, 256)),
        fItem("Heure de début", "Texte libre (ex: « Sam 21h »).", textInput(cfg, "startTime", "Sam 21h")),
      )),
    sectionCard("⚔️", "Format & règles",
      el("div", { class: "fgrid" },
        fItem("Best-of des matchs", "Nombre de manches.", numberInput(cfg, "bestOf", 1, 9)),
        fItem("Best-of de la finale", "", numberInput(cfg, "finalsBestOf", 1, 9)),
        fItem("Règles", "", textareaInput(cfg, "rulesText"), true),
        fItem("Récompenses", "", textInput(cfg, "prizeText", "ex: 50€ + rôle")),
        fItem("Maps légales", "", textInput(cfg, "mapPool", "ex: Brawlhaven, Mammoth…")),
      )),
    sectionCard("✅", "Inscriptions & accès",
      fToggle("Check-in obligatoire", "Les joueurs confirment leur présence avant le début.", cfg, "checkInEnabled", true),
      el("div", { class: "fgrid" },
        fItem("Salon d'inscription", "Où publier le panneau.", channelSelect(cfg, "signupChannelId", "text")),
        fItem("Salon d'annonces", "Bracket, vainqueur…", channelSelect(cfg, "announceChannelId", "text")),
        fItem("Rôle participant", "Donné aux inscrits.", roleSelect(cfg, "participantRoleId")),
        fItem("Rôle à notifier", "Pingé dans l'annonce d'ouverture (ex: @tournoi).", roleSelect(cfg, "pingRoleId"), true),
      )),
    sectionCard("🤖", "Automatisation des matchs",
      el("div", { class: "fgrid" },
        fItem("Catégorie des salons de match", "Où créer les salons privés.", channelSelect(cfg, "matchCategoryId", "category"), true),
        fItem("Rôle staff", "Accès aux salons + alertes litiges.", roleSelect(cfg, "modRoleId")),
        fItem("Salon des alertes/litiges", "Ping en cas de litige ou AFK.", channelSelect(cfg, "modAlertChannelId", "text")),
        fItem("Alerte staff après (min)", "", numberInput(cfg, "alertMinutes", 1, 60)),
        fItem("Forfait/alerte inactivité après (min)", "", numberInput(cfg, "forfeitMinutes", 1, 120)),
      ),
      fToggle("Vocal de match éphémère", "Crée aussi un salon vocal par match.", cfg, "createVoice", true)),
    sectionCard("🎥", "Cast & Hall of Fame",
      el("div", { class: "fgrid" },
        fItem("Cast à partir du top", "Les matchs de ce palier sont verrouillés jusqu'au déblocage staff (/caster). 0 = off.", selectInput(cfg, "castFromTopN", [
          { value: 0, label: "Désactivé" },
          { value: 4, label: "Top 4" },
          { value: 8, label: "Top 8" },
          { value: 16, label: "Top 16" },
          { value: 32, label: "Top 32" },
        ])),
        fItem("Salon Hall of Fame", "Récap podium + MVP posté à l'archivage.", channelSelect(cfg, "hallOfFameChannelId", "text"), true),
      )),
  ];
}

let trnTab = "pilotage";

async function renderTournament(content) {
  content.innerHTML = "";
  setDirty(false);
  content.append(pageHead("🏆", "Tournoi",
    "Crée et pilote ton tournoi Brawlhalla : inscriptions, check-in, bracket et scores."));
  const skel = skeletonCards(2);
  content.append(skel);
  let t;
  try { t = await api("/api/tournament"); } catch { t = null; }
  skel.remove();

  if (!t) return drawWizard();

  // ----- Assistant de création -----
  function drawWizard() {
    const cfg = {
      name: "Tournoi Brawlhalla", format: "1v1", region: "EU", maxParticipants: 16,
      bestOf: 3, finalsBestOf: 5, checkInEnabled: true,
      rulesText: "Stock · 3 vies · 8 min · maps légales.", prizeText: "", mapPool: "",
      startTime: "", createVoice: false, alertMinutes: 7, forfeitMinutes: 10,
    };
    const cards = tournamentFormCards(cfg);
    const steps = [
      { label: "Informations", sub: "Nom, format, places" },
      { label: "Format & règles", sub: "BO, règles, maps" },
      { label: "Inscriptions", sub: "Salons & rôles" },
      { label: "Automatisation", sub: "Salons de match" },
    ];
    let step = 0;

    content.append(el("div", { class: "callout info", style: "cursor:default" },
      el("span", { class: "co-ico" }, icon("sparkles", 18)),
      el("span", {}, "Aucun tournoi actif. Suis les 4 étapes ci-dessous pour en créer un.")));

    const stepper = el("div", { class: "stepper" });
    const stepEls = steps.map((s, i) => {
      const e = el("div", { class: "wstep", onclick: () => { step = i; drawStep(); } },
        el("span", { class: "num" }, String(i + 1)),
        el("div", { class: "w-meta" }, el("span", { class: "w-label" }, s.label), el("span", { class: "w-sub" }, s.sub)));
      stepper.append(e);
      return e;
    });
    const wbody = el("div", { class: "tab-body" });
    const foot = el("div", { class: "save-bar wizard-foot" });
    content.append(stepper, wbody, foot);

    const create = async (btn) => {
      btn.disabled = true;
      try { await api("/api/tournament", "POST", cfg); setDirty(false); toast("Tournoi créé", "ok"); renderTournament(content); }
      catch (e) { toast("Erreur : " + e.message, "err"); btn.disabled = false; }
    };

    function drawStep() {
      stepEls.forEach((e, i) => { e.classList.toggle("active", i === step); e.classList.toggle("done", i < step); });
      wbody.innerHTML = "";
      wbody.append(cards[step]);
      foot.innerHTML = "";
      const back = el("button", { class: "tbtn", onclick: () => { if (step > 0) { step--; drawStep(); } } }, "← Retour");
      back.style.visibility = step > 0 ? "visible" : "hidden";
      foot.append(back);
      if (step < cards.length - 1) {
        foot.append(el("button", { class: "tbtn primary", onclick: () => { step++; drawStep(); } }, "Suivant →"));
      } else {
        const c = el("button", { class: "btn-save" }, icon("trophy", 17), "Créer le tournoi");
        c.addEventListener("click", () => create(c));
        foot.append(c);
      }
    }
    drawStep();
  }

  // ----- Tournoi existant -----
  const STATUS = { draft: "🔧 Brouillon", registration: "🟢 Inscriptions", checkin: "✅ Check-in", running: "⚔️ En cours", completed: "🏆 Terminé" };
  const STATUS_CLASS = { draft: "", registration: "ok", checkin: "info", running: "info", completed: "win" };

  const refreshHero = el("button", { class: "tbtn", title: "Actualiser le tournoi" }, icon("refresh", 15), "Actualiser");
  refreshHero.addEventListener("click", async () => {
    refreshHero.disabled = true;
    await renderTournament(content);
  });
  content.append(el("div", { class: "trn-hero" },
    el("div", { class: "h-main" },
      el("div", { class: "h-name" }, t.name),
      el("div", { class: "h-meta" },
        el("span", { class: "pill status " + (STATUS_CLASS[t.status] || "") }, STATUS[t.status] || t.status),
        el("span", { class: "pill" }, `👥 ${t.participants.length}/${t.maxParticipants}`),
        el("span", { class: "pill" }, `🎮 ${t.format}`),
        el("span", { class: "pill" }, `⚔️ BO${t.bestOf} · finale BO${t.finalsBestOf}`),
        t.startTime ? el("span", { class: "pill" }, `🕒 ${t.startTime}`) : null)),
    refreshHero));

  // Action générique (toolbar) : exécute fn puis recharge (l'onglet actif est conservé).
  const action = (label, fn, variant) => {
    const b = el("button", { class: "tbtn" + (variant ? " " + variant : "") }, label);
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await fn(); toast("Fait", "ok"); renderTournament(content); }
      catch (e) { toast("Erreur : " + e.message, "err"); b.disabled = false; }
    });
    return b;
  };

  const disputes = Object.entries(t.matches).filter(([, m]) => m.status === "dispute");

  const tabs = [
    { id: "pilotage", ico: "🎛️", label: "Pilotage" },
    { id: "participants", ico: "👥", label: "Participants" },
    { id: "bracket", ico: "🗺️", label: "Bracket" },
    { id: "settings", ico: "⚙️", label: "Réglages" },
    { id: "history", ico: "📚", label: "Librairie" },
  ];
  if (disputes.length) tabs.splice(1, 0, { id: "alerts", ico: "🚨", label: `Litiges · ${disputes.length}`, danger: true });
  if (!tabs.some((x) => x.id === trnTab)) trnTab = "pilotage";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === trnTab ? " active" : "") + (tab.danger ? " danger" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { trnTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === trnTab));
    body.innerHTML = "";
    ({ pilotage: drawPilotage, alerts: drawAlerts, participants: drawParticipants, bracket: drawBracket, settings: drawSettings, history: () => renderHistory(body) }[trnTab] || drawPilotage)();
  }

  // ---- Onglet Pilotage ----
  function drawPilotage() {
    if (disputes.length) body.append(disputeCallout());

    const box = sectionCard("🎛️", "Pilotage du tournoi");
    const flow = el("div", { class: "toolbar" });
    flow.append(action("📢 Publier le panneau", () => api("/api/tournament/publish", "POST", {}), "primary"));
    if (t.status === "draft" || t.status === "completed") flow.append(action("🟢 Ouvrir les inscriptions", () => api("/api/tournament/status", "POST", { status: "registration" })));
    if (t.status === "registration" && t.checkInEnabled) flow.append(action("✅ Ouvrir le check-in", () => api("/api/tournament/status", "POST", { status: "checkin" })));
    if (t.status === "registration" || t.status === "checkin") {
      flow.append(action("📊 Seeding par Elo", () => api("/api/tournament/seed-elo", "POST", {})));
      flow.append(action("🎲 Mélanger les seeds", () => api("/api/tournament/shuffle", "POST", {})));
      flow.append(action("⚔️ Générer le bracket", () => api("/api/tournament/generate", "POST", {})));
    }
    box.append(el("div", { class: "tb-label" }, "Déroulé"), flow);

    // Seeding automatique via un lien d'événement start.gg.
    if (t.status === "registration" || t.status === "checkin") {
      const sg = { url: "", token: "" };
      const urlIn = textInput(sg, "url", "https://www.start.gg/tournament/<nom>/event/<event>");
      const tokenIn = el("input", { type: "password", placeholder: "Token start.gg (mémorisé après la 1ʳᵉ fois)" });
      tokenIn.addEventListener("input", () => (sg.token = tokenIn.value.trim()));
      const sgBtn = el("button", { class: "tbtn" }, icon("sprout", 15), "Seeding via start.gg");
      sgBtn.addEventListener("click", async () => {
        if (!sg.url) return toast("Colle le lien de l'événement start.gg.", "err");
        sgBtn.disabled = true;
        try {
          const r = await api("/api/tournament/seed-startgg", "POST", { url: sg.url, token: sg.token || undefined });
          toast(r.message || "Seeding start.gg appliqué", "ok");
          renderTournament(content);
        } catch (e) {
          toast("Erreur : " + e.message, "err");
          sgBtn.disabled = false;
        }
      });
      box.append(
        el("div", { class: "tb-label" }, "Seeding start.gg"),
        el("div", { class: "card-sub" }, "Colle le lien de l'ÉVÉNEMENT start.gg : les seeds y sont récupérés et appliqués (association par pseudo / compte lié). Les joueurs non trouvés sont placés à la fin."),
        el("div", { style: "display:flex;flex-direction:column;gap:8px;max-width:560px" }, urlIn, tokenIn, el("div", {}, sgBtn)),
      );
    }

    const danger = el("div", { class: "toolbar" });
    danger.append(action("📚 Archiver dans la librairie", async () => {
      if (await confirmModal("Archiver ce tournoi dans la librairie ? Il sera retiré de l'écran actif et conservé dans l'historique consultable.", { title: "Archiver", okLabel: "Archiver" })) await api("/api/tournament/archive", "POST", {});
    }));
    danger.append(action("🗑️ Supprimer", async () => {
      if (await confirmModal("Supprimer définitivement ce tournoi ? Tout sera perdu.", { danger: true, okLabel: "Supprimer" })) await api("/api/tournament", "DELETE");
    }, "danger"));
    box.append(el("div", { class: "tb-label" }, "Gestion"), danger);
    body.append(box);
  }

  function disputeCallout() {
    const c = el("div", { class: "callout danger", onclick: () => { trnTab = "alerts"; draw(); } });
    c.append(el("span", { class: "co-ico" }, "🚨"), el("span", {}, `${disputes.length} litige(s) à trancher — clique pour ouvrir.`));
    return c;
  }

  // ---- Onglet Litiges ----
  function drawAlerts() {
    const dc = el("div", { class: "card alert-card" },
      el("div", { class: "card-section-title" }, el("span", { class: "ico" }, "🚨"), `Litiges à trancher (${disputes.length})`),
      el("div", { class: "card-sub" }, "Scores contradictoires — choisis le vainqueur pour débloquer le bracket."));
    for (const [mid, m] of disputes) {
      const A = t.participants.find((p) => p.id === m.aId), B = t.participants.find((p) => p.id === m.bId);
      const ra = m.reports?.[m.aId], rb = m.reports?.[m.bId];
      const row = el("div", { class: "dispute-row" });
      row.append(el("div", { class: "dr-info" }, `${A?.name} (${ra ? ra.a + "-" + ra.b : "—"})  vs  ${B?.name} (${rb ? rb.a + "-" + rb.b : "—"})`));
      const win = (eid, label, wname) => {
        const b = el("button", { class: "tbtn" }, label);
        b.addEventListener("click", async () => {
          if (!await confirmModal(`Attribuer la victoire à <b>${wname}</b> sur ce match ? Le bracket avancera automatiquement.`, { title: "Trancher le litige", okLabel: "Confirmer la victoire" })) return;
          try { await api("/api/tournament/resolve", "POST", { matchId: mid, winnerId: eid }); renderTournament(content); } catch (e) { toast("Erreur : " + e.message, "err"); }
        });
        return b;
      };
      const acts = el("div", { class: "dr-acts" }, win(m.aId, "🏆 " + A?.name, A?.name), win(m.bId, "🏆 " + B?.name, B?.name));
      if (m.channelId && GUILD.id) acts.append(el("a", { class: "tbtn", href: `https://discord.com/channels/${GUILD.id}/${m.channelId}`, target: "_blank", rel: "noopener" }, icon("external", 15), "Salon"));
      row.append(acts);
      dc.append(row);
    }
    body.append(dc);
  }

  // ---- Onglet Participants ----
  function drawParticipants() {
    const checkedIn = t.participants.filter((p) => p.checkedIn).length;
    const pc = sectionCard("👥", `Participants (${t.participants.length}/${t.maxParticipants})`);
    if (t.checkInEnabled) {
      pc.append(el("div", { class: "card-sub" }, `${checkedIn} joueur(s) ont confirmé leur présence (✅ = check-in fait, ⌛ = en attente).`));
    }
    if (!t.participants.length) { pc.append(el("div", { class: "empty-row" }, "Aucun inscrit pour l'instant.")); body.append(pc); return; }
    const grid = el("div", { class: "pgrid" });
    for (const [i, p] of t.participants.entries()) {
      const checked = t.checkInEnabled ? (p.checkedIn ? " ✅" : " ⌛") : "";
      grid.append(el("div", { class: "pcard" },
        el("span", { class: "seed" }, String(i + 1)),
        el("span", { class: "pn" }, p.name + checked),
        el("button", { class: "icon-btn", title: "Retirer", onclick: async () => {
          if (!await confirmModal(`Retirer <b>${p.name}</b> du tournoi ?`, { danger: true, okLabel: "Retirer" })) return;
          await api("/api/tournament/remove", "POST", { entrantId: p.id });
          renderTournament(content);
        } }, "🗑")));
    }
    pc.append(grid);
    body.append(pc);
  }

  // ---- Onglet Bracket ----
  function drawBracket() {
    if (t.rounds > 0) { body.append(renderBracket(content, t)); return; }
    const c = sectionCard("🗺️", "Bracket");
    c.append(el("div", { class: "empty-row" }, "Bracket non généré. Va dans Pilotage → « Générer le bracket » une fois les inscriptions closes."));
    body.append(c);
  }

  // ---- Onglet Réglages ----
  function drawSettings() {
    body.append(el("div", { class: "settings-intro" }, "Modifie la config du tournoi. N'affecte pas les participants ni le bracket en cours."));
    const cfgEdit = JSON.parse(JSON.stringify(t));
    for (const c of tournamentFormCards(cfgEdit)) body.append(c);
    const sv = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer les réglages");
    sv.addEventListener("click", async () => {
      sv.disabled = true;
      try { await api("/api/tournament", "PUT", cfgEdit); setDirty(false); toast("Réglages enregistrés", "ok"); renderTournament(content); }
      catch (e) { toast("Erreur : " + e.message, "err"); sv.disabled = false; }
    });
    body.append(actionBar({ hint: true }, sv));
  }

  draw();
}

function entrantName(t, id) { return id ? (t.participants.find((p) => p.id === id)?.name || "?") : "—"; }

function renderBracket(content, t, readonly = false) {
  const box = card("🗺️ Bracket", readonly ? null : "Clique un match pour saisir ou corriger le score.");
  const roundName = (r) => {
    const fe = t.rounds - 1 - r;
    return fe === 0 ? "Finale" : fe === 1 ? "Demi-finales" : fe === 2 ? "Quarts" : `Round ${r + 1}`;
  };
  const wrap = el("div", { class: "bracket" });
  for (let r = 0; r < t.rounds; r++) {
    const col = el("div", { class: "bracket-round" });
    const inner = el("div", { style: "display:flex;flex-direction:column;justify-content:space-around;flex:1;gap:18px" });
    col.append(el("div", { class: "bracket-round-title" }, roundName(r)), inner);
    const ms = Object.entries(t.matches).filter(([, m]) => m.round === r).sort((a, b) => a[1].index - b[1].index);
    for (const [mid, m] of ms) {
      const A = t.participants.find((p) => p.id === m.aId);
      const B = t.participants.find((p) => p.id === m.bId);
      const prow = (ent, score, win) =>
        el("div", { class: "brow" + (win ? " win" : "") },
          el("span", { class: "pname" + (ent ? "" : " bempty") }, ent ? ent.name : "—"),
          el("span", { class: "pscore" }, ent ? String(score) : "·"));
      const mc = el("div", { class: "bmatch" + (m.status === "done" ? " done" : "") + (m.status === "dispute" ? " dispute" : "") },
        prow(A, m.scoreA, m.winnerId === m.aId),
        prow(B, m.scoreB, m.winnerId === m.bId));
      if (!readonly && m.aId && m.bId) {
        mc.addEventListener("click", async () => {
          const res = await scoreModal(A.name, B.name, m.scoreA, m.scoreB);
          if (!res) return;
          if (res.scoreA === res.scoreB) return toast("Il faut un gagnant (scores différents).", "err");
          try { await api("/api/tournament/result", "POST", { matchId: mid, scoreA: res.scoreA, scoreB: res.scoreB }); renderTournament(content); }
          catch (e) { toast("Erreur : " + e.message, "err"); }
        });
      }
      inner.append(mc);
    }
    wrap.append(col);
  }
  box.append(wrap);
  return box;
}

// ---- Librairie / Historique des tournois ----
async function renderHistory(content) {
  let list;
  try { list = await api("/api/tournament/history"); } catch { return; }
  const box = sectionCard("📚", "Librairie des tournois");
  box.append(el("div", { class: "card-sub" }, "Historique des tournois archivés — consulte les anciennes brackets et leurs résultats."));
  if (!list.length) {
    box.append(el("div", { class: "empty-row" }, "Aucun tournoi archivé pour le moment."));
    content.append(box);
    return;
  }
  for (const h of list) {
    const date = h.archivedAt ? new Date(h.archivedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    box.append(el("div", { class: "reward-row", style: "align-items:center" },
      el("div", { style: "flex:1;min-width:0" },
        el("div", { style: "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, h.name),
        el("div", { class: "desc", style: "margin-top:2px" }, `${h.format} · BO${h.bestOf} · ${h.participants} joueurs · ${date}`)),
      el("span", { class: "pill", style: "white-space:nowrap" }, h.winner ? "🏆 " + h.winner : "— inachevé"),
      el("button", { class: "icon-btn", title: "Consulter", onclick: () => historyModal(h.id) }, "👁"),
      el("button", { class: "icon-btn", title: "Supprimer", onclick: async () => {
        if (!await confirmModal(`Supprimer définitivement « ${h.name} » de la librairie ?`, { danger: true, okLabel: "Supprimer" })) return;
        try { await api("/api/tournament/history/" + h.id, "DELETE"); renderSection("tournament"); } catch (e) { toast("Erreur : " + e.message, "err"); }
      } }, "🗑")));
  }
  content.append(box);
}

async function historyModal(id) {
  let entry;
  try { entry = await api("/api/tournament/history/" + id); } catch (e) { return toast("Erreur : " + e.message, "err"); }
  const t = entry.snapshot;
  const overlay = el("div", { class: "modal-overlay", role: "dialog", "aria-modal": "true" });
  const close = () => { overlay.classList.remove("show"); setTimeout(() => overlay.remove(), 200); };
  const date = entry.archivedAt ? new Date(entry.archivedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const box = el("div", { class: "modal-card", style: "max-width:920px;width:94vw;max-height:88vh;overflow:auto;text-align:left" },
    el("div", { class: "modal-title" }, "📚 " + entry.name),
    el("div", { class: "card-sub" }, `${entry.format} · BO${entry.bestOf} · ${entry.participants} joueurs · ${date}${entry.winner ? " · 🏆 " + entry.winner : ""}`));
  if (t && t.rounds > 0) box.append(renderBracket(null, t, true));
  else box.append(el("div", { class: "empty-row" }, "Pas de bracket enregistré pour ce tournoi."));
  const cl = el("button", { class: "modal-btn primary" }, "Fermer");
  cl.onclick = close;
  box.append(el("div", { class: "modal-actions" }, cl));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.append(box);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
}

void entrantName;

boot();
