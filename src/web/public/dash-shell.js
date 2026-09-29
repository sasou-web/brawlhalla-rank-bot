/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · coquille
   Navigation, routage par hash, rendu de page, onglets de page, palette
   de commandes, menu du compte, démarrage, connexion, session et réseau.
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).

   Architecture d'information : 16 pages en 5 groupes, organisées par tâche.
   Les anciennes adresses (#/stats, #/logs, #/startgg…) sont redirigées vers
   leur nouvel emplacement (ROUTE_ALIASES).
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

// ═══════════════════ 1. Navigation ═══════════════════
const NAV_GROUPS = [
  {
    label: null,
    items: [{ id: "overview", label: "Vue d'ensemble", icon: "dashboard", keywords: "accueil santé statistiques", render: (ctx) => renderOverview(ctx.root) }],
  },
  {
    label: "Modération",
    items: [
      {
        id: "wordfilter",
        label: "Filtre de mots",
        icon: "message-x",
        keywords: "censure mots interdits insultes grossièretés automod filtre modération",
        tabs: [
          { id: "terms", label: "Termes" },
          { id: "sanctions", label: "Sanctions" },
          { id: "exceptions", label: "Exceptions" },
          { id: "history", label: "Historique" },
        ],
        wide: true,
        render: (ctx) => renderWordFilter(ctx),
      },
      {
        id: "tickets",
        label: "Tickets",
        icon: "ticket",
        keywords: "support staff motifs",
        tabs: [
          { id: "config", label: "Configuration" },
          { id: "panel", label: "Panneau" },
          { id: "ticket", label: "Salon de ticket" },
        ],
        render: (ctx) => renderTickets(ctx),
      },
    ],
  },
  {
    label: "Contenu",
    items: [
      { id: "tiktok", label: "TikTok", icon: "music", wide: true, keywords: "vidéos notifications compte annonce", render: (ctx) => renderTikTok(ctx) },
      { id: "announce", label: "Annonces", icon: "megaphone", wide: true, keywords: "message embed publier", render: (ctx) => renderAnnounce(ctx) },
      { id: "reminders", label: "Rappels", icon: "bell", keywords: "messages récurrents", render: (ctx) => renderReminders(ctx) },
      {
        id: "clips",
        label: "Clips",
        icon: "film",
        keywords: "réactions devine ton rang vidéos",
        tabs: [
          { id: "reactions", label: "Réactions automatiques" },
          { id: "guessrank", label: "Devine ton rang" },
        ],
        render: (ctx) => renderClips(ctx),
      },
      { id: "combos", label: "Combos", icon: "flame", keywords: "brawldatabase true combos armes", render: (ctx) => renderCombos(ctx) },
    ],
  },
  {
    label: "Événements",
    items: [
      {
        id: "tournament",
        label: "Tournois",
        icon: "trophy",
        wide: true,
        keywords: "bracket inscriptions check-in seeding",
        tabs: [
          { id: "current", label: "Tournoi en cours" },
          { id: "archives", label: "Archives" },
          { id: "startgg", label: "Seeding start.gg" },
        ],
        render: (ctx) => renderTournament(ctx),
      },
      {
        id: "giveaway",
        label: "Giveaways",
        icon: "gift",
        keywords: "concours tirage gagnants",
        tabs: [
          { id: "contests", label: "Concours" },
          { id: "settings", label: "Réglages" },
        ],
        render: (ctx) => renderGiveaway(ctx),
      },
    ],
  },
  {
    label: "Communauté",
    items: [
      {
        id: "linking",
        label: "Liaison & rangs",
        icon: "link",
        keywords: "lier compte brawlhalla validation rôles rank",
        tabs: [
          { id: "validation", label: "Validation" },
          { id: "panel", label: "Panneau de liaison" },
        ],
        render: (ctx) => renderLinking(ctx),
      },
      { id: "levels", label: "Niveaux", icon: "star", keywords: "xp récompenses paliers", render: (ctx) => renderLevels(ctx) },
      {
        id: "welcome",
        label: "Accueil",
        icon: "user-plus",
        keywords: "bienvenue arrivée départ au revoir auto-rôle",
        tabs: [
          { id: "arrival", label: "Arrivée" },
          { id: "goodbye", label: "Départ" },
          { id: "autorole", label: "Auto-rôle" },
        ],
        render: (ctx) => renderWelcome(ctx),
      },
      {
        id: "voice",
        label: "Vocaux",
        icon: "headphones",
        keywords: "vocal salons temporaires hubs rank",
        tabs: [
          { id: "temp", label: "Salons temporaires" },
          { id: "rank", label: "Salons par rank" },
        ],
        render: (ctx) => renderVoice(ctx),
      },
      { id: "lol", label: "League of Legends", icon: "swords", theme: "lol", keywords: "lol accueil rôle", render: (ctx) => renderLol(ctx) },
    ],
  },
  {
    label: "Système",
    items: [
      {
        id: "system",
        label: "Santé & journal",
        icon: "activity",
        keywords: "api fiabilité métriques logs journal",
        tabs: [
          { id: "api", label: "Fiabilité API" },
          { id: "logs", label: "Journal" },
        ],
        render: (ctx) => renderSystem(ctx),
      },
      { id: "settings", label: "Paramètres", icon: "settings", keywords: "salons audit alertes succès thème apparence", render: (ctx) => renderSettings(ctx) },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label })));

