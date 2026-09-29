/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · opérations : tournois et giveaways
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).

   Tournoi : l'en-tête met en avant l'étape suivante logique (une seule action
   primaire), le reste passe dans des menus contextuels. Toute action visible
   sur Discord (annonce, panneau, bracket) est confirmée.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

const TOURNAMENT_STATUS = {
  draft: "Brouillon",
  registration: "Inscriptions ouvertes",
  checkin: "Check-in en cours",
  running: "Bracket en cours",
  completed: "Terminé",
};

// Clés de configuration éditables d'un tournoi (le reste est structurel).
const TOURNAMENT_KEYS = [
  "name", "format", "region", "maxParticipants", "startTime", "bestOf", "finalsBestOf", "rulesText", "prizeText", "mapPool",
  "checkInEnabled", "signupChannelId", "announceChannelId", "participantRoleId", "pingRoleId", "matchCategoryId", "modRoleId",
  "modAlertChannelId", "alertMinutes", "forfeitMinutes", "createVoice", "castFromTopN", "hallOfFameChannelId",
];

const TOURNAMENT_DEFAULTS = {
  name: "Tournoi Brawlhalla",
  format: "1v1",
  region: "EU",
  maxParticipants: 16,
  startTime: "",
  bestOf: 3,
  finalsBestOf: 5,
  rulesText: "Stock · 3 vies · 8 min · maps légales uniquement.",
  prizeText: "",
  mapPool: "",
  checkInEnabled: true,
  signupChannelId: "",
  announceChannelId: "",
  participantRoleId: "",
  pingRoleId: "",
  matchCategoryId: "",
  modRoleId: "",
  modAlertChannelId: "",
  alertMinutes: 7,
  forfeitMinutes: 10,
  createVoice: false,
  castFromTopN: 0,
  hallOfFameChannelId: "",
};

let PENDING_ACTION = null; // action demandée avant navigation (ex. « nouveau giveaway »)

// ═══════════════════ Tournoi : page ═══════════════════
function renderTournament(ctx) {
  ctx.root.append(pageHeader({ title: "Tournois", description: "Inscriptions, bracket et résultats du tournoi en cours.", hasTabs: true }));
  pageTabs(ctx, (tab, host) => {
    if (tab === "archives") renderTournamentArchives(host, ctx);
    else if (tab === "startgg") renderStartgg(host);
    else renderTournamentCurrent(host, ctx);
  });
}

function roundName(t, r) {
  const fromEnd = t.rounds - 1 - r;
  if (fromEnd === 0) return "Finale";
  if (fromEnd === 1) return "Demi-finales";
  if (fromEnd === 2) return "Quarts de finale";
  return `Tour ${r + 1}`;
}

function tournamentSteps(t) {
  const s = [
    { id: "draft", label: "Brouillon" },
    { id: "registration", label: "Inscriptions" },
  ];
  if (t.checkInEnabled || t.status === "checkin") s.push({ id: "checkin", label: "Check-in" });
  s.push({ id: "running", label: "Bracket" }, { id: "completed", label: "Terminé" });
  return s;
}

function stepsView(t) {
  const steps = tournamentSteps(t);
  const cur = steps.findIndex((s) => s.id === t.status);
  return el(
    "ol",
    { class: "steps", "aria-label": "Avancement du tournoi" },
    steps.map((s, i) => {
      const state = i < cur || t.status === "completed" ? "done" : i === cur ? "current" : "";
      return el(
        "li",
        { class: "step " + state, "aria-current": i === cur ? "step" : null },
        el("span", { class: "step-marker", "aria-hidden": "true" }, state === "done" ? icon("check", 12) : String(i + 1)),
        el("span", {}, s.label, state === "done" ? el("span", { class: "sr-only" }, " (terminé)") : null),
      );
    }),
  );
}

async function tournamentAction(fn, message, reload) {
  await fn();
  if (message) toast(message, "ok");
  reload();
}

function channelRef(id) {
  return id ? el("strong", {}, channelName(id)) : el("strong", {}, "le salon configuré");
}

