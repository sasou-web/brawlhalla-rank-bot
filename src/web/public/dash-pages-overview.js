/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · vue d'ensemble
   Répond à trois questions, dans cet ordre :
   1. Le bot fonctionne-t-il ? (santé)
   2. Y a-t-il quelque chose à traiter ? (litiges, API, modules mal configurés)
   3. Que se passe-t-il ? (communauté, événements en cours, activité récente)
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).
   renderOverview(content) construit son DOM de façon synchrone (les données
   remplissent ensuite des emplacements réservés) : catgirl.js y ajoute sa
   galerie juste après l'appel.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

// Modules activables, dans l'ordre d'affichage.
const MODULES = [
  { section: "wordfilter", label: "Filtre de mots", page: "wordfilter" },
  { section: "tiktok", label: "TikTok", page: "tiktok" },
  { section: "levels", label: "Niveaux", page: "levels" },
  { section: "welcome", label: "Accueil", page: "welcome", on: (c) => c.enabled || c.goodbyeEnabled || c.autoRoleEnabled },
  { section: "tickets", label: "Tickets", page: "tickets" },
  { section: "giveaway", label: "Giveaways", page: "giveaway" },
  { section: "tempvoice", label: "Vocaux temporaires", page: "voice", tab: "temp" },
  { section: "reminders", label: "Rappels", page: "reminders" },
  { section: "clips", label: "Réactions aux clips", page: "clips", tab: "reactions" },
  { section: "guessrank", label: "Devine ton rang", page: "clips", tab: "guessrank" },
  { section: "lol", label: "League of Legends", page: "lol" },
];

const TIER_COLORS = {
  Tin: "#8a8f98",
  Bronze: "#b08d57",
  Silver: "#b8bcc4",
  Gold: "#e0b43c",
  Platinum: "#4aa3a3",
  Diamond: "#4ea1ff",
  Valhallan: "#9b6bd6",
  "Non classé": "#5a606b",
};

function moduleOn(m) {
  const c = CONFIG[m.section] || {};
  return m.on ? !!m.on(c) : !!c.enabled;
}

// Modules activés mais incomplets : ils ne peuvent pas fonctionner.
function configWarnings() {
  const w = [];
  const c = (s) => CONFIG[s] || {};
  const add = (text, page, tab = null) => w.push({ text, page, tab });
  // TikTok : traité à part (tiktokHealth), à partir de l'état réel des sources.
  const wf = c("wordfilter");
  if (wf.enabled && !(wf.words || []).length) add("Le filtre de mots est actif mais sa liste de termes est vide.", "wordfilter", "terms");
  const cl = c("clips");
  if (cl.enabled && !(cl.channelIds || []).length) add("Les réactions aux clips sont actives sans salon surveillé.", "clips", "reactions");
  const gr = c("guessrank");
  if (gr.enabled && !(gr.channelIds || []).length) add("« Devine ton rang » est actif sans salon surveillé.", "clips", "guessrank");
  if (gr.enabled && !(gr.reactions || []).length) add("« Devine ton rang » est actif sans emoji de vote.", "clips", "guessrank");
  const tv = c("tempvoice");
  if (tv.enabled && !Object.keys(tv.hubs || {}).length) add("Les vocaux temporaires sont actifs sans salon hub.", "voice", "temp");
  const rm = c("reminders");
  if (rm.enabled && !rm.channelId) add("Les rappels sont actifs sans salon de publication.", "reminders");
  if (rm.enabled && !(rm.messages || []).some((m) => String(m || "").trim())) add("Les rappels sont actifs sans message.", "reminders");
  const tk = c("tickets");
  if (tk.enabled && (!tk.categoryId || !tk.staffRoleId)) add("Les tickets sont actifs sans catégorie ou rôle staff.", "tickets", "config");
  const wl = c("welcome");
  if (wl.enabled && !wl.channelId) add("Le message d'arrivée est actif sans salon.", "welcome", "arrival");
  if (wl.goodbyeEnabled && !wl.goodbyeChannelId) add("Le message de départ est actif sans salon.", "welcome", "goodbye");
  if (wl.autoRoleEnabled && !(wl.autoRoleIds || []).length) add("L'auto-rôle est actif sans rôle sélectionné.", "welcome", "autorole");
  const lol = c("lol");
  if (lol.enabled && (!lol.roleId || !lol.channelId)) add("L'accueil League of Legends est actif sans rôle ou salon.", "lol");
  return w;
}

