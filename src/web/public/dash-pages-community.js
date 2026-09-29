/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · communauté
   Liaison & rangs, niveaux, accueil, League of Legends, tickets, vocaux.
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

const GREETING_VARS = [
  ["{user}", "Mention du membre"],
  ["{username}", "Pseudo affiché"],
  ["{user.tag}", "Nom d'utilisateur complet"],
  ["{server}", "Nom du serveur"],
  ["{membercount}", "Nombre de membres"],
];

const MESSAGE_FORMATS = [
  { value: "embed", label: "Embed" },
  { value: "text", label: "Texte" },
  { value: "both", label: "Texte + embed" },
];

// Resynchronisation globale des rôles de rank (action, plus une page).
async function resyncRoles() {
  const ok = await confirmDialog({
    title: "Resynchroniser les rôles de rank ?",
    message:
      "Le bot revérifie chaque membre lié auprès de l'API Brawlhalla et corrige ses rôles 1v1, 2v2 et « N°1 du serveur ». " +
      "Le traitement tourne en arrière-plan pendant quelques minutes ; le bilan est posté dans le salon d'audit.",
    confirmLabel: "Lancer la resynchronisation",
  });
  if (!ok) return;
  const r = await api("/api/refresh-roles", "POST", {});
  toast(r.total ? `Resynchronisation lancée pour ${plural(r.total, "membre lié", "membres liés")}.` : "Aucun membre lié à resynchroniser.", "ok");
}

// ═══════════════════ Liaison & rangs ═══════════════════
function renderLinking(ctx) {
  const settings = configForm("settings");
  const lp = configForm("linkpanel");
  ctx.root.append(
    pageHeader({
      title: "Liaison & rangs",
      description: "Liaison des comptes Brawlhalla, validation par le staff et rôles de rank.",
      hasTabs: true,
      actions: [button("Resynchroniser les rôles", { icon: "refresh", onClick: resyncRoles })],
    }),
  );
  pageTabs(ctx, (tab, host) => {
    if (tab === "panel") linkPanelTab(host, lp.data);
    else validationTab(host, settings.data);
  });
}

// Échelle visuelle : quels tiers sont validés automatiquement, lesquels par le staff.
function tierScale(s) {
  const scale = el("div", { class: "tier-scale", role: "list", "aria-label": "Validation par tier" });
  const legend = el(
    "div",
    { class: "tier-legend" },
    el("span", {}, icon("check", 12), "Auto-validé"),
    el("span", {}, icon("shield", 12), "Validation staff"),
    el("span", {}, icon("image", 12), "Capture d'écran exigée"),
  );
  const wrap = el("div", { class: "stack", style: "gap:8px" }, scale, legend);
  watch(scale, () => {
    clearNode(scale);
    const tiers = GUILD.tiers || [];
    const auto = tiers.indexOf(s.autoApproveTier);
    const proof = s.requireProofScreenshot ? tiers.indexOf(s.proofTier) : -1;
    tiers.forEach((t, i) => {
      const isAuto = auto >= 0 && i <= auto;
      const needsProof = !isAuto && proof >= 0 && i >= proof;
      scale.append(
        el(
          "span",
          { class: "tier-step" + (isAuto ? " auto" : "") + (needsProof ? " proof" : ""), role: "listitem", "aria-label": `${t} : ${isAuto ? "auto-validé" : needsProof ? "validation staff avec capture" : "validation staff"}` },
          icon(isAuto ? "check" : needsProof ? "image" : "shield", 12),
          t,
        ),
      );
    });
  });
  return wrap;
}