async function renderTournamentCurrent(host, ctx) {
  const reload = () => {
    if (!host.isConnected) return;
    clearNode(host);
    renderTournamentCurrent(host, ctx);
  };
  host.append(panel(skelLines(5)));
  let t;
  try {
    t = await api("/api/tournament");
  } catch (e) {
    if (!host.isConnected) return;
    clearNode(host).append(panel(inlineError("Impossible de charger le tournoi : " + e.message, reload)));
    return;
  }
  if (!ctx.alive() || !host.isConnected) return;
  clearNode(host);

  if (!t) {
    setAttention({ disputes: 0 });
    host.append(
      panel(
        emptyState({
          icon: "trophy",
          title: "Aucun tournoi en cours",
          text: "Crée un tournoi en brouillon : rien n'est publié sur Discord tant que tu n'ouvres pas les inscriptions.",
          actions: [button("Créer un tournoi", { variant: "primary", icon: "plus", onClick: () => openTournamentDrawer(null, reload) })],
        }),
      ),
    );
    return;
  }

  const disputes = Object.entries(t.matches || {}).filter(([, m]) => m.status === "dispute");
  setAttention({ disputes: disputes.length });
  const byId = Object.fromEntries(t.participants.map((p, i) => [p.id, { ...p, seed: i + 1 }]));

  // --- Actions ---
  const setStatus = (status, message) => () => tournamentAction(() => api("/api/tournament/status", "POST", { status }), message, reload);
  const confirmThen = (opts, run) => async () => {
    if (await confirmDialog(opts)) await run();
  };
  const announceTarget = channelRef(t.announceChannelId);
  const openRegistration = confirmThen(
    { title: "Ouvrir les inscriptions ?", message: ["Les joueurs pourront s'inscrire depuis le panneau. Une annonce est publiée dans ", announceTarget, "."], confirmLabel: "Ouvrir les inscriptions" },
    setStatus("registration", "Inscriptions ouvertes"),
  );
  const openCheckin = confirmThen(
    { title: "Ouvrir le check-in ?", message: ["Les inscrits devront confirmer leur présence. Une annonce est publiée dans ", announceTarget, "."], confirmLabel: "Ouvrir le check-in" },
    setStatus("checkin", "Check-in ouvert"),
  );
  const generate = confirmThen(
    {
      title: "Générer le bracket ?",
      message: [`Les inscriptions sont closes et le bracket est créé avec ${plural(t.participants.length, "participant", "participants")} dans l'ordre des seeds actuel. Il est annoncé dans `, announceTarget, "."],
      confirmLabel: "Générer le bracket",
    },
    () => tournamentAction(() => api("/api/tournament/generate", "POST", {}), "Bracket généré", reload),
  );
  const archive = confirmThen(
    { title: "Archiver le tournoi ?", message: "Il quitte l'écran actif et rejoint les archives avec son bracket. Le récapitulatif du podium est publié dans le salon Hall of Fame s'il est configuré.", confirmLabel: "Archiver" },
    () => tournamentAction(() => api("/api/tournament/archive", "POST", {}), "Tournoi archivé", reload),
  );
  const remove = confirmThen(
    { title: "Supprimer le tournoi ?", message: ["« ", el("strong", {}, t.name), " » et son bracket seront définitivement supprimés, sans archive. Cette action est irréversible."], confirmLabel: "Supprimer définitivement", danger: true },
    () => tournamentAction(() => api("/api/tournament", "DELETE"), "Tournoi supprimé", reload),
  );
  const publish = confirmThen(
    { title: "Publier le panneau d'inscription ?", message: ["Le panneau est publié dans ", channelRef(t.signupChannelId), "."], confirmLabel: "Publier" },
    () => tournamentAction(() => api("/api/tournament/publish", "POST", {}), "Panneau d'inscription publié", reload),
  );

  const next = {
    draft: { label: "Ouvrir les inscriptions", run: openRegistration },
    registration: t.checkInEnabled ? { label: "Ouvrir le check-in", run: openCheckin } : { label: "Générer le bracket", run: generate },
    checkin: { label: "Générer le bracket", run: generate },
    completed: { label: "Archiver le tournoi", run: archive },
  }[t.status];

  const menu = menuButton(() => [
    t.status !== "completed" ? { label: "Publier le panneau d'inscription", icon: "send", onSelect: publish } : null,
    t.status === "registration" && t.checkInEnabled ? { label: "Générer le bracket sans check-in", icon: "list-ordered", onSelect: generate } : null,
    t.status === "completed" ? { label: "Rouvrir les inscriptions", icon: "refresh", onSelect: openRegistration } : null,
    "-",
    t.status !== "completed" ? { label: "Archiver le tournoi", icon: "archive", onSelect: archive } : null,
    { label: "Supprimer le tournoi", icon: "trash", danger: true, onSelect: remove },
  ]);

  const meta = [t.format === "2v2" ? "2v2 (équipes)" : "1v1", t.region, `BO${t.bestOf}, finale BO${t.finalsBestOf}`, t.startTime, `${fmtNum(t.participants.length)}/${fmtNum(t.maxParticipants)} inscrits`].filter(Boolean).join(" · ");
  host.append(
    el(
      "div",
      { class: "trn-head" },
      el("div", { class: "ph-text" }, el("h2", { class: "trn-name" }, t.name), el("p", { class: "trn-meta" }, meta)),
      el(
        "div",
        { class: "row" },
        button("Réglages", { icon: "settings", onClick: () => openTournamentDrawer(t, reload) }),
        next ? button(next.label, { variant: "primary", onClick: next.run }) : null,
        menu,
      ),
    ),
    stepsView(t),
  );

  // --- Points d'attention ---
  const notices = el("div", { class: "stack", style: "margin-bottom:24px" });
  if (disputes.length) notices.append(disputesPanel(t, disputes, byId, reload));
  const beforeBracket = ["draft", "registration", "checkin"].includes(t.status);
  if (!t.signupChannelId && beforeBracket) {
    notices.append(callout("warn", "Aucun salon d'inscription n'est défini : le panneau ne peut pas être publié.", { actions: [button("Définir le salon", { size: "sm", onClick: () => openTournamentDrawer(t, reload) })] }));
  } else if (!t.signupMessageId && beforeBracket) {
    notices.append(callout("info", "Le panneau d'inscription n'a pas encore été publié sur Discord.", { actions: [button("Publier", { size: "sm", onClick: publish })] }));
  }
  if (notices.children.length) host.append(notices);

  // --- Contenu : bracket puis participants, ou participants seuls ---
  const participants = participantsSection(t, reload);
  if (t.rounds > 0) {
    host.append(
      sectionBlock(
        "Bracket",
        { description: t.status === "running" ? "Clique sur un match pour saisir ou corriger son score." : null },
        el("div", { class: "panel" }, bracketView(t, byId, { onMatch: t.status === "running" ? (id, m) => scoreDialog(t, id, m, byId, reload) : null })),
      ),
      participants,
    );
  } else host.append(participants);
}

function disputesPanel(t, disputes, byId, reload) {
  const rows = disputes.map(([mid, m]) => {
    const A = byId[m.aId] || { name: "?" };
    const B = byId[m.bId] || { name: "?" };
    const report = (r) => (r ? `${r.a}–${r.b}` : "rien");
    const ra = m.reports && m.reports[m.aId];
    const rb = m.reports && m.reports[m.bId];
    const win = (winner, loser, wid) =>
      button(`Victoire ${winner.name}`, {
        size: "sm",
        onClick: async () => {
          const ok = await confirmDialog({
            title: "Trancher le litige",
            message: ["Donner la victoire à ", el("strong", {}, winner.name), " contre ", el("strong", {}, loser.name), " ? Le bracket avance et une annonce est publiée."],
            confirmLabel: "Confirmer la victoire",
          });
          if (!ok) return;
          await api("/api/tournament/resolve", "POST", { matchId: mid, winnerId: wid });
          toast("Litige tranché", "ok");
          reload();
        },
      });
    return el(
      "div",
      { class: "list-item warn wrap" },
      icon("alert-triangle", 16),
      el("div", { class: "list-item-main" }, el("div", { class: "list-item-title" }, `${A.name} contre ${B.name} · ${roundName(t, m.round)}`), el("div", { class: "list-item-meta" }, `${A.name} déclare ${report(ra)}, ${B.name} déclare ${report(rb)}`)),
      el("div", { class: "row" }, win(A, B, m.aId), win(B, A, m.bId), m.channelId ? linkButton("Salon", discordChannelUrl(m.channelId), { variant: "ghost", size: "sm", external: true }) : null),
    );
  });
  return el("div", { class: "panel" }, panelHead(`Litiges à trancher (${disputes.length})`), el("div", { class: "list" }, rows));
}

