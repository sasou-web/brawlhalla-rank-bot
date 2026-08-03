/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 7/10
   Pages tickets et giveaways
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
// ---------- Tickets ----------
// Éditeur de motifs (options du menu déroulant du panneau).
function topicsEditor(cfg) {
  cfg.topics = Array.isArray(cfg.topics) ? cfg.topics : [];
  const wrap = el("div", { style: "width:100%" });
  const list = el("div");
  const redraw = () => {
    list.innerHTML = "";
    cfg.topics.forEach((t, i) => {
      const emo = el("input", { type: "text", value: t.emoji || "", placeholder: "🎫", style: "max-width:70px" });
      const lab = el("input", { type: "text", value: t.label || "", placeholder: "Support" });
      const desc = el("input", { type: "text", value: t.description || "", placeholder: "Description courte (affichée dans le menu)" });
      const msg = el("input", { type: "text", value: t.message || "", placeholder: "Message affiché à l'ouverture du ticket (optionnel)", style: "flex:1 1 100%" });
      emo.addEventListener("input", () => (cfg.topics[i].emoji = emo.value.trim()));
      lab.addEventListener("input", () => (cfg.topics[i].label = lab.value));
      desc.addEventListener("input", () => (cfg.topics[i].description = desc.value));
      msg.addEventListener("input", () => (cfg.topics[i].message = msg.value));
      list.append(
        el("div", { class: "hub-row", style: "flex-wrap:wrap" }, emo, lab, desc, msg,
          el("button", { class: "icon-btn", title: "Supprimer", onclick: () => { cfg.topics.splice(i, 1); redraw(); setDirty(true); } }, "🗑")),
      );
    });
    if (!cfg.topics.length) {
      list.append(el("div", { class: "empty-row" }, "Aucun motif : un simple bouton « Ouvrir un ticket » s'affichera."));
    }
  };
  const addBtn = el("button", { class: "btn-add", onclick: () => {
    if (cfg.topics.length >= 25) return toast("Maximum 25 motifs.", "err");
    cfg.topics.push({ label: "Nouveau motif", emoji: "🎫", description: "" });
    redraw();
    setDirty(true);
  } }, "+ Ajouter un motif");
  redraw();
  wrap.append(list, addBtn);
  return wrap;
}

let ticketTab = "config";