function validationTab(host, s) {
  const tiers = tierOptions();
  host.append(
    groups(
      settingsGroup(
        "Validation automatique",
        "Les comptes dont le meilleur rang ne dépasse pas ce seuil sont liés sans intervention du staff.",
        field("Seuil d'auto-validation", selectInput(s, "autoApproveTier", tiers, { size: "sm" }), { help: "Ce tier est inclus." }),
        tierScale(s),
      ),
      settingsGroup(
        "Validation par le staff",
        "Au-dessus du seuil, une demande part dans le salon de validation, avec boutons Valider et Refuser.",
        field("Salon de validation", channelPicker(s, "reviewChannelId", "text")),
        field("Rôle validateur", rolePicker(s, "reviewerRoleId"), { help: "Sans rôle défini, seuls les membres avec « Gérer le serveur » peuvent valider." }),
      ),
      settingsGroup(
        "Preuve pour les hauts rangs",
        "Un fil privé est créé : le joueur y poste une capture de son profil en jeu, le staff valide depuis ce fil.",
        switchField("Exiger une capture d'écran", s, "requireProofScreenshot"),
        showWhen(field("À partir du rang", selectInput(s, "proofTier", tiers, { size: "sm" }), { help: "Ce tier est inclus." }), () => !!s.requireProofScreenshot),
        showWhen(
          field("Salon des fils de preuve", channelPicker(s, "proofChannelId", "text"), {
            help: "Doit être visible par les membres, sinon ils ne peuvent pas rejoindre le fil. Vide : salon où /lier est lancé. Le staff a besoin de « Gérer les fils ».",
          }),
          () => !!s.requireProofScreenshot,
        ),
      ),
      settingsGroup(
        "Annonces de progression",
        "Montées de tier détectées à chaque mise à jour, et récap hebdomadaire des plus gros gains.",
        field("Salon des annonces", channelPicker(s, "announceChannelId", "text"), { help: "Vide : aucune annonce." }),
      ),
    ),
  );
}

function linkPanelTab(host, c) {
  host.append(
    toolbar("Message public avec un bouton « Lier mon compte » : un formulaire lance la liaison sans taper /lier.", [
      button("Publier le panneau", {
        icon: "send",
        onClick: () =>
          publishDialog({
            title: "Publier le panneau de liaison",
            description: "Le panneau est publié tel qu'il apparaît dans l'aperçu.",
            initialChannel: c.channelId,
            onPublish: (channelId) => api("/api/linkpanel/publish", "POST", { channelId }),
          }),
      }),
    ]),
  );
  const form = groups(
    settingsGroup(
      "Contenu",
      "Markdown Discord accepté.",
      field("Titre", textInput(c, "title", { maxLength: 256 })),
      field("Accroche", textArea(c, "description", { rows: 3, maxLength: 2000 })),
      field("Titre des avantages", textInput(c, "benefitsTitle", { maxLength: 256 })),
      field("Avantages", textArea(c, "benefits", { rows: 5, maxLength: 2000 }), { help: "Une ligne par avantage." }),
      field("Conseil en pied de panneau", textArea(c, "footerText", { rows: 2, maxLength: 1000 }), { optional: true }),
      field("Texte du bouton", textInput(c, "buttonLabel", { maxLength: 80, size: "md" })),
    ),
    settingsGroup(
      "Apparence",
      null,
      field("Couleur", colorInput(c, "color", { fallback: "#4ea1ff" })),
      field("Vignette", urlInput(c, "thumbnailUrl"), { help: "Petite image à droite du titre.", optional: true }),
      field("Bannière", urlInput(c, "bannerUrl"), { help: "Grande image en haut du panneau.", optional: true }),
    ),
    settingsGroup("Publication", null, field("Salon du panneau", channelPicker(c, "channelId", "text"), { help: "Proposé par défaut à la publication." })),
  );
  const preview = livePreview(() =>
    discordMessage(
      containerPreview(c.color || "#4ea1ff", [
        safeUrl(c.bannerUrl) ? { banner: safeUrl(c.bannerUrl) } : null,
        { text: `## ${c.title || "Lier ton compte Brawlhalla"}\n${c.description || ""}`, thumb: safeUrl(c.thumbnailUrl) },
        c.benefits && c.benefits.trim() ? "sep" : null,
        c.benefits && c.benefits.trim() ? { text: `### ${c.benefitsTitle || "Pourquoi lier ton compte ?"}\n${c.benefits.trim()}` } : null,
        c.footerText && c.footerText.trim() ? "sep" : null,
        c.footerText && c.footerText.trim() ? { text: `-# ${c.footerText.trim()}` } : null,
        "sep",
        { button: c.buttonLabel || "Lier mon compte", emoji: "🔗" },
      ]),
    ),
  );
  host.append(splitLayout(form, preview));
}