function participantsSection(t, reload) {
  const seedable = t.status === "registration" || t.status === "checkin";
  const checked = t.participants.filter((p) => p.checkedIn).length;
  const winnerId = t.status === "completed" && t.rounds ? (t.matches[`r${t.rounds - 1}m0`] || {}).winnerId : null;
  const seedMenu = seedable && t.participants.length > 1
    ? menuButton(
        () => [
          { label: "Trier par rating 1v1 (Elo)", icon: "list-ordered", onSelect: () => tournamentAction(() => api("/api/tournament/seed-elo", "POST", {}), "Seeds triés par rating 1v1", reload) },
          { label: "Importer les seeds start.gg…", icon: "sprout", onSelect: () => startggImportDialog(reload) },
          "-",
          { label: "Mélanger aléatoirement", icon: "shuffle", onSelect: () => tournamentAction(() => api("/api/tournament/shuffle", "POST", {}), "Seeds mélangés", reload) },
        ],
        { text: "Seeding", variant: "secondary", size: "sm" },
      )
    : null;

  const columns = [
    { key: "seed", label: "Seed", align: "right", width: "64px", sortable: true, meta: true, render: (p) => el("span", { class: "num text-2" }, "#" + p.seed) },
    { key: "name", label: t.format === "2v2" ? "Équipe" : "Joueur", primary: true, sortable: true, render: (p) => el("span", { class: "cell-strong" }, p.name) },
  ];
  if (t.checkInEnabled) {
    columns.push({ key: "checkedIn", label: "Check-in", meta: true, sortValue: (p) => (p.checkedIn ? 1 : 0), sortable: true, render: (p) => (p.checkedIn ? statusDot("ok", "Présent") : statusDot("neutral", "En attente")) });
  }
  if (t.rounds > 0) {
    columns.push({
      key: "state",
      label: "Statut",
      meta: true,
      render: (p) => (p.id === winnerId ? statusDot("ok", "Vainqueur") : p.eliminated ? el("span", { class: "text-2" }, "Éliminé") : statusDot("info", "En lice")),
    });
  }
  columns.push({
    key: "actions",
    label: "",
    render: (p) =>
      menuButton(
        [
          {
            label: "Retirer du tournoi",
            icon: "trash",
            danger: true,
            onSelect: async () => {
              const ok = await confirmDialog({ title: "Retirer ce participant ?", message: ["", el("strong", {}, p.name), " sera retiré du tournoi et le panneau d'inscription mis à jour."], confirmLabel: "Retirer", danger: true });
              if (!ok) return;
              await api("/api/tournament/remove", "POST", { entrantId: p.id });
              toast(`${p.name} retiré du tournoi`, "ok");
              reload();
            },
          },
        ],
        { size: "sm", label: `Actions pour ${p.name}` },
      ),
  });

  const emptyText = {
    draft: "Ouvre les inscriptions pour que les joueurs s'inscrivent depuis Discord.",
    registration: "Les inscriptions sont ouvertes : les joueurs apparaîtront ici dès leur inscription.",
  }[t.status] || "Aucun participant.";
  const rows = t.participants.map((p, i) => ({ ...p, seed: i + 1 }));
  const desc = t.checkInEnabled && t.participants.length ? `${fmtNum(checked)} sur ${fmtNum(t.participants.length)} ont fait leur check-in.` : null;
  return sectionBlock(
    `Participants (${fmtNum(t.participants.length)})`,
    { description: desc, actions: [seedMenu] },
    dataTable({
      columns,
      rows,
      label: "Participants du tournoi",
      searchable: rows.length > 8,
      searchPlaceholder: "Rechercher un participant",
      initialSort: { key: "seed", dir: "asc" },
      pageSize: 50,
      empty: emptyState({ icon: "users", title: "Aucun inscrit", text: emptyText, compact: true }),
    }),
  );
}

// ═══════════════════ Tournoi : bracket ═══════════════════
function bracketView(t, byId, { onMatch } = {}) {
  const wrap = el("div", { class: "bracket", role: "list", "aria-label": "Bracket" });
  for (let r = 0; r < t.rounds; r++) {
    const ms = Object.entries(t.matches || {})
      .filter(([, m]) => m.round === r)
      .sort((a, b) => a[1].index - b[1].index);
    wrap.append(
      el("div", { class: "round", role: "listitem" }, el("h3", { class: "round-title" }, roundName(t, r)), el("div", { class: "round-matches" }, ms.map(([id, m]) => matchCard(t, id, m, byId, onMatch)))),
    );
  }
  return wrap;
}

function matchCard(t, id, m, byId, onMatch) {
  const A = byId[m.aId];
  const B = byId[m.bId];
  const done = m.status === "done";
  const showScore = A && B && (done || m.status === "live" || m.scoreA || m.scoreB);
  // Match terminé avec un seul joueur : l'autre côté est une exemption, pas un adversaire à venir.
  const emptyLabel = done ? "Exempt" : "À déterminer";
  const row = (p, score, win) =>
    el(
      "div",
      { class: "match-row" + (done ? (win ? " win" : " lose") : "") },
      el("span", { class: "match-seed" }, p ? String(p.seed) : ""),
      el("span", { class: "match-name" + (p ? "" : " tbd") }, p ? p.name : emptyLabel),
      el("span", { class: "match-score" }, showScore ? String(score ?? 0) : ""),
    );
  const clickable = onMatch && A && B;
  const statusText = m.status === "dispute" ? "litige" : m.status === "live" ? "en cours" : done ? "terminé" : m.locked ? "verrouillé pour le cast" : "à jouer";
  const card = el(
    clickable ? "button" : "div",
    {
      type: clickable ? "button" : null,
      class: "match" + (m.status === "dispute" ? " dispute" : ""),
      "aria-label": `${A ? A.name : emptyLabel} contre ${B ? B.name : emptyLabel}${showScore ? `, ${m.scoreA ?? 0} à ${m.scoreB ?? 0}` : ""}, ${statusText}${clickable ? ". Saisir le score" : ""}`,
    },
    row(A, m.scoreA, m.winnerId && m.winnerId === m.aId),
    row(B, m.scoreB, m.winnerId && m.winnerId === m.bId),
  );
  if (m.status === "dispute") card.append(el("div", { class: "match-flag warn" }, icon("alert-triangle", 12), "Litige"));
  else if (m.status === "live") card.append(el("div", { class: "match-flag live" }, icon("circle-dot", 12), "En cours"));
  else if (m.locked && !done) card.append(el("div", { class: "match-flag" }, icon("lock", 12), "Verrouillé pour le cast"));
  if (clickable) card.addEventListener("click", () => onMatch(id, m));
  return card;
}

