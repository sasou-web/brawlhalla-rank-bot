/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · ladder
   Classement Elo interne par défis 1v1 (/defi, /ladder) : suivi des défis,
   litiges à trancher, réglages, saisons archivées.
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

const LADDER_STATUS = {
  pending: ["neutral", "En attente de réponse"],
  accepted: ["info", "En cours"],
  reported: ["warn", "À confirmer"],
  disputed: ["danger", "Litige"],
};

function renderLadder(ctx) {
  const f = configForm("ladder");
  const c = f.data;
  ctx.root.append(
    pageHeader({
      title: "Ladder",
      description: "Classement Elo interne par défis 1v1 : /defi pour défier un membre, /ladder pour le classement. Le perdant confirme le score ; le staff tranche les litiges.",
      hasTabs: true,
      actions: [moduleSwitch("ladder", "Ladder")],
    }),
  );
  pageTabs(ctx, (tab, host, scope) => {
    if (tab === "settings") ladderSettingsTab(host, c);
    else if (tab === "seasons") ladderSeasonsTab(host);
    else ladderLiveTab(host, scope);
  });
}

function ladderName(id, name) {
  return name || `Membre ${id}`;
}

function ladderSigned(n) {
  return n > 0 ? `+${n}` : String(n);
}

function ladderStreak(s) {
  if (s > 0) return `${s} victoire${s > 1 ? "s" : ""}`;
  if (s < 0) return `${-s} défaite${s < -1 ? "s" : ""}`;
  return "—";
}