// ═══════════════════ Niveaux ═══════════════════
function renderLevels(ctx) {
  const f = configForm("levels");
  const c = f.data;
  ctx.root.append(
    pageHeader({
      title: "Niveaux",
      description: "Gain d'XP en discutant et en vocal, annonces de niveau et rôles de récompense.",
      actions: [moduleSwitch("levels", "Niveaux"), button("Envoyer un aperçu", { icon: "send", onClick: () => sendTest("/api/levels/test", c.announceMode === "dm" ? "Aperçus envoyés en message privé" : "Aperçus envoyés dans le salon d'annonce") })],
    }),
  );
  const minMax = el("p", { class: "field-error" }, icon("alert-circle", 14), "L'XP minimale dépasse l'XP maximale.");
  showWhen(minMax, () => Number(c.minXp) > Number(c.maxXp));
  ctx.root.append(
    groups(
      settingsGroup(
        "XP des messages",
        "Un gain aléatoire entre le minimum et le maximum, au plus une fois par cooldown.",
        fieldRow(
          field("Cooldown", numberInput(c, "cooldownSec", { min: 0, suffix: "s" })),
          field("XP minimale", numberInput(c, "minXp", { min: 1 })),
          field("XP maximale", numberInput(c, "maxXp", { min: 1 })),
        ),
        minMax,
      ),
      settingsGroup(
        "XP en vocal",
        null,
        switchField("Gagner de l'XP en vocal", c, "voiceEnabled"),
        showWhen(field("XP par minute", numberInput(c, "voiceXpPerMin", { min: 0 })), () => !!c.voiceEnabled),
      ),
      settingsGroup(
        "Bonus",
        null,
        field("Bonus du week-end", numberInput(c, "weekendBonus", { min: 1, step: 0.1, suffix: "×" }), { help: "Multiplie l'XP le samedi et le dimanche. 1 : aucun bonus." }),
        fieldRow(
          field("Rôle bonus", rolePicker(c, "boosterRoleId"), { help: "Par exemple les boosters Nitro." }),
          field("Multiplicateur", numberInput(c, "boosterMultiplier", { min: 1, step: 0.1, suffix: "×" })),
        ),
      ),
      settingsGroup(
        "Limites",
        null,
        field("Plafond quotidien", numberInput(c, "dailyXpCap", { min: 0, suffix: "XP", size: "md" }), { help: "XP maximale par membre et par jour. 0 : illimité." }),
        field("Salons sans XP", multiChannelPicker(c, "noXpChannels", "textvoice"), { help: "Salons textuels ou vocaux exclus du gain d'XP." }),
      ),
      settingsGroup(
        "Annonces de niveau",
        "Message publié à chaque montée de niveau ; les passages de palier mentionnent le membre.",
        field(
          "Où annoncer",
          bindSegmented(c, "announceMode", [
            { value: "channel", label: "Dans un salon" },
            { value: "dm", label: "En message privé" },
            { value: "off", label: "Désactivées" },
          ]),
        ),
        showWhen(field("Salon d'annonce", channelPicker(c, "announceChannelId", "text"), { help: "Vide : salon où le membre a écrit." }), () => c.announceMode === "channel"),
      ),
      settingsGroup(
        "Récompenses",
        "Rôle attribué à l'atteinte d'un niveau.",
        switchField("Cumuler les rôles", c, "stackRewards", { help: "Activé : le membre garde chaque rôle de palier. Désactivé : seul le plus haut est conservé." }),
        field("Paliers", rewardsEditor(c)),
      ),
    ),
  );
}