// Anciennes adresses → nouvel emplacement [page, onglet].
const ROUTE_ALIASES = {
  stats: ["overview", null],
  metrics: ["system", "api"],
  logs: ["system", "logs"],
  linkpanel: ["linking", "panel"],
  roles: ["linking", null],
  vocrank: ["voice", "rank"],
  tempvoice: ["voice", "temp"],
  guessrank: ["clips", "guessrank"],
  startgg: ["tournament", "startgg"],
};

function navItem(id) {
  return NAV_ITEMS.find((i) => i.id === id) || NAV_ITEMS[0];
}

function renderNav() {
  const nav = document.getElementById("nav");
  if (!nav) return;
  clearNode(nav);
  for (const g of NAV_GROUPS) {
    const labelId = g.label ? uid("navg") : null;
    const list = el("ul", { class: "nav-list", role: "list", "aria-labelledby": labelId });
    for (const it of g.items) {
      const a = el("a", { class: "nav-link" + (it.theme ? " theme-" + it.theme : ""), href: "#/" + it.id, "aria-current": ROUTE.page === it.id ? "page" : null }, icon(it.icon, 16), el("span", { class: "nav-label" }, it.label));
      const attn = navAttention(it.id);
      if (attn) a.append(attn);
      list.append(el("li", {}, a));
    }
    nav.append(el("div", { class: "nav-group" }, g.label ? el("div", { class: "nav-group-label", id: labelId }, g.label) : null, list));
  }
}

function navAttention(id) {
  if (id === "tournament" && ATTN.disputes > 0) {
    return el("span", { class: "badge badge-warn", "aria-label": plural(ATTN.disputes, "litige à trancher", "litiges à trancher") }, String(ATTN.disputes));
  }
  if (id === "tiktok" && (ATTN.tiktok === "degraded" || ATTN.tiktok === "down")) {
    const label = ATTN.tiktok === "down" ? "TikTok : aucune source lisible" : "TikTok : surveillance dégradée";
    return el("span", { class: "nav-dot" + (ATTN.tiktok === "down" ? " danger" : ""), role: "img", "aria-label": label, "data-tip": label, "data-tip-pos": "right" });
  }
  if (id === "system" && ATTN.api !== "ok") {
    const label = ATTN.api === "down" ? "API Brawlhalla perturbée" : "API Brawlhalla dégradée";
    return el("span", { class: "nav-dot" + (ATTN.api === "down" ? " danger" : ""), role: "img", "aria-label": label, "data-tip": label, "data-tip-pos": "right" });
  }
  return null;
}

