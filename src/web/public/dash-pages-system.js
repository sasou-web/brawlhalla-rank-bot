/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · système
   Santé & journal (fiabilité de l'API Brawlhalla, journal en direct) et
   paramètres généraux.
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

function renderSystem(ctx) {
  ctx.root.append(pageHeader({ title: "Santé & journal", description: "Fiabilité de l'API Brawlhalla observée par le bot et journal de ses actions.", hasTabs: true }));
  pageTabs(ctx, (tab, host, scope) => {
    if (tab === "logs") logsTab(host, scope);
    else apiTab(host, scope);
  });
}

// ═══════════════════ Fiabilité API ═══════════════════
function apiTab(host, scope) {
  let paused = false;
  const updated = el("span", { class: "text-sm text-3", "aria-live": "off" });
  const pauseBtn = iconButton("pause", "Suspendre l'actualisation", () => {
    paused = !paused;
    const label = paused ? "Reprendre l'actualisation" : "Suspendre l'actualisation";
    pauseBtn.setAttribute("aria-label", label);
    pauseBtn.setAttribute("data-tip", label);
    clearNode(pauseBtn).append(icon(paused ? "play" : "pause", 16));
    if (!paused) load();
  });
  const statusHost = el("div", { class: "api-status" }, el("span", { class: "skel skel-line", style: "width:240px;height:20px" }));
  const bodyHost = el("div", {}, panel(skelLines(6)));
  const errorHost = el("div");
  host.append(statusHost, errorHost, bodyHost);

  let hadData = false;
  async function load() {
    let m;
    let h;
    try {
      [m, h] = await Promise.all([api("/api/metrics"), fetchHealth()]);
    } catch (e) {
      if (!host.isConnected) return;
      clearNode(errorHost);
      if (hadData) errorHost.append(el("div", { style: "margin-bottom:16px" }, callout("warn", "Dernière actualisation échouée : " + e.message + ". Les valeurs affichées peuvent être obsolètes.")));
      else clearNode(bodyHost).append(panel(inlineError("Métriques indisponibles : " + e.message, () => load())));
      return;
    }
    if (!host.isConnected) return;
    hadData = true;
    clearNode(errorHost);
    setAttention({ api: apiHealthLevel(m) });
    drawStatus(m, h);
    drawBody(m, h);
  }

  function drawStatus(m, h) {
    const level = apiHealthLevel(m);
    const kind = !m.meaningful ? "" : level === "ok" ? "ok" : level === "down" ? "danger" : "warn";
    const title = !m.meaningful ? "Aucune requête pour l'instant" : level === "ok" ? "Opérationnelle" : level === "down" ? "Perturbée" : "Dégradée";
    const since = m.uptimeMs ? ` depuis le démarrage du bot (il y a ${fmtDuration(m.uptimeMs)})` : "";
    const summary = m.meaningful ? `${fmtPct(m.successRate, 1)} de requêtes réussies sur ${fmtNum(m.meaningful)}${since}.` : `Le bot n'a encore interrogé l'API Brawlhalla${since}.`;
    updated.textContent = "Actualisé à " + fmtTime(Date.now(), true);
    clearNode(statusHost).append(
      el(
        "div",
        { class: "ph-text" },
        el("h2", { class: "api-status-title " + kind }, el("span", { class: "dot", "aria-hidden": "true" }), "API Brawlhalla : ", title),
        el("p", { class: "text-2", style: "margin-top:2px" }, summary),
        h && h.discord ? el("p", { class: "text-sm text-2", style: "margin-top:4px" }, `Bot Discord ${h.discord.connected ? "connecté" : "déconnecté"}${h.discord.pingMs >= 0 ? `, latence ${fmtNum(h.discord.pingMs)} ms` : ""}.`) : null,
      ),
      el("div", { class: "row" }, updated, pauseBtn),
    );
  }

  function drawBody(m) {
    const dl = (rows) =>
      el(
        "dl",
        { class: "dl" },
        rows.flatMap(([k, v, cls]) => [el("dt", {}, k), el("dd", { class: cls || null }, v)]),
      );
    const idx = m.index || {};
    const cooldown = m.cooldownActiveMs > 0;
    const pendingP = m.pendingProfiles || 0;
    const pendingS = m.pendingSearches || 0;
    const groupsEl = el(
      "div",
      { class: "metric-groups" },
      el(
        "div",
        {},
        el("h3", { class: "metric-group-title" }, "Requêtes"),
        dl([
          ["Tentatives HTTP", fmtNum(m.requests || 0)],
          ["Réussies", fmtNum(m.ok || 0)],
          ["Nouvelles tentatives", fmtNum(m.retries || 0)],
          ["Absences légitimes (404)", fmtNum(m.notFound || 0)],
        ]),
      ),
      el(
        "div",
        {},
        el("h3", { class: "metric-group-title" }, "Erreurs"),
        dl([
          ["Limite de débit (429)", fmtNum(m.rateLimited || 0)],
          ["Erreurs serveur (5xx)", fmtNum(m.serverErrors || 0)],
          ["Autres erreurs 4xx", fmtNum(m.otherClient || 0)],
          ["Erreurs réseau", fmtNum(m.networkErrors || 0)],
        ]),
      ),
      el(
        "div",
        {},
        el("h3", { class: "metric-group-title" }, "État"),
        dl([
          ["Cooldown en cours", cooldown ? fmtDuration(m.cooldownActiveMs) : "Aucun"],
          ["Cooldowns posés", fmtNum(m.cooldowns || 0)],
          ["File de profils", fmtNum(pendingP)],
          ["File de recherches", fmtNum(pendingS)],
          ["Joueurs indexés", fmtNum(idx.count || 0)],
          ["Dernière synchro de l'index", idx.ageMs !== null && idx.ageMs !== undefined ? `il y a ${fmtDuration(idx.ageMs)}` : "Jamais"],
          ["Dernier succès", m.lastSuccessTs ? fmtTime(m.lastSuccessTs, true) : "—"],
        ]),
      ),
    );
    clearNode(bodyHost).append(el("div", { class: "panel" }, el("div", { class: "panel-body" }, groupsEl)));
    if (m.lastError) {
      const e = m.lastError;
      bodyHost.append(
        el(
          "div",
          { style: "margin-top:16px" },
          callout("danger", `${e.status ? `HTTP ${e.status} · ` : ""}${e.message} (${fmtTime(e.ts, true)}, ${fmtRelative(e.ts)})`, { title: "Dernière erreur" }),
        ),
      );
    }
  }

  load();
  scope.interval(() => {
    if (!paused) load();
  }, 5000);
}

// ═══════════════════ Journal ═══════════════════
function logsTab(host, scope) {
  const state = { q: "", level: "all", live: true, lines: [], loaded: false, error: null };
  const search = el("input", { class: "input input-sm", type: "search", placeholder: "Filtrer le journal", "aria-label": "Filtrer le journal", autocomplete: "off" });
  search.addEventListener(
    "input",
    debounce(() => {
      state.q = search.value.trim();
      draw(true);
    }, 120),
  );
  const levels = segmented(
    [
      { value: "all", label: "Tout" },
      { value: "warn", label: "Avertissements" },
      { value: "error", label: "Erreurs" },
    ],
    "all",
    (v) => {
      state.level = v;
      draw(true);
    },
    { label: "Niveau" },
  );
  const liveId = uid("live");
  const live = switchControl({
    checked: true,
    id: liveId,
    onChange: (v) => {
      state.live = v;
      if (v) load();
    },
  });
  const count = el("span", { class: "text-sm text-3", "aria-live": "polite" });
  const view = el("div", { class: "log-view", role: "log", "aria-label": "Journal du bot", tabindex: "0" });
  const jump = button("Aller aux dernières lignes", { size: "sm", icon: "arrow-down", className: "log-jump", onClick: () => { view.scrollTop = view.scrollHeight; jump.hidden = true; } });
  jump.hidden = true;
  view.addEventListener("scroll", () => {
    if (atBottom()) jump.hidden = true;
  });

  host.append(
    el(
      "div",
      { class: "panel" },
      el(
        "div",
        { class: "log-toolbar" },
        el("div", { class: "dt-search" }, icon("search", 14), search),
        levels,
        el("span", { class: "spacer" }),
        count,
        el("span", { class: "row" }, live, el("label", { for: liveId, class: "text-sm" }, "Suivi en direct")),
      ),
      el("div", { class: "log-wrap" }, view, jump),
    ),
  );

  function atBottom() {
    return view.scrollHeight - view.scrollTop - view.clientHeight < 24;
  }

  function filtered() {
    const q = normText(state.q);
    return state.lines.filter((l) => {
      if (state.level === "warn" && l.level !== "warn" && l.level !== "error") return false;
      if (state.level === "error" && l.level !== "error") return false;
      return !q || normText(l.msg).includes(q);
    });
  }

  function draw(forceBottom) {
    const stick = forceBottom || atBottom();
    clearNode(view);
    if (state.error && !state.loaded) {
      view.append(inlineError("Journal indisponible : " + state.error, () => load()));
      count.textContent = "";
      return;
    }
    if (!state.loaded) {
      view.append(skelLines(8));
      return;
    }
    const list = filtered();
    count.textContent = list.length === state.lines.length ? plural(state.lines.length, "ligne", "lignes") : `${fmtNum(list.length)} sur ${fmtNum(state.lines.length)}`;
    if (!state.lines.length) {
      view.append(emptyState({ icon: "terminal", title: "Aucune ligne récente", text: "Les actions du bot apparaîtront ici en direct.", compact: true }));
      return;
    }
    if (!list.length) {
      view.append(emptyState({ icon: "search", title: "Aucune ligne ne correspond", text: state.q ? `Rien pour « ${state.q} » avec ce filtre.` : "Aucune ligne de ce niveau.", compact: true }));
      return;
    }
    const lvl = { warn: "WARN", error: "ERREUR" };
    for (const l of list) {
      view.append(
        el(
          "div",
          { class: "log-line" + (l.level === "warn" ? " warn" : l.level === "error" ? " error" : "") },
          el("span", { class: "log-time" }, fmtTime(l.ts, true)),
          el("span", { class: "log-lvl" }, lvl[l.level] || "INFO"),
          el("span", { class: "log-msg" }, l.msg),
        ),
      );
    }
    if (stick) {
      view.scrollTop = view.scrollHeight;
      jump.hidden = true;
    }
  }

  async function load() {
    try {
      const r = await api("/api/logs?limit=400");
      if (!host.isConnected) return;
      const before = state.lines.length ? state.lines[state.lines.length - 1].ts : 0;
      state.lines = r.lines || [];
      state.loaded = true;
      state.error = null;
      const stick = atBottom();
      draw(!before);
      const newer = state.lines.length && state.lines[state.lines.length - 1].ts > before;
      if (before && newer && !stick) jump.hidden = false;
    } catch (e) {
      state.error = e.message;
      if (host.isConnected && !state.loaded) draw();
    }
  }

  draw();
  load();
  scope.interval(() => {
    if (state.live) load();
  }, 3000);
}

// ═══════════════════ Paramètres ═══════════════════
function renderSettings(ctx) {
  const f = configForm("settings");
  const s = f.data;
  ctx.root.append(pageHeader({ title: "Paramètres", description: "Salons système du bot et préférences de l'interface." }));
  const theme = segmented(
    [
      { value: "system", label: "Système" },
      { value: "light", label: "Clair" },
      { value: "dark", label: "Sombre" },
    ],
    themePref(),
    (v) => applyTheme(v),
    { label: "Thème" },
  );
  ctx.root.append(
    groups(
      settingsGroup(
        "Journal et alertes",
        "Là où le bot rend compte de son activité au staff.",
        field("Salon d'audit", channelPicker(s, "auditChannelId", "text"), { help: "Liaisons, déliaisons, resynchronisations et actions du staff." }),
        field("Salon d'alertes", channelPicker(s, "alertChannelId", "text"), { help: "Crash, déconnexion Discord, API indisponible. Vide : salon d'audit." }),
      ),
      settingsGroup("Succès", "Annonce des succès débloqués par les membres, sans mention.", field("Salon des succès", channelPicker(s, "achievementsChannelId", "text"), { help: "Vide : annonces désactivées." })),
      settingsGroup("Apparence", "Préférence enregistrée sur cet appareil.", field("Thème", theme)),
    ),
  );
}
