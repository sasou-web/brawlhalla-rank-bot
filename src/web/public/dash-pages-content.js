/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · contenu
   Annonces (compositeur), rappels, TikTok, clips, combos.
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

const ANNOUNCE_VARS = [
  ["{server}", "Nom du serveur"],
  ["{membercount}", "Nombre de membres"],
  ["{date}", "Date du jour"],
  ["{time}", "Heure d'envoi"],
  ["{mentions}", "Emplacement des mentions"],
];

function blankAnnouncement() {
  return {
    channelId: "",
    messageId: "",
    mode: "embed",
    content: "",
    mentionEveryone: false,
    mentionRoleIds: [],
    mentionPosition: "top",
    fileDataUrl: "",
    fileName: "",
    embed: {
      color: "#5865f2",
      author: { name: "", iconUrl: "", url: "" },
      title: "",
      url: "",
      description: "",
      fields: [],
      thumbnail: "",
      image: "",
      footer: "",
      footerIcon: false,
      timestamp: false,
    },
  };
}

// Aperçu d'une annonce : mentions placées comme le fera le bot.
function announcePreview(c) {
  const mode = c.mode || "embed";
  const bits = [];
  if (c.mentionEveryone) bits.push("@everyone");
  for (const id of c.mentionRoleIds || []) bits.push("@" + ((roleById(id) || {}).name || "rôle"));
  const mentions = Object.fromEntries(bits.map((b, i) => [`{__m${i}__}`, b]));
  const pills = bits.map((_, i) => `{__m${i}__}`).join(" ");
  let text = mode !== "embed" ? c.content || "" : "";
  if (bits.length) {
    if (text.includes("{mentions}")) text = text.split("{mentions}").join(pills);
    else if (c.mentionPosition === "end") text = text ? `${text} ${pills}` : pills;
    else text = text ? `${pills}\n${text}` : pills;
  } else text = text.split("{mentions}").join("");
  const kids = [];
  if (text.trim()) kids.push(dcText(text, { mentions }));
  if (mode !== "text") kids.push(embedPreview(c.embed || {}, { mentions: {} }));
  if (c.fileDataUrl) kids.push(el("img", { class: "dc-attach", src: c.fileDataUrl, alt: c.fileName || "Image jointe" }));
  if (!kids.length) kids.push(el("div", { class: "dc-content dc-sub" }, "Message vide."));
  return discordMessage(...kids);
}

