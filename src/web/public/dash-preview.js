/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · aperçus Discord
   Rendu approché d'un message du bot : markdown Discord (sous-ensemble),
   embeds classiques et conteneurs « Components V2 » (panneaux de liaison
   et de tickets). Sert aux pages Annonces, Accueil, LoL, Liaison, Tickets.
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).

   Sécurité : tout le texte est échappé AVANT la mise en forme ; seuls des
   liens http(s) et des emojis Discord (CDN) sont reconstruits.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

// Valeurs d'exemple pour les variables des messages.
function sampleVars() {
  const name = ME ? ME.username : "membre";
  const now = Date.now();
  return {
    "{username}": name,
    "{user.name}": name,
    "{user.tag}": name,
    "{server}": GUILD ? GUILD.name : "Serveur",
    "{membercount}": GUILD ? fmtNum(GUILD.memberCount) : "0",
    "{count}": GUILD ? fmtNum(GUILD.memberCount) : "0",
    "{date}": fmtDate(now, { day: "2-digit", month: "2-digit", year: "numeric" }),
    "{time}": fmtTime(now),
  };
}

// Mise en forme en ligne (texte déjà échappé).
function discordInline(s) {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, a, name, id) => `<img class="dc-emoji" src="https://cdn.discordapp.com/emojis/${id}.${a ? "gif" : "webp"}?size=48" alt=":${name}:">`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*/g, "$1<em>$2</em>");
}

/**
 * Markdown Discord → HTML sûr.
 * mentions : { "{user}": "@Pseudo", … } rendus en pastilles de mention.
 */