function renderTickets(content) {
  const cfg = structuredClone(CONFIG.tickets || {});
  if (!Array.isArray(cfg.topics)) cfg.topics = [];

  const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
    el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
    cfg.enabled ? "Module activé" : "Module inactif");

  content.append(pageHead("🎫", "Tickets de support",
    "Panneau de support : les membres ouvrent un salon privé avec le staff via un menu déroulant de motifs.", [badge]));

  const tabs = [
    { id: "config", ico: "⚙️", label: "Configuration" },
    { id: "panel", ico: "🎨", label: "Panneau" },
    { id: "ticket", ico: "💬", label: "Salon de ticket" },
    { id: "topics", ico: "🗂️", label: "Motifs" },
  ];
  if (!tabs.some((t) => t.id === ticketTab)) ticketTab = "config";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === ticketTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { ticketTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === ticketTab));
    body.innerHTML = "";
    if (ticketTab === "config") drawConfig();
    else if (ticketTab === "panel") drawPanel();
    else if (ticketTab === "ticket") drawTicket();
    else drawTopics();
  }

  function drawConfig() {
    const c1 = card("Général", "Où sont créés les tickets et qui les gère.");
    c1.append(
      fieldRow("Activé", "Active la création de tickets via le panneau.", toggle(cfg, "enabled")),
      fieldRow("Catégorie des tickets", "Où sont créés les salons de ticket.", channelSelect(cfg, "categoryId", "category")),
      fieldRow("Rôle staff", "Voit et gère tous les tickets (prise en charge, fermeture).", roleSelect(cfg, "staffRoleId")),
      fieldRow("Salon des transcripts", "Reçoit le .txt + récap à la fermeture (optionnel).", channelSelect(cfg, "logChannelId", "text")),
    );
    body.append(c1, publishCard());
  }

  function drawPanel() {
    const c = card("Apparence du panneau", "Le message public qui permet d'ouvrir un ticket.");
    c.append(
      fieldRow("Titre", "", textInput(cfg, "panelTitle", "🎫 Support & Tickets")),
      fieldRow("Description", "Texte principal de l'embed.", textareaInput(cfg, "panelDescription", "Besoin d'aide ? Ouvre un ticket via le menu ci-dessous."), true),
      fieldRow("Couleur", "Couleur de la barre de l'embed.", colorInput(cfg, "panelColor")),
      fieldRow("Image bannière (URL)", "Grande image affichée en bas de l'embed.", textInput(cfg, "bannerUrl", "https://…")),
      fieldRow("Vignette / logo (URL)", "Petite image en haut à droite.", textInput(cfg, "thumbnailUrl", "https://…")),
      fieldRow("Lien Terms of Service", "Affiché comme lien dans la description (optionnel).", textInput(cfg, "tosUrl", "https://…")),
    );
    const c2 = card("Textes des sections", "Titres et libellés affichés dans le panneau.");
    c2.append(
      fieldRow("À lire avant d'ouvrir", "Instructions affichées dans l'embed (une ligne par règle).", textareaInput(cfg, "rulesText", "• Explique ton problème directement\n• Reste respectueux et patient\n• Pas de ticket pour rien"), true),
      fieldRow("Titre section « Étapes »", "Titre du bloc des instructions.", textInput(cfg, "rulesTitle", "📋 Étapes à suivre")),
      fieldRow("Titre section « Options »", "Titre du bloc listant les motifs.", textInput(cfg, "optionsTitle", "🎫 Options de ticket")),
      fieldRow("Texte de bas de panneau", "Phrase juste au-dessus du menu déroulant.", textInput(cfg, "footerText", "🚀 Choisis un motif dans le menu ci-dessous.")),
      fieldRow("Texte du menu déroulant", "Placeholder affiché sur le menu de motifs.", textInput(cfg, "selectPlaceholder", "Choisis un motif")),
    );
    body.append(c, c2, publishCard());
  }

  function drawTicket() {
    const c = card("Message du ticket créé",
      "Embed posté dans le salon privé à l'ouverture. La vignette et la couleur sont reprises de l'onglet « Panneau ».");
    c.append(
      fieldRow("Titre du ticket", "", textInput(cfg, "ticketTitle", "🎫 Support Ticket")),
      fieldRow("Message d'accueil", "Affiché en haut du ticket. Le lien Terms of Service est ajouté automatiquement s'il est défini.", textareaInput(cfg, "ticketWelcome", "Merci de patienter, un membre du staff va prendre en charge ton ticket."), true),
      fieldRow("Informations complémentaires", "Bloc « Informations » par défaut (un motif peut le remplacer par son propre message).", textareaInput(cfg, "ticketInfo", ""), true),
    );
    body.append(c);
  }

  function drawTopics() {
    const c = card("Motifs du menu déroulant",
      "Chaque motif = une option du menu (emoji + nom + description). Le champ « message » s'affiche à l'ouverture du ticket pour ce motif. Ex : Buy, Support, Replace.");
    c.append(topicsEditor(cfg));
    body.append(c, publishCard());
  }

  function publishCard() {
    const pubState = { channelId: "" };
    const c = card("Publier le panneau", "Enregistre tes réglages, puis publie le panneau de tickets dans un salon.");
    c.append(fieldRow("Salon", "", channelSelect(pubState, "channelId", "textann")));
    const pub = el("button", { class: "tbtn primary", style: "margin-top:10px" }, icon("megaphone", 15), "Publier le panneau");
    pub.addEventListener("click", async () => {
      if (!pubState.channelId) return toast("Choisis un salon.", "err");
      pub.disabled = true;
      try {
        CONFIG.tickets = await api("/api/config/tickets", "PUT", cfg);
        setDirty(false);
        await api("/api/tickets/publish", "POST", { channelId: pubState.channelId });
        toast("Panneau publié", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      pub.disabled = false;
    });
    c.append(el("div", {}, pub));
    return c;
  }

  draw();

  const btn = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      CONFIG.tickets = await api("/api/config/tickets", "PUT", cfg);
      setDirty(false);
      renderNav();
      toast("Modifications enregistrées", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });
  content.append(actionBar({ hint: true }, btn));
}

