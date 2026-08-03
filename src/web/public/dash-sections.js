/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 4/10
   Schémas de configuration déclaratifs et rendu générique d'une section
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
// ═══════════════════ 6. Schémas de configuration ═══════════════════
// Chaque section déclarative renvoie { ico, title, sub, cards[] }.
// Une carte = { title, sub?, fields: [[label, desc, control]], extra? }.
function sectionSchema(id, cfg) {
  const tierOpts = GUILD.tiers.map((t) => ({ value: t, label: t }));
  switch (id) {
    case "settings":
      return {
        ico: "🛡️",
        title: "Validation & salons système",
        sub: "Où le bot publie ses messages internes, et comment les demandes de liaison Brawlhalla sont validées.",
        cards: [
          { title: "Salons système", sub: "Les salons dans lesquels le bot travaille au quotidien.", fields: [
            ["Salon de validation", "Où arrivent les demandes de liaison à valider.", channelSelect(cfg, "reviewChannelId", "text")],
            ["Salon d'audit (logs)", "Journal des actions du bot.", channelSelect(cfg, "auditChannelId", "text")],
            ["Salon des annonces", "Annonces de montée de rang.", channelSelect(cfg, "announceChannelId", "text")],
            ["Salon d'alertes (santé du bot)", "Crash, déconnexion Discord, API down. Vide = salon d'audit.", channelSelect(cfg, "alertChannelId", "text")],
            ["Salon des succès", "Annonces des achievements débloqués (sans ping). Vide = désactivé.", channelSelect(cfg, "achievementsChannelId", "text")],
          ] },
          { title: "Validation des liaisons", sub: "Qui valide, et à partir de quel rang une validation humaine est requise.", fields: [
            ["Rôle validateur", "Rôle autorisé à valider/refuser (sinon permission Gérer le serveur).", roleSelect(cfg, "reviewerRoleId")],
            ["Seuil d'auto-validation", "Tout ce qui est ≤ ce tier est validé automatiquement.", selectInput(cfg, "autoApproveTier", tierOpts)],
          ] },
          { title: "Validation par preuve (hauts rangs)", sub: "À partir du rang choisi, un fil privé est créé : le joueur y poste une capture de sa page de profil en jeu (ID + pseudo visibles), le staff valide depuis ce fil.", fields: [
            ["Preuve obligatoire", "Active la demande de capture d'écran pour les hauts rangs.", toggle(cfg, "requireProofScreenshot")],
            ["Rang exigeant une preuve", "À partir de ce tier (inclus), une capture est demandée.", selectInput(cfg, "proofTier", tierOpts)],
            ["Salon des fils de preuve", "⚠️ Doit être VISIBLE par les membres (sinon ils ne peuvent pas être ajoutés au fil privé). Vide = salon où /lier est lancé. Le staff doit avoir « Gérer les fils » pour les voir.", channelSelect(cfg, "proofChannelId", "text")],
          ] },
        ],
      };
    case "levels":
      return {
        ico: "⭐",
        title: "Système de niveaux",
        sub: "Gain d'XP en discutant et en vocal, annonces de montée de niveau et rôles de récompense.",
        cards: [
          { title: "Général", fields: [
            ["Activé", "Active le gain d'XP.", toggle(cfg, "enabled")],
            ["Annonces", "Où annoncer les montées de niveau.", selectInput(cfg, "announceMode", [{ value: "channel", label: "Salon" }, { value: "dm", label: "Message privé" }, { value: "off", label: "Désactivées" }])],
            ["Salon d'annonce", "Si mode Salon (vide = salon du message).", channelSelect(cfg, "announceChannelId", "text")],
          ] },
          { title: "Gain d'XP", sub: "Combien d'XP rapporte un message ou une minute en vocal.", fields: [
            ["Cooldown (s)", "Délai entre deux gains d'XP par message.", numberInput(cfg, "cooldownSec", 0)],
            ["XP min / message", "", numberInput(cfg, "minXp", 1)],
            ["XP max / message", "", numberInput(cfg, "maxXp", 1)],
            ["XP vocal", "Gain d'XP en vocal.", toggle(cfg, "voiceEnabled")],
            ["XP vocal / min", "", numberInput(cfg, "voiceXpPerMin", 0)],
          ] },
          { title: "Bonus & anti-abus", sub: "Multiplicateurs d'XP et garde-fous.", fields: [
            ["Bonus week-end (×)", "Multiplie l'XP le samedi/dimanche (1 = désactivé).", numberInput(cfg, "weekendBonus", 1)],
            ["Rôle bonus", "Ce rôle gagne plus d'XP (ex: booster Nitro).", roleSelect(cfg, "boosterRoleId")],
            ["Multiplicateur du rôle bonus (×)", "", numberInput(cfg, "boosterMultiplier", 1)],
            ["Cap XP / jour", "Plafond d'XP par membre et par jour (0 = illimité).", numberInput(cfg, "dailyXpCap", 0)],
          ], extra: el("div", { style: "margin-top:14px" }, el("div", { class: "card-sub" }, "🚫 Salons sans XP (texte ou vocal)"), multiChannel(cfg, "noXpChannels", "textvoice")) },
          { title: "Récompenses", sub: "Rôle attribué à chaque palier de niveau.", fields: [
            ["Cumuler les rôles", "Oui = garde tous les paliers. Non = seulement le plus haut.", toggle(cfg, "stackRewards")],
          ], extra: rewardsEditor(cfg) },
        ],
      };
    case "tiktok":
      return {
        ico: "📱",
        title: "Notifications TikTok",
        sub: "Poste automatiquement les nouvelles vidéos d'un compte via son flux RSS.",
        cards: [
          { title: "Source", sub: "Le compte à suivre et la fréquence de vérification.", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["URL du flux RSS", "Généré par rss.app, GitHub Pages, etc.", textInput(cfg, "feedUrl", "https://...")],
            ["Pseudo affiché", "Sans le @.", textInput(cfg, "username", "kayagoldforged")],
            ["Photo de profil (URL)", "Affichée à côté du pseudo.", textInput(cfg, "avatarUrl", "https://...")],
            ["Intervalle (min)", "Fréquence de vérification (min. 2).", numberInput(cfg, "pollIntervalMin", 2)],
          ] },
          { title: "Publication", sub: "Où et comment la vidéo est annoncée.", fields: [
            ["Salon", "Où poster les vidéos.", channelSelect(cfg, "channelId", "text")],
            ["Rôle à ping", "Optionnel.", roleSelect(cfg, "roleId")],
            ["Date de la vidéo", "Affiche « TikTok • date/heure » en bas de l'embed.", toggle(cfg, "showDate")],
            ["Message d'annonce", "Phrase postée avec la vidéo. {pseudo} = nom affiché, {url} = lien. Vide = phrase par défaut.", textareaInput(cfg, "message", "Nouvelle vidéo de {pseudo} va la voir tout de suite !")],
          ] },
        ],
      };
    case "clips":
      return {
        ico: "🎬",
        title: "Réactions sur les clips",
        sub: "Le bot réagit automatiquement aux clips vidéo et modère le salon.",
        cards: [
          { title: "Comportement", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Vidéos uniquement", "Ne réagit qu'aux messages avec une vidéo.", toggle(cfg, "requireVideo")],
            ["Supprimer les non-vidéos", "Efface les messages sans vidéo (besoin de Gérer les messages).", toggle(cfg, "deleteNonVideo")],
            ["Ignorer les bots", "", toggle(cfg, "ignoreBots")],
            ["Ignorer les réponses", "", toggle(cfg, "ignoreReplies")],
            ["Épingler à partir de (réactions)", "Épingle le clip quand une réaction atteint ce nombre (0 = off). La réaction du bot compte.", numberInput(cfg, "pinThreshold", 0)],
          ] },
          { title: "Salons surveillés", sub: "Le bot n'agit que dans ces salons.", fields: [], extra: multiChannel(cfg, "channelIds", "textann") },
          { title: "Réactions ajoutées", sub: "Emojis posés automatiquement sur chaque clip.", fields: [], extra: reactionsEditor(cfg, "reactions") },
          { title: "Domaines vidéo acceptés en plus", sub: "Hébergeurs considérés comme des vidéos valides.", fields: [], extra: domainsEditor(cfg, "extraDomains") },
        ],
      };
    case "guessrank":
      return {
        ico: "🏅",
        title: "Devine ton rang",
        sub: "Les membres votent le rang du joueur d'un clip via des réactions emojis de rank.",
        cards: [
          { title: "Comportement", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Un seul vote / membre", "Retire le vote précédent quand on en clique un autre.", toggle(cfg, "singleVote")],
            ["Vidéos uniquement", "", toggle(cfg, "requireVideo")],
            ["Supprimer les non-vidéos", "", toggle(cfg, "deleteNonVideo")],
            ["Ignorer les bots", "", toggle(cfg, "ignoreBots")],
            ["Ignorer les réponses", "", toggle(cfg, "ignoreReplies")],
          ] },
          { title: "Salons surveillés", fields: [], extra: multiChannel(cfg, "channelIds", "textann") },
          { title: "Emojis de rank", sub: "Dans l'ordre Tin → Valhallan.", fields: [], extra: reactionsEditor(cfg, "reactions") },
          { title: "Domaines vidéo acceptés en plus", fields: [], extra: domainsEditor(cfg, "extraDomains") },
        ],
      };
    case "tempvoice":
      return {
        ico: "🔊",
        title: "Vocaux temporaires",
        sub: "Rejoindre un salon « hub » crée un vocal personnel, supprimé automatiquement quand il se vide.",
        cards: [
          { title: "Général", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Catégorie des salons créés", "Vide = celle de chaque hub.", channelSelect(cfg, "categoryId", "category")],
          ] },
          { title: "Hubs (rejoindre pour créer)", sub: "{user} = pseudo du membre. La limite 0 signifie « illimité ».", fields: [], extra: hubsEditor(cfg) },
        ],
      };
    case "reminders":
      return {
        ico: "🔔",
        title: "Rappels automatiques",
        sub: "Le bot poste régulièrement un message d'une liste dans un salon (vocaux privés, règles, liens utiles…).",
        cards: [
          { title: "Général", fields: [
            ["Activé", "", toggle(cfg, "enabled")],
            ["Salon des rappels", "Où le bot publie les rappels.", channelSelect(cfg, "channelId", "text")],
            ["Intervalle (minutes)", "Délai entre deux rappels (min. 1, max. 10080 = 7 jours).", numberInput(cfg, "intervalMinutes", 1, 10080)],
            ["Ordre d'envoi", "Rotation = à la suite ; Aléatoire = au hasard.", selectInput(cfg, "mode", [{ value: "rotate", label: "Rotation" }, { value: "random", label: "Aléatoire" }])],
          ] },
          { title: "Messages", sub: "Un rappel par bloc. Les rappels sont postés sans mention (pas de ping en masse).", fields: [], extra: messagesEditor(cfg, "messages") },
        ],
      };
    case "linkpanel":
      return {
        ico: "🔗",
        title: "Panneau de liaison",
        sub: "Un cadre soigné + bouton « Lier mon compte » : au clic, un modal (ID / pseudo) lance la liaison. Plus besoin de taper /lier.",
        cards: [
          { title: "Apparence", fields: [
            ["Titre", "", textInput(cfg, "title", "🔗 Lier ton compte Brawlhalla")],
            ["Texte du bouton", "", textInput(cfg, "buttonLabel", "Lier mon compte")],
            ["Couleur (hex)", "Bordure du cadre. Ex : #4ea1ff", textInput(cfg, "color", "#4ea1ff")],
            ["Vignette (URL image)", "Petite image à droite du titre. Optionnel.", textInput(cfg, "thumbnailUrl", "https://...")],
            ["Bannière (URL image)", "Grande image en haut du cadre. Optionnel.", textInput(cfg, "bannerUrl", "https://...")],
          ] },
          { title: "Texte d'accroche", sub: "Markdown supporté.", fields: [], extra: textareaInput(cfg, "description", "Phrase d'accroche (markdown supporté).") },
          { title: "Avantages de la liaison", sub: "Titre + liste affichée dans le cadre (markdown, une ligne par avantage).", fields: [
            ["Titre de la section", "", textInput(cfg, "benefitsTitle", "✨ Pourquoi lier ton compte ?")],
          ], extra: textareaInput(cfg, "benefits", "🎖️ Rôles de rank automatiques\n🔄 Mise à jour auto...") },
          { title: "Pied de cadre (conseil)", fields: [], extra: textareaInput(cfg, "footerText", "💡 Le plus fiable : ton Brawlhalla ID...") },
          { title: "Publication", sub: "Choisis le salon puis utilise « Publier le panneau » dans la barre du bas.", fields: [
            ["Salon du panneau", "", channelSelect(cfg, "channelId", "text")],
          ] },
        ],
      };
    case "lol":
      if (!cfg.embed) cfg.embed = {};
      return {
        ico: "🎮",
        title: "Accueil & rôle LoL",
        sub: "Quand un membre obtient le rôle League of Legends, le bot l'accueille dans le salon de la section.",
        cards: [
          { title: "Déclencheur", sub: "Le bot surveille l'ajout du rôle, peu importe la source : onboarding Discord, reaction-role ou attribution manuelle par le staff.", fields: [
            ["Activé", "Active l'accueil automatique de la section LoL.", toggle(cfg, "enabled")],
            ["Rôle League of Legends", "Le rôle qui déclenche le message d'accueil.", roleSelect(cfg, "roleId")],
            ["Salon d'accueil", "Où poster le message (idéalement le salon de discussion LoL).", channelSelect(cfg, "channelId", "textann")],
            ["Une seule fois par membre", "Évite de reposter si le rôle est retiré puis redonné.", toggle(cfg, "oncePerMember")],
          ], extra: lolOnboardingHelp() },
          { title: "Message", sub: "Format et contenu de l'accueil.", fields: [
            ["Format", "Carte stylée, texte simple, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Carte (embed)" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + carte" }])],
            ["Mentionner le membre", "Ping le membre accueilli.", toggle(cfg, "pingUser")],
            ["Message texte", "Utilisé si format Texte ou Texte + carte.", textareaInput(cfg, "text", "{user} vient de rejoindre la section LoL 🎮")],
          ] },
          { title: "Apparence de la carte", sub: "Utilisée pour les formats « Carte » et « Texte + carte ».", fields: [
            ["Couleur", "Bordure de la carte.", colorInput(cfg.embed, "color")],
            ["Titre", "", textInput(cfg.embed, "title", "🎮 Bienvenue sur la section LoL, {username} !")],
            ["Description", "Markdown supporté.", textareaInput(cfg.embed, "description", "Ici tu peux parler de League of Legends…")],
            ["Avatar du membre en miniature", "Affiche son avatar à droite du titre.", toggle(cfg.embed, "thumbnailUser")],
            ["Image / bannière (URL)", "Grande image en bas de la carte.", textInput(cfg.embed, "image", "https://...")],
            ["Pied de carte", "", textInput(cfg.embed, "footer", "{server} • Section LoL")],
            ["Icône du serveur dans le pied", "", toggle(cfg.embed, "footerIcon")],
          ] },
          { title: "Variables disponibles", fields: [], extra: el("div", { class: "card-sub", style: "margin:0", html:
            "<code>{user}</code> mention · <code>{username}</code> pseudo affiché · <code>{user.tag}</code> tag complet · " +
            "<code>{server}</code> nom du serveur · <code>{membercount}</code> nombre de membres" }) },
          { title: "Historique d'accueil", sub: "Liste des membres déjà accueillis, utilisée par l'option « une seule fois par membre ».", fields: [], extra: lolGreetedBox() },
        ],
      };
  }
}

