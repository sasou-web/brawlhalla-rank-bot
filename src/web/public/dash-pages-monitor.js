/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 5/10
   Pages de pilotage : accueil, statistiques, logs, fiabilité API, rôles, vocaux par rank
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
