/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 3/10
   Navigation, topbar, routing par hash, palette Ctrl+K, renderApp
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