// Rappel de la marche à suivre côté Discord : l'attribution du rôle via la question
// d'onboarding se configure dans les paramètres du serveur, pas depuis le bot.
function lolOnboardingHelp() {
  const box = el("div", { class: "callout info", style: "cursor:default;margin:14px 0 0;align-items:flex-start" });
  box.append(
    el("span", { class: "co-ico" }, icon("alert", 18)),
    el("div", { style: "font-weight:500;line-height:1.6" , html:
      "<b>Côté Discord</b> — pour que la réponse « League of Legends » donne le rôle :<br>" +
      "Paramètres du serveur → <b>Intégration</b> → <b>Onboarding</b> → ta question → " +
      "coche le rôle LoL sur la réponse correspondante.<br>" +
      "<span style=\"opacity:.85\">Le bot ne configure pas l'onboarding lui-même : il réagit à l'ajout du rôle. " +
      "Tout ce qui donne ce rôle déclenchera donc l'accueil.</span>" }),
  );
  return box;
}

// Compteur de membres accueillis + réinitialisation.
function lolGreetedBox() {
  const wrap = el("div", { style: "width:100%" });
  const info = el("div", { class: "card-sub", style: "margin:0 0 10px" }, "Chargement…");
  const reset = el("button", { class: "tbtn danger" }, icon("refresh", 15), "Réinitialiser l'historique");

  const load = async () => {
    try {
      const r = await api("/api/lol/greeted");
      info.textContent = r.count
        ? `${r.count} membre(s) déjà accueilli(s) — ils ne recevront plus le message.`
        : "Aucun membre accueilli pour l'instant.";
    } catch {
      info.textContent = "Impossible de lire l'historique.";
    }
  };
  reset.addEventListener("click", async () => {
    if (!(await confirmModal(
      "Réinitialiser l'historique d'accueil LoL ? Les membres qui ont déjà le rôle pourront être accueillis à nouveau lors d'un prochain ajout de rôle.",
      { title: "Réinitialiser", okLabel: "Réinitialiser", danger: true },
    ))) return;
    reset.disabled = true;
    try {
      const r = await api("/api/lol/reset-greeted", "POST", {});
      toast(r.message || "Historique réinitialisé", "ok");
      await load();
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    reset.disabled = false;
  });

  load();
  wrap.append(info, reset);
  return wrap;
}

// ═══════════════════ 7. Rendu d'une section ═══════════════════
const CUSTOM_RENDERERS = {
  overview: (c) => renderOverview(c),
  stats: (c) => renderStats(c),
  metrics: (c) => renderMetrics(c),
  logs: (c) => renderLogs(c),
  announce: (c) => renderAnnounce(c),
  welcome: (c) => renderWelcome(c),
  vocrank: (c) => renderVocRank(c),
  roles: (c) => renderRoles(c),
  tournament: (c) => renderTournament(c),
  startgg: (c) => renderStartggSeed(c),
  combos: (c) => renderCombos(c),
  tickets: (c) => renderTickets(c),
  giveaway: (c) => renderGiveaway(c),
};

function renderSection(id) {
  const content = $("#content");
  content.innerHTML = "";
  setDirty(false);
  if (logTimer) { clearInterval(logTimer); logTimer = null; }

  if (CUSTOM_RENDERERS[id]) return CUSTOM_RENDERERS[id](content);

  const cfg = structuredClone(CONFIG[id] || {});
  const schema = sectionSchema(id, cfg);

  // État du module remonté dans l'en-tête pour les sections activables.
  const headActions = [];
  if ("enabled" in cfg) {
    const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
      el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
      cfg.enabled ? "Module activé" : "Module inactif");
    headActions.push(badge);
  }

  content.append(pageHead(schema.ico, schema.title, schema.sub, headActions));

  for (const c of schema.cards) {
    const box = el("div", { class: "card" }, el("h3", {}, c.title));
    if (c.sub) box.append(el("div", { class: "card-sub" }, c.sub));
    for (const [label, desc, control] of c.fields) box.append(fieldRow(label, desc, control));
    if (c.extra) box.append(c.extra);
    content.append(box);
  }

  // Bouton d'enregistrement de la section.
  const btn = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
      setDirty(false);
      renderNav(); // met à jour la pastille d'état
      toast("Modifications enregistrées", "ok");
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    btn.disabled = false;
  });

  // Actions secondaires spécifiques à certaines sections (test, publication…).
  const extras = [];
  const secondary = (label, iconName, run) => {
    const b = el("button", { class: "btn-save ghost" }, icon(iconName, 16), label);
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
        setDirty(false);
        await run();
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      b.disabled = false;
    });
    extras.push(b);
  };

  if (id === "tiktok") {
    secondary("Envoyer un test", "sparkles", async () => {
      await api("/api/tiktok/test", "POST", {});
      toast("Test envoyé dans le salon", "ok");
    });
  }
  if (id === "reminders") {
    secondary("Envoyer un rappel test", "sparkles", async () => {
      await api("/api/reminders/test", "POST", {});
      toast("Rappel envoyé dans le salon", "ok");
    });
  }
  if (id === "levels") {
    secondary("Aperçu level up", "sparkles", async () => {
      await api("/api/levels/test", "POST", {});
      toast("Aperçu envoyé", "ok");
    });
  }
  if (id === "lol") {
    secondary("Envoyer un test", "sparkles", async () => {
      await api("/api/lol/test", "POST", {});
      toast("Message d'accueil envoyé dans le salon", "ok");
    });
  }
  if (id === "linkpanel") {
    const pub = el("button", { class: "btn-save ghost" }, icon("megaphone", 16), "Publier le panneau");
    pub.addEventListener("click", async () => {
      if (!cfg.channelId) return toast("Choisis d'abord un salon.", "err");
      pub.disabled = true;
      try {
        CONFIG[id] = await api(`/api/config/${id}`, "PUT", cfg);
        setDirty(false);
        await api("/api/linkpanel/publish", "POST", { channelId: cfg.channelId });
        toast("Panneau publié", "ok");
      } catch (e) {
        toast("Erreur : " + e.message, "err");
      }
      pub.disabled = false;
    });
    extras.push(pub);
  }

  content.append(actionBar({ hint: true }, ...extras, btn));
}