function renderOverview(content) {
  const ctx = PAGE.ctx;
  const active = MODULES.filter(moduleOn).length;

  content.append(
    pageHeader({
      title: "Vue d'ensemble",
      description: `${GUILD.name} · ${plural(GUILD.memberCount || 0, "membre", "membres")} · ${active} modules actifs sur ${MODULES.length}`,
      actions: [
        button("Nouvelle annonce", { variant: "primary", icon: "megaphone", onClick: () => navigate("announce") }),
        menuButton(() => [
          { label: "Nouveau giveaway", icon: "gift", onSelect: () => startNewGiveaway() },
          { label: "Resynchroniser les rôles de rank", icon: "refresh", onSelect: () => resyncRoles() },
          "-",
          { label: "Ouvrir le journal", icon: "terminal", onSelect: () => navigate("system", "logs") },
        ]),
      ],
    }),
  );

  // --- 1. Santé ---
  const health = el("div", { class: "health", role: "list", "aria-label": "Santé du bot" });
  const cell = (label) => {
    const value = el("div", { class: "health-value" }, el("span", { class: "skel skel-line", style: "width:70%" }));
    const meta = el("div", { class: "health-meta" }, el("span", { class: "skel skel-line", style: "width:50%" }));
    health.append(el("div", { class: "health-cell", role: "listitem" }, el("div", { class: "health-label" }, label), value, meta));
    return { value, meta };
  };
  const cBot = cell("Bot Discord");
  const cApi = cell("API Brawlhalla");
  const cIndex = cell("Index du classement");
  const cQueue = cell("File de récupération");
  content.append(health);

  // --- 2. À traiter ---
  const attention = el("div", { class: "section" });
  content.append(attention);

  // --- 3. Grille ---
  const left = el("div", { class: "ov-col" });
  const right = el("div", { class: "ov-col" });
  content.append(el("div", { class: "ov-grid" }, left, right));

  const community = el("div", {}, panel(skelLines(4)));
  const activity = el("div", {}, panel(skelLines(5)));
  const communitySection = sectionBlock("Communauté", { description: "Comptes Brawlhalla liés et activité XP." }, community);
  const activitySection = sectionBlock("Activité récente", { actions: [linkButton("Ouvrir le journal", "#/system/logs", { variant: "ghost", size: "sm" })] }, activity);
  communitySection.classList.add("ov-community");
  activitySection.classList.add("ov-activity");
  left.append(communitySection, activitySection);

  const ongoing = el("div", {}, panel(skelLines(3)));
  const modules = panel(
    el(
      "div",
      { class: "list" },
      MODULES.map((m) => {
        const on = moduleOn(m);
        return el(
          "a",
          { class: "list-item", href: "#/" + m.page + (m.tab ? "/" + m.tab : "") },
          el("span", { class: "list-item-main list-item-title" }, m.label),
          statusDot(on ? "ok" : "neutral", on ? "Actif" : "Inactif"),
          icon("chevron-right", 14),
        );
      }),
    ),
  );
  const watchHost = el("div", {}, panel(skelLines(2)));
  const watchSection = sectionBlock("Surveillance", {}, watchHost);
  const ongoingSection = sectionBlock("En cours", {}, ongoing);
  const modulesSection = sectionBlock("Modules", {}, modules);
  watchSection.classList.add("ov-watch");
  ongoingSection.classList.add("ov-ongoing");
  modulesSection.classList.add("ov-modules");
  right.append(watchSection, ongoingSection, modulesSection);

  // --- Données ---
  const settled = Promise.allSettled([
    fetchHealth(),
    api("/api/metrics"),
    api("/api/stats"),
    api("/api/tournament"),
    api("/api/giveaway/list"),
    api("/api/logs?limit=8"),
    api("/api/wordfilter/status"),
    api("/api/tiktok/status"),
  ]);
  settled.then(([h, m, s, t, g, l, wf, tt]) => {
    if (!ctx.alive()) return;
    const val = (r) => (r.status === "fulfilled" ? r.value : null);
    fillHealth({ cBot, cApi, cIndex, cQueue }, val(h), val(m));
    fillAttention(attention, val(t), val(m), { wf: val(wf), tt: val(tt), ttLoaded: tt.status === "fulfilled" });
    fillSurveillance(watchHost, wf, tt);
    fillCommunity(community, s);
    fillOngoing(ongoing, t, g);
    fillActivity(activity, l);
    if (m.status === "fulfilled") setAttention({ api: apiHealthLevel(m.value) });
    if (t.status === "fulfilled") setAttention({ disputes: t.value ? Object.values(t.value.matches || {}).filter((x) => x.status === "dispute").length : 0 });
    if (tt.status === "fulfilled") setAttention({ tiktok: tiktokHealth(CONFIG.tiktok, tt.value).level });
  });
}