// ═══════════════════ Suivi ═══════════════════
function ladderLiveTab(host, scope) {
  const body = el("div", { "aria-live": "polite" }, panel(skelLines(5)));
  host.append(body);
  let hadData = false;

  async function load() {
    let s;
    try {
      s = await api("/api/ladder/status");
    } catch (e) {
      if (!host.isConnected) return;
      if (!hadData) clearNode(body).append(panel(inlineError("État du ladder indisponible : " + e.message, load)));
      else toast("Actualisation du ladder impossible : " + e.message, "err");
      return;
    }
    if (!host.isConnected) return;
    hadData = true;
    setAttention({ ladderDisputes: s.stats.disputes });
    draw(s);
  }

  function draw(s) {
    clearNode(body);
    const cfg = CONFIG.ladder || {};
    const notices = el("div", { class: "stack", style: "margin-bottom:24px" });
    if (!cfg.enabled) notices.append(callout("info", "Le ladder est désactivé : /defi et /ladder répondent qu'il n'est pas actif, et aucun défi n'expire ni n'est validé automatiquement."));
    if (!cfg.channelId) notices.append(callout("warn", "Aucun salon du ladder : les défis ne peuvent pas être publiés. Choisis-le dans l'onglet Réglages."));
    if (!cfg.modAlertChannelId) notices.append(callout("info", "Aucun salon d'alerte : les litiges ne sont signalés qu'ici et dans le salon d'audit."));
    if (notices.children.length) body.append(notices);

    body.append(
      sectionBlock(
        `Saison ${s.season.number}`,
        { description: s.season.startedAt ? `Depuis le ${fmtDate(s.season.startedAt)}.` : "Première saison, depuis l'activation du ladder." },
        statGrid([
          { label: "Joueurs classés", value: fmtNum(s.stats.ranked) },
          { label: "Défis validés", value: fmtNum(s.stats.validated) },
          { label: "Défis ouverts", value: fmtNum(s.stats.active) },
          { label: "À confirmer", value: fmtNum(s.stats.waiting) },
          { label: "Litiges", value: fmtNum(s.stats.disputes) },
        ]),
      ),
    );

    if (s.disputes.length || s.waiting.length) {
      body.append(
        sectionBlock(
          "À traiter",
          { description: "Tu peux trancher un litige, ou valider un score sans attendre le perdant. L'Elo est mis à jour et le résultat annoncé dans le salon du ladder." },
          el(
            "div",
            { class: "stack" },
            s.disputes.length ? ladderMatchPanel(`Litiges à trancher (${s.disputes.length})`, s.disputes, load, { warn: true }) : null,
            s.waiting.length ? ladderMatchPanel(`En attente de confirmation du perdant (${s.waiting.length})`, s.waiting, load) : null,
          ),
        ),
      );
    }

    body.append(
      sectionBlock(
        "Classement",
        { description: "À égalité d'Elo : le plus de victoires, puis le moins de défaites." },
        dataTable({
          label: "Classement du ladder",
          rows: s.ranking,
          searchable: s.ranking.length > 10,
          searchPlaceholder: "Rechercher un joueur",
          searchText: (r) => ladderName(r.userId, r.name),
          initialSort: { key: "position", dir: "asc" },
          empty: emptyState({ icon: "trending-up", title: "Personne n'est classé", text: "Le classement se remplit au premier défi validé.", compact: true }),
          columns: [
            { key: "position", label: "#", sortable: true, width: "56px", render: (r) => `#${r.position}` },
            { key: "name", label: "Joueur", primary: true, sortable: true, sortValue: (r) => ladderName(r.userId, r.name).toLowerCase(), render: (r) => cellTitle(ladderName(r.userId, r.name), null) },
            { key: "elo", label: "Elo", align: "right", sortable: true, meta: true, render: (r) => fmtNum(r.elo) },
            { key: "wins", label: "Victoires", align: "right", sortable: true, meta: true, render: (r) => fmtNum(r.wins) },
            { key: "losses", label: "Défaites", align: "right", sortable: true, meta: true, render: (r) => fmtNum(r.losses) },
            { key: "streak", label: "Série", sortable: true, meta: true, hideSm: true, render: (r) => ladderStreak(r.streak) },
            { key: "updatedAt", label: "Dernier défi", sortable: true, meta: true, hideSm: true, render: (r) => fmtRelative(r.updatedAt) },
          ],
        }),
      ),
    );

    body.append(
      sectionBlock(
        "Défis ouverts",
        { description: "Un défi sans réponse expire après 24 h, un défi accepté sans score final aussi." },
        dataTable({
          label: "Défis ouverts",
          rows: s.active,
          initialSort: { key: "createdAt", dir: "desc" },
          empty: emptyState({ icon: "inbox", title: "Aucun défi ouvert", compact: true }),
          columns: [
            { key: "players", label: "Défi", primary: true, render: (m) => cellTitle(`${ladderName(m.aId, m.aName)} contre ${ladderName(m.bId, m.bName)}`, `BO${m.bestOf}`) },
            { key: "status", label: "Statut", meta: true, render: (m) => statusDot(...LADDER_STATUS[m.status]) },
            { key: "score", label: "Score", align: "right", meta: true, render: (m) => `${m.scoreA}–${m.scoreB}` },
            { key: "createdAt", label: "Lancé", sortable: true, meta: true, hideSm: true, render: (m) => fmtRelative(m.createdAt) },
            { key: "link", label: "", render: (m) => ladderCardLink(m) },
          ],
        }),
      ),
    );

    body.append(
      sectionBlock(
        "Derniers résultats",
        { description: "Les 15 derniers défis validés, par le perdant, automatiquement ou par le staff." },
        dataTable({
          label: "Derniers défis validés",
          rows: s.recent,
          empty: emptyState({ icon: "trophy", title: "Aucun défi validé", compact: true }),
          columns: [
            { key: "result", label: "Résultat", primary: true, render: (m) => cellTitle(ladderResultText(m), `BO${m.bestOf}`) },
            { key: "eloDelta", label: "Elo", align: "right", meta: true, render: (m) => `${ladderSigned(m.eloDelta)} / ${ladderSigned(-m.eloDelta)}` },
            { key: "how", label: "Validation", meta: true, hideSm: true, render: (m) => (m.status === "resolved" ? "Staff" : m.resolvedBy ? "Perdant" : "Automatique") },
            { key: "resolvedAt", label: "Date", meta: true, hideSm: true, render: (m) => fmtRelative(m.resolvedAt) },
          ],
        }),
      ),
    );
  }

  load();
  scope.interval(load, 60000);
}

function ladderResultText(m) {
  const aWon = m.winnerId === m.aId;
  const w = aWon ? ladderName(m.aId, m.aName) : ladderName(m.bId, m.bName);
  const l = aWon ? ladderName(m.bId, m.bName) : ladderName(m.aId, m.aName);
  return `${w} bat ${l} ${Math.max(m.scoreA, m.scoreB)}–${Math.min(m.scoreA, m.scoreB)}`;
}

function ladderCardLink(m) {
  if (!m.channelId || !m.messageId) return null;
  return linkButton("Voir", `${discordChannelUrl(m.channelId)}/${m.messageId}`, { variant: "ghost", size: "sm", external: true });
}