// ---------- Giveaways ----------
let gwTab = "manage";

async function renderGiveaway(content) {
  content.innerHTML = "";
  setDirty(false);
  // cfg partagé entre les onglets : éditer les réglages puis basculer sur « Giveaways »
  // ne perd pas les modifications en cours (elles restent en mémoire jusqu'à l'enregistrement).
  const cfg = structuredClone(CONFIG.giveaway || {});

  const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
    el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
    cfg.enabled ? "Module activé" : "Module inactif");

  content.append(pageHead("🎉", "Giveaways",
    "Crée et gère des concours. Les gagnants sont tirés au sort automatiquement à l'échéance.", [badge]));

  const tabs = [
    { id: "manage", ico: "🎁", label: "Concours" },
    { id: "settings", ico: "⚙️", label: "Réglages" },
    { id: "look", ico: "🎨", label: "Apparence" },
  ];
  if (!tabs.some((x) => x.id === gwTab)) gwTab = "manage";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === gwTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { gwTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  const saveCfg = async () => {
    CONFIG.giveaway = await api("/api/config/giveaway", "PUT", cfg);
    setDirty(false);
    renderNav();
  };

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === gwTab));
    body.innerHTML = "";
    if (gwTab === "manage") drawManage();
    else if (gwTab === "look") drawLook();
    else drawSettings();
  }

  function saveBar() {
    const saveBtn = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      try { await saveCfg(); toast("Réglages enregistrés", "ok"); }
      catch (e) { toast("Erreur : " + e.message, "err"); }
      saveBtn.disabled = false;
    });
    return actionBar({ hint: true }, saveBtn);
  }

  // ---- Onglet Réglages ----
  function drawSettings() {
    const c1 = card("Général", "Où publier les concours et qui peut participer.");
    c1.append(
      fieldRow("Activé", "Active le système de giveaways (requis pour en créer).", toggle(cfg, "enabled")),
      fieldRow("Salon par défaut", "Salon où sont publiés les giveaways par défaut.", channelSelect(cfg, "defaultChannelId", "textann")),
      fieldRow("Rôle pingé", "Mentionné à la publication d'un giveaway (optionnel).", roleSelect(cfg, "pingRoleId")),
      fieldRow("Rôle requis", "Seuls les membres ayant ce rôle peuvent participer (optionnel).", roleSelect(cfg, "requiredRoleId")),
      fieldRow("MP aux gagnants", "Envoie un message privé à chaque gagnant à la clôture.", toggle(cfg, "dmWinners")),
    );

    const c3 = card("Messages des gagnants", null);
    c3.append(el("div", { class: "card-sub", html:
      "Placeholders : <code>{winners}</code> (mentions), <code>{prize}</code>, <code>{count}</code> (participants), <code>{host}</code> (organisateur)." }));
    c3.append(
      fieldRow("Annonce des gagnants", "Message posté dans le salon quand il y a des gagnants.", textareaInput(cfg, "winnerAnnounce", "🎉 Félicitations {winners} ! Vous remportez **{prize}** 🏆"), true),
      fieldRow("Message privé au gagnant", "MP envoyé à chaque gagnant (si « MP aux gagnants » est activé).", textareaInput(cfg, "winnerDm", "🎉 Tu as gagné **{prize}** dans le giveaway !"), true),
      fieldRow("Aucun participant", "Message posté si personne n'a participé.", textareaInput(cfg, "noWinnerMessage", "😢 Le giveaway **{prize}** se termine sans participant."), true),
    );
    body.append(c1, c3, saveBar());
  }

  // ---- Onglet Apparence ----
  function drawLook() {
    const c2 = card("Apparence de l'embed", "Le rendu visuel du message de giveaway.");
    c2.append(
      fieldRow("Titre", "Affiché en haut du giveaway (mis en majuscules).", textInput(cfg, "embedTitle", "GIVEAWAY")),
      fieldRow("Couleur", "Couleur de la barre de l'embed.", colorInput(cfg, "embedColor")),
      fieldRow("Bannière (URL)", "Grande image intégrée en haut (optionnel).", textInput(cfg, "bannerUrl", "https://…")),
      fieldRow("Texte du bouton", "Libellé du bouton de participation.", textInput(cfg, "buttonLabel", "Participer")),
      fieldRow("Emoji du bouton", "Emoji unicode ou custom (<:nom:id>).", textInput(cfg, "buttonEmoji", "🎉")),
      fieldRow("Pied de page", "Petite phrase en bas de l'embed.", textInput(cfg, "footerText", "Bonne chance à toutes et à tous ! 🍀")),
    );
    body.append(c2, saveBar());
  }

  // ---- Onglet Concours (création + liste) ----
  function drawManage() {
    const form = {
      prize: "", description: "",
      duration: cfg.defaultDuration || "24h",
      winnersCount: cfg.defaultWinners || 1,
      channelId: cfg.defaultChannelId || "",
    };
    const c1 = card("Lancer un giveaway", "Durée : 30m, 2h, 1d, 1w — combinable (ex : 1d12h).");
    c1.append(
      fieldRow("Récompense", "Ce que les gagnants remportent.", textInput(form, "prize", "Nitro classique 1 mois")),
      fieldRow("Description", "Texte additionnel affiché dans l'embed (optionnel).", textareaInput(form, "description", "Détails, conditions, etc."), true),
      fieldRow("Durée", "Ex : 30m, 2h, 1d, 1w.", textInput(form, "duration", "24h")),
      fieldRow("Nombre de gagnants", "Combien de gagnants tirer au sort.", numberInput(form, "winnersCount", 1, 50)),
      fieldRow("Salon", "Où publier (vide = salon par défaut).", channelSelect(form, "channelId", "textann")),
    );
    const createBtn = el("button", { class: "tbtn primary", style: "margin-top:12px" }, icon("gift", 15), "Lancer le giveaway");
    createBtn.addEventListener("click", async () => {
      if (!form.prize || !form.prize.trim()) return toast("Indique une récompense.", "err");
      createBtn.disabled = true;
      try {
        await saveCfg();
        await api("/api/giveaway/create", "POST", {
          prize: form.prize,
          description: form.description,
          duration: form.duration,
          winnersCount: Number(form.winnersCount) || 1,
          channelId: form.channelId || undefined,
        });
        toast("Giveaway lancé 🎉", "ok");
        loadList();
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      createBtn.disabled = false;
    });
    c1.append(el("div", {}, createBtn));
    body.append(c1);

    const refreshBtn = el("button", { class: "tbtn", title: "Rafraîchir la liste et les participants" }, icon("refresh", 15), "Rafraîchir");
    refreshBtn.addEventListener("click", () => loadList());
    const listCard = card("Giveaways en cours", null, refreshBtn);
    const listWrap = el("div", {}, el("div", { class: "card-sub" }, "Chargement…"));
    listCard.append(listWrap);
    body.append(listCard);

    const fmtDate = (ts) => new Date(ts).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    const roleName = (rid) => (GUILD.roles.find((r) => r.id === rid) || {}).name;
    const chanName = (cid) => {
      const all = [...GUILD.channels.text, ...GUILD.channels.announcement];
      return (all.find((c) => c.id === cid) || {}).name;
    };

    const gwRow = (g) => {
      const meta = [`🎟️ ${g.entries} participant(s)`, `🏅 ${g.winnersCount} gagnant(s)`];
      if (chanName(g.channelId)) meta.push(`# ${chanName(g.channelId)}`);
      if (g.requiredRoleId && roleName(g.requiredRoleId)) meta.push(`🔒 @${roleName(g.requiredRoleId)}`);
      const info = el("div", { style: "min-width:0" },
        el("div", { style: "font-weight:600" }, `🎁 ${g.prize}`),
        el("div", { class: "desc", style: "margin-top:4px" }, meta.join(" · ")));
      const head = el("div", { style: "display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap" }, info);
      const actions = el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" });

      if (g.status === "active") {
        head.append(el("span", { class: "pill status info" }, `Fin : ${fmtDate(g.endsTs)}`));
        const endBtn = el("button", { class: "tbtn" }, "🏁 Terminer");
        endBtn.addEventListener("click", async () => {
          if (!(await confirmModal(`Terminer le giveaway <b>${g.prize}</b> maintenant ?`, { okLabel: "Terminer" }))) return;
          endBtn.disabled = true;
          try { await api("/api/giveaway/end", "POST", { id: g.id }); toast("Giveaway terminé", "ok"); loadList(); }
          catch (e) { toast("Erreur : " + e.message, "err"); endBtn.disabled = false; }
        });
        const cancelBtn = el("button", { class: "tbtn danger" }, "🚫 Annuler");
        cancelBtn.addEventListener("click", async () => {
          if (!(await confirmModal(`Annuler le giveaway <b>${g.prize}</b> (sans tirage) ?`, { okLabel: "Annuler le giveaway", danger: true }))) return;
          cancelBtn.disabled = true;
          try { await api("/api/giveaway/cancel", "POST", { id: g.id }); toast("Giveaway annulé", "ok"); loadList(); }
          catch (e) { toast("Erreur : " + e.message, "err"); cancelBtn.disabled = false; }
        });
        actions.append(endBtn, cancelBtn);
      } else {
        const label = g.status === "cancelled" ? "Annulé" : "Terminé";
        head.append(el("span", { class: "pill" }, label));
        if (g.winnerIds && g.winnerIds.length) {
          info.append(el("div", { class: "desc", style: "margin-top:4px" }, `🥳 Gagnant(s) : ${g.winnerIds.map((w) => "<@" + w + ">").join(", ")}`));
        }
        if (g.status === "ended") {
          const rerollBtn = el("button", { class: "tbtn" }, icon("refresh", 15), "Reroll");
          rerollBtn.addEventListener("click", async () => {
            rerollBtn.disabled = true;
            try { const r = await api("/api/giveaway/reroll", "POST", { id: g.id }); toast("Reroll : " + (r.winners || []).length + " nouveau(x) gagnant(s)", "ok"); }
            catch (e) { toast("Erreur : " + e.message, "err"); }
            rerollBtn.disabled = false;
          });
          actions.append(rerollBtn);
        }
      }
      return el("div", { class: "card nested" }, head, actions.children.length ? el("div", { style: "margin-top:10px" }, actions) : null);
    };

    async function loadList() {
      refreshBtn.disabled = true;
      let data;
      try {
        data = await api("/api/giveaway/list");
      } catch (e) {
        listWrap.innerHTML = "";
        listWrap.append(el("div", { class: "empty-row" }, "Erreur : " + e.message));
        refreshBtn.disabled = false;
        return;
      }
      listWrap.innerHTML = "";
      if (data.active.length) {
        for (const g of data.active) listWrap.append(gwRow(g));
      } else {
        listWrap.append(el("div", { class: "empty-row" }, "Aucun giveaway en cours."));
      }
      const ended = data.recent.filter((g) => g.status !== "active");
      if (ended.length) {
        listWrap.append(blockTitle("Historique récent"));
        for (const g of ended.slice(0, 10)) listWrap.append(gwRow(g));
      }
      refreshBtn.disabled = false;
    }

    loadList();
  }

  draw();
}