function scoreDialog(t, id, m, byId, onDone) {
  const A = byId[m.aId];
  const B = byId[m.bId];
  const s = { a: m.scoreA || 0, b: m.scoreB || 0 };
  const bo = m.round === t.rounds - 1 ? t.finalsBestOf : t.bestOf;
  const inA = numberInput(s, "a", { min: 0, max: 99, size: "xs" });
  const inB = numberInput(s, "b", { min: 0, max: 99, size: "xs" });
  inA.id = uid("score");
  inB.id = uid("score");
  openDialog({
    title: "Score du match",
    description: `${roundName(t, m.round)} · BO${bo}, premier à ${Math.ceil(bo / 2)} manches`,
    body: el(
      "div",
      { class: "score-grid" },
      el("label", { class: "truncate cell-strong", for: inA.id }, A.name),
      inA,
      el("label", { class: "truncate cell-strong", for: inB.id }, B.name),
      inB,
    ),
    actions: [
      { label: "Annuler" },
      {
        label: "Enregistrer le score",
        variant: "primary",
        onClick: async () => {
          if (s.a === s.b) {
            toast("Il faut un vainqueur : les scores doivent être différents.", "err");
            return false;
          }
          await api("/api/tournament/result", "POST", { matchId: id, scoreA: s.a, scoreB: s.b });
          toast("Score enregistré", "ok");
          onDone();
        },
      },
    ],
  });
}

// ═══════════════════ Tournoi : création / réglages ═══════════════════
function tournamentFormFields(cfg) {
  return el(
    "div",
    { class: "stack", style: "gap:24px" },
    groups(
      settingsGroup(
        "Informations",
        null,
        field("Nom du tournoi", textInput(cfg, "name", { maxLength: 100 })),
        fieldRow(
          field("Format", selectInput(cfg, "format", [{ value: "1v1", label: "1v1" }, { value: "2v2", label: "2v2 (équipes)" }])),
          field("Région", textInput(cfg, "region", { placeholder: "EU", maxLength: 12 })),
        ),
        fieldRow(
          field("Places", numberInput(cfg, "maxParticipants", { min: 2, max: 256 }), { help: "Idéalement 8, 16 ou 32." }),
          field("Début", textInput(cfg, "startTime", { placeholder: "Sam. 21 h" }), { help: "Texte libre affiché aux joueurs.", optional: true }),
        ),
      ),
      settingsGroup(
        "Matchs",
        null,
        fieldRow(field("Best-of des matchs", numberInput(cfg, "bestOf", { min: 1, max: 9 })), field("Best-of de la finale", numberInput(cfg, "finalsBestOf", { min: 1, max: 9 }))),
        field("Règles", textArea(cfg, "rulesText", { rows: 3 })),
        field("Récompenses", textInput(cfg, "prizeText", { placeholder: "50 € + rôle" }), { optional: true }),
        field("Maps légales", textInput(cfg, "mapPool", { placeholder: "Small Brawlhaven, Mammoth Fortress…" }), { optional: true }),
      ),
      settingsGroup(
        "Inscriptions",
        null,
        switchField("Check-in obligatoire", cfg, "checkInEnabled", { help: "Les inscrits confirment leur présence avant la génération du bracket." }),
        field("Salon d'inscription", channelPicker(cfg, "signupChannelId", "text"), { help: "Où est publié le panneau d'inscription." }),
        field("Salon d'annonces", channelPicker(cfg, "announceChannelId", "text"), { help: "Ouverture, check-in, bracket et vainqueur." }),
        field("Rôle participant", rolePicker(cfg, "participantRoleId"), { help: "Attribué automatiquement aux inscrits.", optional: true }),
        field("Rôle à mentionner", rolePicker(cfg, "pingRoleId"), { help: "Mentionné dans l'annonce d'ouverture.", optional: true }),
      ),
    ),
    disclosure(
      "Salons de match, cast et Hall of Fame",
      groups(
        settingsGroup(
          "Salons de match",
          "Un salon privé par match, avec relance des joueurs inactifs.",
          field("Catégorie des salons", channelPicker(cfg, "matchCategoryId", "category")),
          field("Rôle staff", rolePicker(cfg, "modRoleId"), { help: "Accès aux salons de match et alertes de litige." }),
          field("Salon des alertes", channelPicker(cfg, "modAlertChannelId", "text"), { help: "Litiges et joueurs inactifs." }),
          fieldRow(
            field("Alerte staff après", numberInput(cfg, "alertMinutes", { min: 1, max: 60, suffix: "min" })),
            field("Forfait après", numberInput(cfg, "forfeitMinutes", { min: 1, max: 120, suffix: "min" })),
          ),
          switchField("Salon vocal par match", cfg, "createVoice", { help: "Crée aussi un vocal éphémère pour chaque match." }),
        ),
        settingsGroup(
          "Cast et Hall of Fame",
          null,
          field(
            "Cast à partir du",
            selectInput(cfg, "castFromTopN", [
              { value: 0, label: "Désactivé" },
              { value: 4, label: "Top 4" },
              { value: 8, label: "Top 8" },
              { value: 16, label: "Top 16" },
              { value: 32, label: "Top 32" },
            ]),
            { help: "Ces matchs restent verrouillés jusqu'au déblocage par le staff (/caster)." },
          ),
          field("Salon Hall of Fame", channelPicker(cfg, "hallOfFameChannelId", "text"), { help: "Podium et MVP publiés à l'archivage.", optional: true }),
        ),
      ),
    ),
  );
}

function openTournamentDrawer(t, onDone) {
  const initial = {};
  for (const k of TOURNAMENT_KEYS) initial[k] = t ? (t[k] ?? TOURNAMENT_DEFAULTS[k]) : TOURNAMENT_DEFAULTS[k];
  const form = createForm({ initial, register: false });
  openDialog({
    kind: "drawer",
    title: t ? "Réglages du tournoi" : "Nouveau tournoi",
    description: t ? "Les participants et le bracket ne sont pas modifiés." : "Le tournoi est créé en brouillon : rien n'est publié avant l'ouverture des inscriptions.",
    body: tournamentFormFields(form.data),
    beforeClose: async () => !formDirty(form) || confirmLeave(),
    actions: [
      { label: "Annuler", onClick: async (dlg) => { await dlg.requestClose(); return false; } },
      {
        label: t ? "Enregistrer" : "Créer le tournoi",
        variant: "primary",
        onClick: async () => {
          if (!String(form.data.name || "").trim()) {
            toast("Donne un nom au tournoi.", "err");
            return false;
          }
          if (t) {
            const patch = diffPatch(form.baseObj, form.data);
            if (Object.keys(patch).length) await api("/api/tournament", "PUT", patch);
            toast("Réglages du tournoi enregistrés", "ok");
          } else {
            await api("/api/tournament", "POST", form.data);
            toast("Tournoi créé en brouillon", "ok");
          }
          onDone();
        },
      },
    ],
  });
}