// ═══════════════════ Annonces ═══════════════════
function renderAnnounce(ctx) {
  // Brouillon non persistant : protégé contre la perte à la navigation, sans barre d'enregistrement.
  const form = createForm({ initial: blankAnnouncement() });
  const c = form.data;
  const edit = { on: false };
  const result = el("div");

  const send = button("Envoyer", { variant: "primary", icon: "send", onClick: () => sendAnnouncement() });
  const sendLabel = send.querySelector("span");
  watch(send, () => {
    sendLabel.textContent = c.messageId && c.messageId.trim() ? "Enregistrer la modification" : "Envoyer";
  });

  ctx.root.append(
    pageHeader({
      title: "Annonces",
      description: "Compose un message du bot (texte, embed, image) et publie-le, ou modifie un message déjà publié.",
      actions: [
        menuButton([
          {
            label: "Vider le brouillon",
            icon: "trash",
            onSelect: async () => {
              if (formDirty(form) && !(await confirmDialog({ title: "Vider le brouillon ?", message: "Le contenu en cours de rédaction sera perdu.", confirmLabel: "Vider", danger: true }))) return;
              FORMS = [];
              rerenderPage();
            },
          },
        ]),
        send,
      ],
    }),
    result,
  );

  async function sendAnnouncement() {
    if (!c.channelId) {
      toast("Choisis d'abord un salon.", "err");
      return;
    }
    const editing = !!(c.messageId && c.messageId.trim());
    if (c.mentionEveryone && !editing) {
      const ok = await confirmDialog({ title: "Mentionner @everyone ?", message: "Tous les membres du serveur recevront une notification.", confirmLabel: "Envoyer avec @everyone", danger: true });
      if (!ok) return;
    }
    const r = await api("/api/announce/send", "POST", c);
    markSaved(form);
    touch();
    const where = channelName(c.channelId);
    toast(r.edited ? "Message modifié" : `Message publié dans ${where}`, "ok");
    clearNode(result).append(
      el(
        "div",
        { style: "margin-bottom:24px" },
        callout("ok", r.edited ? `Le message a été modifié dans ${where}.` : `Message publié dans ${where}.`, {
          actions: [
            r.messageId && !r.edited
              ? button("Modifier ce message", {
                  size: "sm",
                  onClick: () => {
                    c.messageId = r.messageId;
                    edit.on = true;
                    msgInput.value = r.messageId;
                    editSwitch.setChecked(true);
                    markSaved(form);
                    touch();
                    msgInput.focus();
                  },
                })
              : null,
            linkButton("Voir sur Discord", discordChannelUrl(c.channelId), { variant: "ghost", size: "sm", external: true }),
          ],
        }),
      ),
    );
  }

  // --- Destination ---
  const msgInput = textInput(c, "messageId", { mono: true, placeholder: "123456789012345678", trim: true, size: "md" });
  const msgField = field("Identifiant du message", msgInput, { help: "Clic droit sur le message › Copier l'identifiant (mode développeur). Seuls les messages du bot peuvent être modifiés." });
  showWhen(msgField, () => edit.on);
  const editRow = switchField("Modifier un message existant", edit, "on", {
    onChange: (v) => {
      if (!v) {
        c.messageId = "";
        msgInput.value = "";
      } else requestAnimationFrame(() => msgInput.focus());
    },
  });
  const editSwitch = editRow.querySelector(".switch");

  // --- Image jointe ---
  const fileInput = el("input", { type: "file", accept: "image/*", tabindex: "-1", "aria-hidden": "true" });
  const fileInfo = el("span", { class: "row" });
  const pickBtn = button("Joindre une image", { size: "sm", icon: "paperclip", onClick: () => fileInput.click() });
  const drawFile = () => {
    clearNode(fileInfo);
    if (c.fileName) {
      fileInfo.append(
        el("span", { class: "chip" }, icon("image", 14), el("span", { class: "chip-label" }, c.fileName), iconButton("x", "Retirer l'image", () => { c.fileDataUrl = ""; c.fileName = ""; fileInput.value = ""; drawFile(); touch(); }, { size: "sm" })),
      );
    }
    pickBtn.hidden = !!c.fileName;
  };
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) {
      toast("Image trop lourde : 8 Mo maximum.", "err");
      fileInput.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      c.fileDataUrl = String(reader.result);
      c.fileName = f.name;
      drawFile();
      touch();
    };
    reader.readAsDataURL(f);
  });
  drawFile();
  const fileField = el("div", { class: "file-field", "data-group": "", role: "group" }, fileInput, pickBtn, fileInfo);

  const wantText = () => c.mode !== "embed";
  const wantEmbed = () => c.mode !== "text";
  const e = c.embed;
  const hasMentions = () => c.mentionEveryone || (c.mentionRoleIds || []).length > 0;

  const editor = groups(
    settingsGroup("Destination", null, field("Salon", channelPicker(c, "channelId", "text", { allowNone: false })), editRow, msgField),
    settingsGroup(
      "Contenu",
      "Markdown Discord accepté.",
      field("Format", bindSegmented(c, "mode", MESSAGE_FORMATS)),
      showWhen(field("Texte", textArea(c, "content", { rows: 5, maxLength: 2000 })), wantText),
      field("Image jointe", fileField, { help: "8 Mo maximum. Envoyée même sans embed.", optional: true }),
      varsHint(ANNOUNCE_VARS),
    ),
    showWhen(
      settingsGroup(
        "Embed",
        null,
        field("Couleur", colorInput(e, "color", { fallback: "#5865f2" })),
        field("Titre", textInput(e, "title", { maxLength: 256 })),
        field("Lien du titre", urlInput(e, "url"), { optional: true }),
        field("Description", textArea(e, "description", { rows: 6, maxLength: 4096 })),
        field("Vignette", urlInput(e, "thumbnail"), { help: "Petite image en haut à droite.", optional: true }),
        field("Grande image", urlInput(e, "image"), { optional: true }),
        field("Champs", embedFieldsEditor(e), { help: "« En ligne » place jusqu'à trois champs côte à côte." }),
        disclosure(
          "Auteur et pied de page",
          field("Nom de l'auteur", textInput(e.author, "name", { maxLength: 256 })),
          field("Icône de l'auteur", urlInput(e.author, "iconUrl")),
          field("Lien de l'auteur", urlInput(e.author, "url")),
          field("Pied de page", textInput(e, "footer", { maxLength: 2048 })),
          switchField("Icône du serveur dans le pied de page", e, "footerIcon"),
          switchField("Afficher la date et l'heure d'envoi", e, "timestamp"),
        ),
      ),
      wantEmbed,
    ),
    settingsGroup(
      "Mentions",
      "À utiliser avec parcimonie.",
      switchField("Mentionner @everyone", c, "mentionEveryone", { help: "Notifie tout le serveur. Une confirmation est demandée à l'envoi." }),
      field("Rôles à mentionner", multiRolePicker(c, "mentionRoleIds")),
      showWhen(
        field(
          "Position",
          selectInput(c, "mentionPosition", [
            { value: "top", label: "Au début du message" },
            { value: "end", label: "À la fin du message" },
            { value: "inline", label: "À l'emplacement de {mentions}" },
          ]),
        ),
        hasMentions,
      ),
    ),
  );
  ctx.root.append(splitLayout(editor, livePreview(() => announcePreview(c))));
}