// ═══════════════════ Accueil (arrivée, départ, auto-rôle) ═══════════════════
function greetingFields(c, { textPlaceholder } = {}) {
  const wantText = () => c.mode === "text" || c.mode === "both";
  const wantEmbed = () => c.mode !== "text";
  return [
    settingsGroup(
      "Message",
      null,
      field("Format", bindSegmented(c, "mode", MESSAGE_FORMATS)),
      switchField("Mentionner le membre", c, "pingUser", { help: "Le membre reçoit une notification." }),
    ),
    showWhen(settingsGroup("Texte", null, field("Message", textArea(c, "text", { rows: 3, maxLength: 2000, placeholder: textPlaceholder })), varsHint(GREETING_VARS)), wantText),
    showWhen(
      settingsGroup(
        "Embed",
        "Markdown Discord accepté.",
        field("Couleur", colorInput(c.embed, "color", { fallback: "#5865f2" })),
        field("Titre", textInput(c.embed, "title", { maxLength: 256 })),
        field("Description", textArea(c.embed, "description", { rows: 4, maxLength: 4096 })),
        switchField("Avatar du membre en vignette", c.embed, "thumbnailUser"),
        field("Image", urlInput(c.embed, "image"), { help: "Grande image en bas de l'embed.", optional: true }),
        field("Pied de page", textInput(c.embed, "footer", { maxLength: 2048 }), { optional: true }),
        switchField("Icône du serveur dans le pied de page", c.embed, "footerIcon"),
        varsHint(GREETING_VARS),
      ),
      wantEmbed,
    ),
  ];
}

function renderWelcome(ctx) {
  const f = configForm("welcome", { normalize: (d) => { if (!d.embed || typeof d.embed !== "object") d.embed = {}; } });
  const c = f.data;
  ctx.root.append(pageHeader({ title: "Accueil", description: "Message d'arrivée, message de départ et rôles attribués aux nouveaux membres.", hasTabs: true }));
  pageTabs(ctx, (tab, host) => {
    if (tab === "goodbye") {
      host.append(
        splitLayout(
          groups(
            settingsGroup(
              "Message de départ",
              "Publié quand un membre quitte le serveur.",
              switchField("Envoyer un message de départ", c, "goodbyeEnabled"),
              field("Salon", channelPicker(c, "goodbyeChannelId", "text")),
              field("Message", textArea(c, "goodbyeText", { rows: 3, maxLength: 2000, placeholder: "{username} a quitté le serveur." })),
              varsHint(GREETING_VARS),
            ),
          ),
          livePreview(() => discordMessage(c.goodbyeText ? dcText(c.goodbyeText, { mentions: defaultMentions() }) : el("div", { class: "dc-content dc-sub" }, "Message vide."))),
        ),
      );
    } else if (tab === "autorole") {
      host.append(
        groups(
          settingsGroup(
            "Rôles automatiques",
            "Attribués à chaque nouveau membre dès son arrivée.",
            switchField("Attribuer des rôles à l'arrivée", c, "autoRoleEnabled"),
            field("Rôles", multiRolePicker(c, "autoRoleIds"), { help: "Le rôle du bot doit être placé au-dessus de ces rôles dans la hiérarchie." }),
          ),
        ),
      );
    } else {
      host.append(
        toolbar("Publié quand un membre rejoint le serveur.", [button("Envoyer un test", { icon: "send", onClick: () => sendTest("/api/welcome/test", "Message de test envoyé dans le salon de bienvenue") })]),
        splitLayout(
          groups(
            settingsGroup("Envoi", null, switchField("Envoyer un message d'arrivée", c, "enabled"), field("Salon", channelPicker(c, "channelId", "text"))),
            ...greetingFields(c, { textPlaceholder: "Bienvenue {user} sur {server} !" }),
          ),
          livePreview(() => greetingPreview(c)),
        ),
      );
    }
  });
}

