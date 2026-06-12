"use strict";

// ----- État global -----
let ME = null;
let GUILD = null;
let CONFIG = {};
let current = "overview";
let dirty = false;
let appHooked = false;
let logTimer = null;

function setDirty(v) {
  dirty = v;
  document.querySelectorAll("#content .btn-save").forEach((b) => b.classList.toggle("dirty", v));
}

const $ = (sel) => document.querySelector(sel);
const errorMessages = {
  notadmin: "Tu n'es pas administrateur de ce serveur.",
  token: "Échec de l'authentification Discord.",
  oauth: "Erreur OAuth. Réessaie.",
  nocode: "Connexion annulée.",
  state: "Session de connexion expirée ou invalide. Relance la connexion.",
};

// ----- Helpers DOM -----
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
  t.textContent = msg;
  t.className = "show " + kind;
  setTimeout(() => (t.className = ""), 2600);
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

// Modale de confirmation stylée (remplace confirm()).
function confirmModal(message, { title = "Confirmation", danger = false, okLabel = "Confirmer" } = {}) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const card = el("div", { class: "modal-card" },
      el("div", { class: "modal-title" }, title),
      el("div", { class: "modal-msg", html: message }));
    const cancel = el("button", { class: "modal-btn" }, "Annuler");
    const ok = el("button", { class: "modal-btn " + (danger ? "danger" : "primary") }, okLabel);
    const done = (v) => { overlay.classList.remove("show"); setTimeout(() => overlay.remove(), 200); resolve(v); };
    cancel.onclick = () => done(false);
    ok.onclick = () => done(true);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(false); });
    card.append(el("div", { class: "modal-actions" }, cancel, ok));
    overlay.append(card);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
  });
}

// Modale de saisie de score d'un match.
function scoreModal(nameA, nameB, sa, sb) {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const inA = el("input", { type: "number", min: 0, value: sa });
    const inB = el("input", { type: "number", min: 0, value: sb });
    const cancel = el("button", { class: "modal-btn" }, "Annuler");
    const ok = el("button", { class: "modal-btn primary" }, "Valider");
    const done = (v) => { overlay.classList.remove("show"); setTimeout(() => overlay.remove(), 200); resolve(v); };
    cancel.onclick = () => done(null);
    ok.onclick = () => done({ scoreA: Number(inA.value), scoreB: Number(inB.value) });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) done(null); });
    overlay.append(el("div", { class: "modal-card" },
      el("div", { class: "modal-title" }, "Score du match"),
      el("div", { class: "modal-fields" },
        el("div", { style: "text-align:center" }, el("div", { class: "desc", style: "margin-bottom:6px" }, nameA), inA),
        el("span", { class: "vs" }, "—"),
        el("div", { style: "text-align:center" }, el("div", { class: "desc", style: "margin-bottom:6px" }, nameB), inB)),
      el("div", { class: "modal-actions" }, cancel, ok)));
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
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
  search.addEventListener("blur", () => setTimeout(close, 150));
  wrap.append(btn, panel);
  return wrap;
}

function skeletonCards(n = 3) {
  const w = el("div");
  for (let i = 0; i < n; i++) {
    w.append(el("div", { class: "card" }, el("div", { class: "skel skel-title" }), el("div", { class: "skel skel-line" }), el("div", { class: "skel skel-line short" })));
  }
  return w;
}

function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  localStorage.setItem("bh_theme", theme);
}

// Presets de couleurs d'accent (override des variables CSS).
const ACCENT_PRESETS = {
  violet: { a: "#7c5cff", b: "#4ea1ff" },
  bleu: { a: "#4ea1ff", b: "#2ecc71" },
  rouge: { a: "#ff4d5e", b: "#ff8a3d" },
  or: { a: "#f1c40f", b: "#ff8a3d" },
  vert: { a: "#2ecc71", b: "#4ea1ff" },
  rose: { a: "#ff5ca8", b: "#7c5cff" },
};

function applyAccent(name) {
  const p = ACCENT_PRESETS[name] || ACCENT_PRESETS.violet;
  const root = document.documentElement.style;
  root.setProperty("--accent", p.a);
  root.setProperty("--accent-2", p.b);
  root.setProperty("--accent-grad", `linear-gradient(135deg, ${p.a}, ${p.b})`);
  localStorage.setItem("bh_accent", name);
}

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

// ----- Navigation -----
// Regroupée en sections logiques (un intitulé par groupe dans la sidebar).
const NAV_GROUPS = [
  { label: "Général", items: [
    { id: "overview", label: "Vue d'ensemble", ico: "📊" },
    { id: "stats", label: "Statistiques", ico: "📈" },
    { id: "metrics", label: "Fiabilité API", ico: "📡" },
    { id: "logs", label: "Logs en direct", ico: "📜" },
    { id: "announce", label: "Annonces", ico: "📢" },
    { id: "reminders", label: "Rappels auto", ico: "🔔" },
    { id: "settings", label: "Réglages généraux", ico: "⚙️" },
  ] },
  { label: "Engagement", items: [
    { id: "welcome", label: "Bienvenue", ico: "👋" },
    { id: "levels", label: "Niveaux", ico: "⭐" },
    { id: "guessrank", label: "Devine ton rang", ico: "🏅" },
    { id: "giveaway", label: "Giveaway", ico: "🎉" },
  ] },
  { label: "Contenu & modération", items: [
    { id: "tiktok", label: "TikTok", ico: "📱" },
    { id: "clips", label: "Clips", ico: "🎬" },
    { id: "combos", label: "Combos", ico: "🥊" },
    { id: "tickets", label: "Tickets", ico: "🎫" },
  ] },
  { label: "Vocal", items: [
    { id: "tempvoice", label: "Vocaux temporaires", ico: "🔊" },
    { id: "vocrank", label: "Vocaux par rank", ico: "🎙️" },
  ] },
  { label: "Compétition", items: [
    { id: "tournament", label: "Tournoi", ico: "🏆" },
  ] },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items);

function renderApp() {
  $("#loading").style.display = "none";
  $("#app").classList.add("active");
  $("#guild-name").textContent = GUILD.name;
  $("#user-name").textContent = ME.username;
  if (ME.avatar) $("#user-avatar").src = ME.avatar;

  // Hooks globaux (une seule fois) : détection des modifications + menu mobile.
  if (!appHooked) {
    appHooked = true;
    $("#content").addEventListener("input", () => setDirty(true));
    $("#content").addEventListener("change", () => setDirty(true));
    const tgl = el("button", { class: "menu-toggle", onclick: () => $(".sidebar").classList.toggle("open") }, "☰ Menu");
    document.body.append(tgl);
    // Bouton thème clair/sombre dans la sidebar.
    const themeBtn = el("button", { class: "theme-toggle" });
    const syncTheme = () => (themeBtn.textContent = document.body.classList.contains("light") ? "🌙 Mode sombre" : "☀️ Mode clair");
    themeBtn.onclick = () => { applyTheme(document.body.classList.contains("light") ? "dark" : "light"); syncTheme(); };
    syncTheme();
    $(".sidebar-foot").append(themeBtn);

    // Presets de couleurs d'accent (pastilles cliquables).
    const accentRow = el("div", { class: "accent-row" });
    for (const name of Object.keys(ACCENT_PRESETS)) {
      const p = ACCENT_PRESETS[name];
      const dot = el("button", {
        class: "accent-dot",
        title: name,
        style: `background:linear-gradient(135deg, ${p.a}, ${p.b})`,
        onclick: () => applyAccent(name),
      });
      accentRow.append(dot);
    }
    $(".sidebar-foot").append(accentRow);

    // Garde-fou : avertit avant de quitter/recharger la page si des modifications
    // ne sont pas enregistrées (la navigation interne est déjà protégée par confirmModal).
    window.addEventListener("beforeunload", (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });

    // Raccourci Ctrl/Cmd+S : déclenche le bouton « Enregistrer » de la section active.
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        const saveBtn = $("#content .btn-save:not(:disabled)");
        if (saveBtn) {
          e.preventDefault();
          saveBtn.click();
        }
      }
    });
  }

  const nav = $("#nav");
  nav.innerHTML = "";
  const makeNavItem = (item) =>
    el(
      "button",
      {
        class: "nav-item" + (item.id === current ? " active" : ""),
        onclick: async () => {
          if (dirty && !(await confirmModal("Tu as des modifications non enregistrées. Changer de section quand même ?", { okLabel: "Quitter sans enregistrer", danger: true }))) return;
          setDirty(false);
          current = item.id;
          $(".sidebar").classList.remove("open");
          renderApp();
        },
      },
      el("span", { class: "ico" }, item.ico),
      item.label,
    );
  for (const group of NAV_GROUPS) {
    nav.append(el("div", { class: "nav-group" }, group.label));
    for (const item of group.items) nav.append(makeNavItem(item));
  }
  renderSection(current);
}

// ----- Sources de listes -----
const channelOpts = (kind) => {
  if (kind === "textann" || kind === "text") return [...GUILD.channels.text, ...GUILD.channels.announcement];
  if (kind === "textvoice") return [...GUILD.channels.text, ...GUILD.channels.announcement, ...GUILD.channels.voice];
  return GUILD.channels[kind] || [];
};