function startggImportDialog(onDone) {
  const s = { url: "", token: "" };
  const hasToken = !!(CONFIG.settings && CONFIG.settings.startggToken);
  openDialog({
    title: "Importer les seeds start.gg",
    description: "Les seeds de l'événement sont appliqués aux inscrits (association par pseudo ou compte lié). Les joueurs non trouvés passent en fin de liste.",
    size: "md",
    body: el(
      "div",
      { class: "stack" },
      field("Lien de l'événement", textInput(s, "url", { placeholder: "https://www.start.gg/tournament/…/event/…", trim: true })),
      field("Token start.gg", textInput(s, "token", { type: "password", trim: true }), {
        optional: hasToken,
        help: hasToken ? "Un token est déjà mémorisé : laisse vide pour l'utiliser." : "Personal Access Token (Settings › Developer). Il sera mémorisé.",
      }),
    ),
    actions: [
      { label: "Annuler" },
      {
        label: "Importer les seeds",
        variant: "primary",
        onClick: async () => {
          if (!s.url) {
            toast("Colle le lien de l'événement start.gg.", "err");
            return false;
          }
          const r = await api("/api/tournament/seed-startgg", "POST", { url: s.url, token: s.token || undefined });
          toast(r.message || "Seeds start.gg appliqués", "ok");
          onDone();
        },
      },
    ],
  });
}

// ═══════════════════ Tournoi : archives ═══════════════════
async function renderTournamentArchives(host, ctx) {
  const reload = () => {
    if (!host.isConnected) return;
    clearNode(host);
    renderTournamentArchives(host, ctx);
  };
  host.append(panel(skelLines(4)));
  let list;
  try {
    list = await api("/api/tournament/history");
  } catch (e) {
    if (host.isConnected) clearNode(host).append(panel(inlineError("Impossible de charger les archives : " + e.message, reload)));
    return;
  }
  if (!ctx.alive() || !host.isConnected) return;
  clearNode(host).append(
    dataTable({
      label: "Tournois archivés",
      rows: list || [],
      searchable: (list || []).length > 8,
      searchPlaceholder: "Rechercher un tournoi",
      initialSort: { key: "archivedAt", dir: "desc" },
      empty: emptyState({ icon: "archive", title: "Aucun tournoi archivé", text: "Archive un tournoi terminé pour le conserver ici avec son bracket.", compact: true }),
      columns: [
        { key: "name", label: "Tournoi", primary: true, sortable: true, render: (h) => el("span", { class: "cell-strong" }, h.name) },
        { key: "format", label: "Format", meta: true, render: (h) => `${h.format} · BO${h.bestOf}` },
        { key: "participants", label: "Joueurs", align: "right", sortable: true, meta: true, render: (h) => fmtNum(h.participants) },
        { key: "winner", label: "Vainqueur", sortable: true, meta: true, render: (h) => (h.winner ? h.winner : el("span", { class: "text-3" }, "Inachevé")) },
        { key: "archivedAt", label: "Archivé le", sortable: true, meta: true, render: (h) => fmtDate(h.archivedAt) },
        {
          key: "actions",
          label: "",
          render: (h) =>
            rowActions(
              iconButton("eye", "Voir le bracket", () => archiveDialog(h.id), { size: "sm" }),
              menuButton(
                [
                  {
                    label: "Supprimer de l'archive",
                    icon: "trash",
                    danger: true,
                    onSelect: async () => {
                      const ok = await confirmDialog({ title: "Supprimer ce tournoi archivé ?", message: ["« ", el("strong", {}, h.name), " » et son bracket seront définitivement supprimés."], confirmLabel: "Supprimer", danger: true });
                      if (!ok) return;
                      await api("/api/tournament/history/" + encodeURIComponent(h.id), "DELETE");
                      toast("Tournoi supprimé de l'archive", "ok");
                      reload();
                    },
                  },
                ],
                { size: "sm", label: `Actions pour ${h.name}` },
              ),
            ),
        },
      ],
    }),
  );
}

async function archiveDialog(id) {
  const entry = await api("/api/tournament/history/" + encodeURIComponent(id)).catch((e) => {
    reportError(e);
    return null;
  });
  if (!entry) return;
  const t = entry.snapshot;
  const byId = t ? Object.fromEntries((t.participants || []).map((p, i) => [p.id, { ...p, seed: i + 1 }])) : {};
  openDialog({
    title: entry.name,
    description: [`${entry.format} · BO${entry.bestOf}`, plural(entry.participants, "joueur", "joueurs"), fmtDate(entry.archivedAt, { day: "numeric", month: "long", year: "numeric" }), entry.winner ? `Vainqueur : ${entry.winner}` : null].filter(Boolean).join(" · "),
    size: "lg",
    body: t && t.rounds > 0 ? el("div", { class: "panel" }, bracketView(t, byId)) : emptyState({ icon: "list-ordered", title: "Aucun bracket enregistré", text: "Ce tournoi a été archivé avant la génération du bracket.", compact: true }),
    actions: [{ label: "Fermer", variant: "secondary" }],
  });
}