// ═══════════════════ League of Legends ═══════════════════
function renderLol(ctx) {
  const f = configForm("lol", { normalize: (d) => { if (!d.embed || typeof d.embed !== "object") d.embed = {}; } });
  const c = f.data;
  ctx.root.append(
    pageHeader({
      title: "League of Legends",
      description: "Accueil automatique des membres qui reçoivent le rôle League of Legends.",
      actions: [moduleSwitch("lol", "League of Legends"), button("Envoyer un test", { icon: "send", onClick: () => sendTest("/api/lol/test", "Message d'accueil de test envoyé") })],
    }),
  );

  const greeted = el("span", { class: "text-2" }, "Chargement…");
  const loadGreeted = async () => {
    try {
      const r = await api("/api/lol/greeted");
      greeted.textContent = r.count ? `${plural(r.count, "membre déjà accueilli", "membres déjà accueillis")} : ils ne recevront plus le message.` : "Aucun membre accueilli pour l'instant.";
    } catch (e) {
      greeted.textContent = "Historique indisponible : " + e.message;
    }
  };
  loadGreeted();

  ctx.root.append(
    splitLayout(
      groups(
        settingsGroup(
          "Déclencheur",
          "Le bot réagit à l'ajout du rôle, quelle qu'en soit la source : onboarding, reaction-role ou staff.",
          field("Rôle League of Legends", rolePicker(c, "roleId")),
          field("Salon d'accueil", channelPicker(c, "channelId", "text"), { help: "Idéalement le salon de discussion de la section." }),
          switchField("Une seule fois par membre", c, "oncePerMember", { help: "N'accueille pas à nouveau un membre dont le rôle est retiré puis redonné." }),
          disclosure(
            "Attribuer le rôle via l'onboarding Discord",
            el(
              "ol",
              {},
              el("li", {}, "Paramètres du serveur › Intégration › Onboarding."),
              el("li", {}, "Ouvre la question concernée."),
              el("li", {}, "Coche le rôle League of Legends sur la réponse correspondante."),
            ),
            el("p", {}, "Le bot ne configure pas l'onboarding : il réagit à l'ajout du rôle. Tout ce qui attribue ce rôle déclenche donc l'accueil."),
          ),
        ),
        ...greetingFields(c, { textPlaceholder: "{user} rejoint la section League of Legends." }),
        settingsGroup(
          "Historique d'accueil",
          "Utilisé par l'option « Une seule fois par membre ».",
          greeted,
          el(
            "div",
            {},
            button("Réinitialiser l'historique", {
              variant: "danger-secondary",
              icon: "refresh",
              onClick: async () => {
                const ok = await confirmDialog({
                  title: "Réinitialiser l'historique ?",
                  message: "Les membres déjà accueillis pourront l'être à nouveau lors d'un prochain ajout du rôle.",
                  confirmLabel: "Réinitialiser",
                  danger: true,
                });
                if (!ok) return;
                const r = await api("/api/lol/reset-greeted", "POST", {});
                toast(r.message || "Historique réinitialisé", "ok");
                loadGreeted();
              },
            }),
          ),
        ),
      ),
      livePreview(() => greetingPreview(c)),
    ),
  );
}