function setAttention(patch) {
  const before = JSON.stringify(ATTN);
  Object.assign(ATTN, patch);
  if (JSON.stringify(ATTN) !== before) renderNav();
}

function apiHealthLevel(m) {
  if (!m || !m.meaningful) return "ok";
  if (m.successRate < 0.6) return "down";
  if (m.successRate < 0.9 || m.cooldownActiveMs > 0) return "degraded";
  return "ok";
}

// Indicateurs de navigation chargés en arrière-plan au démarrage.
async function loadAttention() {
  const [t, m, tt] = await Promise.allSettled([api("/api/tournament"), api("/api/metrics"), api("/api/tiktok/status")]);
  const patch = {};
  if (t.status === "fulfilled") patch.disputes = t.value ? Object.values(t.value.matches || {}).filter((x) => x.status === "dispute").length : 0;
  if (m.status === "fulfilled") patch.api = apiHealthLevel(m.value);
  if (tt.status === "fulfilled") patch.tiktok = tiktokHealth(CONFIG.tiktok, tt.value).level;
  setAttention(patch);
}

// ═══════════════════ 2. Routage ═══════════════════
function parseHash() {
  const parts = (location.hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  let page = parts[0] || "overview";
  let tab = parts[1] || null;
  if (ROUTE_ALIASES[page]) {
    const [p, t] = ROUTE_ALIASES[page];
    page = p;
    tab = tab || t;
  }
  if (!NAV_ITEMS.some((i) => i.id === page)) page = "overview";
  const item = navItem(page);
  if (tab && !(item.tabs || []).some((t) => t.id === tab)) tab = null;
  return { page, tab };
}

function routeHash(r) {
  return "#/" + r.page + (r.tab ? "/" + r.tab : "");
}

// Navigation applicative : passe par le hash (historique du navigateur).
function navigate(page, tab = null) {
  const target = routeHash({ page, tab });
  if (location.hash === target) {
    if (ROUTE.page !== page || ROUTE.tab !== tab) onHashChange();
    return;
  }
  location.hash = target;
}

async function confirmLeave() {
  return confirmDialog({
    title: "Modifications non enregistrées",
    message: "Tu as des modifications non enregistrées sur cette page. Les abandonner ?",
    confirmLabel: "Abandonner les modifications",
    cancelLabel: "Rester sur la page",
    danger: true,
  });
}

async function onHashChange() {
  const next = parseHash();
  if (next.page === ROUTE.page && next.tab === ROUTE.tab) return;
  if (hasUnsavedChanges() && !(await confirmLeave())) {
    history.replaceState(null, "", routeHash(ROUTE));
    return;
  }
  ROUTE = next;
  closeSidebar();
  renderRoute();
  window.scrollTo(0, 0);
  const h = $("#content .page-title");
  if (h) {
    h.tabIndex = -1;
    h.focus({ preventScroll: true });
  }
}

// ═══════════════════ 3. Rendu de page ═══════════════════
let PAGE = null; // { id, root, ctx, cleanups, token }

function renderRoute() {
  if (PAGE) for (const fn of PAGE.cleanups) {
    try {
      fn();
    } catch {
      /* nettoyage best-effort */
    }
  }
  closePopover();
  hideTip();
  FORMS = [];
  WATCHERS = [];
  updateSaveBar();

  const item = navItem(ROUTE.page);
  const content = document.getElementById("content");
  clearNode(content);
  const root = el("div", { class: "page" + (item.wide ? " page-wide" : "") });
  content.append(root);

  // Adresse canonique (anciens liens #/logs → #/system/logs), sans nouvelle entrée d'historique.
  if (location.hash !== routeHash(ROUTE)) history.replaceState(null, "", location.pathname + location.search + routeHash(ROUTE));

  const token = {};
  PAGE = { id: item.id, root, cleanups: [], token };
  const ctx = {
    page: item.id,
    root,
    tab: ROUTE.tab,
    alive: () => !!PAGE && PAGE.token === token,
    onCleanup: (fn) => PAGE.cleanups.push(fn),
    setTab: (tab) => {
      ROUTE.tab = tab;
      ctx.tab = tab;
      history.replaceState(null, "", routeHash(ROUTE));
    },
    // Intervalle arrêté à la sortie de la page et suspendu onglet masqué.
    interval: (fn, ms) => {
      const t = setInterval(() => {
        if (ctx.alive() && !document.hidden) fn();
      }, ms);
      PAGE.cleanups.push(() => clearInterval(t));
      return t;
    },
  };
  PAGE.ctx = ctx;

  document.body.classList.toggle("theme-lol", item.theme === "lol");
  document.title = `${item.label} · Xray Kaya`;
  const mt = document.getElementById("mobile-title");
  if (mt) mt.textContent = item.label;
  renderNav();
  try {
    item.render(ctx);
  } catch (e) {
    console.error(e);
    root.append(inlineError("Cette page n'a pas pu s'afficher : " + e.message, () => rerenderPage()));
  }
  afterChange();
}

function rerenderPage() {
  const y = window.scrollY;
  renderRoute();
  requestAnimationFrame(() => window.scrollTo(0, y));
}

// En-tête de page : titre, contexte, actions (une seule primaire).
function pageHeader({ title, description, actions = [], hasTabs = false } = {}) {
  return el(
    "header",
    { class: "page-header" + (hasTabs ? " has-tabs" : "") },
    el("div", { class: "ph-text" }, el("h1", { class: "page-title" }, title), description ? el("p", { class: "page-desc" }, description) : null),
    actions.filter(Boolean).length ? el("div", { class: "page-actions" }, ...actions.filter(Boolean)) : null,
  );
}

/**
 * Onglets de page (définis dans NAV_GROUPS). renderPanel(tabId, panel, scope)
 * reconstruit uniquement le panneau ; les brouillons de la page sont conservés.
 * items : surcharge facultative (compteurs, alertes).
 */
function pageTabs(ctx, renderPanel, { items, host = ctx.root } = {}) {
  const list = (items || navItem(ctx.page).tabs || []).filter(Boolean);
  let active = list.some((t) => t.id === ctx.tab) ? ctx.tab : list[0].id;
  const panelEl = el("div", { class: "tab-panel", role: "tabpanel", id: "tabpanel", tabindex: "-1" });
  let scope = [];
  const runCleanups = () => {
    for (const fn of scope) {
      try {
        fn();
      } catch {
        /* best-effort */
      }
    }
    scope = [];
  };
  const draw = () => {
    runCleanups();
    closePopover();
    clearNode(panelEl);
    panelEl.setAttribute("aria-labelledby", "tab-" + active);
    renderPanel(active, panelEl, {
      onCleanup: (fn) => scope.push(fn),
      interval: (fn, ms) => {
        const t = setInterval(() => {
          if (ctx.alive() && !document.hidden) fn();
        }, ms);
        scope.push(() => clearInterval(t));
      },
    });
    afterChange();
  };
  ctx.onCleanup(runCleanups);
  const bar = tabBar(list, active, (id) => {
    active = id;
    ctx.setTab(id);
    draw();
  });
  host.append(bar, panelEl);
  draw();
  return { bar, panel: panelEl, redraw: draw, get active() { return active; } };
}

// ═══════════════════ 4. Barre latérale (mobile) ═══════════════════
function openSidebar() {
  const sb = document.getElementById("sidebar");
  sb.classList.add("open");
  document.getElementById("scrim").hidden = false;
  document.getElementById("nav-toggle").setAttribute("aria-expanded", "true");
  const current = sb.querySelector('[aria-current="page"]') || sb.querySelector("a, button");
  if (current) current.focus();
}

function closeSidebar() {
  const sb = document.getElementById("sidebar");
  if (!sb || !sb.classList.contains("open")) return;
  sb.classList.remove("open");
  document.getElementById("scrim").hidden = true;
  const t = document.getElementById("nav-toggle");
  t.setAttribute("aria-expanded", "false");
  if (sb.contains(document.activeElement)) t.focus();
}

function isMobileNav() {
  return window.matchMedia("(max-width: 1023px)").matches;
}

// ═══════════════════ 5. Palette de commandes (Ctrl K) ═══════════════════
function catgirlApi() {
  return window.xkCatgirl && typeof window.xkCatgirl.toggle === "function" ? window.xkCatgirl : null;
}

function paletteCommands() {
  const cmds = [];
  for (const it of NAV_ITEMS) {
    cmds.push({ group: "Pages", label: it.label, hint: it.group || "", icon: it.icon, keywords: it.keywords || "", run: () => navigate(it.id) });
    for (const t of it.tabs || []) {
      cmds.push({ group: "Pages", label: `${it.label} › ${t.label}`, hint: "", icon: it.icon, keywords: it.keywords || "", run: () => navigate(it.id, t.id) });
    }
  }
  cmds.push(
    { group: "Actions", label: "Nouvelle annonce", icon: "megaphone", keywords: "message publier", run: () => navigate("announce") },
    { group: "Actions", label: "Nouveau giveaway", icon: "gift", keywords: "concours lancer", run: () => startNewGiveaway() },
    { group: "Actions", label: "Resynchroniser les rôles de rank", icon: "refresh", keywords: "actualiser roles", run: () => resyncRoles().catch(reportError) },
    { group: "Actions", label: "Ouvrir le journal", icon: "terminal", keywords: "logs", run: () => navigate("system", "logs") },
    { group: "Préférences", label: "Thème : système", icon: "monitor", keywords: "apparence auto", run: () => applyTheme("system") },
    { group: "Préférences", label: "Thème : clair", icon: "sun", keywords: "apparence light", run: () => applyTheme("light") },
    { group: "Préférences", label: "Thème : sombre", icon: "moon", keywords: "apparence dark", run: () => applyTheme("dark") },
  );
  const cg = catgirlApi();
  if (cg) cmds.push({ group: "Préférences", label: cg.isOn() ? "Désactiver le mode Catgirl" : "Activer le mode Catgirl", icon: "sparkles", keywords: "neko kawaii", run: () => cg.toggle() });
  cmds.push({ group: "Compte", label: "Se déconnecter", icon: "log-out", keywords: "logout quitter", run: () => (location.href = "/logout") });
  return cmds;
}

function openPalette() {
  if (DIALOGS.length) return;
  const commands = paletteCommands();
  const listId = uid("pal");
  const input = el("input", {
    class: "palette-input",
    type: "text",
    placeholder: "Aller à une page, lancer une action…",
    "aria-label": "Rechercher une page ou une action",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": listId,
    "aria-autocomplete": "list",
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = el("ul", { class: "palette-list", role: "listbox", id: listId });
  let matches = commands;
  let active = 0;

  const backdrop = el("div", { class: "dialog-backdrop palette-backdrop" });
  const box = el(
    "div",
    { class: "dialog palette", role: "dialog", "aria-modal": "true", "aria-label": "Palette de commandes" },
    el("div", { class: "palette-input-wrap" }, icon("search", 18), input, kbd("Échap")),
    list,
    el("div", { class: "palette-foot" }, el("span", {}, kbd("↑"), kbd("↓"), "naviguer"), el("span", {}, kbd("Entrée"), "ouvrir"), el("span", {}, kbd("Ctrl K"), "fermer")),
  );
  backdrop.append(box);
  const prevFocus = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey, true);
    document.documentElement.classList.remove("scroll-lock");
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
  };
  const run = (c) => {
    close();
    Promise.resolve().then(c.run).catch(reportError);
  };
  const paint = () => {
    $$(".palette-opt", list).forEach((n) => n.classList.toggle("active", Number(n.dataset.idx) === active));
    const cur = list.querySelector(".palette-opt.active");
    if (cur) {
      input.setAttribute("aria-activedescendant", cur.id);
      cur.scrollIntoView({ block: "nearest" });
    }
  };
  // Pertinence : le dernier segment du libellé (« Page › Onglet ») commence par la
  // recherche, puis un mot du libellé, puis le libellé la contient, puis mots-clés.
  const groupOrder = [...new Set(commands.map((c) => c.group))];
  const score = (c, q) => {
    const label = normText(c.label);
    const last = label.split("›").pop().trim();
    if (last.startsWith(q)) return 0;
    if (label.split(/[\s›&'-]+/).some((w) => w.startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    return 3;
  };
  const draw = () => {
    const q = normText(input.value.trim());
    matches = q
      ? commands
          .filter((c) => normText(`${c.label} ${c.hint} ${c.keywords} ${c.group}`).includes(q))
          .map((c, i) => ({ c, i, s: score(c, q), g: groupOrder.indexOf(c.group) }))
          .sort((a, b) => a.g - b.g || a.s - b.s || a.i - b.i)
          .map((x) => x.c)
      : commands;
    active = 0;
    clearNode(list);
    input.removeAttribute("aria-activedescendant");
    if (!matches.length) {
      list.append(el("li", { class: "lb-empty", role: "presentation" }, `Aucun résultat pour « ${input.value.trim()} ».`));
      return;
    }
    let group = null;
    matches.forEach((c, i) => {
      if (c.group !== group) {
        group = c.group;
        list.append(el("li", { class: "palette-group", role: "presentation" }, group));
      }
      const li = el("li", { class: "palette-opt", role: "option", id: `${listId}-${i}`, dataset: { idx: String(i) }, "aria-selected": "false" }, icon(c.icon, 16), el("span", { class: "palette-opt-label" }, c.label), c.hint ? el("span", { class: "palette-opt-hint" }, c.hint) : null);
      li.addEventListener("pointermove", () => {
        if (active !== i) {
          active = i;
          paint();
        }
      });
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", () => run(c));
      list.append(li);
    });
    paint();
  };
  function onKey(e) {
    if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown" && matches.length) {
      e.preventDefault();
      active = (active + 1) % matches.length;
      paint();
    } else if (e.key === "ArrowUp" && matches.length) {
      e.preventDefault();
      active = (active - 1 + matches.length) % matches.length;
      paint();
    } else if (e.key === "Enter" && matches[active]) {
      e.preventDefault();
      run(matches[active]);
    } else if (e.key === "Tab") e.preventDefault();
  }
  input.addEventListener("input", draw);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.append(backdrop);
  document.documentElement.classList.add("scroll-lock");
  draw();
  input.focus();
}

// ═══════════════════ 6. Menu du compte ═══════════════════
function openAccountMenu(anchor) {
  const pref = themePref();
  const cg = catgirlApi();
  openMenu(
    anchor,
    [
      { heading: ME ? `Connecté en tant que ${ME.username}` : "Compte" },
      "-",
      { heading: "Thème" },
      { label: "Système", icon: "monitor", radio: true, checked: pref === "system", onSelect: () => applyTheme("system") },
      { label: "Clair", icon: "sun", radio: true, checked: pref === "light", onSelect: () => applyTheme("light") },
      { label: "Sombre", icon: "moon", radio: true, checked: pref === "dark", onSelect: () => applyTheme("dark") },
      cg ? "-" : null,
      cg ? { label: "Mode Catgirl", icon: "sparkles", checked: cg.isOn(), onSelect: () => cg.toggle() } : null,
      "-",
      { label: "Se déconnecter", icon: "log-out", onSelect: () => (location.href = "/logout") },
    ],
    { placement: "bottom-start" },
  );
}

// ═══════════════════ 7. Session, réseau ═══════════════════
let SESSION_LOST = false;
let NET_RETRY = 0;

function onSessionLost(kind) {
  if (SESSION_LOST) return;
  SESSION_LOST = true;
  const app = document.getElementById("app");
  if (!app || app.hidden) return showLogin(kind === "revoked" ? "revoked" : "expired");
  const revoked = kind === "revoked";
  openDialog({
    title: revoked ? "Accès retiré" : "Session expirée",
    body: el(
      "p",
      { class: "dialog-text" },
      revoked
        ? "Ton compte n'a plus la permission « Gérer le serveur » sur ce serveur. Le dashboard n'est plus accessible."
        : "Ta session a expiré. Reconnecte-toi pour continuer ; les modifications non enregistrées de cette page seront perdues.",
    ),
    dismissible: false,
    actions: [
      revoked
        ? { label: "Se déconnecter", variant: "primary", onClick: () => { location.href = "/logout"; return false; } }
        : { label: "Se reconnecter", variant: "primary", onClick: () => { location.href = "/login"; return false; } },
    ],
  });
}

function setOnline(ok) {
  if (ok === NET.online) return;
  NET.online = ok;
  const b = document.getElementById("conn-banner");
  if (!b) return;
  if (!ok) {
    clearNode(b).append(
      icon("wifi-off", 16),
      el("span", {}, "Connexion au dashboard perdue. Les données affichées peuvent être obsolètes."),
      button("Réessayer", { size: "sm", variant: "secondary", onClick: () => pingServer() }),
    );
    b.hidden = false;
    clearInterval(NET_RETRY);
    NET_RETRY = setInterval(pingServer, 10000);
  } else {
    b.hidden = true;
    clearInterval(NET_RETRY);
    if (ME) toast("Connexion rétablie", "ok");
  }
}

async function pingServer() {
  try {
    await api("/api/me");
  } catch {
    /* setOnline gère l'état */
  }
}

// ═══════════════════ 8. Démarrage & connexion ═══════════════════
const LOGIN_ERRORS = {
  notadmin: "Ton compte Discord n'a pas la permission « Gérer le serveur » sur Xray Kaya.",
  token: "L'authentification Discord a échoué. Réessaie.",
  oauth: "Une erreur est survenue pendant la connexion. Réessaie.",
  nocode: "Connexion annulée.",
  state: "La demande de connexion a expiré. Relance la connexion.",
  expired: "Ta session a expiré. Reconnecte-toi.",
  revoked: "Ton accès au dashboard a été retiré.",
  network: "Le serveur du dashboard ne répond pas. Vérifie ta connexion puis réessaie.",
};

function showLogin(err) {
  document.getElementById("loading").hidden = true;
  const app = document.getElementById("app");
  app.hidden = true;
  app.classList.remove("active");
  document.getElementById("login").hidden = false;
  const box = document.getElementById("login-error");
  const msg = LOGIN_ERRORS[err];
  box.hidden = !msg;
  clearNode(box);
  if (msg) box.append(icon("alert-circle", 16), el("div", { class: "callout-body" }, msg));
}

// Échec de chargement des données du serveur : écran dédié avec relance.
function showBootError(message) {
  showLogin(null);
  const box = document.getElementById("login-error");
  clearNode(box).append(icon("alert-circle", 16), el("div", { class: "callout-body" }, el("div", { class: "callout-title" }, "Impossible de charger le serveur Discord"), el("div", { class: "callout-text" }, message)));
  box.hidden = false;
  const note = $(".login-note");
  if (note) note.hidden = true;
  const actions = document.getElementById("login-actions");
  clearNode(actions).append(
    button("Réessayer", { variant: "primary", size: "lg", block: true, icon: "refresh", onClick: () => location.reload() }),
    linkButton("Se déconnecter", "/logout", { variant: "ghost", size: "lg" }),
  );
}

let SHELL_READY = false;

function initShell() {
  if (SHELL_READY) return;
  SHELL_READY = true;

  $("#nav-toggle").append(icon("menu", 18));
  $("#mobile-search").append(icon("search", 18));
  $("#sb-search").prepend(icon("search", 14));
  $("#account-btn").append(icon("chevrons-up-down", 14));

  $("#nav-toggle").addEventListener("click", () => ($("#sidebar").classList.contains("open") ? closeSidebar() : openSidebar()));
  $("#scrim").addEventListener("click", closeSidebar);
  $("#nav").addEventListener("click", (e) => {
    if (e.target.closest("a") && isMobileNav()) closeSidebar();
  });
  $("#sb-search").addEventListener("click", openPalette);
  $("#mobile-search").addEventListener("click", openPalette);
  $("#account-btn").addEventListener("click", (e) => {
    const b = e.currentTarget;
    if (isPopoverFor(b)) return closePopover();
    openAccountMenu(b);
  });

  $("#savebar-save").addEventListener("click", (e) => runBusy(e.currentTarget, () => saveAllForms()));
  $("#savebar-discard").addEventListener("click", () => rerenderPage());

  document.addEventListener("input", touch);
  document.addEventListener("change", touch);
  // Emoji Discord introuvable dans un aperçu : son nom en texte plutôt qu'une image cassée.
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img && img.matches && img.matches("img.dc-emoji")) img.replaceWith(document.createTextNode(img.alt || ""));
    },
    true,
  );
  trackTextFields();
  initTooltips();
  setInterval(tickRelativeTimes, 30000);

  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("beforeunload", (e) => {
    // Session perdue : l'utilisateur a déjà été prévenu par le dialogue.
    if (!SESSION_LOST && hasUnsavedChanges()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("offline", () => setOnline(false));
  window.addEventListener("online", () => pingServer());
  window.addEventListener("resize", () => {
    if (!isMobileNav()) closeSidebar();
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
    } else if (mod && e.key.toLowerCase() === "s") {
      const save = $("#savebar-save");
      if (!$("#savebar").hidden && save && !save.disabled && !DIALOGS.length) {
        e.preventDefault();
        save.click();
      }
    } else if (e.key === "Escape" && $("#sidebar").classList.contains("open") && !DIALOGS.length && !POPOVER) {
      closeSidebar();
    }
  });
}

function renderShellChrome() {
  $("#guild-name").textContent = GUILD.name;
  const gi = clearNode($("#guild-icon"));
  if (GUILD.icon) gi.append(el("img", { src: GUILD.icon, alt: "" }));
  else gi.textContent = (GUILD.name || "?").slice(0, 2).toUpperCase();
  $("#user-name").textContent = ME.username;
  if (ME.avatar) $("#user-avatar").src = ME.avatar;
}

// Rendu complet de l'application. Appelé aussi par catgirl.js (bascule) :
// la page n'est pas reconstruite si un brouillon est en cours.
function renderApp() {
  document.getElementById("loading").hidden = true;
  document.getElementById("login").hidden = true;
  const app = document.getElementById("app");
  app.hidden = false;
  app.classList.add("active");
  initShell();
  renderShellChrome();
  if (PAGE && hasUnsavedChanges()) renderNav();
  else renderRoute();
}

async function boot() {
  const err = new URLSearchParams(location.search).get("error");
  try {
    ME = await api("/api/me");
  } catch (e) {
    ME = null;
    return showLogin(e.status === 0 ? "network" : err);
  }
  if (!ME.isAdmin) {
    ME = null;
    return showLogin("notadmin");
  }
  try {
    [GUILD, CONFIG] = await Promise.all([api("/api/guild"), api("/api/config")]);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return showLogin(e.status === 403 ? "revoked" : "expired");
    return showBootError(e.message);
  }
  if (err) history.replaceState(null, "", location.pathname + location.hash);
  ROUTE = parseHash();
  renderApp();
  loadAttention();
}