// ═══════════════════ Rappels ═══════════════════
function renderReminders(ctx) {
  const f = configForm("reminders");
  const c = f.data;
  ctx.root.append(
    pageHeader({
      title: "Rappels",
      description: "Messages publiés régulièrement dans un salon : règles, vocaux privés, liens utiles…",
      actions: [moduleSwitch("reminders", "Rappels"), button("Envoyer maintenant", { icon: "send", onClick: () => sendTest("/api/reminders/test", "Rappel envoyé dans le salon") })],
    }),
  );
  const cadence = el("p", { class: "field-help" });
  watch(cadence, () => {
    const n = Number(c.intervalMinutes) || 0;
    cadence.textContent = n ? `Un rappel toutes les ${fmtDuration(n * 60000)}.` : "";
  });
  ctx.root.append(
    groups(
      settingsGroup(
        "Publication",
        null,
        field("Salon", channelPicker(c, "channelId", "text")),
        el("div", { class: "field" }, field("Intervalle", numberInput(c, "intervalMinutes", { min: 1, max: 10080, suffix: "min", size: "md" })), cadence),
        field(
          "Ordre",
          bindSegmented(c, "mode", [
            { value: "rotate", label: "À la suite" },
            { value: "random", label: "Au hasard" },
          ]),
        ),
      ),
      settingsGroup("Messages", "Publiés sans mention, pour éviter les notifications de masse.", field("Rappels", messagesEditor(c, "messages", { what: "rappel", placeholder: "Vocaux privés : rejoins le salon « Créer un vocal »." }))),
    ),
  );
}

// ═══════════════════ TikTok ═══════════════════
const TT_SOURCES = { embed: "Source directe TikTok", rss: "Flux RSS de secours" };
const TT_VIA = { embed: "via la source directe", rss: "via le flux RSS de secours" };
const TT_ACCENT = "#fe2c55"; // couleur de la carte publiée par le bot (tiktok.js)

function ttTs(v) {
  return toTs(v);
}