// ----- Rendu de champs génériques -----
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
  const i = el("input", { type: "color", value: cfg[key] || "#7c5cff", style: "width:54px;height:40px;padding:4px;cursor:pointer" });
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
    for (const id of cfg[key]) {
      const r = GUILD.roles.find((x) => x.id === id);
      tags.append(
        el("span", { class: "tag" }, "@ " + (r ? r.name : id),
          el("button", { onclick: () => { cfg[key] = cfg[key].filter((x) => x !== id); redraw(); } }, "✕")),
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
    for (const id of cfg[key]) {
      const c = channelOpts(kind).find((x) => x.id === id);
      tags.append(
        el("span", { class: "tag" }, "# " + (c ? c.name : id),
          el("button", { onclick: () => { cfg[key] = cfg[key].filter((x) => x !== id); redraw(); } }, "✕")),
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
      pal.append(el("img", { src: e.url, title: e.name, onclick: () => { input.value = (input.value.trim() + " " + e.token).trim() + " "; sync(); } }));
    }
    wrap.append(el("div", { class: "desc", style: "margin-top:8px" }, "Clique un emoji du serveur pour l'ajouter :"), pal);
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
    for (const [lvl, roleId] of Object.entries(cfg.rewards).sort((a, b) => +a[0] - +b[0])) {
      const lvlIn = el("input", { class: "lvl", type: "number", value: lvl, min: 1 });
      const rSel = roleSelect({ v: roleId }, "v", false);
      const apply = () => {
        delete cfg.rewards[lvl];
        if (lvlIn.value) cfg.rewards[String(parseInt(lvlIn.value, 10))] = rSel.value;
      };
      lvlIn.addEventListener("change", () => { apply(); redraw(); });
      rSel.addEventListener("change", () => (cfg.rewards[String(parseInt(lvlIn.value, 10))] = rSel.value));
      list.append(
        el("div", { class: "reward-row" }, lvlIn, rSel,
          el("button", { class: "icon-btn", onclick: () => { delete cfg.rewards[lvl]; redraw(); } }, "🗑")),
      );
    }
  };
  const addBtn = el("button", { class: "btn-add", onclick: () => {
    let n = 5; while (cfg.rewards[n]) n += 5;
    cfg.rewards[n] = (GUILD.roles[0] && GUILD.roles[0].id) || "";
    redraw();
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
    for (const [chId, h] of Object.entries(cfg.hubs)) {
      const c = GUILD.channels.voice.find((x) => x.id === chId);
      const nameIn = el("input", { type: "text", value: h.nameTemplate || "🎮 {user}", placeholder: "{user} 1v1" });
      const limitIn = el("input", { type: "number", value: h.userLimit || 0, min: 0, max: 99, style: "max-width:90px" });
      nameIn.addEventListener("input", () => (cfg.hubs[chId].nameTemplate = nameIn.value));
      limitIn.addEventListener("change", () => (cfg.hubs[chId].userLimit = Number(limitIn.value)));
      list.append(
        el("div", { class: "hub-row", style: "flex-wrap:wrap" },
          el("span", { class: "tag" }, "🔊 " + (c ? c.name : chId)),
          nameIn, limitIn,
          el("button", { class: "icon-btn", onclick: () => { delete cfg.hubs[chId]; redraw(); } }, "🗑")),
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
  wrap.append(list, el("div", { style: "margin-top:8px" }, addSel));
  return wrap;
}

// Liste de messages de rappel : un textarea par message + ajout/suppression.
function messagesEditor(cfg, key) {
  cfg[key] = Array.isArray(cfg[key]) ? cfg[key] : [];
  const wrap = el("div", { style: "width:100%" });
  const list = el("div");
  const redraw = () => {
    list.innerHTML = "";
    cfg[key].forEach((msg, i) => {
      const t = el("textarea", { placeholder: "🎙️ Vocaux privés : rejoins le salon..." });
      t.value = msg || "";
      t.addEventListener("input", () => (cfg[key][i] = t.value));
      const del = el("button", { class: "icon-btn", onclick: () => { cfg[key].splice(i, 1); redraw(); } }, "🗑");
      list.append(
        el("div", { class: "msg-row", style: "display:flex;gap:8px;align-items:flex-start;margin-bottom:8px" },
          el("span", { class: "tag", style: "margin-top:6px" }, "#" + (i + 1)),
          el("div", { style: "flex:1" }, t),
          del),
      );
    });
  };
  const addBtn = el("button", { class: "btn-add", onclick: () => {
    if (cfg[key].length >= 25) return toast("Maximum 25 messages.", "err");
    cfg[key].push("");
    redraw();
  } }, "+ Ajouter un message");
  redraw();
  wrap.append(list, addBtn);
  return wrap;
}
function sectionSchema(id, cfg) {
  switch (id) {
    case "settings":
      return {
        title: "⚙️ Réglages généraux",
        sub: "Salons système (validation, audit, annonces, alertes) et validation des liaisons Brawlhalla.",
        cards: [
          { title: "Salons & rôles", fields: [
            ["Salon de validation", "Où arrivent les demandes de liaison à valider.", channelSelect(cfg, "reviewChannelId", "text")],
            ["Rôle validateur", "Rôle autorisé à valider/refuser (sinon permission Gérer le serveur).", roleSelect(cfg, "reviewerRoleId")],
            ["Salon d'audit (logs)", "Journal des actions du bot.", channelSelect(cfg, "auditChannelId", "text")],
            ["Salon des annonces", "Annonces de montée de rang.", channelSelect(cfg, "announceChannelId", "text")],
            ["Salon d'alertes (santé du bot)", "Crash, déconnexion Discord, API down. Vide = salon d'audit.", channelSelect(cfg, "alertChannelId", "text")],
            ["Salon des succès", "Annonces des achievements débloqués (sans ping). Vide = désactivé.", channelSelect(cfg, "achievementsChannelId", "text")],
            ["Seuil d'auto-validation", "Tout ce qui est ≤ ce tier est validé automatiquement.", selectInput(cfg, "autoApproveTier", GUILD.tiers.map((t) => ({ value: t, label: t })))],
            ["Rang exigeant l'ID (pas de pseudo)", "À partir de ce tier (inclus), la liaison par pseudo est refusée : le joueur doit utiliser son Brawlhalla ID (la recherche par pseudo est peu fiable pour les hauts rangs).", selectInput(cfg, "idRequiredTier", GUILD.tiers.map((t) => ({ value: t, label: t })))],
          ] },
          { title: "Validation par preuve (hauts rangs)", sub: "À partir du rang choisi, un fil privé est créé : le joueur y poste une capture de sa page de profil en jeu (ID + pseudo visibles), le staff valide depuis ce fil.", fields: [
            ["Preuve obligatoire", "Active la demande de capture d'écran pour les hauts rangs.", toggle(cfg, "requireProofScreenshot")],
            ["Rang exigeant une preuve", "À partir de ce tier (inclus), une capture est demandée.", selectInput(cfg, "proofTier", GUILD.tiers.map((t) => ({ value: t, label: t })))],
            ["Salon des fils de preuve", "⚠️ Doit être VISIBLE par les membres (sinon ils ne peuvent pas être ajoutés au fil privé). Vide = salon où /lier est lancé. Le staff doit avoir « Gérer les fils » pour les voir.", channelSelect(cfg, "proofChannelId", "text")],
          ] },
        ],
      };
    case "levels":
      return {
        title: "⭐ Système de niveaux",
        sub: "XP en discutant et en vocal, rôles de récompense.",
        cards: [
          { title: "Général", fields: [
            ["Activé", "Active le gain d'XP.", toggle(cfg, "enabled")],
            ["Annonces", "Où annoncer les montées de niveau.", selectInput(cfg, "announceMode", [{ value: "channel", label: "Salon" }, { value: "dm", label: "Message privé" }, { value: "off", label: "Désactivées" }])],
            ["Salon d'annonce", "Si mode Salon (vide = salon du message).", channelSelect(cfg, "announceChannelId", "text")],
          ] },
          { title: "XP", fields: [
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
          ], extra: el("div", {}, el("div", { class: "card-sub" }, "🚫 Salons sans XP (texte ou vocal)"), multiChannel(cfg, "noXpChannels", "textvoice")) },
          { title: "Récompenses", sub: "Rôle attribué à chaque palier de niveau.", fields: [
            ["Cumuler les rôles", "Oui = garde tous les paliers. Non = seulement le plus haut.", toggle(cfg, "stackRewards")],
          ], extra: rewardsEditor(cfg) },
        ],
      };
    case "tiktok":
      return {
        title: "📱 Notifications TikTok",
        sub: "Poste les nouvelles vidéos d'un compte (via flux RSS).",
        cards: [
          { title: "Configuration", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["URL du flux RSS", "Généré par rss.app, GitHub Pages, etc.", textInput(cfg, "feedUrl", "https://...")],
            ["Pseudo affiché", "Sans le @.", textInput(cfg, "username", "kayagoldforged")],
            ["Photo de profil (URL)", "Affichée à côté du pseudo.", textInput(cfg, "avatarUrl", "https://...")],
            ["Message d'annonce", "Phrase postée avec la vidéo. {pseudo} = nom affiché, {url} = lien. Vide = phrase par défaut.", textareaInput(cfg, "message", "Nouvelle vidéo de {pseudo} va la voir tout de suite ! <:Emoji_Wow_Metadev:1513693924814880879>")],
            ["Date de la vidéo", "Affiche « TikTok • date/heure » en bas de l'embed.", toggle(cfg, "showDate")],
            ["Salon", "Où poster les vidéos.", channelSelect(cfg, "channelId", "text")],
            ["Rôle à ping", "Optionnel.", roleSelect(cfg, "roleId")],
            ["Intervalle (min)", "Fréquence de vérification (min. 2).", numberInput(cfg, "pollIntervalMin", 2)],
          ] },
        ],
      };
    case "clips":
      return {
        title: "🎬 Réactions sur les clips",
        sub: "Réagit aux clips vidéo et modère le salon.",
        cards: [
          { title: "Configuration", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Vidéos uniquement", "Ne réagit qu'aux messages avec une vidéo.", toggle(cfg, "requireVideo")],
            ["Supprimer les non-vidéos", "Efface les messages sans vidéo (besoin de Gérer les messages).", toggle(cfg, "deleteNonVideo")],
            ["Ignorer les bots", "", toggle(cfg, "ignoreBots")],
            ["Ignorer les réponses", "", toggle(cfg, "ignoreReplies")],
            ["Épingler à partir de (réactions)", "Épingle le clip quand une réaction atteint ce nombre (0 = off). La réaction du bot compte.", numberInput(cfg, "pinThreshold", 0)],
          ] },
          { title: "Salons surveillés", fields: [], extra: multiChannel(cfg, "channelIds", "textann") },
          { title: "Réactions", fields: [], extra: reactionsEditor(cfg, "reactions") },
          { title: "Domaines vidéo acceptés en plus", fields: [], extra: domainsEditor(cfg, "extraDomains") },
        ],
      };
    case "guessrank":
      return {
        title: "🏅 Devine ton rang",
        sub: "Réactions emojis de rank pour voter le rang du joueur.",
        cards: [
          { title: "Configuration", fields: [
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
        title: "🔊 Vocaux temporaires",
        sub: "Rejoindre un hub crée un salon perso supprimé quand vide.",
        cards: [
          { title: "Général", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Catégorie des salons créés", "Vide = celle de chaque hub.", channelSelect(cfg, "categoryId", "category")],
          ] },
          { title: "Hubs (rejoindre pour créer)", sub: "{user} = pseudo du membre.", fields: [], extra: hubsEditor(cfg) },
        ],
      };
    case "reminders":
      return {
        title: "🔔 Rappels automatiques",
        sub: "Le bot poste régulièrement un message d'une liste dans un salon (vocaux privés, règles, liens utiles...).",
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
  }
}

// ----- Rendu d'une section -----
function renderSection(id) {
  const content = $("#content");
  content.innerHTML = "";
  setDirty(false);
  if (logTimer) { clearInterval(logTimer); logTimer = null; }

  if (id === "overview") return renderOverview(content);
  if (id === "stats") return renderStats(content);
  if (id === "metrics") return renderMetrics(content);
  if (id === "logs") return renderLogs(content);
  if (id === "announce") return renderAnnounce(content);
  if (id === "welcome") return renderWelcome(content);
  if (id === "vocrank") return renderVocRank(content);
  if (id === "tournament") return renderTournament(content);
  if (id === "combos") return renderCombos(content);
  if (id === "tickets") return renderTickets(content);
  if (id === "giveaway") return renderGiveaway(content);

  const cfg = structuredClone(CONFIG[id] || {});
  const schema = sectionSchema(id, cfg);

  content.append(
    el("div", { class: "page-head" }, el("h2", { html: schema.title }), schema.sub ? el("p", {}, schema.sub) : null),
  );

  for (const card of schema.cards) {
    const c = el("div", { class: "card" }, el("h3", {}, card.title));
    if (card.sub) c.append(el("div", { class: "card-sub" }, card.sub));
    for (const [label, desc, control] of card.fields) c.append(fieldRow(label, desc, control));
    if (card.extra) c.append(card.extra);
    content.append(c);
  }

  const btn = el("button", { class: "btn-save" }, "💾 Enregistrer");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
      setDirty(false);
      toast("Modifications enregistrées ✅", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });

  const barItems = [];
  // Bouton de test pour TikTok : enregistre la config puis poste la derniere video.
  if (id === "tiktok") {
    const test = el("button", { class: "btn-save", style: "background:var(--surface-3);box-shadow:none" }, "🧪 Envoyer un test");
    test.addEventListener("click", async () => {
      test.disabled = true;
      try {
        CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
        setDirty(false);
        await api("/api/tiktok/test", "POST", {});
        toast("Test envoyé dans le salon ✅", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      test.disabled = false;
    });
    barItems.push(test);
  }
  // Bouton de test pour les Rappels : enregistre puis poste immediatement le prochain rappel.
  if (id === "reminders") {
    const test = el("button", { class: "btn-save", style: "background:var(--surface-3);box-shadow:none" }, "🧪 Envoyer un rappel test");
    test.addEventListener("click", async () => {
      test.disabled = true;
      try {
        CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
        setDirty(false);
        await api("/api/reminders/test", "POST", {});
        toast("Rappel envoyé dans le salon ✅", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      test.disabled = false;
    });
    barItems.push(test);
  }
  // Bouton de test pour les Niveaux : enregistre puis poste un apercu (niveau simple + palier).
  if (id === "levels") {
    const test = el("button", { class: "btn-save", style: "background:var(--surface-3);box-shadow:none" }, "🧪 Aperçu level up");
    test.addEventListener("click", async () => {
      test.disabled = true;
      try {
        CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
        setDirty(false);
        await api("/api/levels/test", "POST", {});
        toast("Aperçu envoyé ✅", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      test.disabled = false;
    });
    barItems.push(test);
  }
  barItems.push(btn);
  content.append(el("div", { class: "save-bar" }, ...barItems));
}

// ----- Vocaux par rank -----
function renderVocRank(content) {
  setDirty(false);
  const state = { categoryId: "", rangMin: "Bronze", limite: 0 };

  content.append(
    el("div", { class: "page-head" },
      el("h2", { html: "🎙️ Vocaux par rank" }),
      el("p", {}, "Crée un salon vocal par rank. L'accès est vérifié par le bot : impossible de tricher."),
    ),
  );

  const card = el("div", { class: "card" }, el("h3", {}, "Configuration"));
  card.append(fieldRow("Catégorie", "Où créer les vocaux de rank.", channelSelect(state, "categoryId", "category", false)));
  card.append(
    fieldRow(
      "Rang minimum",
      "Le rank le plus bas à créer. Les rangs supérieurs accèdent aussi aux vocaux inférieurs.",
      selectInput(state, "rangMin", GUILD.tiers.map((t) => ({ value: t, label: t }))),
    ),
  );
  card.append(fieldRow("Limite par vocal", "Nombre max de membres (0 = illimité).", numberInput(state, "limite", 0, 99)));
  card.append(
    el("div", { class: "card-sub", style: "margin-top:12px" },
      "Seuls les membres ayant un rôle de rank égal ou supérieur peuvent rejoindre (Valhallan accède à tout). " +
        "Comme les rôles viennent de /lier (vérifié via l'API), personne ne peut mytho, et un membre non lié n'entre nulle part.",
    ),
  );
  content.append(card);

  const btn = el("button", { class: "btn-save" }, "🎙️ Créer / Mettre à jour les vocaux");
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
      toast(r.message || "Vocaux prêts ✅", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });
  content.append(el("div", { class: "save-bar" }, btn));
}

// ----- Page Combos (admin) -----
async function renderCombos(content) {
  content.append(
    el("div", { class: "page-head" },
      el("h2", { html: "🥊 Combos Brawlhalla" }),
      el("p", {}, "Base de true combos (source BrawlDatabase) que les membres parcourent via /combos.")),
  );

  const card = el("div", { class: "card" }, el("h3", {}, "Base de données"));
  const body = el("div", { class: "card-sub" }, "Chargement…");
  card.append(body);

  const upd = el("button", { class: "tbtn", style: "margin-top:14px" }, "🔄 Mettre à jour la base");
  upd.addEventListener("click", async () => {
    upd.disabled = true;
    const old = upd.textContent;
    upd.textContent = "⏳ Récupération depuis BrawlDB…";
    try {
      const r = await api("/api/combos/refresh", "POST", {});
      toast(`Base mise à jour : ${r.count} combos ✅`, "ok");
      renderSection("combos");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
      upd.disabled = false;
      upd.textContent = old;
    }
  });
  card.append(el("div", {}, upd));
  content.append(card);

  // Publier le panneau interactif dans un salon
  const pubState = { channelId: "" };
  const pubCard = el("div", { class: "card" },
    el("h3", {}, "Publier le panneau"),
    el("div", { class: "card-sub" }, "Poste un panneau /combos interactif dans un salon : les membres choisissent l'arme et parcourent les combos (vidéo intégrée)."));
  pubCard.append(fieldRow("Salon", "", channelSelect(pubState, "channelId", "textann")));
  const pub = el("button", { class: "tbtn primary", style: "margin-top:6px" }, "📌 Publier le panneau");
  pub.addEventListener("click", async () => {
    if (!pubState.channelId) return toast("Choisis un salon.", "err");
    pub.disabled = true;
    try {
      await api("/api/combos/publish", "POST", { channelId: pubState.channelId });
      setDirty(false);
      toast("Panneau publié ✅", "ok");
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
      el("div", { style: "font-size:15px" }, el("b", {}, String(info.count)), ` combos · ${Object.keys(info.byWeapon || {}).length} armes`),
      el("div", { class: "card-sub", style: "margin-top:4px" }, "Dernière mise à jour : " + date),
    );
  } catch (e) {
    body.textContent = "Erreur : " + e.message;
  }
}

// ----- Éditeur de motifs de tickets (options du menu déroulant) -----
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
          el("button", { class: "icon-btn", onclick: () => { cfg.topics.splice(i, 1); redraw(); setDirty(true); } }, "🗑")),
      );
    });
    if (!cfg.topics.length) {
      list.append(el("div", { class: "card-sub" }, "Aucun motif : un simple bouton « Ouvrir un ticket » s'affichera."));
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

// ----- Page Tickets (admin) -----
function renderTickets(content) {
  const cfg = structuredClone(CONFIG.tickets || {});
  if (!Array.isArray(cfg.topics)) cfg.topics = [];

  content.append(
    el("div", { class: "page-head" },
      el("h2", { html: "🎫 Tickets de support" }),
      el("p", {}, "Panneau de support : les membres ouvrent un salon privé avec le staff via un menu déroulant de motifs.")),
  );

  // Configuration de base
  const c1 = el("div", { class: "card" }, el("h3", {}, "Configuration"));
  c1.append(fieldRow("Activé", "Active la création de tickets via le panneau.", toggle(cfg, "enabled")));
  c1.append(fieldRow("Catégorie des tickets", "Où sont créés les salons de ticket.", channelSelect(cfg, "categoryId", "category")));
  c1.append(fieldRow("Rôle staff", "Voit et gère tous les tickets (prise en charge, fermeture).", roleSelect(cfg, "staffRoleId")));
  c1.append(fieldRow("Salon des transcripts", "Reçoit le .txt + récap à la fermeture (optionnel).", channelSelect(cfg, "logChannelId", "text")));
  content.append(c1);

  // Apparence du panneau
  const c2 = el("div", { class: "card" }, el("h3", {}, "Apparence du panneau"));
  c2.append(fieldRow("Titre", "", textInput(cfg, "panelTitle", "🎫 Support & Tickets")));
  c2.append(fieldRow("Description", "Texte principal de l'embed.", textareaInput(cfg, "panelDescription", "Besoin d'aide ? Ouvre un ticket via le menu ci-dessous.")));
  c2.append(fieldRow("Couleur", "Couleur de la barre de l'embed.", colorInput(cfg, "panelColor")));
  c2.append(fieldRow("Image bannière (URL)", "Grande image affichée en bas de l'embed.", textInput(cfg, "bannerUrl", "https://…")));
  c2.append(fieldRow("Vignette / logo (URL)", "Petite image en haut à droite.", textInput(cfg, "thumbnailUrl", "https://…")));
  c2.append(fieldRow("À lire avant d'ouvrir", "Instructions affichées dans l'embed (une ligne par règle).", textareaInput(cfg, "rulesText", "• Explique ton problème directement\n• Reste respectueux et patient\n• Pas de ticket pour rien")));
  c2.append(fieldRow("Titre section « Étapes »", "Titre du bloc des instructions (mets l'emoji que tu veux).", textInput(cfg, "rulesTitle", "📋 Étapes à suivre")));
  c2.append(fieldRow("Titre section « Options »", "Titre du bloc listant les motifs.", textInput(cfg, "optionsTitle", "🎫 Options de ticket")));
  c2.append(fieldRow("Texte de bas de panneau", "Phrase juste au-dessus du menu déroulant.", textInput(cfg, "footerText", "🚀 Choisis un motif dans le menu ci-dessous pour ouvrir un ticket.")));
  c2.append(fieldRow("Lien Terms of Service", "Affiché comme lien dans la description (optionnel).", textInput(cfg, "tosUrl", "https://…")));
  c2.append(fieldRow("Texte du menu déroulant", "Placeholder affiché sur le menu de motifs.", textInput(cfg, "selectPlaceholder", "Choisis un motif")));
  content.append(c2);

  // Embed affiché DANS le salon de ticket créé
  const cTicket = el("div", { class: "card" },
    el("h3", {}, "Message du ticket créé"),
    el("div", { class: "card-sub" }, "Embed posté dans le salon privé à l'ouverture (titre, message d'accueil, infos). La vignette et la couleur sont reprises de l'apparence ci-dessus."));
  cTicket.append(fieldRow("Titre du ticket", "", textInput(cfg, "ticketTitle", "🎫 Support Ticket")));
  cTicket.append(fieldRow("Message d'accueil", "Affiché en haut du ticket. Le lien Terms of Service est ajouté automatiquement s'il est défini.", textareaInput(cfg, "ticketWelcome", "Merci de patienter, un membre du staff va prendre en charge ton ticket.")));
  cTicket.append(fieldRow("Informations complémentaires", "Bloc « Informations » par défaut (un motif peut le remplacer par son propre message).", textareaInput(cfg, "ticketInfo", "")));
  content.append(cTicket);

  // Motifs (options du menu déroulant)
  const c3 = el("div", { class: "card" },
    el("h3", {}, "Motifs du menu déroulant"),
    el("div", { class: "card-sub" }, "Chaque motif = une option du menu (emoji + nom + description). Le 4ᵉ champ « message » s'affiche à l'ouverture du ticket pour ce motif (ex : réponse auto). Ex : Buy, Support, Replace."));
  c3.append(topicsEditor(cfg));
  content.append(c3);

  // Publier le panneau
  const pubState = { channelId: "" };
  const c4 = el("div", { class: "card" },
    el("h3", {}, "Publier le panneau"),
    el("div", { class: "card-sub" }, "Enregistre tes réglages, puis publie le panneau de tickets dans un salon."));
  c4.append(fieldRow("Salon", "", channelSelect(pubState, "channelId", "textann")));
  const pub = el("button", { class: "tbtn primary", style: "margin-top:6px" }, "📌 Publier le panneau");
  pub.addEventListener("click", async () => {
    if (!pubState.channelId) return toast("Choisis un salon.", "err");
    pub.disabled = true;
    try {
      CONFIG.tickets = await api("/api/config/tickets", "PUT", cfg);
      setDirty(false);
      await api("/api/tickets/publish", "POST", { channelId: pubState.channelId });
      toast("Panneau publié ✅", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    pub.disabled = false;
  });
  c4.append(el("div", {}, pub));
  content.append(c4);

  // Enregistrer
  const btn = el("button", { class: "btn-save" }, "💾 Enregistrer");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      CONFIG.tickets = await api("/api/config/tickets", "PUT", cfg);
      setDirty(false);
      toast("Modifications enregistrées ✅", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });
  content.append(el("div", { class: "save-bar" }, btn));
}

// ----- Page Giveaway (admin) -----
let gwTab = "settings";

async function renderGiveaway(content) {
  content.innerHTML = "";
  setDirty(false);
  // cfg partagé entre les onglets : éditer les réglages puis basculer sur « Giveaways »
  // ne perd pas les modifications en cours (elles restent en mémoire jusqu'à l'enregistrement).
  const cfg = structuredClone(CONFIG.giveaway || {});

  content.append(
    el("div", { class: "page-head" },
      el("h2", { html: "🎉 Giveaways" }),
      el("p", {}, "Crée et gère des concours en Components V2. Les gagnants sont tirés au sort automatiquement à l'échéance.")),
  );

  const tabs = [
    { id: "settings", ico: "⚙️", label: "Réglages" },
    { id: "manage", ico: "🎉", label: "Giveaways" },
  ];
  if (!tabs.some((x) => x.id === gwTab)) gwTab = "settings";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === gwTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { gwTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === gwTab));
    body.innerHTML = "";
    if (gwTab === "manage") drawManage();
    else drawSettings();
  }

  // ---- Onglet Réglages ----
  function drawSettings() {
    // Configuration générale
    const c1 = el("div", { class: "card" }, el("h3", {}, "Configuration"));
    c1.append(fieldRow("Activé", "Active le système de giveaways (requis pour en créer).", toggle(cfg, "enabled")));
    c1.append(fieldRow("Salon par défaut", "Salon où sont publiés les giveaways par défaut.", channelSelect(cfg, "defaultChannelId", "textann")));
    c1.append(fieldRow("Rôle pingé", "Mentionné à la publication d'un giveaway (optionnel).", roleSelect(cfg, "pingRoleId")));
    c1.append(fieldRow("Rôle requis", "Seuls les membres ayant ce rôle peuvent participer (optionnel).", roleSelect(cfg, "requiredRoleId")));
    c1.append(fieldRow("MP aux gagnants", "Envoie un message privé à chaque gagnant à la clôture.", toggle(cfg, "dmWinners")));
    body.append(c1);

    // Apparence
    const c2 = el("div", { class: "card" }, el("h3", {}, "Apparence de l'embed"));
    c2.append(fieldRow("Titre", "Affiché en haut du giveaway (mis en majuscules).", textInput(cfg, "embedTitle", "GIVEAWAY")));
    c2.append(fieldRow("Couleur", "Couleur de la barre de l'embed.", colorInput(cfg, "embedColor")));
    c2.append(fieldRow("Bannière (URL)", "Grande image intégrée en haut (optionnel).", textInput(cfg, "bannerUrl", "https://…")));
    c2.append(fieldRow("Texte du bouton", "Libellé du bouton de participation.", textInput(cfg, "buttonLabel", "Participer")));
    c2.append(fieldRow("Emoji du bouton", "Emoji unicode ou custom (<:nom:id>).", textInput(cfg, "buttonEmoji", "🎉")));
    c2.append(fieldRow("Pied de page", "Petite phrase en bas de l'embed.", textInput(cfg, "footerText", "Bonne chance à toutes et à tous ! 🍀")));
    body.append(c2);

    // Messages personnalisables
    const c3 = el("div", { class: "card" },
      el("h3", {}, "Messages des gagnants"),
      el("div", { class: "card-sub" }, "Personnalise les messages envoyés à la clôture. Placeholders : <code>{winners}</code> (mentions), <code>{prize}</code>, <code>{count}</code> (participants), <code>{host}</code> (organisateur)."));
    c3.append(fieldRow("Annonce des gagnants", "Message posté dans le salon quand il y a des gagnants.", textareaInput(cfg, "winnerAnnounce", "🎉 Félicitations {winners} ! Vous remportez **{prize}** 🏆")));
    c3.append(fieldRow("Message privé au gagnant", "MP envoyé à chaque gagnant (si « MP aux gagnants » est activé).", textareaInput(cfg, "winnerDm", "🎉 Tu as gagné **{prize}** dans le giveaway !")));
    c3.append(fieldRow("Aucun participant", "Message posté si personne n'a participé.", textareaInput(cfg, "noWinnerMessage", "😢 Le giveaway **{prize}** se termine sans participant. Aucun gagnant.")));
    body.append(c3);

    const saveBtn = el("button", { class: "btn-save" }, "💾 Enregistrer");
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try {
        CONFIG.giveaway = await api("/api/config/giveaway", "PUT", cfg);
        setDirty(false);
        toast("Réglages enregistrés ✅", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      saveBtn.disabled = false;
    });
    body.append(el("div", { class: "save-bar" }, saveBtn));
  }

  // ---- Onglet Giveaways (création + liste) ----
  function drawManage() {
    // Créer un giveaway
    const form = { prize: "", description: "", duration: cfg.defaultDuration || "24h", winnersCount: cfg.defaultWinners || 1, channelId: cfg.defaultChannelId || "" };
    const c1 = el("div", { class: "card" },
      el("h3", {}, "🎉 Lancer un giveaway"),
      el("div", { class: "card-sub" }, "Enregistre d'abord tes réglages (onglet Réglages), puis lance un concours. Durée : 30m, 2h, 1d, 1w (combinable : 1d12h)."));
    c1.append(fieldRow("Récompense", "Ce que les gagnants remportent.", textInput(form, "prize", "Nitro classique 1 mois")));
    c1.append(fieldRow("Description", "Texte additionnel affiché dans l'embed (optionnel).", textareaInput(form, "description", "Détails, conditions, etc.")));
    c1.append(fieldRow("Durée", "Ex : 30m, 2h, 1d, 1w.", textInput(form, "duration", "24h")));
    c1.append(fieldRow("Nombre de gagnants", "Combien de gagnants tirer au sort.", numberInput(form, "winnersCount", 1, 50)));
    c1.append(fieldRow("Salon", "Où publier (vide = salon par défaut).", channelSelect(form, "channelId", "textann")));
    const createBtn = el("button", { class: "tbtn primary", style: "margin-top:6px" }, "🎉 Lancer le giveaway");
    createBtn.addEventListener("click", async () => {
      if (!form.prize || !form.prize.trim()) return toast("Indique une récompense.", "err");
      createBtn.disabled = true;
      try {
        CONFIG.giveaway = await api("/api/config/giveaway", "PUT", cfg);
        await api("/api/giveaway/create", "POST", {
          prize: form.prize,
          description: form.description,
          duration: form.duration,
          winnersCount: Number(form.winnersCount) || 1,
          channelId: form.channelId || undefined,
        });
        setDirty(false);
        toast("Giveaway lancé 🎉", "ok");
        loadList();
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      createBtn.disabled = false;
    });
    c1.append(el("div", {}, createBtn));
    body.append(c1);

    // Liste + bouton refresh (recharge la liste sans recharger toute la page)
    const listCard = el("div", { class: "card" });
    const refreshBtn = el("button", { class: "tbtn", title: "Rafraîchir la liste et les participants" }, "🔄 Rafraîchir");
    refreshBtn.addEventListener("click", () => loadList());
    listCard.append(
      el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap" },
        el("h3", { style: "margin:0" }, "Giveaways en cours"),
        refreshBtn),
    );
    const listWrap = el("div", { style: "margin-top:6px" }, el("div", { class: "card-sub" }, "Chargement…"));
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
      const info = el("div", {},
        el("div", { style: "font-weight:600" }, `🎁 ${g.prize}`),
        el("div", { class: "desc", style: "margin-top:4px" }, meta.join(" · ")));
      const head = el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap" }, info);
      const actions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });

      if (g.status === "active") {
        head.append(el("span", { class: "tag" }, `Fin : ${fmtDate(g.endsTs)}`));
        const endBtn = el("button", { class: "tbtn" }, "🏁 Terminer");
        endBtn.addEventListener("click", async () => {
          if (!(await confirmModal(`Terminer le giveaway <b>${g.prize}</b> maintenant ?`, { okLabel: "Terminer" }))) return;
          endBtn.disabled = true;
          try { await api("/api/giveaway/end", "POST", { id: g.id }); toast("Giveaway terminé 🏁", "ok"); loadList(); }
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
        head.append(el("span", { class: "tag" }, label));
        if (g.winnerIds && g.winnerIds.length) {
          info.append(el("div", { class: "desc", style: "margin-top:4px" }, `🥳 Gagnant(s) : ${g.winnerIds.map((w) => "<@" + w + ">").join(", ")}`));
        }
        if (g.status === "ended") {
          const rerollBtn = el("button", { class: "tbtn" }, "🔁 Reroll");
          rerollBtn.addEventListener("click", async () => {
            rerollBtn.disabled = true;
            try { const r = await api("/api/giveaway/reroll", "POST", { id: g.id }); toast("Reroll : " + (r.winners || []).length + " nouveau(x) gagnant(s) 🔁", "ok"); }
            catch (e) { toast("Erreur : " + e.message, "err"); }
            rerollBtn.disabled = false;
          });
          actions.append(rerollBtn);
        }
      }
      return el("div", { class: "card", style: "background:var(--surface-2);margin-top:10px" }, head, actions.children.length ? el("div", { style: "margin-top:10px" }, actions) : null);
    };

    async function loadList() {
      refreshBtn.disabled = true;
      let data;
      try {
        data = await api("/api/giveaway/list");
      } catch (e) {
        listWrap.innerHTML = "";
        listWrap.append(el("div", { class: "card-sub" }, "Erreur : " + e.message));
        refreshBtn.disabled = false;
        return;
      }
      listWrap.innerHTML = "";
      if (data.active.length) {
        for (const g of data.active) listWrap.append(gwRow(g));
      } else {
        listWrap.append(el("div", { class: "card-sub" }, "Aucun giveaway en cours."));
      }
      const ended = data.recent.filter((g) => g.status !== "active");
      if (ended.length) {
        listWrap.append(el("h3", { style: "margin-top:18px" }, "Historique récent"));
        for (const g of ended.slice(0, 10)) listWrap.append(gwRow(g));
      }
      refreshBtn.disabled = false;
    }

    loadList();
  }

  draw();
}

function renderOverview(content) {
  const c = CONFIG;
  const stat = (val, lbl) => el("div", { class: "stat" }, el("div", { class: "val", html: val }), el("div", { class: "lbl" }, lbl));
  const onOff = (b) => `<span class="dot ${b ? "on" : "off"}"></span>${b ? "Activé" : "Inactif"}`;
  content.append(
    el("div", { class: "page-head" }, el("h2", { html: "📊 Vue d'ensemble" }), el("p", {}, `${GUILD.name} · ${GUILD.memberCount} membres`)),
    el("div", { class: "stats" },
      stat(onOff(c.levels?.enabled), "Niveaux"),
      stat(onOff(c.tiktok?.enabled), "TikTok"),
      stat(onOff(c.clips?.enabled), "Réactions clips"),
      stat(onOff(c.guessrank?.enabled), "Devine ton rang"),
      stat(onOff(c.tempvoice?.enabled), "Vocaux temporaires"),
      stat(String(Object.keys(c.tempvoice?.hubs || {}).length), "Hubs vocaux"),
      stat(onOff(c.reminders?.enabled), "Rappels auto"),
    ),
    el("div", { class: "card", style: "margin-top:18px" },
      el("h3", {}, "Bienvenue 👋"),
      el("div", { class: "card-sub" }, "Choisis une section à gauche pour tout configurer. Les changements sont appliqués au bot immédiatement après l'enregistrement."),
    ),
  );
}

// ----- Page Statistiques -----
const TIER_PALETTE = {
  Tin: "#9d9d9d", Bronze: "#b08d57", Silver: "#c0c0c0", Gold: "#f1c40f",
  Platinum: "#4aa3a3", Diamond: "#4ea1ff", Valhallan: "#9b59b6", "Non classé": "#5a606b",
};

async function renderStats(content) {
  content.append(el("div", { class: "page-head" }, el("h2", { html: "📈 Statistiques" }), el("p", {}, "Vue d'ensemble de l'activité du serveur.")));
  const loading = el("div", { class: "card" }, el("div", { class: "card-sub" }, "Chargement…"));
  content.append(loading);

  let s;
  try {
    s = await api("/api/stats");
  } catch (e) {
    loading.innerHTML = "";
    loading.append(el("div", { class: "card-sub" }, "Erreur : " + e.message));
    return;
  }
  loading.remove();

  const stat = (val, lbl) => el("div", { class: "stat" }, el("div", { class: "val", html: String(val) }), el("div", { class: "lbl" }, lbl));
  content.append(
    el("div", { class: "stats" },
      stat(s.linkedCount, "Comptes liés"),
      stat(s.memberCount ?? "—", "Membres serveur"),
      stat(s.xp.members, "Membres avec XP"),
      stat(s.xp.totalXp.toLocaleString("fr-FR"), "XP totale"),
      stat(s.xp.topLevel, "Plus haut niveau"),
    ),
  );

  // Répartition par tier 1v1 (camembert via QuickChart).
  const entries = Object.entries(s.tierCounts || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length) {
    const light = document.body.classList.contains("light");
    const legendColor = light ? "#16161c" : "#ccc";
    const bkg = light ? "#ffffff" : "#0a0a0d";
    const chart = {
      type: "doughnut",
      data: {
        labels: entries.map(([t]) => t),
        datasets: [{ data: entries.map(([, n]) => n), backgroundColor: entries.map(([t]) => TIER_PALETTE[t] || "#777") }],
      },
      options: { plugins: { legend: { position: "right", labels: { color: legendColor } } } },
    };
    const url = "https://quickchart.io/chart?bkg=" + encodeURIComponent(bkg) + "&w=520&h=320&c=" + encodeURIComponent(JSON.stringify(chart));
    const card = el("div", { class: "card", style: "margin-top:18px" }, el("h3", {}, "Répartition par tier (1v1)"));
    const img = el("img", { src: url, style: "max-width:100%;border-radius:12px;margin-top:10px" });
    card.append(img);
    content.append(card);
  } else {
    content.append(el("div", { class: "card", style: "margin-top:18px" }, el("div", { class: "card-sub" }, "Aucun compte lié pour l'instant — la répartition par tier apparaîtra ici.")));
  }
}

// ----- Page Logs en direct -----
function renderLogs(content) {
  content.append(el("div", { class: "page-head" }, el("h2", { html: "📜 Logs en direct" }), el("p", {}, "Dernières actions du bot (rafraîchi toutes les 3 s).")));
  const box = el("pre", { class: "logbox" });
  const card = el("div", { class: "card" }, box);
  content.append(card);

  const LEVEL_COLOR = { log: "#c8ccd2", warn: "#f1c40f", error: "#ff6b6b" };
  const draw = (lines) => {
    box.innerHTML = "";
    if (!lines.length) { box.append(el("div", { style: "color:var(--muted)" }, "Aucun log récent.")); return; }
    for (const l of lines) {
      const time = new Date(l.ts).toLocaleTimeString("fr-FR");
      box.append(el("div", { style: `color:${LEVEL_COLOR[l.level] || "#c8ccd2"}` }, `[${time}] ${l.msg}`));
    }
    box.scrollTop = box.scrollHeight;
  };
  const refresh = async () => {
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

// ----- Page Fiabilité API (consomme /api/metrics, rafraîchi toutes les 5 s) -----
function renderMetrics(content) {
  content.append(
    el("div", { class: "page-head" },
      el("h2", { html: "📡 Fiabilité API" }),
      el("p", {}, "Santé de l'API Brawlhalla observée par le bot depuis son démarrage. Rafraîchi toutes les 5 s."),
    ),
  );
  const statsBox = el("div", { class: "stats" });
  const detail = el("div", { class: "card", style: "margin-top:18px" });
  content.append(statsBox, detail);

  const fmtMs = (v) => (v == null ? "—" : v < 60000 ? `${Math.round(v / 1000)} s` : `${Math.floor(v / 60000)} min`);
  const stat = (val, lbl, color) =>
    el("div", { class: "stat" },
      el("div", { class: "val", html: String(val), style: color ? `color:${color}` : null }),
      el("div", { class: "lbl" }, lbl),
    );
  const row = (k, v) =>
    el("div", { class: "field" },
      el("div", {}, el("div", { class: "label" }, k)),
      el("div", { class: "control" }, el("b", {}, String(v))),
    );

  const draw = (m) => {
    const pct = m.meaningful > 0 ? Math.round(m.successRate * 100) : 100;
    const pctColor = pct >= 90 ? "#3fb950" : pct >= 60 ? "#f1c40f" : "#ff6b6b";
    const pending = (m.pendingProfiles || 0) + (m.pendingSearches || 0);

    statsBox.innerHTML = "";
    statsBox.append(
      stat(`${pct}%`, "Taux de succès", pctColor),
      stat((m.requests || 0).toLocaleString("fr-FR"), "Tentatives HTTP"),
      stat((m.retries || 0).toLocaleString("fr-FR"), "Retries"),
      stat(m.cooldownActiveMs > 0 ? `⏳ ${fmtMs(m.cooldownActiveMs)}` : "—", "Cooldown actif", m.cooldownActiveMs > 0 ? "#f1c40f" : null),
      stat(pending, "File de récup", pending > 0 ? "#f1c40f" : null),
      stat((m.index?.count || 0).toLocaleString("fr-FR"), "Index (joueurs)"),
    );

    detail.innerHTML = "";
    detail.append(
      el("h3", {}, "Détail"),
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
      detail.append(
        el("div", { class: "card-sub", style: "margin-top:12px;color:#ff8585" }, `⚠️ Dernière erreur : ${head}${m.lastError.message} (${when})`),
      );
    }
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
      if (e.footerIcon && GUILD.icon) f.append(el("img", { src: GUILD.icon, class: "pe-footer-ico" }));
      f.append(document.createTextNode(previewVars(e.footer)));
      body.append(f);
    }
    embed.append(body);
    if (e.thumbnailUser && ME.avatar) embed.append(el("img", { src: ME.avatar, class: "pe-thumb" }));
    if (e.image) embed.append(el("img", { src: e.image, class: "pe-image" }));
    wrap.append(embed);
  }
  if (!wrap.children.length) wrap.append(el("div", { class: "preview-text", style: "color:var(--muted)" }, "(message vide)"));
  return wrap;
}

function renderWelcome(content) {
  const cfg = structuredClone(CONFIG.welcome || {});
  if (!cfg.embed) cfg.embed = {};

  content.append(el("div", { class: "page-head" }, el("h2", { html: "👋 Message de bienvenue" }), el("p", {}, "Accueille les nouveaux membres avec un embed personnalisé, un auto-rôle et un message d'au revoir.")));

  // Aperçu
  const previewCard = el("div", { class: "card" }, el("h3", {}, "Aperçu en direct"), el("div", { class: "card-sub" }, "Rendu approximatif avec tes données — se met à jour pendant que tu édites."));
  const previewHolder = el("div");
  previewHolder.append(buildPreview(cfg));
  previewCard.append(previewHolder);
  content.append(previewCard);

  const refreshPreview = () => { previewHolder.innerHTML = ""; previewHolder.append(buildPreview(cfg)); };

  // Carte message
  const c1 = el("div", { class: "card" }, el("h3", {}, "Message"));
  c1.append(
    fieldRow("Activé", "Envoyer un message quand un membre arrive.", toggle(cfg, "enabled")),
    fieldRow("Salon de bienvenue", "", channelSelect(cfg, "channelId", "text")),
    fieldRow("Format", "Embed, texte simple, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Embed" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + Embed" }])),
    fieldRow("Mentionner le membre", "Ping le nouveau membre.", toggle(cfg, "pingUser")),
    fieldRow("Message texte", "Utilisé si format Texte ou Texte+Embed.", textareaInput(cfg, "text"), true),
  );
  content.append(c1);

  // Carte embed
  const c2 = el("div", { class: "card" }, el("h3", {}, "Embed"), el("div", { class: "card-sub" }, "Personnalise l'apparence de l'embed."));
  c2.append(
    fieldRow("Couleur", "", colorInput(cfg.embed, "color")),
    fieldRow("Titre", "", textInput(cfg.embed, "title")),
    fieldRow("Description", "", textareaInput(cfg.embed, "description"), true),
    fieldRow("Avatar du membre en miniature", "Affiche l'avatar en haut à droite.", toggle(cfg.embed, "thumbnailUser")),
    fieldRow("Image / bannière (URL)", "Grande image en bas de l'embed.", textInput(cfg.embed, "image", "https://...")),
    fieldRow("Footer", "", textInput(cfg.embed, "footer")),
    fieldRow("Icône du serveur dans le footer", "", toggle(cfg.embed, "footerIcon")),
  );
  content.append(c2);

  // Variables
  content.append(
    el("div", { class: "card" }, el("h3", {}, "Variables disponibles"),
      el("div", { class: "card-sub", html:
        "<code>{user}</code> mention · <code>{username}</code> pseudo · <code>{server}</code> nom du serveur · " +
        "<code>{membercount}</code> nombre de membres · <code>{user.tag}</code> tag complet" })),
  );

  // Auto-role
  const c3 = el("div", { class: "card" }, el("h3", {}, "Auto-rôle"), el("div", { class: "card-sub" }, "Donne automatiquement des rôles aux nouveaux membres."));
  c3.append(fieldRow("Activé", "", toggle(cfg, "autoRoleEnabled")));
  c3.append(multiRole(cfg, "autoRoleIds"));
  content.append(c3);

  // Goodbye
  const c4 = el("div", { class: "card" }, el("h3", {}, "Message d'au revoir"));
  c4.append(
    fieldRow("Activé", "", toggle(cfg, "goodbyeEnabled")),
    fieldRow("Salon", "", channelSelect(cfg, "goodbyeChannelId", "text")),
    fieldRow("Message", "", textareaInput(cfg, "goodbyeText"), true),
  );
  content.append(c4);

  // Live preview : se rafraîchit à chaque édition. On attache les écouteurs aux
  // cartes (recréées à chaque rendu) et non à #content (persistant) pour éviter
  // d'empiler des listeners + des closures périmées à chaque visite de la section.
  for (const card of [c1, c2]) {
    card.addEventListener("input", refreshPreview);
    card.addEventListener("change", refreshPreview);
  }

  // Barre d'actions
  const save = el("button", { class: "btn-save" }, "💾 Enregistrer");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try { CONFIG.welcome = await api("/api/config/welcome", "PUT", cfg); setDirty(false); toast("Enregistré ✅", "ok"); }
    catch (e) { toast("Erreur : " + e.message, "err"); }
    save.disabled = false;
  });
  const test = el("button", { class: "btn-save", style: "background:var(--surface-3);box-shadow:none" }, "🧪 Envoyer un test");
  test.addEventListener("click", async () => {
    test.disabled = true;
    try { await api("/api/config/welcome", "PUT", cfg); await api("/api/welcome/test", "POST", {}); toast("Test envoyé dans le salon ✅", "ok"); }
    catch (e) { toast("Erreur : " + e.message, "err"); }
    test.disabled = false;
  });
  content.append(el("div", { class: "save-bar" }, test, save));
}

// ----- Section Annonces / messages personnalisés -----
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
      if (e.author.iconUrl) a.append(el("img", { src: e.author.iconUrl, class: "pe-author-ico" }));
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
      if (e.footerIcon && GUILD.icon) f.append(el("img", { src: GUILD.icon, class: "pe-footer-ico" }));
      f.append(document.createTextNode((previewVars(e.footer) || GUILD.name) + (e.timestamp ? " • aujourd'hui" : "")));
      body.append(f);
    }
    embed.append(body);
    if (e.thumbnail) embed.append(el("img", { src: e.thumbnail, class: "pe-thumb" }));
    if (e.image) embed.append(el("img", { src: e.image, class: "pe-image" }));
    wrap.append(embed);
  }
  // Image jointe (upload) — affichée comme une pièce jointe, hors embed.
  if (cfg.fileDataUrl) {
    wrap.append(el("img", { src: cfg.fileDataUrl, class: "preview-attach" }));
  }
  if (!wrap.children.length) wrap.append(el("div", { class: "preview-text", style: "color:var(--muted)" }, "(message vide)"));
  return wrap;
}

function renderAnnounce(content) {
  // Config locale (non persistée : page d'action ponctuelle).
  const cfg = {
    channelId: "",
    messageId: "",
    mode: "embed",
    content: "",
    mentionEveryone: false,
    mentionRoleIds: [],
    mentionPosition: "top",
    fileDataUrl: "",
    fileName: "",
    embed: {
      color: "#7c5cff",
      author: { name: "", iconUrl: "", url: "" },
      title: "",
      url: "",
      description: "",
      fields: [],
      thumbnail: "",
      image: "",
      footer: "",
      footerIcon: false,
      timestamp: false,
    },
  };

  content.append(el("div", { class: "page-head" },
    el("h2", { html: "📢 Annonces & messages perso" }),
    el("p", {}, "Compose un message entièrement personnalisable (texte + embed) et envoie-le dans le salon de ton choix.")));

  // Aperçu en direct
  const previewCard = el("div", { class: "card" }, el("h3", {}, "Aperçu en direct"), el("div", { class: "card-sub" }, "Rendu approximatif — se met à jour pendant que tu édites."));
  const previewHolder = el("div");
  previewHolder.append(buildAnnouncePreview(cfg));
  previewCard.append(previewHolder);
  content.append(previewCard);
  const refreshPreview = () => { previewHolder.innerHTML = ""; previewHolder.append(buildAnnouncePreview(cfg)); };

  // Destination
  const cDest = el("div", { class: "card" }, el("h3", {}, "Destination"));
  cDest.append(
    fieldRow("Salon", "Où publier le message.", channelSelect(cfg, "channelId", "textann", false)),
    fieldRow("ID du message à éditer", "Optionnel : colle l'ID d'un message du bot pour le modifier au lieu d'en envoyer un nouveau.", textInput(cfg, "messageId", "Laisser vide pour un nouveau message")),
    fieldRow("Format", "Texte simple, embed, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Embed" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + Embed" }])),
    fieldRow("Message texte", "Contenu hors embed (markdown supporté).", textareaInput(cfg, "content"), true),
  );

  // Image jointe (upload) — fonctionne avec ou sans embed.
  const fileInput = el("input", { type: "file", accept: "image/*" });
  const fileInfo = el("div", { class: "desc", style: "margin-top:6px" });
  const fileClear = el("button", { class: "btn-mini danger", style: "display:none;margin-top:6px" }, "✕ Retirer l'image");
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
  cDest.append(fieldRow("Image jointe (upload)", "Joins une image (max 8 Mo) — envoyée même sans embed.", el("div", { style: "width:100%" }, fileInput, fileInfo, fileClear), true));
  content.append(cDest);

  // Mentions
  const cMent = el("div", { class: "card" }, el("h3", {}, "Mentions"), el("div", { class: "card-sub" }, "Ajoute un ping en tête du message. À utiliser avec parcimonie."));
  cMent.append(fieldRow("Mentionner @everyone", "Notifie tout le serveur.", toggle(cfg, "mentionEveryone")));
  cMent.append(fieldRow("Rôles à mentionner", "", multiRole(cfg, "mentionRoleIds")));
  cMent.append(fieldRow("Position du ping", "Au début, à la fin, ou n'importe où dans le texte via la variable {mentions}.", selectInput(cfg, "mentionPosition", [
    { value: "top", label: "Au début du message" },
    { value: "end", label: "À la fin du message" },
    { value: "inline", label: "Personnalisé (variable {mentions})" },
  ])));
  content.append(cMent);

  // Embed
  const cEmbed = el("div", { class: "card" }, el("h3", {}, "Embed"), el("div", { class: "card-sub" }, "Personnalise entièrement l'apparence de l'embed."));
  cEmbed.append(
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
  content.append(cEmbed);

  // Champs (fields)
  const cFields = el("div", { class: "card" }, el("h3", {}, "Champs de l'embed"), el("div", { class: "card-sub" }, "Jusqu'à 25 champs (titre + valeur). « En ligne » place les champs côte à côte."));
  const fieldsHolder = el("div");
  const drawFields = () => {
    fieldsHolder.innerHTML = "";
    cfg.embed.fields.forEach((f, idx) => {
      const row = el("div", { class: "card", style: "background:var(--surface-2);margin:8px 0" });
      row.append(
        fieldRow("Titre du champ", "", textInput(f, "name")),
        fieldRow("Valeur", "", textareaInput(f, "value"), true),
        fieldRow("En ligne", "", toggle(f, "inline")),
      );
      const del = el("button", { class: "btn-mini danger", onclick: () => { cfg.embed.fields.splice(idx, 1); drawFields(); refreshPreview(); setDirty(true); } }, "🗑 Supprimer ce champ");
      row.append(del);
      row.addEventListener("input", refreshPreview);
      row.addEventListener("change", refreshPreview);
      fieldsHolder.append(row);
    });
  };
  drawFields();
  const addField = el("button", { class: "btn-mini", onclick: () => {
    if (cfg.embed.fields.length >= 25) return toast("25 champs maximum.", "err");
    cfg.embed.fields.push({ name: "", value: "", inline: false }); drawFields(); setDirty(true);
  } }, "➕ Ajouter un champ");
  cFields.append(fieldsHolder, addField);
  content.append(cFields);

  // Variables
  content.append(
    el("div", { class: "card" }, el("h3", {}, "Variables disponibles"),
      el("div", { class: "card-sub", html:
        "<code>{server}</code> nom du serveur · <code>{membercount}</code> nombre de membres · " +
        "<code>{date}</code> date · <code>{time}</code> heure · <code>{mentions}</code> emplacement du ping" })),
  );

  // Rafraîchissement de l'aperçu sur édition.
  for (const card of [cDest, cMent, cEmbed]) {
    card.addEventListener("input", refreshPreview);
    card.addEventListener("change", refreshPreview);
  }

  // Barre d'actions : envoi / édition.
  const send = el("button", { class: "btn-save" }, "📨 Envoyer le message");
  send.addEventListener("click", async () => {
    if (!cfg.channelId) return toast("Choisis d'abord un salon.", "err");
    const editing = !!(cfg.messageId && cfg.messageId.trim());
    if (cfg.mentionEveryone && !editing) {
      if (!(await confirmModal("Ce message va ping @everyone. Confirmer l'envoi ?", { okLabel: "Envoyer", danger: true }))) return;
    }
    send.disabled = true;
    try {
      const r = await api("/api/announce/send", "POST", cfg);
      setDirty(false);
      toast(r.edited ? "Message modifié ✅" : "Message envoyé ✅", "ok");
      if (!editing && r.messageId) cfg.messageId = r.messageId;
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    send.disabled = false;
  });
  content.append(el("div", { class: "save-bar" }, send));
}

// ----- Section Tournoi -----
const TROPHY = "🏆";

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

// Construit les cartes groupées du formulaire de tournoi (création OU édition).
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
  content.append(el("div", { class: "page-head" }, el("h2", { html: `${TROPHY} Tournoi` }), el("p", {}, "Crée et pilote ton tournoi Brawlhalla : inscriptions, check-in, bracket et scores.")));
  const skel = skeletonCards(2);
  content.append(skel);
  let t;
  try { t = await api("/api/tournament"); } catch { t = null; }
  skel.remove();

  if (!t) {
    // ----- Création (assistant par étapes) -----
    const cfg = { name: "Tournoi Brawlhalla", format: "1v1", region: "EU", maxParticipants: 16, bestOf: 3, finalsBestOf: 5, checkInEnabled: true, rulesText: "Stock · 3 vies · 8 min · maps légales.", prizeText: "", mapPool: "", startTime: "", createVoice: false, alertMinutes: 7, forfeitMinutes: 10 };
    const cards = tournamentFormCards(cfg);
    const steps = [
      { ico: "📋", label: "Informations", sub: "Nom, format, places" },
      { ico: "⚔️", label: "Format & règles", sub: "BO, règles, maps" },
      { ico: "✅", label: "Inscriptions", sub: "Salons & rôles" },
      { ico: "🤖", label: "Automatisation", sub: "Salons de match" },
    ];
    let step = 0;

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
      try { await api("/api/tournament", "POST", cfg); setDirty(false); toast("Tournoi créé ✅", "ok"); renderTournament(content); }
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
        const c = el("button", { class: "btn-save" }, "🏆 Créer le tournoi");
        c.addEventListener("click", () => create(c));
        foot.append(c);
      }
    }
    drawStep();
    return;
  }

  // ----- Tournoi existant -----
  const STATUS = { draft: "🔧 Brouillon", registration: "🟢 Inscriptions", checkin: "✅ Check-in", running: "⚔️ En cours", completed: "🏆 Terminé" };
  const STATUS_CLASS = { draft: "", registration: "ok", checkin: "info", running: "info", completed: "win" };

  // Hero (en-tête synthétique)
  const refreshHero = el("button", { class: "tbtn", title: "Actualiser le tournoi" }, "🔄 Actualiser");
  refreshHero.addEventListener("click", async () => {
    refreshHero.disabled = true;
    refreshHero.textContent = "⏳ …";
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
    b.addEventListener("click", async () => { b.disabled = true; try { await fn(); toast("Fait ✅", "ok"); renderTournament(content); } catch (e) { toast("Erreur : " + e.message, "err"); b.disabled = false; } });
    return b;
  };

  const disputes = Object.entries(t.matches).filter(([, m]) => m.status === "dispute");

  // Onglets internes
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
    const card = el("div", { class: "card" }, el("div", { class: "card-section-title" }, el("span", { class: "ico" }, "🎛️"), "Pilotage du tournoi"));

    const flow = el("div", { class: "toolbar" });
    flow.append(action("📢 Publier le panneau", () => api("/api/tournament/publish", "POST", {}), "primary"));
    if (t.status === "draft" || t.status === "completed") flow.append(action("🟢 Ouvrir les inscriptions", () => api("/api/tournament/status", "POST", { status: "registration" })));
    if (t.status === "registration" && t.checkInEnabled) flow.append(action("✅ Ouvrir le check-in", () => api("/api/tournament/status", "POST", { status: "checkin" })));
    if (t.status === "registration" || t.status === "checkin") {
      flow.append(action("📊 Seeding par Elo", () => api("/api/tournament/seed-elo", "POST", {})));
      flow.append(action("🎲 Mélanger les seeds", () => api("/api/tournament/shuffle", "POST", {})));
      flow.append(action("⚔️ Générer le bracket", () => api("/api/tournament/generate", "POST", {})));
    }
    card.append(el("div", { class: "tb-label" }, "Déroulé"), flow);

    const danger = el("div", { class: "toolbar", style: "margin-top:18px" });
    danger.append(action("📚 Archiver dans la librairie", async () => {
      if (await confirmModal("Archiver ce tournoi dans la librairie ? Il sera retiré de l'écran actif et conservé dans l'historique consultable.", { title: "Archiver", okLabel: "Archiver" })) await api("/api/tournament/archive", "POST", {});
    }));
    danger.append(action("🗑️ Supprimer", async () => { if (await confirmModal("Supprimer définitivement ce tournoi ? Tout sera perdu.", { danger: true, okLabel: "Supprimer" })) await api("/api/tournament", "DELETE"); }, "danger"));
    card.append(el("div", { class: "tb-label", style: "margin-top:18px" }, "Gestion"), danger);
    body.append(card);

    if (disputes.length) body.append(disputeCallout());
  }

  function disputeCallout() {
    const c = el("div", { class: "callout danger", onclick: () => { trnTab = "alerts"; draw(); } });
    c.append(el("span", { class: "co-ico" }, "🚨"), el("span", {}, `${disputes.length} litige(s) à trancher — clique pour ouvrir.`));
    return c;
  }

  // ---- Onglet Litiges ----
  function drawAlerts() {
    const dc = el("div", { class: "card alert-card" });
    dc.append(el("div", { class: "card-section-title" }, el("span", { class: "ico" }, "🚨"), `Litiges à trancher (${disputes.length})`),
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
      if (m.channelId && GUILD.id) acts.append(el("a", { class: "tbtn", href: `https://discord.com/channels/${GUILD.id}/${m.channelId}`, target: "_blank" }, "💬 Salon"));
      row.append(acts);
      dc.append(row);
    }
    body.append(dc);
  }

  // ---- Onglet Participants ----
  function drawParticipants() {
    const pc = el("div", { class: "card" }, el("div", { class: "card-section-title" }, el("span", { class: "ico" }, "👥"), `Participants (${t.participants.length}/${t.maxParticipants})`));
    if (!t.participants.length) { pc.append(el("div", { class: "empty-row" }, "Aucun inscrit pour l'instant.")); body.append(pc); return; }
    const grid = el("div", { class: "pgrid" });
    for (const [i, p] of t.participants.entries()) {
      const checked = t.checkInEnabled ? (p.checkedIn ? " ✅" : " ⌛") : "";
      grid.append(el("div", { class: "pcard" },
        el("span", { class: "seed" }, String(i + 1)),
        el("span", { class: "pn" }, p.name + checked),
        el("button", { class: "icon-btn", title: "Retirer", onclick: async () => { await api("/api/tournament/remove", "POST", { entrantId: p.id }); renderTournament(content); } }, "🗑")));
    }
    pc.append(grid);
    body.append(pc);
  }

  // ---- Onglet Bracket ----
  function drawBracket() {
    if (t.rounds > 0) { body.append(renderBracket(content, t)); return; }
    const c = el("div", { class: "card" }, el("div", { class: "card-section-title" }, el("span", { class: "ico" }, "🗺️"), "Bracket"));
    c.append(el("div", { class: "empty-row" }, "Bracket non généré. Va dans Pilotage → « Générer le bracket » une fois les inscriptions closes."));
    body.append(c);
  }

  // ---- Onglet Réglages ----
  function drawSettings() {
    body.append(el("div", { class: "settings-intro" }, "Modifie la config du tournoi. N'affecte pas les participants ni le bracket en cours."));
    const cfgEdit = JSON.parse(JSON.stringify(t));
    for (const card of tournamentFormCards(cfgEdit)) body.append(card);
    const sv = el("button", { class: "btn-save" }, "💾 Enregistrer les réglages");
    sv.addEventListener("click", async () => {
      sv.disabled = true;
      try { await api("/api/tournament", "PUT", cfgEdit); setDirty(false); toast("Réglages enregistrés ✅", "ok"); renderTournament(content); }
      catch (e) { toast("Erreur : " + e.message, "err"); sv.disabled = false; }
    });
    body.append(el("div", { class: "save-bar" }, sv));
  }

  draw();
}

function entrantName(t, id) { return id ? (t.participants.find((p) => p.id === id)?.name || "?") : "—"; }

function renderBracket(content, t, readonly = false) {
  const card = el("div", { class: "card" }, el("h3", {}, "🗺️ Bracket"));
  if (!readonly) card.append(el("div", { class: "card-sub" }, "Clique un match pour saisir/corriger le score."));
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
  card.append(wrap);
  return card;
}

// ---- Librairie / Historique des tournois ----
async function renderHistory(content) {
  let list;
  try { list = await api("/api/tournament/history"); } catch { return; }
  const card = el("div", { class: "card" },
    el("div", { class: "card-section-title" }, el("span", { class: "ico" }, "📚"), "Librairie des tournois"),
    el("div", { class: "card-sub" }, "Historique des tournois archivés — consulte les anciennes brackets et leurs résultats."));
  if (!list.length) {
    card.append(el("div", { class: "empty-row" }, "Aucun tournoi archivé pour le moment."));
    content.append(card);
    return;
  }
  for (const h of list) {
    const date = h.archivedAt ? new Date(h.archivedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
    const row = el("div", { class: "reward-row", style: "align-items:center" });
    row.append(
      el("div", { style: "flex:1;min-width:0" },
        el("div", { style: "font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }, h.name),
        el("div", { class: "card-sub", style: "margin:2px 0 0" }, `${h.format} · BO${h.bestOf} · ${h.participants} joueurs · ${date}`)),
      el("span", { class: "tag", style: "white-space:nowrap" }, h.winner ? "🏆 " + h.winner : "— inachevé"),
      el("button", { class: "icon-btn", title: "Consulter", onclick: () => historyModal(h.id) }, "👁"),
      el("button", { class: "icon-btn", title: "Supprimer", onclick: async () => {
        if (!await confirmModal(`Supprimer définitivement « ${h.name} » de la librairie ?`, { danger: true, okLabel: "Supprimer" })) return;
        try { await api("/api/tournament/history/" + h.id, "DELETE"); renderTournament(content); } catch (e) { toast("Erreur : " + e.message, "err"); }
      } }, "🗑"));
    card.append(row);
  }
  content.append(card);
}

async function historyModal(id) {
  let entry;
  try { entry = await api("/api/tournament/history/" + id); } catch (e) { return toast("Erreur : " + e.message, "err"); }
  const t = entry.snapshot;
  const overlay = el("div", { class: "modal-overlay" });
  const close = () => { overlay.classList.remove("show"); setTimeout(() => overlay.remove(), 200); };
  const date = entry.archivedAt ? new Date(entry.archivedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" }) : "—";
  const card = el("div", { class: "modal-card", style: "max-width:900px;width:94vw;max-height:88vh;overflow:auto;text-align:left" },
    el("div", { class: "modal-title", style: "text-align:left" }, "📚 " + entry.name),
    el("div", { class: "card-sub", style: "margin-bottom:14px" }, `${entry.format} · BO${entry.bestOf} · ${entry.participants} joueurs · ${date}${entry.winner ? " · 🏆 " + entry.winner : ""}`));
  if (t && t.rounds > 0) card.append(renderBracket(null, t, true));
  else card.append(el("div", { class: "empty-row" }, "Pas de bracket enregistré pour ce tournoi."));
  const cl = el("button", { class: "modal-btn primary" }, "Fermer");
  cl.onclick = close;
  card.append(el("div", { class: "modal-actions" }, cl));
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  overlay.append(card);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
}

boot();