// Liste de défis à trancher (litiges, ou résultats que le perdant n'a pas confirmés).
function ladderMatchPanel(title, matches, reload, { warn = false } = {}) {
  const rows = matches.map((m) => {
    const A = ladderName(m.aId, m.aName);
    const B = ladderName(m.bId, m.bName);
    const meta = [`BO${m.bestOf}`, `score ${m.scoreA}–${m.scoreB}`];
    if (m.status === "reported" && m.autoConfirmAt) meta.push(`validation automatique ${fmtRelative(m.autoConfirmAt)}`);
    if (m.status === "reported" && !m.autoConfirmAt) meta.push("pas de validation automatique");
    const d = m.dispute;
    const why = d
      ? el("div", { class: "list-item-meta" }, `${d.byName ? d.byName + " : " : ""}« ${d.reason || "Non précisée"} »${d.files ? ` · ${plural(d.files, "capture envoyée", "captures envoyées")} au salon d'alerte` : ""}`)
      : null;
    return el(
      "div",
      { class: "list-item wrap" + (warn ? " warn" : "") },
      icon(warn ? "alert-triangle" : "clock", 16),
      el("div", { class: "list-item-main" }, el("div", { class: "list-item-title" }, `${A} contre ${B}`), el("div", { class: "list-item-meta" }, meta.join(" · ")), why),
      el(
        "div",
        { class: "row" },
        button(`Victoire ${A}`, { size: "sm", onClick: () => ladderResolve(m, "a", reload) }),
        button(`Victoire ${B}`, { size: "sm", onClick: () => ladderResolve(m, "b", reload) }),
        button("Annuler", { size: "sm", variant: "ghost", onClick: () => ladderVoid(m, reload) }),
        ladderCardLink(m),
      ),
    );
  });
  return el("div", { class: "panel" }, panelHead(title), el("div", { class: "list" }, rows));
}

async function ladderResolve(m, side, reload) {
  const winner = side === "a" ? ladderName(m.aId, m.aName) : ladderName(m.bId, m.bName);
  const loser = side === "a" ? ladderName(m.bId, m.bName) : ladderName(m.aId, m.aName);
  const ok = await confirmDialog({
    title: "Trancher le défi",
    message: ["Donner la victoire à ", el("strong", {}, winner), " contre ", el("strong", {}, loser), " ? L'Elo des deux joueurs est mis à jour et le résultat est annoncé dans le salon du ladder."],
    confirmLabel: "Confirmer la victoire",
  });
  if (!ok) return;
  const r = await api("/api/ladder/resolve", "POST", { matchId: m.id, winner: side });
  toast(`Victoire attribuée à ${winner} (${ladderSigned(r.delta)} Elo)`, "ok");
  reload();
}

async function ladderVoid(m, reload) {
  const ok = await confirmDialog({
    title: "Annuler le défi ?",
    message: ["Le défi ", el("strong", {}, `${ladderName(m.aId, m.aName)} contre ${ladderName(m.bId, m.bName)}`), " est clos sans vainqueur : aucun point n'est attribué."],
    confirmLabel: "Annuler le défi",
    cancelLabel: "Garder",
    danger: true,
  });
  if (!ok) return;
  await api("/api/ladder/void", "POST", { matchId: m.id });
  toast("Défi annulé", "ok");
  reload();
}

// ═══════════════════ Réglages ═══════════════════
function ladderSettingsTab(host, c) {
  const resetDays = [{ value: 0, label: "Jamais (manuelle uniquement)" }].concat(Array.from({ length: 28 }, (_, i) => ({ value: i + 1, label: i === 0 ? "Le 1er du mois" : `Le ${i + 1} du mois` })));
  host.append(
    groups(
      settingsGroup(
        "Défis",
        "Un défi par paire à la fois, 10 minutes entre deux défis lancés par un même joueur.",
        field("Salon du ladder", channelPicker(c, "channelId", "text"), { help: "Cartes des défis, scoreboards et annonces des résultats. Le bot doit pouvoir y écrire et intégrer des liens." }),
        switchField("Exiger un compte lié", c, "requireLink", { help: "Les deux joueurs doivent avoir lié leur compte Brawlhalla avec /lier." }),
        field("Défis par paire et par jour", numberInput(c, "maxPerDayPerPair", { min: 1, max: 20 }), { help: "Sur 24 h glissantes, défis refusés ou expirés compris." }),
      ),
      settingsGroup(
        "Validation du score",
        "Le perdant confirme le score final ; un litige bloque le défi jusqu'à la décision du staff.",
        field("Validation automatique après", numberInput(c, "autoConfirmHours", { min: 0, max: 72, suffix: "h" }), { help: "Si le perdant ne répond pas. 0 : jamais, le staff tranche depuis cette page." }),
      ),
      settingsGroup(
        "Elo",
        "Les nouveaux réglages s'appliquent aux prochains défis validés.",
        fieldRow(
          field("Elo de départ", numberInput(c, "startElo", { min: 100, max: 3000, size: "md" })),
          field("Facteur K", numberInput(c, "kFactor", { min: 8, max: 64 }), { help: "À Elo égal, le vainqueur gagne K/2 points." }),
        ),
      ),
      settingsGroup(
        "Saison",
        "À la clôture, le top 10 est archivé, le podium annoncé et tout le monde repart de l'Elo de départ.",
        field("Nouvelle saison automatique", selectInput(c, "resetDay", resetDays, { size: "md" }), { help: "Heure de Paris. Changer la date ne déclenche jamais de remise à zéro immédiate." }),
      ),
      settingsGroup(
        "Staff",
        "Les membres avec la permission « Gérer le serveur » peuvent toujours trancher.",
        field("Rôle staff", rolePicker(c, "modRoleId"), { help: "Mentionné dans les alertes et autorisé à trancher depuis Discord.", optional: true }),
        field("Salon des alertes", channelPicker(c, "modAlertChannelId", "text"), { help: "Litiges avec raison et captures, boutons de décision.", optional: true }),
      ),
    ),
  );
}

// ═══════════════════ Saisons ═══════════════════
function ladderSeasonsTab(host) {
  const body = el("div", {}, panel(skelLines(4)));
  host.append(body);

  async function closeSeason(s) {
    const ok = await confirmDialog({
      title: `Clore la saison ${s.season.number} ?`,
      message: `Le top 10 est archivé, le podium est annoncé dans le salon du ladder et ${plural(s.stats.ranked, "le joueur classé repart", "les joueurs classés repartent")} de l'Elo de départ. Les défis en cours continuent et compteront pour la saison suivante. Cette action est irréversible.`,
      confirmLabel: "Clore la saison",
      danger: true,
    });
    if (!ok) return;
    await api("/api/ladder/reset", "POST", {});
    toast(`Saison ${s.season.number} close`, "ok");
    load();
  }

  async function load() {
    let s;
    try {
      s = await api("/api/ladder/status");
    } catch (e) {
      if (host.isConnected) clearNode(body).append(panel(inlineError("Saisons indisponibles : " + e.message, load)));
      return;
    }
    if (!host.isConnected) return;
    clearNode(body);
    body.append(
      sectionBlock(
        `Saison ${s.season.number} en cours`,
        {
          description: `${s.season.startedAt ? `Depuis le ${fmtDate(s.season.startedAt)}` : "Depuis l'activation du ladder"} · ${plural(s.stats.ranked, "joueur classé", "joueurs classés")} · ${plural(s.stats.validated, "défi validé", "défis validés")}.`,
          actions: [button("Clore la saison", { variant: "danger-secondary", icon: "archive", onClick: () => closeSeason(s) })],
        },
      ),
    );
    if (!s.seasons.length) {
      body.append(panel(emptyState({ icon: "archive", title: "Aucune saison archivée", text: "Les saisons closes apparaissent ici avec leur top 10.", compact: true })));
      return;
    }
    for (const a of s.seasons) {
      body.append(
        sectionBlock(
          `Saison ${a.season}`,
          { description: `${a.startedAt ? `Du ${fmtDate(a.startedAt)} au ` : "Close le "}${fmtDate(a.endedAt)} · ${plural(a.players, "joueur", "joueurs")} · ${plural(a.matches, "défi validé", "défis validés")}${a.by === "auto" ? " · clôture automatique" : ""}` },
          dataTable({
            label: `Top 10 de la saison ${a.season}`,
            rows: a.top,
            empty: emptyState({ icon: "trophy", title: "Personne n'était classé", compact: true }),
            columns: [
              { key: "position", label: "#", width: "56px", render: (p) => `#${p.position}` },
              { key: "name", label: "Joueur", primary: true, render: (p) => cellTitle(ladderName(p.userId, p.name), null) },
              { key: "elo", label: "Elo", align: "right", meta: true, render: (p) => fmtNum(p.elo) },
              { key: "record", label: "Bilan", align: "right", meta: true, render: (p) => `${p.wins} V · ${p.losses} D` },
            ],
          }),
        ),
      );
    }
  }

  load();
}