// ═══════════════════ Tickets ═══════════════════
function renderTickets(ctx) {
  const f = configForm("tickets");
  const c = f.data;
  const publish = () => {
    if (!c.categoryId || !c.staffRoleId) {
      toast("Définis d'abord la catégorie et le rôle staff (onglet Configuration).", "err");
      return;
    }
    if (!(CONFIG.tickets && CONFIG.tickets.enabled)) {
      toast("Active d'abord le module Tickets.", "err");
      return;
    }
    publishDialog({
      title: "Publier le panneau de tickets",
      description: "Les membres ouvriront un ticket depuis ce panneau.",
      onPublish: (channelId) => api("/api/tickets/publish", "POST", { channelId }),
    });
  };
  ctx.root.append(
    pageHeader({
      title: "Tickets",
      description: "Les membres ouvrent un salon privé avec le staff depuis un panneau de support.",
      hasTabs: true,
      actions: [moduleSwitch("tickets", "Tickets"), button("Publier le panneau", { icon: "send", onClick: publish })],
    }),
  );
  pageTabs(ctx, (tab, host) => {
    if (tab === "panel") ticketPanelTab(host, c);
    else if (tab === "ticket") ticketChannelTab(host, c);
    else {
      host.append(
        groups(
          settingsGroup(
            "Salons",
            "Où sont créés les tickets et où sont archivés les transcripts.",
            field("Catégorie des tickets", channelPicker(c, "categoryId", "category")),
            field("Salon des transcripts", channelPicker(c, "logChannelId", "text"), { help: "Reçoit la transcription et un récapitulatif à la fermeture.", optional: true }),
          ),
          settingsGroup("Staff", null, field("Rôle staff", rolePicker(c, "staffRoleId"), { help: "Voit tous les tickets, peut les prendre en charge et les fermer." })),
        ),
      );
    }
  });
}

function ticketPanelTab(host, c) {
  const form = groups(
    settingsGroup(
      "En-tête",
      "Markdown Discord accepté.",
      field("Titre", textInput(c, "panelTitle", { maxLength: 256 })),
      field("Description", textArea(c, "panelDescription", { rows: 3, maxLength: 2000 })),
      field("Couleur", colorInput(c, "panelColor", { fallback: "#5865f2" })),
      field("Vignette", urlInput(c, "thumbnailUrl"), { optional: true }),
      field("Bannière", urlInput(c, "bannerUrl"), { optional: true }),
    ),
    settingsGroup(
      "Étapes à suivre",
      "Consignes affichées avant le menu.",
      field("Titre de la section", textInput(c, "rulesTitle", { maxLength: 100 })),
      field("Consignes", textArea(c, "rulesText", { rows: 4, placeholder: "• Explique ton problème directement\n• Reste respectueux et patient" }), { help: "Vide : section masquée.", optional: true }),
    ),
    settingsGroup(
      "Motifs",
      "Chaque motif devient une option du menu. Le message s'affiche à l'ouverture d'un ticket de ce type.",
      field("Titre de la section", textInput(c, "optionsTitle", { maxLength: 100 })),
      field("Motifs", topicsEditor(c)),
      field("Texte du menu", textInput(c, "selectPlaceholder", { maxLength: 150 })),
    ),
    settingsGroup(
      "Pied de panneau",
      null,
      field("Texte", textInput(c, "footerText", { maxLength: 300 })),
      field("Lien des conditions d'utilisation", urlInput(c, "tosUrl"), { optional: true }),
    ),
  );
  const preview = livePreview(() => {
    const topics = Array.isArray(c.topics) ? c.topics : [];
    const options = topics.filter((t) => t.description).map((t) => `${t.emoji || "•"} **${t.label || "Motif"}** → ${t.description}`).join("\n");
    let footer = c.footerText || "Choisis un motif dans le menu ci-dessous pour ouvrir un ticket.";
    if (safeUrl(c.tosUrl)) footer += `\n-# [Terms of Service](${safeUrl(c.tosUrl)})`;
    return discordMessage(
      containerPreview(c.panelColor, [
        safeUrl(c.bannerUrl) ? { banner: safeUrl(c.bannerUrl) } : null,
        { text: `## ${c.panelTitle || "Support & Tickets"}\n${c.panelDescription || ""}`, thumb: safeUrl(c.thumbnailUrl) },
        c.rulesText && c.rulesText.trim() ? "sep" : null,
        c.rulesText && c.rulesText.trim() ? { text: `### ${c.rulesTitle || "Étapes à suivre"}\n${c.rulesText.trim()}` } : null,
        options ? "sep" : null,
        options ? { text: `### ${c.optionsTitle || "Options de ticket"}\n${options}` } : null,
        "sep",
        { text: footer },
        "sep",
        topics.length ? { select: c.selectPlaceholder || "Ouvrir un ticket" } : { button: "Ouvrir un ticket", emoji: "🎫" },
      ]),
    );
  });
  host.append(splitLayout(form, preview));
}

