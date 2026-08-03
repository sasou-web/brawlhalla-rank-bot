/* ════════════════════════════════════════════════════════════════════════
   Xray BrawlBot — Dashboard · fichier 8/10
   Aperçus d'embed Discord, bienvenue, annonces
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
// ---------- Aperçus d'embed (bienvenue & annonces) ----------
function previewVars(str) {
  return String(str || "")
    .replaceAll("{user}", "@" + ME.username)
    .replaceAll("{username}", ME.username)
    .replaceAll("{user.name}", ME.username)
    .replaceAll("{user.tag}", ME.username)
    .replaceAll("{server}", GUILD.name)
    .replaceAll("{membercount}", GUILD.memberCount)
    .replaceAll("{count}", GUILD.memberCount);
}

function mdToHtml(str) {
  const esc = String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/\n/g, "<br>");
}

function buildPreview(cfg) {
  const wrap = el("div", { class: "preview-wrap" });
  const wantText = cfg.mode === "text" || cfg.mode === "both";
  const wantEmbed = cfg.mode === "embed" || cfg.mode === "both";

  if (wantText && cfg.text) {
    wrap.append(el("div", { class: "preview-text", html: mdToHtml(previewVars(cfg.text)) }));
  } else if (cfg.pingUser) {
    wrap.append(el("div", { class: "preview-text", html: `<span class="mention">@${ME.username}</span>` }));
  }

  if (wantEmbed) {
    const e = cfg.embed || {};
    const embed = el("div", { class: "preview-embed", style: `border-left-color:${e.color || "#7c5cff"}` });
    const body = el("div", { class: "pe-body" });
    if (e.title) body.append(el("div", { class: "pe-title", html: mdToHtml(previewVars(e.title)) }));
    if (e.description) body.append(el("div", { class: "pe-desc", html: mdToHtml(previewVars(e.description)) }));
    if (e.footer) {
      const f = el("div", { class: "pe-footer" });
      if (e.footerIcon && GUILD.icon) f.append(el("img", { src: GUILD.icon, class: "pe-footer-ico", alt: "" }));
      f.append(document.createTextNode(previewVars(e.footer)));
      body.append(f);
    }
    embed.append(body);
    if (e.thumbnailUser && ME.avatar) embed.append(el("img", { src: ME.avatar, class: "pe-thumb", alt: "" }));
    if (e.image) embed.append(el("img", { src: e.image, class: "pe-image", alt: "" }));
    wrap.append(embed);
  }
  if (!wrap.children.length) wrap.append(el("div", { class: "preview-text", style: "color:var(--muted)" }, "(message vide)"));
  return wrap;
}

// ---------- Bienvenue ----------
let welcomeTab = "message";

function renderWelcome(content) {
  const cfg = structuredClone(CONFIG.welcome || {});
  if (!cfg.embed) cfg.embed = {};

  const badge = el("span", { class: "badge-state " + (cfg.enabled ? "on" : "off") },
    el("span", { class: "dot " + (cfg.enabled ? "on" : "off") }),
    cfg.enabled ? "Module activé" : "Module inactif");

  content.append(pageHead("👋", "Bienvenue & au revoir",
    "Accueille les nouveaux membres avec un embed personnalisé, un auto-rôle, et annonce les départs.", [badge]));

  // Aperçu permanent en haut : on voit le résultat pendant qu'on édite.
  const previewCard = card("Aperçu en direct", "Rendu approximatif avec tes données — se met à jour pendant que tu édites.");
  const previewHolder = el("div");
  previewHolder.append(buildPreview(cfg));
  previewCard.append(previewHolder);
  content.append(previewCard);
  const refreshPreview = () => { previewHolder.innerHTML = ""; previewHolder.append(buildPreview(cfg)); };

  const tabs = [
    { id: "message", ico: "💬", label: "Message" },
    { id: "embed", ico: "🎨", label: "Embed" },
    { id: "roles", ico: "🏷️", label: "Auto-rôle" },
    { id: "goodbye", ico: "🚪", label: "Au revoir" },
  ];
  if (!tabs.some((t) => t.id === welcomeTab)) welcomeTab = "message";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === welcomeTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { welcomeTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  // Aperçu live : un seul écouteur délégué sur le conteneur d'onglets
  // (évite d'empiler des listeners à chaque changement d'onglet).
  body.addEventListener("input", refreshPreview);
  body.addEventListener("change", refreshPreview);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === welcomeTab));
    body.innerHTML = "";
    if (welcomeTab === "message") drawMessage();
    else if (welcomeTab === "embed") drawEmbed();
    else if (welcomeTab === "roles") drawRoles();
    else drawGoodbye();
    refreshPreview();
  }

  function variables() {
    const c = card("Variables disponibles", null);
    c.append(el("div", { class: "card-sub", html:
      "<code>{user}</code> mention · <code>{username}</code> pseudo · <code>{server}</code> nom du serveur · " +
      "<code>{membercount}</code> nombre de membres · <code>{user.tag}</code> tag complet" }));
    return c;
  }

  function drawMessage() {
    const c = card("Message d'arrivée", "Quand et comment le bot accueille un nouveau membre.");
    c.append(
      fieldRow("Activé", "Envoyer un message quand un membre arrive.", toggle(cfg, "enabled")),
      fieldRow("Salon de bienvenue", "", channelSelect(cfg, "channelId", "text")),
      fieldRow("Format", "Embed, texte simple, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Embed" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + Embed" }])),
      fieldRow("Mentionner le membre", "Ping le nouveau membre.", toggle(cfg, "pingUser")),
      fieldRow("Message texte", "Utilisé si format Texte ou Texte+Embed.", textareaInput(cfg, "text"), true),
    );
    body.append(c, variables());
  }

  function drawEmbed() {
    const c = card("Embed d'accueil", "Personnalise l'apparence de l'embed.");
    c.append(
      fieldRow("Couleur", "", colorInput(cfg.embed, "color")),
      fieldRow("Titre", "", textInput(cfg.embed, "title")),
      fieldRow("Description", "", textareaInput(cfg.embed, "description"), true),
      fieldRow("Avatar du membre en miniature", "Affiche l'avatar en haut à droite.", toggle(cfg.embed, "thumbnailUser")),
      fieldRow("Image / bannière (URL)", "Grande image en bas de l'embed.", textInput(cfg.embed, "image", "https://...")),
      fieldRow("Footer", "", textInput(cfg.embed, "footer")),
      fieldRow("Icône du serveur dans le footer", "", toggle(cfg.embed, "footerIcon")),
    );
    body.append(c, variables());
  }

  function drawRoles() {
    const c = card("Auto-rôle", "Donne automatiquement des rôles aux nouveaux membres.");
    c.append(fieldRow("Activé", "", toggle(cfg, "autoRoleEnabled")));
    c.append(multiRole(cfg, "autoRoleIds"));
    body.append(c);
  }

  function drawGoodbye() {
    const c = card("Message d'au revoir", "Publié quand un membre quitte le serveur.");
    c.append(
      fieldRow("Activé", "", toggle(cfg, "goodbyeEnabled")),
      fieldRow("Salon", "", channelSelect(cfg, "goodbyeChannelId", "text")),
      fieldRow("Message", "", textareaInput(cfg, "goodbyeText"), true),
    );
    body.append(c, variables());
  }

  draw();

  const save = el("button", { class: "btn-save" }, icon("check", 17), "Enregistrer");
  save.addEventListener("click", async () => {
    save.disabled = true;
    try { CONFIG.welcome = await api("/api/config/welcome", "PUT", cfg); setDirty(false); renderNav(); toast("Enregistré", "ok"); }
    catch (e) { toast("Erreur : " + e.message, "err"); }
    save.disabled = false;
  });
  const test = el("button", { class: "btn-save ghost" }, icon("sparkles", 16), "Envoyer un test");
  test.addEventListener("click", async () => {
    test.disabled = true;
    try { await api("/api/config/welcome", "PUT", cfg); await api("/api/welcome/test", "POST", {}); toast("Test envoyé dans le salon", "ok"); }
    catch (e) { toast("Erreur : " + e.message, "err"); }
    test.disabled = false;
  });
  content.append(actionBar({ hint: true }, test, save));
}

// ---------- Annonces / messages personnalisés ----------
function buildAnnouncePreview(cfg) {
  const wrap = el("div", { class: "preview-wrap" });
  const mode = cfg.mode || "embed";
  const wantText = mode === "text" || mode === "both";
  const wantEmbed = mode === "embed" || mode === "both";

  // Mentions (rôles + everyone) sous forme de pastilles.
  const bits = [];
  if (cfg.mentionEveryone) bits.push("@everyone");
  for (const id of cfg.mentionRoleIds || []) {
    const r = GUILD.roles.find((x) => x.id === id);
    bits.push("@" + (r ? r.name : "rôle"));
  }
  const mentionHtml = bits.map((b) => `<span class="mention">${b}</span>`).join(" ");
  const hasPlaceholder = wantText && cfg.content && cfg.content.includes("{mentions}");

  // Texte du message avec placement du ping.
  let textHtml = "";
  if (wantText && cfg.content) {
    if (mentionHtml && hasPlaceholder) {
      const SENT = "\u0000MENT\u0000";
      const raw = previewVars(cfg.content).replaceAll("{mentions}", SENT);
      textHtml = mdToHtml(raw).replaceAll(SENT, mentionHtml);
    } else {
      textHtml = mdToHtml(previewVars(cfg.content).replaceAll("{mentions}", ""));
    }
  }
  if (mentionHtml && !hasPlaceholder) {
    const pos = cfg.mentionPosition || "top";
    if (pos === "end") textHtml = textHtml ? textHtml + " " + mentionHtml : mentionHtml;
    else textHtml = textHtml ? mentionHtml + "<br>" + textHtml : mentionHtml;
  }
  if (textHtml) wrap.append(el("div", { class: "preview-text", html: textHtml }));

  if (wantEmbed) {
    const e = cfg.embed || {};
    const embed = el("div", { class: "preview-embed", style: `border-left-color:${e.color || "#7c5cff"}` });
    const body = el("div", { class: "pe-body" });
    if (e.author && e.author.name) {
      const a = el("div", { class: "pe-author" });
      if (e.author.iconUrl) a.append(el("img", { src: e.author.iconUrl, class: "pe-author-ico", alt: "" }));
      a.append(document.createTextNode(previewVars(e.author.name)));
      body.append(a);
    }
    if (e.title) body.append(el("div", { class: "pe-title", html: mdToHtml(previewVars(e.title)) }));
    if (e.description) body.append(el("div", { class: "pe-desc", html: mdToHtml(previewVars(e.description)) }));
    const fields = (e.fields || []).filter((f) => f && (f.name || f.value));
    if (fields.length) {
      const grid = el("div", { class: "pe-fields" });
      for (const f of fields) {
        grid.append(el("div", { class: "pe-field" + (f.inline ? " inline" : "") },
          el("div", { class: "pe-field-name", html: mdToHtml(previewVars(f.name || "")) }),
          el("div", { class: "pe-field-value", html: mdToHtml(previewVars(f.value || "")) })));
      }
      body.append(grid);
    }
    if (e.footer || e.footerIcon) {
      const f = el("div", { class: "pe-footer" });
      if (e.footerIcon && GUILD.icon) f.append(el("img", { src: GUILD.icon, class: "pe-footer-ico", alt: "" }));
      f.append(document.createTextNode((previewVars(e.footer) || GUILD.name) + (e.timestamp ? " • aujourd'hui" : "")));
      body.append(f);
    }
    embed.append(body);
    if (e.thumbnail) embed.append(el("img", { src: e.thumbnail, class: "pe-thumb", alt: "" }));
    if (e.image) embed.append(el("img", { src: e.image, class: "pe-image", alt: "" }));
    wrap.append(embed);
  }
  // Image jointe (upload) — affichée comme une pièce jointe, hors embed.
  if (cfg.fileDataUrl) wrap.append(el("img", { src: cfg.fileDataUrl, class: "preview-attach", alt: "" }));
  if (!wrap.children.length) wrap.append(el("div", { class: "preview-text", style: "color:var(--muted)" }, "(message vide)"));
  return wrap;
}

let announceTab = "message";

function renderAnnounce(content) {
  // Config locale (non persistée : page d'action ponctuelle).
  const cfg = {
    channelId: "", messageId: "", mode: "embed", content: "",
    mentionEveryone: false, mentionRoleIds: [], mentionPosition: "top",
    fileDataUrl: "", fileName: "",
    embed: {
      color: "#7c5cff",
      author: { name: "", iconUrl: "", url: "" },
      title: "", url: "", description: "", fields: [],
      thumbnail: "", image: "", footer: "", footerIcon: false, timestamp: false,
    },
  };

  content.append(pageHead("📢", "Annonces & messages perso",
    "Compose un message entièrement personnalisable (texte + embed) et envoie-le — ou modifie un message existant du bot."));

  // Aperçu en direct, toujours visible.
  const previewCard = card("Aperçu en direct", "Rendu approximatif — se met à jour pendant que tu édites.");
  const previewHolder = el("div");
  previewHolder.append(buildAnnouncePreview(cfg));
  previewCard.append(previewHolder);
  content.append(previewCard);
  const refreshPreview = () => { previewHolder.innerHTML = ""; previewHolder.append(buildAnnouncePreview(cfg)); };

  const tabs = [
    { id: "message", ico: "💬", label: "Message" },
    { id: "embed", ico: "🎨", label: "Embed" },
    { id: "fields", ico: "🧩", label: "Champs" },
    { id: "mentions", ico: "🔔", label: "Mentions" },
  ];
  if (!tabs.some((t) => t.id === announceTab)) announceTab = "message";

  const nav = el("div", { class: "subtabs" });
  const body = el("div", { class: "tab-body" });
  for (const tab of tabs) {
    const b = el("button", { class: "subtab" + (tab.id === announceTab ? " active" : "") },
      el("span", { class: "st-ico" }, tab.ico), el("span", {}, tab.label));
    b.addEventListener("click", () => { announceTab = tab.id; draw(); });
    nav.append(b);
  }
  content.append(nav, body);

  body.addEventListener("input", refreshPreview);
  body.addEventListener("change", refreshPreview);

  function draw() {
    [...nav.children].forEach((c, i) => c.classList.toggle("active", tabs[i].id === announceTab));
    body.innerHTML = "";
    if (announceTab === "message") drawMessage();
    else if (announceTab === "embed") drawEmbed();
    else if (announceTab === "fields") drawFieldsTab();
    else drawMentions();
    refreshPreview();
  }

  function drawMessage() {
    const c = card("Destination & contenu", "Où publier, et le texte affiché hors de l'embed.");
    c.append(
      fieldRow("Salon", "Où publier le message.", channelSelect(cfg, "channelId", "textann", false)),
      fieldRow("ID du message à éditer", "Optionnel : colle l'ID d'un message du bot pour le modifier au lieu d'en envoyer un nouveau.", textInput(cfg, "messageId", "Laisser vide pour un nouveau message")),
      fieldRow("Format", "Texte simple, embed, ou les deux.", selectInput(cfg, "mode", [{ value: "embed", label: "Embed" }, { value: "text", label: "Texte" }, { value: "both", label: "Texte + Embed" }])),
      fieldRow("Message texte", "Contenu hors embed (markdown supporté).", textareaInput(cfg, "content"), true),
    );

    // Image jointe (upload) — fonctionne avec ou sans embed.
    const fileInput = el("input", { type: "file", accept: "image/*" });
    const fileInfo = el("div", { class: "desc", style: "margin-top:6px" });
    const fileClear = el("button", { class: "btn-mini danger", style: "display:none" }, "✕ Retirer l'image");
    const syncFile = () => {
      fileInfo.textContent = cfg.fileName ? "📎 " + cfg.fileName : "";
      fileClear.style.display = cfg.fileName ? "" : "none";
    };
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast("Image trop lourde (max 8 Mo).", "err"); fileInput.value = ""; return; }
      const reader = new FileReader();
      reader.onload = () => {
        cfg.fileDataUrl = String(reader.result);
        cfg.fileName = f.name;
        syncFile(); refreshPreview(); setDirty(true);
      };
      reader.readAsDataURL(f);
    });
    fileClear.addEventListener("click", () => {
      cfg.fileDataUrl = ""; cfg.fileName = ""; fileInput.value = "";
      syncFile(); refreshPreview();
    });
    syncFile();
    c.append(fieldRow("Image jointe (upload)", "Joins une image (max 8 Mo) — envoyée même sans embed.",
      el("div", { style: "width:100%" }, fileInput, fileInfo, fileClear), true));
    body.append(c, variables());
  }

  function variables() {
    const c = card("Variables disponibles", null);
    c.append(el("div", { class: "card-sub", html:
      "<code>{server}</code> nom du serveur · <code>{membercount}</code> nombre de membres · " +
      "<code>{date}</code> date · <code>{time}</code> heure · <code>{mentions}</code> emplacement du ping" }));
    return c;
  }

  function drawEmbed() {
    const c = card("Embed", "Personnalise entièrement l'apparence de l'embed.");
    c.append(
      fieldRow("Couleur", "Bande latérale de l'embed.", colorInput(cfg.embed, "color")),
      fieldRow("Auteur", "Petit titre tout en haut.", textInput(cfg.embed.author, "name")),
      fieldRow("Icône de l'auteur (URL)", "", textInput(cfg.embed.author, "iconUrl", "https://...")),
      fieldRow("Lien de l'auteur (URL)", "", textInput(cfg.embed.author, "url", "https://...")),
      fieldRow("Titre", "", textInput(cfg.embed, "title")),
      fieldRow("Lien du titre (URL)", "Rend le titre cliquable.", textInput(cfg.embed, "url", "https://...")),
      fieldRow("Description", "Markdown supporté.", textareaInput(cfg.embed, "description"), true),
      fieldRow("Miniature (URL)", "Petite image en haut à droite.", textInput(cfg.embed, "thumbnail", "https://...")),
      fieldRow("Grande image (URL)", "Bannière en bas de l'embed.", textInput(cfg.embed, "image", "https://...")),
      fieldRow("Footer", "Texte de bas d'embed.", textInput(cfg.embed, "footer")),
      fieldRow("Icône du serveur dans le footer", "", toggle(cfg.embed, "footerIcon")),
      fieldRow("Afficher l'horodatage", "Date/heure d'envoi en bas.", toggle(cfg.embed, "timestamp")),
    );
    body.append(c);
  }

  function drawFieldsTab() {
    const c = card("Champs de l'embed", "Jusqu'à 25 champs (titre + valeur). « En ligne » place les champs côte à côte.");
    const holder = el("div");
    const drawFields = () => {
      holder.innerHTML = "";
      if (!cfg.embed.fields.length) holder.append(el("div", { class: "empty-row" }, "Aucun champ pour l'instant."));
      cfg.embed.fields.forEach((f, idx) => {
        const row = el("div", { class: "card nested" });
        row.append(
          fieldRow("Titre du champ", "", textInput(f, "name")),
          fieldRow("Valeur", "", textareaInput(f, "value"), true),
          fieldRow("En ligne", "", toggle(f, "inline")),
        );
        row.append(el("button", { class: "btn-mini danger", onclick: () => { cfg.embed.fields.splice(idx, 1); drawFields(); refreshPreview(); setDirty(true); } }, "🗑 Supprimer ce champ"));
        holder.append(row);
      });
    };
    drawFields();
    c.append(holder, el("button", { class: "btn-add", onclick: () => {
      if (cfg.embed.fields.length >= 25) return toast("25 champs maximum.", "err");
      cfg.embed.fields.push({ name: "", value: "", inline: false });
      drawFields(); setDirty(true);
    } }, "+ Ajouter un champ"));
    body.append(c);
  }

  function drawMentions() {
    const c = card("Mentions", "Ajoute un ping au message. À utiliser avec parcimonie.");
    c.append(
      fieldRow("Mentionner @everyone", "Notifie tout le serveur.", toggle(cfg, "mentionEveryone")),
      fieldRow("Rôles à mentionner", "", multiRole(cfg, "mentionRoleIds"), true),
      fieldRow("Position du ping", "Au début, à la fin, ou n'importe où dans le texte via la variable {mentions}.", selectInput(cfg, "mentionPosition", [
        { value: "top", label: "Au début du message" },
        { value: "end", label: "À la fin du message" },
        { value: "inline", label: "Personnalisé (variable {mentions})" },
      ])),
    );
    body.append(c);
  }

  draw();

  const send = el("button", { class: "btn-save" }, icon("megaphone", 17), "Envoyer le message");
  send.addEventListener("click", async () => {
    if (!cfg.channelId) return toast("Choisis d'abord un salon.", "err");
    const editing = !!(cfg.messageId && cfg.messageId.trim());
    if (cfg.mentionEveryone && !editing) {
      if (!(await confirmModal("Ce message va ping <b>@everyone</b>. Confirmer l'envoi ?", { okLabel: "Envoyer", danger: true }))) return;
    }
    send.disabled = true;
    try {
      const r = await api("/api/announce/send", "POST", cfg);
      setDirty(false);
      toast(r.edited ? "Message modifié" : "Message envoyé", "ok");
      if (!editing && r.messageId) cfg.messageId = r.messageId;
    } catch (e) {
      toast("Erreur : " + e.message, "err");
    }
    send.disabled = false;
  });
  content.append(actionBar({}, send));
}