function ttHandle(v) {
  return String(v || "").trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Santé de la surveillance TikTok. `cfg` = configuration enregistrée, `st` = état
 * renvoyé par /api/tiktok/status (peut être null). Partagé avec la vue d'ensemble.
 * level : off | setup | unknown | pending | ok | degraded | down
 */
function tiktokHealth(cfg, st) {
  const c = cfg || {};
  if (!c.enabled) return { level: "off", kind: "neutral", title: "Inactif", detail: "Aucune vidéo n'est annoncée." };
  if (!c.account && !c.feedUrl) return { level: "setup", kind: "warn", title: "Aucun compte suivi", detail: "Indique le compte TikTok à surveiller." };
  if (!c.channelId) return { level: "setup", kind: "warn", title: "Aucun salon de publication", detail: "Choisis où annoncer les vidéos." };
  if (!st) return { level: "unknown", kind: "neutral", title: "État inconnu", detail: "" };
  const names = [c.account ? "embed" : null, c.feedUrl ? "rss" : null].filter(Boolean);
  const srcs = names.map((n) => (st.sources || {})[n] || {});
  if (srcs.every((s) => s.ok === null || s.ok === undefined)) return { level: "pending", kind: "info", title: "Première lecture en attente", detail: "Le bot lit le compte dans quelques instants." };
  if (srcs.every((s) => s.ok === false)) return { level: "down", kind: "danger", title: "Aucune source lisible", detail: "Aucune nouvelle vidéo n'est annoncée tant que ce n'est pas rétabli." };
  if (srcs.some((s) => s.ok === false)) {
    const directDown = names[0] === "embed" && srcs[0].ok === false;
    return { level: "degraded", kind: "warn", title: directDown ? "Source directe illisible" : "Flux RSS illisible", detail: directDown ? "Repli sur le flux RSS : les annonces peuvent arriver en retard." : "La source directe fonctionne." };
  }
  if (st.lastPostError) return { level: "degraded", kind: "warn", title: "Dernière publication échouée", detail: st.lastPostError };
  return { level: "ok", kind: "ok", title: "Opérationnel", detail: "" };
}

function ttSourceRow(name, s, cfg) {
  const who = name === "embed" ? `@${cfg.account}` : (() => { try { return new URL(cfg.feedUrl).host; } catch { return cfg.feedUrl; } })();
  const meta = [];
  if (ttTs(s.at)) meta.push(`Lue ${fmtRelative(ttTs(s.at))}`);
  if (s.ok === false && s.error) meta.push(s.error);
  if (s.retryAt && s.retryAt > Date.now()) meta.push(`En pause, reprise ${fmtRelative(s.retryAt)}`);
  const state = s.ok === true ? statusDot("ok", `Lisible · ${plural(s.count || 0, "vidéo", "vidéos")}`) : s.ok === false ? statusDot("danger", "Illisible") : statusDot("neutral", "Pas encore lue");
  return el(
    "div",
    { class: "list-item" + (s.ok === false ? " danger" : "") },
    icon(name === "embed" ? "music" : "link", 16),
    el("div", { class: "list-item-main" }, el("div", { class: "list-item-title wrap" }, `${TT_SOURCES[name]} · ${who}`), meta.length ? el("div", { class: "list-item-meta" }, meta.join(" · ")) : null),
    state,
  );
}

function ttStatusView(cfg, st) {
  const h = tiktokHealth(cfg, st);
  const every = `toutes les ${fmtDuration((cfg.pollIntervalMin || 2) * 60000)}`;
  const lastCheck = ttTs(st.lastCheckAt);
  const lastPost = ttTs(st.lastPostAt);
  const nextPoll = ttTs(st.nextPollAt);
  const strong = (node) => el("span", { class: "status status-strong" }, node);
  const view = el(
    "div",
    { class: "stack", style: "gap:12px" },
    infoStrip(
      [
        { label: "Surveillance", value: statusDot(h.kind, h.title, { strong: true }), meta: h.level === "ok" || h.level === "pending" ? `@${cfg.account || "?"} · ${every}` : h.detail },
        {
          label: "Dernière vérification",
          value: lastCheck ? strong(timeAgo(lastCheck)) : "Jamais",
          meta: st.lastCheckError ? st.lastCheckError : TT_VIA[st.lastSource] || null,
        },
        { label: "Dernière annonce", value: lastPost ? strong(timeAgo(lastPost)) : "Aucune pour l'instant", meta: st.lastPostError || (cfg.channelId ? `dans ${channelName(cfg.channelId)}` : null) },
        {
          label: "Prochaine vérification",
          // Échéance passée : le passage est en cours ou imminent (tick toutes les 30 s).
          value: !cfg.enabled ? "—" : !nextPoll ? "Au prochain passage" : nextPoll <= Date.now() ? "Imminente" : strong(timeAgo(nextPoll)),
          meta: plural(st.seenCount || 0, "vidéo déjà vue", "vidéos déjà vues"),
        },
      ],
      { label: "État de la surveillance TikTok" },
    ),
  );
  const rows = [cfg.account ? ttSourceRow("embed", (st.sources || {}).embed || {}, cfg) : null, cfg.feedUrl ? ttSourceRow("rss", (st.sources || {}).rss || {}, cfg) : null].filter(Boolean);
  if (rows.length) view.append(panel(el("div", { class: "list" }, rows)));
  if (st.lastNote) {
    const [when, ...rest] = String(st.lastNote).split(" — ");
    const ts = ttTs(when);
    view.append(callout("info", rest.length ? rest.join(" — ") : st.lastNote, { title: ts ? `Dernier événement, ${fmtRelative(ts)}` : "Dernier événement" }));
  }
  return view;
}

// Date au format affiché par Discord pour <t:…:f>.
function ttDiscordDate(ts) {
  return new Date(ts).toLocaleString("fr-FR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Miniature recadrée en 9:16 comme le fait le bot en repli (CDN wsrv.nl).
function ttCover(url) {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  return "https://wsrv.nl/?url=" + encodeURIComponent(url) + "&w=360&h=640&fit=cover&a=center&output=jpg";
}

/** Reproduit buildMessagePayload (tiktok.js) : ligne d'annonce puis carte TikTok. */
function tiktokMessagePreview(cfg, { video, displayName, defaultMessage }) {
  // Même ordre que le bot ; sans compte (aperçu seulement), un nom d'exemple lisible.
  const who = String(cfg.username || "").replace(/^@+/, "") || displayName || cfg.account || "@compte";
  const url = (video && video.url) || `https://www.tiktok.com/@${cfg.account || "compte"}`;
  const template = cfg.message && cfg.message.trim() ? cfg.message : defaultMessage || "Nouvelle vidéo de {pseudo} !";
  const intro = template.replace(/\{pseudo\}/gi, who).replace(/\{url\}/gi, url).trim();
  const role = cfg.roleId ? roleById(cfg.roleId) : null;
  const first = dcText((role ? "{__role__} " : "") + intro, { mentions: role ? { "{__role__}": "@" + role.name } : {} });

  const caption = String((video && video.title) || "").replace(/\s+/g, " ").trim();
  const tags = (caption.match(/#[^\s#]+/g) || []).join(" ");
  let text = caption.replace(/#[^\s#]+/g, "").replace(/\s+/g, " ").trim();
  if (text.length > 280) text = text.slice(0, 277).trimEnd() + "…";
  const foot = ["📱 **TikTok**"];
  if (cfg.showDate !== false) foot.push(ttDiscordDate(ttTs(video && video.date) || Date.now()));
  let footer = `-# ${foot.join(" • ")}`;
  if (tags) footer += `\n-# ${tags.slice(0, 500)}`;

  return discordMessage(
    first,
    containerPreview(TT_ACCENT, [
      text ? { text: `> [${text.replace(/[[\]]/g, "")}](${url})` } : null,
      { media: ttCover(video && video.image) },
      "sep",
      { text: footer },
      { linkButton: "Voir sur TikTok", emoji: "▶️" },
    ]),
  );
}

function renderTikTok(ctx) {
  const f = configForm("tiktok");
  const c = f.data;
  const tt = { status: null, error: null, diag: null, diagLoading: false, diagError: null };

  ctx.root.append(
    pageHeader({
      title: "TikTok",
      description: "Annonce chaque nouvelle vidéo d'un compte dans un salon. Plusieurs vidéos d'un coup donnent un seul message.",
      actions: [moduleSwitch("tiktok", "TikTok"), button("Envoyer un test", { icon: "send", onClick: () => sendTest("/api/tiktok/test", "Dernière vidéo publiée dans le salon") })],
    }),
  );

  // --- État en direct (configuration enregistrée + état interne du bot) ---
  const statusHost = el("div", { class: "page-status" });
  ctx.root.append(statusHost);
  let drawnKey = "";
  const drawStatus = (force) => {
    const saved = CONFIG.tiktok || {};
    const key = JSON.stringify([saved.enabled, saved.account, saved.feedUrl, saved.channelId, saved.pollIntervalMin, tt.error, tt.status]);
    if (!force && key === drawnKey) return;
    drawnKey = key;
    clearNode(statusHost);
    if (tt.error && !tt.status) statusHost.append(inlineError("État indisponible : " + tt.error, () => loadStatus()));
    else if (!tt.status) statusHost.append(infoStrip(["Surveillance", "Dernière vérification", "Dernière annonce", "Prochaine vérification"].map((label) => ({ label, value: el("span", { class: "skel skel-line", style: "width:60%" }) }))));
    else statusHost.append(ttStatusView(saved, tt.status));
  };
  watch(statusHost, () => drawStatus(false));

  async function loadStatus() {
    try {
      tt.status = await api("/api/tiktok/status");
      tt.error = null;
    } catch (e) {
      tt.error = e.message;
    }
    if (!ctx.alive()) return;
    drawStatus(true);
    touch();
  }
  loadStatus();
  ctx.interval(loadStatus, 30000);

  // --- Vérification du compte (sans enregistrer ni publier) ---
  const diagHost = el("div", { "aria-live": "polite" });
  const diagMatches = () => tt.diag && ttHandle(tt.diag.account) === ttHandle(c.account);
  const latestVideo = () => {
    if (!diagMatches()) return null;
    const r = tt.diag.results.find((x) => x.ok && x.latest);
    return r ? r.latest : null;
  };
  const displayName = () => {
    const d = diagMatches() && tt.diag.results.find((x) => x.profile && x.profile.nickname);
    if (d) return d.profile.nickname;
    return ttHandle(c.account) === ttHandle(CONFIG.tiktok && CONFIG.tiktok.account) && tt.status && tt.status.profile ? tt.status.profile.nickname : "";
  };

  async function diagnose() {
    if (!c.account && !c.feedUrl) {
      toast("Indique d'abord le compte TikTok.", "err");
      return;
    }
    tt.diagLoading = true;
    tt.diagError = null;
    drawDiag();
    try {
      tt.diag = await api("/api/tiktok/diagnose", "POST", { account: c.account, feedUrl: c.feedUrl });
    } catch (e) {
      tt.diagError = e.message;
      tt.diag = null;
    }
    tt.diagLoading = false;
    if (!ctx.alive()) return;
    drawDiag();
    touch();
  }

  function drawDiag() {
    clearNode(diagHost);
    if (tt.diagLoading) {
      diagHost.append(panel(skelLines(2)));
      return;
    }
    if (tt.diagError) {
      diagHost.append(callout("danger", tt.diagError, { title: "Vérification impossible" }));
      return;
    }
    if (!diagMatches()) return;
    const rows = tt.diag.results.map((r) => {
      const meta = r.ok
        ? [r.profile && r.profile.nickname ? `Profil « ${r.profile.nickname} »` : null, r.latest && r.latest.title ? `dernière : « ${r.latest.title.replace(/\s+/g, " ").slice(0, 70)} »` : null, `${fmtNum(r.ms)} ms`].filter(Boolean).join(" · ")
        : r.error;
      return el(
        "div",
        { class: "list-item" + (r.ok ? "" : " danger") },
        icon(r.ok ? "check-circle" : "alert-circle", 16),
        el("div", { class: "list-item-main" }, el("div", { class: "list-item-title" }, TT_SOURCES[r.source] || r.source), el("div", { class: "list-item-meta" }, meta)),
        r.ok ? statusDot("ok", plural(r.count, "vidéo visible", "vidéos visibles")) : statusDot("danger", "Illisible"),
      );
    });
    const direct = tt.diag.results.find((r) => r.source === "embed");
    const note = direct && direct.ok
      ? `Les nouvelles vidéos seront détectées environ ${fmtDuration((c.pollIntervalMin || 2) * 60000)} après leur publication.`
      : tt.diag.results.some((r) => r.ok)
        ? "Seul le flux RSS répond : les annonces dépendront de son rythme de mise à jour."
        : "Aucune source ne répond : rien ne sera annoncé tant que ce n'est pas réglé.";
    diagHost.append(el("div", { class: "stack", style: "gap:8px" }, panel(el("div", { class: "list" }, rows)), el("p", { class: "field-help" }, note)));
  }
  // Le résultat ne vaut que pour le compte vérifié : il disparaît si le compte change.
  watch(diagHost, () => {
    if (!tt.diagLoading && tt.diag && !diagMatches()) {
      tt.diag = null;
      drawDiag();
    }
  });

  const accountInput = textInput(c, "account", { placeholder: "kayagoldforged", trim: true });
  const accountRow = el("div", { class: "row", style: "flex-wrap:nowrap" }, accountInput, button("Vérifier", { icon: "search", onClick: diagnose }));

  const form = groups(
    settingsGroup(
      "Compte suivi",
      "Le bot lit la page publique du compte, sans clé ni connexion. « Vérifier » teste la lecture sans rien enregistrer ni publier.",
      field("Compte TikTok", accountRow, { help: "Pseudo sans @, ou lien du profil." }),
      diagHost,
      field("Nom affiché", textInput(c, "username", { size: "md" }), { help: "Remplace {pseudo} dans l'annonce. Vide : nom du profil TikTok.", optional: true }),
      field("Vérifier toutes les", numberInput(c, "pollIntervalMin", { min: 1, max: 1440, suffix: "min" }), { help: "Par défaut : 2 minutes." }),
      disclosure(
        "Flux RSS de secours",
        field("Adresse du flux", urlInput(c, "feedUrl"), { help: "Utilisé seulement si TikTok ne répond pas ; plus lent.", optional: true }),
      ),
    ),
    settingsGroup(
      "Publication",
      null,
      field("Salon", channelPicker(c, "channelId", "text")),
      field("Rôle à mentionner", rolePicker(c, "roleId"), { optional: true }),
      switchField("Afficher la date de la vidéo", c, "showDate", { help: "« TikTok • date » en bas de la carte." }),
    ),
    settingsGroup(
      "Message",
      "Phrase publiée au-dessus de la carte de la vidéo.",
      field("Phrase d'annonce", textArea(c, "message", { rows: 2, maxLength: 1500, placeholder: "Nouvelle vidéo de {pseudo} !" }), { help: "Vide : phrase par défaut du bot." }),
      varsHint([
        ["{pseudo}", "Nom affiché"],
        ["{url}", "Lien de la vidéo"],
      ]),
    ),
  );

  // --- Aperçu fidèle : la vraie dernière vidéo après « Vérifier », sinon un exemple ---
  const previewHolder = el("div");
  const previewSource = el("span", { class: "text-3" });
  const aside = el("div", { class: "split-aside" }, el("div", { class: "aside-label" }, el("span", {}, "Aperçu"), previewSource), previewHolder);
  watch(previewHolder, () => {
    const video = latestVideo();
    previewSource.textContent = video ? "Dernière vidéo du compte" : "Exemple";
    clearNode(previewHolder).append(
      tiktokMessagePreview(c, {
        video: video || { title: "La légende de la vidéo apparaît ici #brawlhalla", image: "", url: "" },
        displayName: displayName(),
        defaultMessage: tt.status && tt.status.defaultMessage,
      }),
    );
  });

  ctx.root.append(splitLayout(form, aside));
}

// ═══════════════════ Clips & Devine ton rang ═══════════════════
function renderClips(ctx) {
  const clips = configForm("clips");
  const guess = configForm("guessrank");
  ctx.root.append(pageHeader({ title: "Clips", description: "Réactions automatiques et vote « Devine ton rang » sur les clips vidéo.", hasTabs: true }));
  pageTabs(ctx, (tab, host) => {
    if (tab === "guessrank") clipsTab(host, guess.data, true);
    else clipsTab(host, clips.data, false);
  });
}

function clipsTab(host, c, guess) {
  host.append(
    toolbar(guess ? "Le bot ajoute des emojis de rank sous chaque clip : les membres votent pour le rang du joueur." : "Le bot réagit automatiquement aux clips et peut modérer le salon.", [
      moduleSwitch(guess ? "guessrank" : "clips", guess ? "Devine ton rang" : "Réactions aux clips"),
    ]),
    groups(
      settingsGroup("Salons surveillés", "Le bot n'agit que dans ces salons.", field("Salons", multiChannelPicker(c, "channelIds", "text"))),
      settingsGroup(
        guess ? "Emojis de vote" : "Réactions",
        guess ? "Un emoji par tier, du plus bas au plus haut." : "Ajoutées sous chaque clip, dans cet ordre.",
        field(guess ? "Emojis" : "Réactions", reactionsEditor(c, "reactions", { captions: guess ? GUILD.tiers : null })),
        guess ? switchField("Un seul vote par membre", c, "singleVote", { help: "Retire le vote précédent quand un membre en choisit un autre." }) : null,
      ),
      settingsGroup(
        "Filtrage",
        null,
        switchField("Vidéos uniquement", c, "requireVideo", { help: "Ignore les messages sans vidéo." }),
        switchField("Supprimer les messages sans vidéo", c, "deleteNonVideo", { help: "Nécessite la permission « Gérer les messages »." }),
        switchField("Ignorer les bots", c, "ignoreBots"),
        switchField("Ignorer les réponses", c, "ignoreReplies"),
      ),
      guess
        ? null
        : settingsGroup(
            "Épinglage",
            null,
            field("Épingler à partir de", numberInput(c, "pinThreshold", { min: 0, suffix: "réactions", size: "md" }), { help: "Quand une réaction atteint ce nombre, celle du bot comprise. 0 : désactivé." }),
          ),
      settingsGroup("Hébergeurs vidéo", "Domaines reconnus comme des vidéos, en plus des hébergeurs courants.", field("Domaines supplémentaires", domainsEditor(c, "extraDomains"), { optional: true })),
    ),
  );
}

// ═══════════════════ Combos ═══════════════════
function renderCombos(ctx) {
  const refresh = button("Mettre à jour la base", {
    icon: "refresh",
    onClick: async () => {
      const r = await api("/api/combos/refresh", "POST", {});
      toast(`Base mise à jour : ${plural(r.count || 0, "combo", "combos")}`, "ok");
      rerenderPage();
    },
  });
  const publish = button("Publier le panneau", {
    variant: "primary",
    icon: "send",
    onClick: () =>
      publishDialog({
        title: "Publier le panneau de combos",
        description: "Les membres choisissent une arme et parcourent ses combos, vidéo à l'appui.",
        onPublish: (channelId) => api("/api/combos/publish", "POST", { channelId }),
      }),
  });
  // Page publique d'entraînement (sans connexion), servie par ce même serveur.
  const lab = linkButton("Ouvrir le Combo Lab", "/lab/", { icon: "play", external: true });
  ctx.root.append(pageHeader({ title: "Combos", description: "Base de true combos (source BrawlDatabase), consultable avec /combos, un panneau interactif ou le Combo Lab public (/lab/).", actions: [lab, refresh, publish] }));
  const body = el("div", {}, panel(skelLines(4)));
  ctx.root.append(body);

  api("/api/combos")
    .then((info) => {
      if (!ctx.alive()) return;
      clearNode(body);
      const weapons = Object.entries(info.byWeapon || {})
        .map(([w, n]) => ({ label: w.charAt(0).toUpperCase() + w.slice(1), value: n }))
        .sort((a, b) => b.value - a.value);
      if (!info.count) {
        publish.disabled = true;
        body.append(
          panel(
            emptyState({
              icon: "flame",
              title: "La base de combos est vide",
              text: "Mets-la à jour depuis BrawlDatabase pour la rendre disponible sur Discord.",
              actions: [button("Mettre à jour la base", { variant: "primary", icon: "refresh", onClick: () => refresh.click() })],
            }),
          ),
        );
        return;
      }
      body.append(
        statGrid([
          { label: "Combos en base", value: fmtNum(info.count) },
          { label: "Armes couvertes", value: fmtNum(weapons.length) },
          { label: "Dernière mise à jour", value: info.scrapedAt ? fmtDate(info.scrapedAt) : "—", hint: info.scrapedAt ? fmtRelative(info.scrapedAt) : null },
        ]),
        sectionBlock("Combos par arme", {}, el("div", { class: "panel" }, el("div", { class: "panel-body" }, barList(weapons)))),
      );
    })
    .catch((e) => {
      if (ctx.alive()) clearNode(body).append(panel(inlineError("Impossible de lire la base : " + e.message, () => rerenderPage())));
    });
}