function discordHtml(raw, { mentions = {}, vars = sampleVars() } = {}) {
  let s = String(raw ?? "");
  const pills = [];
  for (const [token, label] of Object.entries(mentions)) {
    if (!s.includes(token)) continue;
    s = s.split(token).join(`\uE000${pills.length}\uE001`);
    pills.push(label);
  }
  for (const [token, value] of Object.entries(vars)) s = s.split(token).join(value);
  s = escapeHtml(s);
  const html = s
    .split("\n")
    .map((line) => {
      let m;
      if ((m = /^-# (.*)$/.exec(line))) return `<div class="dc-sub">${discordInline(m[1])}</div>`;
      if ((m = /^(#{1,3}) (.*)$/.exec(line))) return `<div class="dc-h${m[1].length}">${discordInline(m[2])}</div>`;
      if ((m = /^&gt; (.*)$/.exec(line))) return `<div class="dc-quote">${discordInline(m[1])}</div>`;
      if ((m = /^\s*[-*•] (.*)$/.exec(line))) return `<div class="dc-li">${discordInline(m[1])}</div>`;
      return line.trim() ? `<div>${discordInline(line)}</div>` : '<div class="dc-gap"></div>';
    })
    .join("");
  return html.replace(/\uE000(\d+)\uE001/g, (_, i) => `<span class="dc-mention">${escapeHtml(pills[Number(i)])}</span>`);
}

function dcText(raw, opts) {
  return el("div", { class: "dc-content", html: discordHtml(raw, opts) });
}

function defaultMentions() {
  return { "{user}": "@" + (ME ? ME.username : "membre") };
}

// Chrome du message : avatar du bot, nom, badge APP, heure.
function discordMessage(...children) {
  return el(
    "div",
    { class: "dc", role: "img", "aria-label": "Aperçu du message Discord" },
    el(
      "div",
      { class: "dc-msg" },
      el("img", { class: "dc-avatar", src: "/icon-192.png", alt: "" }),
      el(
        "div",
        { class: "dc-main" },
        el("div", { class: "dc-head" }, el("span", { class: "dc-author" }, "XK Bot"), el("span", { class: "dc-app" }, "APP"), el("span", { class: "dc-time" }, "Aujourd'hui à " + fmtTime(Date.now()))),
        ...children,
      ),
    ),
  );
}

function safeUrl(u) {
  return typeof u === "string" && /^https?:\/\/\S+$/i.test(u.trim()) ? u.trim() : null;
}

/** Embed classique. e : { color, author:{name,iconUrl}, title, description, fields, thumbnail, image, footer, footerIcon, timestamp } */
function embedPreview(e, { thumbnail, mentions = defaultMentions() } = {}) {
  const box = el("div", { class: "dc-embed", style: `border-left-color:${toHex(e.color, "#5865f2")}` });
  const main = el("div", { class: "dc-embed-main" });
  if (e.author && e.author.name) {
    main.append(el("div", { class: "dc-embed-author" }, safeUrl(e.author.iconUrl) ? el("img", { src: safeUrl(e.author.iconUrl), alt: "" }) : null, el("span", {}, e.author.name)));
  }
  if (e.title) main.append(el("div", { class: "dc-embed-title", html: discordHtml(e.title, { mentions }) }));
  if (e.description) main.append(dcText(e.description, { mentions }));
  const fields = (e.fields || []).filter((f) => f && (f.name || f.value));
  if (fields.length) {
    main.append(
      el(
        "div",
        { class: "dc-embed-fields" },
        fields.map((f) =>
          el("div", { class: "dc-field" + (f.inline ? " inline" : "") }, el("div", { class: "dc-field-name", html: discordHtml(f.name || "", { mentions }) }), dcText(f.value || "", { mentions })),
        ),
      ),
    );
  }
  const thumb = thumbnail || safeUrl(e.thumbnail);
  if (!main.children.length && !thumb && !safeUrl(e.image) && !e.footer) main.append(el("div", { class: "dc-sub" }, "Embed vide : ajoute un titre ou une description."));
  box.append(main);
  box.append(thumb ? el("img", { class: "dc-thumb", src: thumb, alt: "" }) : el("span"));
  if (safeUrl(e.image)) box.append(el("img", { class: "dc-image", src: safeUrl(e.image), alt: "" }));
  if (e.footer || e.timestamp) {
    const parts = [e.footer ? discordHtml(e.footer).replace(/<\/?div[^>]*>/g, "") : "", e.timestamp ? "Aujourd'hui à " + fmtTime(Date.now()) : ""].filter(Boolean);
    box.append(el("div", { class: "dc-embed-footer" }, e.footerIcon && GUILD && GUILD.icon ? el("img", { src: GUILD.icon, alt: "" }) : null, el("span", { html: parts.join(" • ") })));
  }
  return box;
}

/**
 * Conteneur Components V2. blocks : [{ banner }, { text, thumb }, "sep",
 * { button }, { select }] — même structure que les panneaux du bot.
 */
function containerPreview(color, blocks) {
  const box = el("div", { class: "dc-container", style: `border-left-color:${toHex(color, "#5865f2")}` });
  for (const b of blocks) {
    if (!b) continue;
    if (b === "sep") box.append(el("div", { class: "dc-sep" }));
    else if (b.banner) box.append(el("img", { class: "dc-banner", src: b.banner, alt: "" }));
    else if (b.text !== undefined) {
      const text = dcText(b.text);
      box.append(b.thumb ? el("div", { class: "dc-section" }, text, el("img", { class: "dc-thumb", src: b.thumb, alt: "" })) : text);
    } else if (b.media !== undefined) {
      box.append(b.media ? el("img", { class: "dc-media", src: b.media, alt: "" }) : el("span", { class: "dc-media dc-media-empty" }, "Miniature de la vidéo"));
    } else if (b.linkButton) box.append(el("span", { class: "dc-btn link" }, b.emoji ? el("span", { "aria-hidden": "true" }, b.emoji) : null, b.linkButton, icon("external", 14)));
    else if (b.button) box.append(el("span", { class: "dc-btn" }, b.emoji ? el("span", { "aria-hidden": "true" }, b.emoji) : null, b.button));
    else if (b.select) box.append(el("span", { class: "dc-select" }, el("span", {}, b.select), icon("chevron-down", 16)));
  }
  return box;
}

/**
 * Aperçu de message au format du bot (bienvenue, LoL) :
 * cfg.mode = text | embed | both, cfg.text, cfg.pingUser, cfg.embed.
 */
function greetingPreview(cfg) {
  const mode = cfg.mode || "embed";
  const kids = [];
  const wantText = mode === "text" || mode === "both";
  if (wantText && cfg.text) kids.push(dcText(cfg.text, { mentions: defaultMentions() }));
  else if (cfg.pingUser) kids.push(el("div", { class: "dc-content" }, el("span", { class: "dc-mention" }, "@" + (ME ? ME.username : "membre"))));
  if (mode === "embed" || mode === "both") {
    const e = cfg.embed || {};
    kids.push(embedPreview(e, { thumbnail: e.thumbnailUser && ME && ME.avatar ? ME.avatar : null }));
  }
  if (!kids.length) kids.push(el("div", { class: "dc-content dc-sub" }, "Message vide."));
  return discordMessage(...kids);
}

// Colonne d'aperçu recalculée à chaque modification (voir watch()).
function livePreview(build, { label = "Aperçu" } = {}) {
  const holder = el("div");
  const aside = el("div", { class: "split-aside" }, el("div", { class: "aside-label" }, el("span", {}, label), el("span", { class: "text-3" }, "Rendu approximatif")), holder);
  watch(holder, () => {
    clearNode(holder);
    try {
      holder.append(build());
    } catch {
      holder.append(el("div", { class: "text-sm text-2" }, "Aperçu indisponible."));
    }
  });
  return aside;
}

// Mise en page éditeur + aperçu.
function splitLayout(main, aside) {
  return el("div", { class: "split" }, el("div", { class: "split-main" }, main), aside);
}