// Filtre de mots et TikTok : les deux modules qui tournent en continu, en un coup d'œil.
function fillSurveillance(host, wfR, ttR) {
  const wfCfg = CONFIG.wordfilter || {};
  const ttCfg = CONFIG.tiktok || {};
  const words = (wfCfg.words || []).length;
  let wfMeta;
  if (!wfCfg.enabled) wfMeta = "Inactif : aucun message n'est filtré.";
  else if (wfR.status !== "fulfilled") wfMeta = "Statistiques indisponibles";
  else {
    const s = wfR.value;
    wfMeta = `${plural(s.last24h, "message filtré", "messages filtrés")} en 24 h · ${plural(words, "terme", "termes")}`;
  }
  const wfState = !wfCfg.enabled ? statusDot("neutral", "Inactif") : words ? statusDot("ok", "Actif") : statusDot("warn", "Liste vide");

  const h = tiktokHealth(ttCfg, ttR.status === "fulfilled" ? ttR.value : null);
  const st = ttR.status === "fulfilled" ? ttR.value : null;
  let ttMeta = h.detail || h.title;
  if (h.level === "ok" || h.level === "pending") {
    const last = st && ttTs(st.lastPostAt);
    ttMeta = last ? `Dernière annonce ${fmtRelative(last)}` : "Aucune vidéo annoncée pour l'instant";
  } else if (ttR.status !== "fulfilled" && ttCfg.enabled) ttMeta = "État indisponible";
  const ttShort = { ok: "Actif", pending: "Actif", off: "Inactif", setup: "À configurer", unknown: "Inconnu", degraded: "Dégradé", down: "En panne" }[h.level] || h.title;

  const row = (href, iconName, title, meta, state) =>
    el("a", { class: "list-item", href }, icon(iconName, 16), el("div", { class: "list-item-main" }, el("div", { class: "list-item-title" }, title), el("div", { class: "list-item-meta" }, meta)), state, icon("chevron-right", 14));

  clearNode(host).append(
    panel(
      el(
        "div",
        { class: "list" },
        row("#/wordfilter", "message-x", "Filtre de mots", wfMeta, wfState),
        row("#/tiktok", "music", ttCfg.account ? `TikTok · @${ttCfg.account}` : "TikTok", ttMeta, statusDot(h.kind, ttShort)),
      ),
    ),
  );
}

function setCell(c, valueNode, metaText) {
  clearNode(c.value).append(valueNode);
  clearNode(c.meta).append(metaText || "");
}

function fillHealth(cells, h, m) {
  if (h && h.discord) {
    const up = h.discord.connected;
    setCell(cells.cBot, statusDot(up ? "ok" : "danger", up ? "Connecté" : "Déconnecté", { strong: true }), [h.discord.pingMs >= 0 ? `Latence ${fmtNum(h.discord.pingMs)} ms` : null, `actif depuis ${fmtDuration((h.uptimeSec || 0) * 1000)}`].filter(Boolean).join(" · "));
  } else setCell(cells.cBot, statusDot("neutral", "Inconnu", { strong: true }), "État indisponible");

  if (m) {
    const level = apiHealthLevel(m);
    const kind = level === "ok" ? "ok" : level === "down" ? "danger" : "warn";
    const text = !m.meaningful ? "Aucune requête" : m.cooldownActiveMs > 0 ? "Cooldown en cours" : `${fmtPct(m.successRate, 1)} de succès`;
    setCell(cells.cApi, statusDot(m.meaningful ? kind : "neutral", text, { strong: true }), `sur ${plural(m.requests || 0, "requête", "requêtes")}`);
    const idx = m.index || {};
    setCell(cells.cIndex, el("span", { class: "status status-strong num" }, plural(idx.count || 0, "joueur", "joueurs")), idx.ageMs !== null && idx.ageMs !== undefined ? `Synchronisé il y a ${fmtDuration(idx.ageMs)}` : "Jamais synchronisé");
    const pending = (m.pendingProfiles || 0) + (m.pendingSearches || 0);
    setCell(cells.cQueue, statusDot(pending ? "warn" : "ok", pending ? `${fmtNum(pending)} en attente` : "Vide", { strong: true }), pending ? "Profils et recherches à réessayer" : "Aucune requête en attente");
  } else {
    for (const c of [cells.cApi, cells.cIndex, cells.cQueue]) setCell(c, statusDot("neutral", "Indisponible", { strong: true }), "Métriques non chargées");
  }
}