function ticketChannelTab(host, c) {
  host.append(
    groups(
      settingsGroup(
        "Message d'ouverture",
        "Publié dans le salon privé à la création du ticket. Couleur et vignette reprises du panneau.",
        field("Titre", textInput(c, "ticketTitle", { maxLength: 256 })),
        field("Message d'accueil", textArea(c, "ticketWelcome", { rows: 3, maxLength: 2000 }), { help: "Le lien des conditions d'utilisation est ajouté s'il est défini." }),
        field("Informations complémentaires", textArea(c, "ticketInfo", { rows: 3, maxLength: 2000 }), { help: "Remplacé par le message du motif s'il en a un.", optional: true }),
      ),
    ),
  );
}

// ═══════════════════ Vocaux ═══════════════════
function renderVoice(ctx) {
  const f = configForm("tempvoice");
  const c = f.data;
  ctx.root.append(pageHeader({ title: "Vocaux", description: "Salons vocaux créés à la demande et salons réservés par rank.", hasTabs: true }));
  pageTabs(ctx, (tab, host) => {
    if (tab === "rank") return rankVoiceTab(host);
    host.append(
      toolbar("Rejoindre un salon hub crée un vocal personnel, supprimé automatiquement quand il se vide.", [moduleSwitch("tempvoice", "Vocaux temporaires")]),
      groups(
        settingsGroup("Création", null, field("Catégorie des salons créés", channelPicker(c, "categoryId", "category", { noneLabel: "Celle du hub" }))),
        settingsGroup("Salons hubs", "{user} est remplacé par le pseudo du membre. Limite 0 : illimitée.", field("Hubs", hubsEditor(c))),
      ),
    );
  });
}

function rankVoiceTab(host) {
  const s = { categoryId: "", rangMin: "Bronze", limite: 0 };
  const result = el("div");
  host.append(
    toolbar("Crée un salon vocal par rank. Les rangs supérieurs accèdent aussi aux vocaux inférieurs ; un membre non lié n'entre nulle part."),
    groups(
      settingsGroup(
        "Salons à créer",
        "Action ponctuelle : relance-la pour mettre à jour les salons existants.",
        field("Catégorie", channelPicker(s, "categoryId", "category", { allowNone: false })),
        fieldRow(
          field("Rang minimum", selectInput(s, "rangMin", tierOptions()), { help: "Le rank le plus bas qui reçoit un salon." }),
          field("Limite par salon", numberInput(s, "limite", { min: 0, max: 99, suffix: "places" }), { help: "0 : illimitée." }),
        ),
        el(
          "div",
          {},
          button("Créer ou mettre à jour les salons", {
            variant: "primary",
            icon: "mic",
            onClick: async () => {
              if (!s.categoryId) {
                toast("Choisis une catégorie.", "err");
                return;
              }
              const ok = await confirmDialog({
                title: "Créer les salons vocaux par rank ?",
                message: ["Des salons sont créés ou mis à jour dans ", el("strong", {}, channelName(s.categoryId)), `, à partir du rang ${s.rangMin}.`],
                confirmLabel: "Créer les salons",
              });
              if (!ok) return;
              const r = await api("/api/setup-vocaux-rank", "POST", { categoryId: s.categoryId, rangMin: s.rangMin, limite: Number(s.limite) || 0 });
              clearNode(result).append(callout(r.failed ? "warn" : "ok", r.message || "Salons prêts."));
              toast("Salons vocaux par rank prêts", "ok");
            },
          }),
        ),
        result,
      ),
    ),
  );
}
