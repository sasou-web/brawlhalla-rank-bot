/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 6/10
   Pages outils : seeding start.gg, base de combos
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
// ---------- Seeding start.gg ----------
function renderStartggSeed(content) {
  setDirty(false);
  const state = { url: "", token: "", phaseId: "", phaseName: "", eventName: "", rows: [], phases: [] };

  content.append(pageHead("🌱", "Seeding start.gg",
    "Seede un tournoi géré sur start.gg d'après le niveau Brawlhalla (rating 1v1), puis réécris le seeding directement sur start.gg."));

  const conn = card("Événement start.gg", "Le lien doit pointer vers un événement (.../event/...).");
  const urlIn = textInput(state, "url", "https://www.start.gg/tournament/<nom>/event/<event>");
  const tokenIn = el("input", { type: "password", placeholder: "Personal Access Token start.gg" });
  tokenIn.addEventListener("input", () => (state.token = tokenIn.value.trim()));
  conn.append(
    fieldRow("Lien de l'événement", "Copie l'URL depuis start.gg.", urlIn),
    fieldRow("Token start.gg", "Settings → Developer → Personal Access Tokens. Doit être ADMIN du tournoi pour réécrire le seeding. Mémorisé après la 1ʳᵉ fois.", tokenIn),
  );
  content.append(conn);

  const resultCard = card("Seeding proposé");
  const info = el("div", { class: "card-sub" }, "Charge les inscrits pour calculer le seeding (rating 1v1 décroissant).");
  const phaseRow = el("div", { style: "margin:10px 0" });
  const tableWrap = el("div", {});
  resultCard.append(info, phaseRow, tableWrap);

  function renderTable() {
    tableWrap.innerHTML = "";
    if (!state.rows.length) return;
    tableWrap.append(el("div", { class: "sg-row sg-head" },
      el("span", {}, "Seed"), el("span", {}, "Joueur"), el("span", {}, "Rating 1v1"), el("span", {}, "Source"), el("span", {}, "Actuel")));
    for (const r of state.rows) {
      tableWrap.append(el("div", { class: "sg-row" },
        el("span", { class: "sg-seed" }, "#" + r.proposedSeed),
        el("span", {}, r.name),
        el("span", {}, r.rating ? String(r.rating) : "—"),
        el("span", { class: "sg-src" }, r.source),
        el("span", { class: "sg-cur" }, "#" + r.currentSeed)));
    }
  }

  function drawPhasePicker() {
    phaseRow.innerHTML = "";
    if (state.phases.length <= 1) return;
    const sel = el("select");
    for (const p of state.phases) {
      const opt = el("option", { value: p.id }, p.name);
      if (p.id === state.phaseId) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => { state.phaseId = sel.value; loadPreview(); });
    phaseRow.append(el("div", { class: "tb-label", style: "margin:0 0 6px" }, "Phase à seeder"), sel);
  }

  async function loadPreview() {
    if (!state.url) return toast("Colle le lien de l'événement start.gg.", "err");
    info.textContent = "⏳ Récupération des inscrits et calcul du seeding…";
    try {
      const r = await api("/api/startgg/preview", "POST", { url: state.url, token: state.token || undefined, phaseId: state.phaseId || undefined });
      state.eventName = r.eventName; state.phaseId = r.phaseId; state.phaseName = r.phaseName;
      state.phases = r.phases || []; state.rows = r.rows || [];
      const matched = state.rows.filter((x) => x.source !== "inconnu").length;
      info.textContent = `${r.eventName} — phase « ${r.phaseName} » : ${state.rows.length} inscrit(s), ${matched} avec rating connu.`;
      drawPhasePicker();
      renderTable();
    } catch (e) {
      info.textContent = "";
      toast("Erreur : " + e.message, "err");
    }
  }

  const loadBtn = el("button", { class: "btn-save ghost" }, icon("refresh", 16), "Charger & calculer");
  loadBtn.addEventListener("click", async () => { loadBtn.disabled = true; await loadPreview(); loadBtn.disabled = false; });

  const applyBtn = el("button", { class: "btn-save" }, icon("check", 17), "Appliquer sur start.gg");
  applyBtn.addEventListener("click", async () => {
    if (!state.rows.length) return toast("Charge d'abord le seeding.", "err");
    if (!(await confirmModal(`Réécrire le seeding de la phase « ${state.phaseName} » sur start.gg (${state.rows.length} joueurs) ?`, { title: "Appliquer le seeding", okLabel: "Appliquer" }))) return;
    applyBtn.disabled = true;
    try {
      const mapping = state.rows.map((r) => ({ seedId: r.seedId, seedNum: r.proposedSeed }));
      const r = await api("/api/startgg/apply", "POST", { token: state.token || undefined, phaseId: state.phaseId, mapping });
      toast(r.message || "Seeding appliqué", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    applyBtn.disabled = false;
  });

  content.append(resultCard, actionBar({}, loadBtn, applyBtn));
}

// ---------- Combos (base BrawlDatabase) ----------
async function renderCombos(content) {
  content.append(pageHead("🥊", "Combos Brawlhalla",
    "Base de true combos (source BrawlDatabase) que les membres parcourent via /combos ou un panneau interactif."));

  const dbCard = card("Base de données", null);
  const body = el("div", { class: "card-sub" }, "Chargement…");
  dbCard.append(body);

  const upd = el("button", { class: "tbtn", style: "margin-top:12px" }, icon("refresh", 15), "Mettre à jour la base");
  upd.addEventListener("click", async () => {
    upd.disabled = true;
    upd.innerHTML = "";
    upd.append(icon("refresh", 15), "Récupération depuis BrawlDB…");
    try {
      const r = await api("/api/combos/refresh", "POST", {});
      toast(`Base mise à jour : ${r.count} combos`, "ok");
      renderSection("combos");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
      upd.disabled = false;
      upd.innerHTML = "";
      upd.append(icon("refresh", 15), "Mettre à jour la base");
    }
  });
  dbCard.append(el("div", {}, upd));
  content.append(dbCard);

  // Panneau interactif à publier dans un salon.
  const pubState = { channelId: "" };
  const pubCard = card("Publier le panneau",
    "Poste un panneau /combos interactif : les membres choisissent l'arme et parcourent les combos (vidéo intégrée).");
  pubCard.append(fieldRow("Salon", "Où publier le panneau.", channelSelect(pubState, "channelId", "textann")));
  const pub = el("button", { class: "tbtn primary", style: "margin-top:10px" }, icon("megaphone", 15), "Publier le panneau");
  pub.addEventListener("click", async () => {
    if (!pubState.channelId) return toast("Choisis un salon.", "err");
    pub.disabled = true;
    try {
      await api("/api/combos/publish", "POST", { channelId: pubState.channelId });
      setDirty(false);
      toast("Panneau publié", "ok");
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
      el("div", { class: "stats", style: "margin:0" },
        el("div", { class: "stat" },
          el("div", { class: "st-top" }, icon("flame", 15)),
          el("div", { class: "val" }, String(info.count)),
          el("div", { class: "lbl" }, "Combos en base")),
        el("div", { class: "stat" },
          el("div", { class: "st-top" }, icon("sliders", 15)),
          el("div", { class: "val" }, String(Object.keys(info.byWeapon || {}).length)),
          el("div", { class: "lbl" }, "Armes couvertes")),
        el("div", { class: "stat" },
          el("div", { class: "st-top" }, icon("refresh", 15)),
          el("div", { class: "val", style: "font-size:15px;font-weight:600" }, date),
          el("div", { class: "lbl" }, "Dernière mise à jour"))),
    );
  } catch (e) {
    body.textContent = "Erreur : " + e.message;
  }
}