function fillAttention(host, t, m, { wf = null, tt = null, ttLoaded = false } = {}) {
  const items = [];
  // TikTok : réglage manquant (même sans état) ou source en panne (état chargé).
  const h = tiktokHealth(CONFIG.tiktok, ttLoaded ? tt : null);
  if (h.level === "setup") items.push({ kind: "warn", text: `TikTok est actif mais incomplet : ${h.title.toLowerCase()}.`, action: "Configurer", page: "tiktok" });
  else if (h.level === "down") items.push({ kind: "danger", text: `TikTok · ${h.title}. ${h.detail}`, action: "Voir l'état", page: "tiktok" });
  else if (h.level === "degraded") items.push({ kind: "warn", text: `TikTok · ${h.title}. ${h.detail}`, action: "Voir l'état", page: "tiktok" });
  // Filtre de mots actif mais sans le droit de supprimer : il ne sert à rien.
  const wfCfg = CONFIG.wordfilter || {};
  if (wf && wfCfg.enabled && wfCfg.action !== "flag" && wf.permissions && !wf.permissions.manageMessages) {
    items.push({ kind: "danger", text: "Le filtre de mots est actif mais le bot n'a pas la permission « Gérer les messages » : aucun message n'est supprimé.", action: "Voir", page: "wordfilter" });
  }
  if (t) {
    const n = Object.values(t.matches || {}).filter((x) => x.status === "dispute").length;
    if (n) items.push({ kind: "warn", text: `${plural(n, "litige", "litiges")} à trancher dans « ${t.name} »`, action: "Trancher", page: "tournament", tab: "current" });
  }
  if (m) {
    const level = apiHealthLevel(m);
    if (level !== "ok") items.push({ kind: level === "down" ? "danger" : "warn", text: level === "down" ? "L'API Brawlhalla est perturbée : les rangs ne se mettent plus à jour." : "L'API Brawlhalla est dégradée : certaines mises à jour peuvent échouer.", action: "Voir le détail", page: "system", tab: "api" });
  }
  for (const w of configWarnings()) items.push({ kind: "warn", text: w.text, action: "Configurer", page: w.page, tab: w.tab });

  clearNode(host);
  if (!items.length) {
    host.append(callout("ok", "Rien à signaler : les modules actifs sont configurés et aucun litige n'est en attente."));
    return;
  }
  host.append(
    el("div", { class: "section-head" }, el("div", { class: "section-title-row" }, el("h2", { class: "section-title" }, "À traiter"), el("span", { class: "badge badge-warn", "aria-label": plural(items.length, "élément", "éléments") }, fmtNum(items.length)))),
    panel(
      el(
        "div",
        { class: "list" },
        items.map((it) =>
          el(
            "div",
            { class: "list-item " + it.kind },
            icon(it.kind === "danger" ? "alert-circle" : "alert-triangle", 16),
            el("span", { class: "list-item-main" }, it.text),
            linkButton(it.action, "#/" + it.page + (it.tab ? "/" + it.tab : ""), { variant: "ghost", size: "sm" }),
          ),
        ),
      ),
    ),
  );
}

