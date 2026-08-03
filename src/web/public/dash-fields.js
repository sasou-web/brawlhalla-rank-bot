/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 2/10
   En-têtes de page, champs de formulaire et éditeurs réutilisables
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