// ═══════════════════ Tournoi : seeding d'un événement start.gg ═══════════════════
function renderStartgg(host) {
  const s = { url: "", token: "", phaseId: "", result: null, loading: false, error: null };
  const hasToken = !!(CONFIG.settings && CONFIG.settings.startggToken);
  host.append(toolbar("Pour un tournoi géré sur start.gg : calcule un seeding d'après le rating 1v1 Brawlhalla des inscrits, puis réécris-le sur start.gg."));

  const calc = button("Calculer le seeding", { variant: "primary", icon: "list-ordered", onClick: () => load() });
  host.append(
    groups(
      settingsGroup(
        "Événement",
        "Le lien doit pointer vers un événement (…/event/…). Le token doit appartenir à un admin du tournoi pour réécrire le seeding.",
        field("Lien de l'événement", textInput(s, "url", { placeholder: "https://www.start.gg/tournament/…/event/…", trim: true })),
        field("Token start.gg", textInput(s, "token", { type: "password", trim: true }), {
          optional: hasToken,
          help: hasToken ? "Un token est mémorisé : laisse vide pour l'utiliser." : "Personal Access Token (Settings › Developer). Il sera mémorisé.",
        }),
        el("div", {}, calc),
      ),
    ),
  );
  const result = el("div", { class: "section" });
  host.append(result);

  async function load() {
    if (!s.url) {
      toast("Colle le lien de l'événement start.gg.", "err");
      return;
    }
    s.loading = true;
    s.error = null;
    draw();
    try {
      const r = await api("/api/startgg/preview", "POST", { url: s.url, token: s.token || undefined, phaseId: s.phaseId || undefined });
      s.result = r;
      s.phaseId = r.phaseId;
    } catch (e) {
      s.error = e.message;
    }
    s.loading = false;
    if (host.isConnected) draw();
  }

  function draw() {
    clearNode(result);
    // Une seule action primaire : une fois le seeding calculé, c'est « Appliquer ».
    const hasResult = !!s.result && !s.error;
    calc.classList.toggle("btn-primary", !hasResult);
    calc.classList.toggle("btn-secondary", hasResult);
    calc.querySelector("span").textContent = hasResult ? "Recalculer" : "Calculer le seeding";
    if (s.loading) {
      result.append(panel(skelLines(6)));
      return;
    }
    if (s.error) {
      result.append(panel(inlineError("Calcul impossible : " + s.error, () => load())));
      return;
    }
    const r = s.result;
    if (!r) {
      result.append(panel(emptyState({ icon: "sprout", title: "Aucun seeding calculé", text: "Renseigne l'événement ci-dessus puis lance le calcul.", compact: true })));
      return;
    }
    const matched = r.rows.filter((x) => x.source !== "inconnu").length;
    const apply = button("Appliquer sur start.gg", {
      variant: "primary",
      icon: "check",
      disabled: !r.rows.length,
      onClick: async () => {
        const ok = await confirmDialog({
          title: "Réécrire le seeding sur start.gg ?",
          message: ["Le seeding de la phase « ", el("strong", {}, r.phaseName), " » est remplacé pour ", el("strong", {}, plural(r.rows.length, "joueur", "joueurs")), "."],
          confirmLabel: "Appliquer le seeding",
        });
        if (!ok) return;
        const res = await api("/api/startgg/apply", "POST", { token: s.token || undefined, phaseId: r.phaseId, mapping: r.rows.map((x) => ({ seedId: x.seedId, seedNum: x.proposedSeed })) });
        toast(res.message || "Seeding appliqué sur start.gg", "ok");
      },
    });
    const phaseSel = (r.phases || []).length > 1 ? selectInput(s, "phaseId", r.phases.map((p) => ({ value: p.id, label: p.name })), { size: "md" }) : null;
    if (phaseSel) {
      phaseSel.setAttribute("aria-label", "Phase à seeder");
      phaseSel.addEventListener("change", () => load());
    }
    const sourceBadge = (src) => (src === "membre lié" ? badge("Membre lié", "ok") : src === "leaderboard" ? badge("Classement", "info") : badge("Inconnu"));
    result.append(
      sectionBlock(
        r.eventName,
        { description: `Phase « ${r.phaseName} » · ${plural(r.rows.length, "inscrit", "inscrits")}, ${fmtNum(matched)} avec un rating connu`, actions: [phaseSel, apply] },
        dataTable({
          label: "Seeding proposé",
          rows: r.rows,
          searchable: r.rows.length > 10,
          searchPlaceholder: "Rechercher un joueur",
          initialSort: { key: "proposedSeed", dir: "asc" },
          pageSize: 64,
          empty: emptyState({ icon: "users", title: "Aucun inscrit sur cette phase", compact: true }),
          columns: [
            { key: "proposedSeed", label: "Seed proposé", align: "right", sortable: true, width: "112px", meta: true, render: (x) => el("span", { class: "num cell-strong" }, "#" + x.proposedSeed) },
            { key: "name", label: "Joueur", primary: true, sortable: true },
            { key: "rating", label: "Rating 1v1", align: "right", sortable: true, meta: true, render: (x) => (x.rating ? fmtNum(x.rating) : el("span", { class: "text-3" }, "—")) },
            { key: "source", label: "Source", meta: true, sortable: true, render: (x) => sourceBadge(x.source) },
            { key: "currentSeed", label: "Seed actuel", align: "right", sortable: true, hideSm: true, render: (x) => el("span", { class: "num text-2" }, "#" + x.currentSeed) },
            {
              key: "delta",
              label: "Écart",
              align: "right",
              hideSm: true,
              sortable: true,
              sortValue: (x) => x.currentSeed - x.proposedSeed,
              render: (x) => {
                const d = x.currentSeed - x.proposedSeed;
                if (!d) return el("span", { class: "delta" }, "=");
                return el("span", { class: "delta " + (d > 0 ? "up" : "down"), "aria-label": d > 0 ? `monte de ${d}` : `descend de ${-d}` }, icon(d > 0 ? "arrow-up" : "arrow-down", 12), String(Math.abs(d)));
              },
            },
          ],
        }),
      ),
    );
  }
  draw();
}

// ═══════════════════ Giveaways ═══════════════════
function parseDurationMs(input) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const re = /(\d+)\s*(w|d|h|m|s)/gi;
  let total = 0;
  let matched = false;
  let m;
  while ((m = re.exec(String(input || ""))) !== null) {
    matched = true;
    total += parseInt(m[1], 10) * units[m[2].toLowerCase()];
  }
  if (!matched) {
    const n = parseInt(input, 10);
    return Number.isFinite(n) && n > 0 ? n * 60000 : 0;
  }
  return total;
}

// Ouvre la création depuis n'importe quelle page (palette, vue d'ensemble).
function startNewGiveaway() {
  if (ROUTE.page === "giveaway" && PAGE && PAGE.ctx.alive()) {
    newGiveawayDialog(() => rerenderGiveawayList());
    return;
  }
  PENDING_ACTION = "new-giveaway";
  navigate("giveaway", "contests");
}

let GIVEAWAY_TABS = null;

function rerenderGiveawayList() {
  if (GIVEAWAY_TABS && GIVEAWAY_TABS.active === "contests" && GIVEAWAY_TABS.panel.isConnected) GIVEAWAY_TABS.redraw();
}