function fillCommunity(host, r) {
  clearNode(host);
  if (r.status !== "fulfilled") {
    host.append(panel(inlineError("Statistiques indisponibles : " + r.reason.message, () => rerenderPage())));
    return;
  }
  const s = r.value;
  const stats = statGrid(
    [
      { label: "Comptes liés", value: fmtNum(s.linkedCount), hint: s.memberCount ? `${fmtPct(s.linkedCount / s.memberCount, 1)} des membres` : null },
      { label: "Membres avec XP", value: fmtNum(s.xp.members) },
      { label: "XP totale", value: fmtCompact(s.xp.totalXp), title: fmtNum(s.xp.totalXp) },
      { label: "Niveau le plus haut", value: fmtNum(s.xp.topLevel) },
    ],
    { inPanel: true },
  );
  // Du tier le plus haut au plus bas, « Non classé » en dernier.
  const rank = (label) => (GUILD.tiers || []).indexOf(label);
  const tiers = Object.entries(s.tierCounts || {})
    .map(([label, value]) => ({ label, value, color: TIER_COLORS[label] }))
    .sort((a, b) => rank(b.label) - rank(a.label));
  const body = el("div", { class: "panel-body" });
  if (!tiers.length) {
    body.append(
      emptyState({
        icon: "link",
        title: "Aucun compte lié",
        text: "Les membres lient leur compte avec /lier ou le panneau de liaison. La répartition par tier apparaîtra ici.",
        actions: [linkButton("Configurer le panneau", "#/linking/panel", { size: "sm" })],
        compact: true,
      }),
    );
  } else {
    body.append(el("div", { class: "aside-label" }, el("span", {}, "Comptes liés par tier 1v1"), el("span", { class: "text-3" }, "du plus haut au plus bas")), barList(tiers));
  }
  host.append(el("div", { class: "panel" }, stats, body));
}

function fillOngoing(host, tr, gr) {
  clearNode(host);
  const list = el("div", { class: "list" });
  if (tr.status === "fulfilled") {
    const t = tr.value;
    if (t) {
      const disputes = Object.values(t.matches || {}).filter((x) => x.status === "dispute").length;
      list.append(
        el(
          "a",
          { class: "list-item", href: "#/tournament" },
          icon("trophy", 16),
          el("div", { class: "list-item-main" }, el("div", { class: "list-item-title" }, t.name), el("div", { class: "list-item-meta" }, `${TOURNAMENT_STATUS[t.status] || t.status} · ${fmtNum(t.participants.length)}/${fmtNum(t.maxParticipants)} inscrits`)),
          disputes ? badge(plural(disputes, "litige", "litiges"), "warn") : null,
          icon("chevron-right", 14),
        ),
      );
    } else {
      list.append(el("a", { class: "list-item", href: "#/tournament" }, icon("trophy", 16), el("div", { class: "list-item-main" }, el("div", { class: "list-item-title text-2" }, "Aucun tournoi en cours")), el("span", { class: "text-sm text-2" }, "Créer"), icon("chevron-right", 14)));
    }
  } else list.append(inlineError("Tournoi indisponible : " + tr.reason.message));

  if (gr.status === "fulfilled") {
    const act = gr.value.active || [];
    if (!act.length) {
      list.append(el("a", { class: "list-item", href: "#/giveaway" }, icon("gift", 16), el("div", { class: "list-item-main" }, el("div", { class: "list-item-title text-2" }, "Aucun giveaway en cours")), el("span", { class: "text-sm text-2" }, "Lancer"), icon("chevron-right", 14)));
    }
    for (const g of act.slice(0, 3)) {
      list.append(
        el(
          "a",
          { class: "list-item", href: "#/giveaway" },
          icon("gift", 16),
          el("div", { class: "list-item-main" }, el("div", { class: "list-item-title" }, g.prize), el("div", { class: "list-item-meta" }, plural(g.entries, "participant", "participants"), " · se termine ", timeAgo(g.endsTs))),
          icon("chevron-right", 14),
        ),
      );
    }
    if (act.length > 3) list.append(el("a", { class: "list-item", href: "#/giveaway" }, el("span", { class: "list-item-main text-sm text-2" }, `${act.length - 3} autres giveaways en cours`), icon("chevron-right", 14)));
  } else list.append(inlineError("Giveaways indisponibles : " + gr.reason.message));
  host.append(panel(list));
}

function fillActivity(host, r) {
  clearNode(host);
  if (r.status !== "fulfilled") {
    host.append(panel(inlineError("Journal indisponible : " + r.reason.message, () => rerenderPage())));
    return;
  }
  const lines = (r.value.lines || []).slice(-8).reverse();
  if (!lines.length) {
    host.append(panel(emptyState({ icon: "terminal", title: "Aucune activité récente", text: "Les actions du bot apparaîtront ici.", compact: true })));
    return;
  }
  host.append(
    panel(
      lines.map((l) =>
        el(
          "div",
          { class: "log-mini" + (l.level === "warn" ? " warn" : l.level === "error" ? " error" : "") },
          el("span", { class: "log-mini-time" }, fmtTime(l.ts, true)),
          el("span", { class: "log-mini-msg", title: l.msg }, l.level === "error" ? "Erreur · " : l.level === "warn" ? "Avertissement · " : "", l.msg),
        ),
      ),
    ),
  );
}
