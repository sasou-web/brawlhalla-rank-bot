/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 9/10
   Tournoi : formulaire, pilotage, bracket, librairie
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