function renderGiveaway(ctx) {
  const form = configForm("giveaway");
  const newBtn = button("Nouveau giveaway", { variant: "primary", icon: "plus", onClick: () => newGiveawayDialog(() => rerenderGiveawayList()) });
  watch(newBtn, () => {
    newBtn.disabled = !(CONFIG.giveaway && CONFIG.giveaway.enabled);
  });
  ctx.root.append(
    pageHeader({
      title: "Giveaways",
      description: "Concours tirés au sort automatiquement à l'échéance.",
      hasTabs: true,
      actions: [moduleSwitch("giveaway", "Giveaways"), newBtn],
    }),
  );
  GIVEAWAY_TABS = pageTabs(ctx, (tab, host, scope) => {
    if (tab === "settings") giveawaySettings(host, form.data);
    else giveawayContests(host, ctx, scope);
  });
  if (PENDING_ACTION === "new-giveaway") {
    PENDING_ACTION = null;
    if (CONFIG.giveaway && CONFIG.giveaway.enabled) requestAnimationFrame(() => newGiveawayDialog(() => rerenderGiveawayList()));
  }
}

function giveawayContests(host, ctx, scope) {
  const disabledNote = callout("warn", "Le module est inactif : aucun giveaway ne peut être lancé. Active-le avec l'interrupteur en haut de page.");
  disabledNote.style.marginBottom = "24px";
  showWhen(disabledNote, () => !(CONFIG.giveaway && CONFIG.giveaway.enabled));
  const updated = el("span", { class: "text-sm text-3" });
  const refresh = iconButton("refresh", "Actualiser la liste", () => load(), { size: "sm" });
  const activeHost = el("div", {}, panel(skelLines(3)));
  const recentHost = el("div", {}, panel(skelLines(3)));
  const recentSection = sectionBlock("Terminés récemment", {}, recentHost);
  host.append(disabledNote, sectionBlock("En cours", { actions: [updated, refresh] }, activeHost), recentSection);

  const where = (g) => (g.channelId ? channelName(g.channelId) : "—");
  const winnersTitle = (g) => (g.winnerIds && g.winnerIds.length ? `Identifiants : ${g.winnerIds.join(", ")}` : null);

  async function load() {
    let data;
    try {
      data = await api("/api/giveaway/list");
    } catch (e) {
      if (!host.isConnected) return;
      clearNode(activeHost).append(panel(inlineError("Impossible de charger les giveaways : " + e.message, () => load())));
      recentSection.hidden = true;
      return;
    }
    if (!ctx.alive() || !host.isConnected) return;
    recentSection.hidden = false;
    updated.textContent = "Mis à jour à " + fmtTime(Date.now());

    clearNode(activeHost).append(
      dataTable({
        label: "Giveaways en cours",
        rows: data.active || [],
        initialSort: { key: "endsTs", dir: "asc" },
        empty: emptyState({
          icon: "gift",
          title: "Aucun giveaway en cours",
          text: "Lance un concours : les gagnants sont tirés au sort automatiquement à l'échéance.",
          actions: CONFIG.giveaway && CONFIG.giveaway.enabled ? [button("Nouveau giveaway", { icon: "plus", onClick: () => newGiveawayDialog(() => load()) })] : [],
          compact: true,
        }),
        columns: [
          { key: "prize", label: "Récompense", primary: true, sortable: true, render: (g) => cellTitle(g.prize, g.description ? g.description.slice(0, 80) : null) },
          { key: "channelId", label: "Salon", meta: true, render: where },
          { key: "entries", label: "Participants", align: "right", sortable: true, meta: true, render: (g) => fmtNum(g.entries) },
          { key: "winnersCount", label: "Gagnants", align: "right", meta: true, hideSm: true, render: (g) => fmtNum(g.winnersCount) },
          { key: "endsTs", label: "Fin", sortable: true, meta: true, render: (g) => timeAgo(g.endsTs) },
          {
            key: "actions",
            label: "",
            render: (g) =>
              rowActions(
                button("Terminer", {
                  size: "sm",
                  onClick: async () => {
                    const ok = await confirmDialog({ title: "Terminer maintenant ?", message: ["Le tirage de « ", el("strong", {}, g.prize), ` » a lieu immédiatement parmi ${plural(g.entries, "participant", "participants")}, et les gagnants sont annoncés.`], confirmLabel: "Terminer et tirer au sort" });
                    if (!ok) return;
                    await api("/api/giveaway/end", "POST", { id: g.id });
                    toast("Giveaway terminé, gagnants tirés au sort", "ok");
                    load();
                  },
                }),
                menuButton(
                  [
                    {
                      label: "Annuler sans tirage",
                      icon: "x",
                      danger: true,
                      onSelect: async () => {
                        const ok = await confirmDialog({ title: "Annuler ce giveaway ?", message: ["« ", el("strong", {}, g.prize), " » est clos sans tirage au sort. Les participations sont perdues."], confirmLabel: "Annuler le giveaway", cancelLabel: "Garder", danger: true });
                        if (!ok) return;
                        await api("/api/giveaway/cancel", "POST", { id: g.id });
                        toast("Giveaway annulé", "ok");
                        load();
                      },
                    },
                  ],
                  { size: "sm", label: `Actions pour ${g.prize}` },
                ),
              ),
          },
        ],
      }),
    );

    const recent = (data.recent || []).filter((g) => g.status !== "active");
    clearNode(recentHost).append(
      dataTable({
        label: "Giveaways terminés",
        rows: recent,
        initialSort: { key: "endsTs", dir: "desc" },
        pageSize: 10,
        empty: emptyState({ icon: "archive", title: "Aucun giveaway terminé", text: "Les concours terminés ou annulés apparaîtront ici.", compact: true }),
        columns: [
          { key: "prize", label: "Récompense", primary: true, sortable: true, render: (g) => el("span", { class: "cell-strong" }, g.prize) },
          { key: "status", label: "Statut", meta: true, render: (g) => (g.status === "cancelled" ? statusDot("neutral", "Annulé") : statusDot("ok", "Terminé")) },
          { key: "entries", label: "Participants", align: "right", sortable: true, meta: true, render: (g) => fmtNum(g.entries) },
          { key: "winners", label: "Gagnants", align: "right", meta: true, render: (g) => el("span", { title: winnersTitle(g) }, fmtNum((g.winnerIds || []).length)) },
          { key: "endsTs", label: "Date", sortable: true, meta: true, render: (g) => fmtDate(g.endsTs) },
          {
            key: "actions",
            label: "",
            render: (g) =>
              g.status === "ended" && g.entries > 0
                ? iconButton("refresh", "Relancer le tirage", async () => {
                    const ok = await confirmDialog({ title: "Relancer le tirage ?", message: ["De nouveaux gagnants sont tirés au sort pour « ", el("strong", {}, g.prize), " » et annoncés dans le salon."], confirmLabel: "Relancer le tirage" });
                    if (!ok) return;
                    const r = await api("/api/giveaway/reroll", "POST", { id: g.id });
                    toast(`Nouveau tirage : ${plural((r.winners || []).length, "gagnant", "gagnants")}`, "ok");
                    load();
                  }, { size: "sm" })
                : null,
          },
        ],
      }),
    );
  }
  load();
  scope.interval(load, 30000);
}

function newGiveawayDialog(onCreated) {
  const cfg = CONFIG.giveaway || {};
  if (!cfg.enabled) {
    toast("Active d'abord le module Giveaways.", "err");
    return;
  }
  const s = { prize: "", description: "", duration: cfg.defaultDuration || "24h", winnersCount: cfg.defaultWinners || 1, channelId: "" };
  const durInput = textInput(s, "duration", { size: "sm", placeholder: "24h" });
  const durHelp = el("p", { class: "field-help", "aria-live": "polite" });
  const syncDur = () => {
    const ms = parseDurationMs(s.duration);
    if (ms >= 10000) {
      durHelp.className = "field-help";
      durHelp.textContent = `Se termine le ${fmtDateTime(Date.now() + ms)}.`;
    } else {
      durHelp.className = "field-error";
      durHelp.textContent = "Durée invalide. Exemples : 30m, 2h, 1d, 1w ou 1d12h.";
    }
  };
  durInput.addEventListener("input", syncDur);
  const presets = el(
    "div",
    { class: "row", style: "gap:4px" },
    [["1 h", "1h"], ["1 jour", "1d"], ["3 jours", "3d"], ["1 semaine", "1w"]].map(([label, v]) =>
      button(label, { size: "sm", variant: "ghost", onClick: () => { durInput.value = v; s.duration = v; syncDur(); } }),
    ),
  );
  syncDur();
  const hasDefault = !!cfg.defaultChannelId;
  openDialog({
    title: "Nouveau giveaway",
    description: "Publié immédiatement dans le salon choisi.",
    size: "md",
    body: el(
      "div",
      { class: "stack" },
      field("Récompense", textInput(s, "prize", { placeholder: "Nitro 1 mois", maxLength: 200 })),
      field("Description", textArea(s, "description", { rows: 3, placeholder: "Conditions, détails…" }), { optional: true }),
      el("div", { class: "field" }, el("label", { class: "field-label", for: (durInput.id = uid("dur")) }, "Durée"), el("div", { class: "row" }, durInput, presets), durHelp),
      fieldRow(
        field("Gagnants", numberInput(s, "winnersCount", { min: 1, max: 50 })),
        field("Salon", channelPicker(s, "channelId", "text", { allowNone: hasDefault, noneLabel: hasDefault ? `Par défaut (${channelName(cfg.defaultChannelId)})` : undefined })),
      ),
    ),
    actions: [
      { label: "Annuler" },
      {
        label: "Lancer le giveaway",
        variant: "primary",
        onClick: async () => {
          if (!s.prize.trim()) {
            toast("Indique une récompense.", "err");
            return false;
          }
          if (parseDurationMs(s.duration) < 10000) {
            toast("Durée invalide.", "err");
            return false;
          }
          if (!s.channelId && !hasDefault) {
            toast("Choisis un salon.", "err");
            return false;
          }
          await api("/api/giveaway/create", "POST", { prize: s.prize.trim(), description: s.description, duration: s.duration, winnersCount: Number(s.winnersCount) || 1, channelId: s.channelId || undefined });
          toast(`Giveaway lancé dans ${channelName(s.channelId || cfg.defaultChannelId)}`, "ok");
          if (onCreated) onCreated();
        },
      },
    ],
  });
}

function giveawaySettings(host, cfg) {
  host.append(
    groups(
      settingsGroup(
        "Publication",
        "Valeurs proposées par défaut à la création.",
        field("Salon par défaut", channelPicker(cfg, "defaultChannelId", "text")),
        fieldRow(
          field("Durée par défaut", textInput(cfg, "defaultDuration", { size: "sm", placeholder: "24h" }), { help: "30m, 2h, 1d, 1w…" }),
          field("Gagnants par défaut", numberInput(cfg, "defaultWinners", { min: 1, max: 50 })),
        ),
        field("Rôle mentionné", rolePicker(cfg, "pingRoleId"), { help: "Mentionné à la publication de chaque giveaway.", optional: true }),
      ),
      settingsGroup("Participation", null, field("Rôle requis", rolePicker(cfg, "requiredRoleId"), { help: "Seuls les membres ayant ce rôle peuvent participer.", optional: true })),
      settingsGroup(
        "Apparence",
        "Message publié pour chaque giveaway.",
        field("Titre", textInput(cfg, "embedTitle", { placeholder: "GIVEAWAY", maxLength: 100 }), { help: "Affiché en majuscules." }),
        field("Couleur", colorInput(cfg, "embedColor")),
        field("Bannière", urlInput(cfg, "bannerUrl"), { optional: true }),
        fieldRow(field("Texte du bouton", textInput(cfg, "buttonLabel", { placeholder: "Participer", maxLength: 80 })), field("Emoji du bouton", textInput(cfg, "buttonEmoji", { size: "sm" }))),
        field("Pied de page", textInput(cfg, "footerText", { maxLength: 200 }), { optional: true }),
      ),
      settingsGroup(
        "Annonce des gagnants",
        null,
        field("Annonce dans le salon", textArea(cfg, "winnerAnnounce", { rows: 3 })),
        switchField("Prévenir les gagnants en message privé", cfg, "dmWinners"),
        showWhen(field("Message privé", textArea(cfg, "winnerDm", { rows: 3 })), () => !!cfg.dmWinners),
        field("Sans participant", textArea(cfg, "noWinnerMessage", { rows: 2 })),
        varsHint([
          ["{winners}", "Mentions des gagnants"],
          ["{prize}", "Récompense"],
          ["{count}", "Nombre de participants"],
          ["{host}", "Organisateur"],
        ]),
      ),
    ),
  );
}
