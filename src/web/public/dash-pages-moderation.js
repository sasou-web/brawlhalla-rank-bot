/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · modération : filtre de mots
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).

   Organisation de la page :
   - état en tête (messages filtrés, dernier, termes surveillés) + alertes de
     permissions calculées en direct à partir des réglages en cours d'édition ;
   - Termes : la liste, les options de détection et un testeur en direct qui
     utilise la configuration NON enregistrée (on voit l'effet avant de valider) ;
   - Sanctions, Exceptions, Historique.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

const WF_ACTIONS = [
  { value: "delete", label: "Supprimer" },
  { value: "mask", label: "Masquer" },
  { value: "flag", label: "Signaler seulement" },
];

const WF_ACTION_HELP = {
  delete: "Le message est supprimé et son auteur averti.",
  mask: "Le message est supprimé puis republié sous le nom et l'avatar de son auteur, avec les termes masqués (*****).",
  flag: "Rien n'est supprimé : le message est seulement consigné dans l'historique et le journal de modération.",
};

const WF_VERDICT = { delete: "Serait supprimé", mask: "Serait republié masqué", flag: "Serait signalé au staff" };

// Libellé + type de pastille par action enregistrée (rouge réservé à l'échec).
const WF_RESULT = {
  delete: ["neutral", "Supprimé"],
  mask: ["neutral", "Masqué"],
  flag: ["warn", "Signalé"],
  failed: ["danger", "Non supprimé"],
};

const WF_WARN_VARS = [
  ["{user}", "Mention de l'auteur"],
  ["{username}", "Pseudo de l'auteur"],
  ["{channel}", "Salon du message"],
  ["{server}", "Nom du serveur"],
];

function termBadge(term) {
  const b = badge(term);
  b.classList.add("badge-mono");
  return b;
}

// Clé de comparaison approximative (le serveur dédoublonne précisément).
function wfKey(s) {
  return normText(String(s || "").replace(/\s+/g, " ").trim());
}

// « *con* » : un terme court cherché au milieu des mots touche beaucoup de mots innocents.
function wfRisky(term) {
  const t = String(term || "").trim();
  return t.length > 2 && t.startsWith("*") && t.endsWith("*") && t.replace(/[*\s]/g, "").length <= 3;
}

/**
 * Éditeur de liste de termes : saisie (Entrée ou collage de plusieurs lignes),
 * puces retirables, filtre quand la liste est longue, liste de base optionnelle.
 */
function termListEditor(obj, key, { placeholder, emptyText, max = 1000, presets = null } = {}) {
  const get = () => (Array.isArray(obj[key]) ? obj[key] : []);
  const state = { q: "" };
  const input = el("input", { class: "input", type: "text", placeholder, "aria-label": placeholder, autocomplete: "off", spellcheck: "false", maxlength: "100" });
  const chips = el("div", { class: "chips", role: "list" });
  const head = el("div", { class: "term-editor-head" });

  function add(raws) {
    const list = [...get()];
    const keys = new Set(list.map(wfKey));
    let added = 0;
    let dup = 0;
    for (const raw of raws) {
      const s = String(raw).replace(/\s+/g, " ").trim().slice(0, 100);
      if (!s) continue;
      const k = wfKey(s);
      if (keys.has(k)) {
        dup++;
        continue;
      }
      if (list.length >= max) {
        toast(`Maximum ${fmtNum(max)} termes.`, "err");
        break;
      }
      keys.add(k);
      list.push(s);
      added++;
    }
    if (added) {
      obj[key] = list;
      touch();
      draw();
    } else if (dup) toast(dup > 1 ? "Ces termes sont déjà dans la liste." : "Ce terme est déjà dans la liste.", "info");
    return added;
  }
  const splitList = (s) => String(s).split(/[\n,;]+/);
  const submit = () => {
    if (add(splitList(input.value)) || !input.value.trim()) input.value = "";
    input.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  });
  // Coller une liste (une ligne par terme, ou séparée par des virgules) ajoute tout d'un coup.
  input.addEventListener("paste", (e) => {
    const text = e.clipboardData && e.clipboardData.getData("text");
    if (text && /[\n,;]/.test(text)) {
      e.preventDefault();
      const n = add(splitList(text));
      if (n) toast(`${plural(n, "terme ajouté", "termes ajoutés")}`, "ok");
    }
  });

  const filter = el("input", { class: "input input-sm", type: "search", placeholder: "Filtrer la liste", "aria-label": "Filtrer la liste", autocomplete: "off" });
  filter.addEventListener("input", () => {
    state.q = filter.value.trim();
    draw();
  });
  const filterWrap = el("div", { class: "dt-search" }, icon("search", 14), filter);
  const count = el("span", { class: "text-sm text-2" });

  // `presets` peut être une fonction : la liste arrive avec les statistiques, après l'affichage.
  const getPresets = typeof presets === "function" ? presets : () => presets;
  const missingPresets = () => {
    const keys = new Set(get().map(wfKey));
    return (getPresets() || []).filter((p) => !keys.has(wfKey(p)));
  };
  const presetBtn = presets
    ? button("Ajouter la liste de base", {
        size: "sm",
        variant: "ghost",
        icon: "plus",
        onClick: async () => {
          const missing = missingPresets();
          const ok = await confirmDialog({
            title: "Ajouter la liste de base ?",
            message: el(
              "div",
              { class: "stack", style: "gap:10px" },
              el("p", {}, `${plural(missing.length, "terme courant", "termes courants")} (insultes en français) seront ajoutés à ta liste. Tu pourras en retirer ensuite.`),
              el("div", { class: "chips" }, missing.map((t) => el("span", { class: "chip term" }, el("span", { class: "chip-label" }, t)))),
            ),
            confirmLabel: "Ajouter",
          });
          if (ok) add(missing);
        },
      })
    : null;
  if (presetBtn) {
    watch(presetBtn, () => {
      presetBtn.hidden = !missingPresets().length;
    });
  }

  function draw() {
    const list = get();
    const q = normText(state.q);
    const shown = q ? list.filter((t) => normText(t).includes(q)) : list;
    clearNode(head);
    count.textContent = q ? `${fmtNum(shown.length)} sur ${plural(list.length, "terme", "termes")}` : plural(list.length, "terme", "termes");
    head.append(count, el("span", { class: "spacer" }));
    if (list.length > 15) head.append(filterWrap);
    if (presetBtn) {
      presetBtn.hidden = !missingPresets().length;
      head.append(presetBtn);
    }

    clearNode(chips);
    if (!list.length) chips.append(el("span", { class: "text-sm text-2", role: "listitem" }, emptyText));
    else if (!shown.length) chips.append(el("span", { class: "text-sm text-2", role: "listitem" }, `Aucun terme ne contient « ${state.q} ».`));
    for (const t of shown) {
      const risky = wfRisky(t);
      chips.append(
        el(
          "span",
          { class: "chip term" + (risky ? " risky" : ""), role: "listitem", "data-tip": risky ? "Terme court cherché au milieu des mots : risque de faux positifs" : null },
          risky ? icon("alert-triangle", 12) : null,
          el("span", { class: "chip-label" }, t),
          iconButton("x", `Retirer ${t}`, () => {
            obj[key] = get().filter((x) => x !== t);
            touch();
            draw();
            input.focus();
          }, { size: "sm" }),
        ),
      );
    }
  }
  draw();

  return el(
    "div",
    { class: "term-editor", role: "group", "data-group": "" },
    el("div", { class: "row", style: "flex-wrap:nowrap" }, input, button("Ajouter", { onClick: submit })),
    el("p", { class: "field-help" }, "Entrée pour ajouter. Colle une liste pour en ajouter plusieurs d'un coup (une ligne par terme, ou séparés par des virgules)."),
    head,
    chips,
  );
}

function wfSyntax() {
  const row = (code, text) => [el("code", {}, code), el("span", {}, text)];
  return el(
    "div",
    { class: "syntax" },
    row("mot", "Le mot entier : « con » ne touche pas « concert »."),
    row("mot*", "Les mots qui commencent ainsi : « encul* » couvre enculé, enculer…"),
    row("*mot", "Les mots qui finissent ainsi."),
    row("*mot*", "Partout, même au milieu d'un mot. À réserver aux termes longs."),
    row("deux mots", "Une expression : les mots doivent se suivre."),
  );
}

// Variantes de contournement d'un terme, pour montrer ce que le filtre détecte.
function wfExamples(words) {
  const base = (words || []).find((w) => /^[\p{L}]{4,}$/u.test(w));
  if (!base) return [];
  const leet = base.replace(/o/gi, "0").replace(/a/gi, "4").replace(/e/gi, "3").replace(/i/gi, "1");
  const spaced = [...base].join(" ");
  const out = [base.toUpperCase(), spaced];
  if (leet !== base) out.splice(1, 0, leet);
  return out;
}

// Texte d'origine avec les passages détectés surlignés (construit en nœuds, sans HTML).
function wfHighlight(text, matches) {
  const box = el("div", { class: "tester-box" });
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) box.append(document.createTextNode(text.slice(pos, m.start)));
    box.append(el("mark", { class: "hl", title: m.terms.join(", ") }, text.slice(m.start, m.end)));
    pos = m.end;
  }
  if (pos < text.length) box.append(document.createTextNode(text.slice(pos)));
  return box;
}

/** Testeur en direct : analyse avec la configuration en cours d'édition. */
function wfTester(cfg) {
  const state = { key: "", result: null, loading: false, error: null };
  const ta = el("textarea", { class: "textarea", rows: "4", placeholder: "Écris un message pour voir ce que le filtre en ferait.", "aria-label": "Message à tester", maxlength: "2000" });
  const examples = el("div", { class: "vars" });
  const out = el("div", { class: "stack", style: "gap:12px", "aria-live": "polite" });

  const payload = () => ({ text: ta.value, words: cfg.words, allowed: cfg.allowed, evasion: cfg.evasion, ignoreLinks: cfg.ignoreLinks });

  async function analyse() {
    const p = payload();
    const key = JSON.stringify(p);
    if (key === state.key) return;
    state.key = key;
    if (!p.text.trim() || !(cfg.words || []).length) {
      state.result = null;
      state.error = null;
      draw();
      return;
    }
    state.loading = true;
    draw();
    try {
      const r = await api("/api/wordfilter/check", "POST", p);
      if (key !== state.key) return; // une saisie plus récente est en cours
      state.result = { text: p.text, ...r };
      state.error = null;
    } catch (e) {
      if (key !== state.key) return;
      state.error = e.message;
    }
    state.loading = false;
    draw();
  }
  const run = debounce(analyse, 250);
  ta.addEventListener("input", run);

  function drawExamples() {
    clearNode(examples);
    const list = wfExamples(cfg.words);
    if (!list.length) return;
    examples.append(el("span", { class: "vars-label" }, "Essayer"));
    for (const ex of list) {
      const b = el("button", { type: "button", class: "var-chip" }, ex);
      b.addEventListener("click", () => {
        ta.value = `Tu es un ${ex}`;
        analyse();
      });
      examples.append(b);
    }
  }

  function draw() {
    clearNode(out);
    if (!ta.value.trim()) {
      out.append(el("p", { class: "field-help" }, "Le verdict s'affiche pendant que tu écris. Le testeur utilise les réglages en cours, même non enregistrés."));
      return;
    }
    if (!(cfg.words || []).length) {
      out.append(callout("info", "Ajoute au moins un terme interdit pour tester."));
      return;
    }
    if (state.error) {
      out.append(inlineError("Analyse impossible : " + state.error, () => { state.key = ""; analyse(); }));
      return;
    }
    const r = state.result;
    if (!r) {
      out.append(skelLines(2));
      return;
    }
    if (!r.matches.length) {
      out.append(statusDot("ok", "Aucun terme détecté : le message passe.", { strong: true }));
      return;
    }
    // appendKids (et non append) : ignore les éléments absents au lieu d'écrire « null ».
    appendKids(out, [
      statusDot("warn", WF_VERDICT[cfg.action] || WF_VERDICT.delete, { strong: true }),
      el("div", {}, el("div", { class: "tester-caption" }, "Passages détectés"), wfHighlight(r.text, r.matches)),
      el("div", { class: "row", style: "gap:6px" }, el("span", { class: "text-sm text-2" }, "Déclenché par"), r.terms.map(termBadge)),
      cfg.action === "mask" ? el("div", {}, el("div", { class: "tester-caption" }, "Republié ainsi"), el("div", { class: "tester-box" }, r.masked)) : null,
    ]);
  }

  watch(out, () => {
    drawExamples();
    run();
  });
  draw();

  return el(
    "div",
    { class: "split-aside" },
    el("div", { class: "aside-label" }, el("span", {}, "Tester un message"), el("span", { class: "text-3" }, "Rien n'est envoyé")),
    el("div", { class: "stack", style: "gap:10px" }, ta, examples, out),
  );
}

// ═══════════════════ Page ═══════════════════
function renderWordFilter(ctx) {
  const form = configForm("wordfilter");
  const c = form.data;
  ctx.root.append(
    pageHeader({
      title: "Filtre de mots",
      description: "Supprime ou masque automatiquement les messages qui contiennent un terme interdit.",
      hasTabs: false,
      actions: [moduleSwitch("wordfilter", "Filtre de mots")],
    }),
  );

  const status = { data: null, error: null };
  const statusHost = el("div", { class: "page-status" });
  const noticeHost = el("div", { class: "stack", style: "gap:8px" });
  ctx.root.append(statusHost);

  function drawStatus() {
    clearNode(statusHost);
    if (status.error) {
      statusHost.append(inlineError("Statistiques indisponibles : " + status.error, () => loadStatus()));
    } else {
      const s = status.data;
      const skel = () => el("span", { class: "skel skel-line", style: "width:60%" });
      const termsValue = el("span", { class: "status status-strong num" });
      watch(termsValue, () => {
        termsValue.textContent = plural((c.words || []).length, "terme", "termes");
      });
      statusHost.append(
        infoStrip(
          [
            { label: "Filtrés · 24 h", value: s ? el("span", { class: "status status-strong num" }, fmtNum(s.last24h)) : skel(), meta: s ? `${plural(s.last7d, "message", "messages")} sur 7 jours` : null },
            { label: "Dernier message filtré", value: s ? (s.lastTs ? el("span", { class: "status status-strong" }, timeAgo(s.lastTs)) : "Aucun") : skel(), meta: s ? `${plural(s.total, "message", "messages")} depuis la mise en place` : null },
            { label: "Termes surveillés", value: termsValue, meta: `${plural((c.allowed || []).length, "terme autorisé", "termes autorisés")}` },
          ],
          { label: "État du filtre" },
        ),
      );
    }
    statusHost.append(noticeHost);
  }

  // Alertes recalculées à chaque modification : l'effet d'un réglage se voit tout de suite.
  watch(noticeHost, () => {
    clearNode(noticeHost);
    const enabled = !!(CONFIG.wordfilter && CONFIG.wordfilter.enabled);
    const p = status.data && status.data.permissions;
    if (enabled && !(c.words || []).length) noticeHost.append(callout("warn", "Le filtre est actif mais la liste des termes interdits est vide : rien n'est filtré."));
    if (p && c.action !== "flag" && !p.manageMessages) noticeHost.append(callout("danger", "Le bot n'a pas la permission « Gérer les messages » : il ne peut supprimer aucun message.", { title: "Permission manquante" }));
    if (p && c.action === "mask" && !p.manageWebhooks) noticeHost.append(callout("warn", "Sans la permission « Gérer les webhooks », les messages sont supprimés sans être republiés masqués."));
    if (p && c.action !== "flag" && c.timeoutEnabled && !p.moderateMembers) noticeHost.append(callout("warn", "Sans la permission « Exclure temporairement des membres », les récidivistes ne sont pas exclus."));
  });

  async function loadStatus() {
    try {
      status.data = await api("/api/wordfilter/status");
      status.error = null;
    } catch (e) {
      status.error = e.message;
    }
    if (!ctx.alive()) return;
    drawStatus();
    touch();
    if (tabs && tabs.active === "history") tabs.redraw();
  }

  drawStatus();
  let tabs = null;
  tabs = pageTabs(ctx, (tab, host) => {
    if (tab === "sanctions") wfSanctionsTab(host, c);
    else if (tab === "exceptions") wfExceptionsTab(host, c);
    else if (tab === "history") wfHistoryTab(host, status, loadStatus);
    else wfTermsTab(host, c, status);
  });
  loadStatus();
}

function wfTermsTab(host, c, status) {
  const presets = () => status.data && status.data.starterTerms;
  host.append(
    splitLayout(
      groups(
        settingsGroup(
          "Termes interdits",
          "Majuscules et accents sont ignorés : « enculé » couvre aussi « ENCULE ».",
          field("Termes", termListEditor(c, "words", { placeholder: "Ajouter un terme…", emptyText: "Aucun terme interdit pour l'instant.", presets })),
          disclosure("Syntaxe des termes", wfSyntax()),
        ),
        settingsGroup(
          "Détection",
          null,
          switchField("Détecter les contournements", c, "evasion", { help: "Chiffres ou symboles à la place des lettres (c0nn4rd), lettres répétées, espacées ou coupées par de la ponctuation, lettres d'autres alphabets." }),
          switchField("Ignorer les liens", c, "ignoreLinks", { help: "Le texte des adresses web n'est pas analysé." }),
          switchField("Vérifier aussi les messages modifiés", c, "checkEdits", { help: "Empêche d'écrire un message correct puis de le modifier." }),
        ),
      ),
      wfTester(c),
    ),
  );
}

function wfSanctionsTab(host, c) {
  const actionHelp = el("p", { class: "field-help" });
  watch(actionHelp, () => {
    actionHelp.textContent = WF_ACTION_HELP[c.action] || "";
  });
  const summary = el("p", { class: "field-help" });
  watch(summary, () => {
    summary.textContent = `${plural(Number(c.timeoutAfter) || 0, "infraction", "infractions")} en moins de ${fmtDuration((Number(c.timeoutWindowMin) || 0) * 60000)} : exclusion de ${fmtDuration((Number(c.timeoutMinutes) || 0) * 60000)}.`;
  });
  const removes = () => c.action !== "flag";
  // Aide propre à l'action choisie, placée sous le contrôle (et annoncée avec lui).
  const actionField = field("Que faire du message", bindSegmented(c, "action", WF_ACTIONS));
  actionHelp.id = uid("help");
  actionField.querySelector('[role="radiogroup"]').setAttribute("aria-describedby", actionHelp.id);
  actionField.append(actionHelp);
  host.append(
    groups(
      settingsGroup(
        "Réaction du bot",
        "Ce que fait le bot quand un message contient un terme interdit.",
        actionField,
        showWhen(callout("info", "Au-delà de 8 Mo de pièces jointes, le message est simplement supprimé. La republication ne conserve ni la réponse à un autre message ni les réactions."), () => c.action === "mask"),
      ),
      showWhen(
        settingsGroup(
          "Avertissement",
          "Message adressé à l'auteur quand son message est retiré.",
          field(
            "Prévenir l'auteur",
            bindSegmented(c, "warnMode", [
              { value: "channel", label: "Dans le salon" },
              { value: "dm", label: "En message privé" },
              { value: "off", label: "Ne pas prévenir" },
            ]),
          ),
          showWhen(field("Message", textArea(c, "warnMessage", { rows: 2, maxLength: 500 })), () => c.warnMode !== "off"),
          showWhen(varsHint(WF_WARN_VARS), () => c.warnMode !== "off"),
          showWhen(field("Effacer l'avertissement après", numberInput(c, "warnDeleteSec", { min: 0, max: 120, suffix: "s" }), { help: "0 : l'avertissement reste affiché." }), () => c.warnMode === "channel"),
        ),
        removes,
      ),
      showWhen(
        settingsGroup(
          "Exclusion temporaire",
          "Pour les récidives rapprochées. Nécessite la permission « Exclure temporairement des membres ».",
          switchField("Exclure en cas de récidive", c, "timeoutEnabled"),
          showWhen(
            el(
              "div",
              { class: "stack" },
              fieldRow(
                field("Après", numberInput(c, "timeoutAfter", { min: 1, max: 20, suffix: "infractions", size: "md" })),
                field("En moins de", numberInput(c, "timeoutWindowMin", { min: 1, max: 1440, suffix: "min", size: "md" })),
                field("Durée", numberInput(c, "timeoutMinutes", { min: 1, max: 40320, suffix: "min", size: "md" })),
              ),
              summary,
            ),
            () => !!c.timeoutEnabled,
          ),
        ),
        removes,
      ),
      settingsGroup(
        "Journal de modération",
        "Chaque message filtré y est consigné avec son auteur, les termes détectés et le texte d'origine sous balise spoiler.",
        field("Salon", channelPicker(c, "logChannelId", "text"), { help: "Vide : aucun journal sur Discord. L'historique reste consultable ici." }),
      ),
    ),
  );
}

function wfExceptionsTab(host, c) {
  host.append(
    groups(
      settingsGroup(
        "Termes autorisés",
        "Jamais filtrés, même s'ils correspondent à un terme interdit. Exemple : « concombre » si « con* » est interdit.",
        field("Termes autorisés", termListEditor(c, "allowed", { placeholder: "Ajouter un terme autorisé…", emptyText: "Aucun terme autorisé.", max: 500 })),
      ),
      settingsGroup(
        "Membres",
        null,
        switchField("Ignorer le staff", c, "ignoreStaff", { help: "Les membres ayant la permission « Gérer les messages » ne sont jamais filtrés." }),
        field("Rôles exemptés", multiRolePicker(c, "exemptRoleIds"), { optional: true }),
      ),
      settingsGroup(
        "Salons",
        "Un salon ou une catégorie exemptés ne sont jamais filtrés, fils compris.",
        field(
          "Salons et catégories exemptés",
          multiPicker({
            obj: c,
            key: "exemptChannelIds",
            options: [...channelOptions("textvoice"), ...channelOptions("category")],
            addLabel: "Ajouter un salon",
            emptyText: "Aucun salon exempté.",
            missingLabel: "Salon introuvable",
            searchPlaceholder: "Rechercher un salon ou une catégorie",
          }),
          { optional: true },
        ),
      ),
    ),
  );
}

function wfHistoryTab(host, status, reload) {
  if (status.error) {
    host.append(panel(inlineError("Historique indisponible : " + status.error, () => reload())));
    return;
  }
  const s = status.data;
  if (!s) {
    host.append(panel(skelLines(5)));
    return;
  }
  const clear = menuButton([
    {
      label: "Effacer l'historique",
      icon: "trash",
      danger: true,
      disabled: !s.recent.length,
      onSelect: async () => {
        const ok = await confirmDialog({
          title: "Effacer l'historique ?",
          message: "La liste des messages filtrés et le compteur de récidives de chaque membre sont remis à zéro. Le journal de modération sur Discord n'est pas touché.",
          confirmLabel: "Effacer",
          danger: true,
        });
        if (!ok) return;
        await api("/api/wordfilter/clear-history", "POST", {});
        toast("Historique effacé", "ok");
        reload();
      },
    },
  ]);
  host.append(
    toolbar(s.total ? `${plural(s.total, "message filtré", "messages filtrés")} depuis la mise en place. Les 100 plus récents sont listés.` : "", [
      iconButton("refresh", "Actualiser", () => reload(), { size: "sm" }),
      clear,
    ]),
    dataTable({
      label: "Messages filtrés",
      rows: s.recent,
      searchable: s.recent.length > 8,
      searchPlaceholder: "Rechercher un membre ou un terme",
      searchText: (r) => `${r.userName} ${r.terms.join(" ")} ${channelName(r.channelId, "")} ${r.excerpt}`,
      initialSort: { key: "ts", dir: "desc" },
      pageSize: 25,
      empty: emptyState({ icon: "message-x", title: "Aucun message filtré", text: "Les messages retirés ou signalés par le filtre apparaîtront ici.", compact: true }),
      columns: [
        { key: "ts", label: "Date", sortable: true, meta: true, width: "140px", render: (r) => timeAgo(r.ts) },
        { key: "userName", label: "Membre", primary: true, sortable: true, render: (r) => cellTitle(r.userName, channelName(r.channelId)) },
        { key: "terms", label: "Termes", meta: true, render: (r) => el("span", { class: "row", style: "gap:4px" }, r.terms.map(termBadge)) },
        {
          key: "action",
          label: "Action",
          meta: true,
          sortable: true,
          render: (r) => {
            const [kind, label] = WF_RESULT[r.action] || ["neutral", r.action];
            const extra = [r.action === "failed" ? "permission manquante" : null, r.edited ? "après modification" : null, r.timeout ? "membre exclu" : null].filter(Boolean).join(", ");
            return el("span", {}, statusDot(kind, label), extra ? el("span", { class: "cell-sub" }, extra) : null);
          },
        },
        { key: "excerpt", label: "Extrait", hideSm: true, render: (r) => el("span", { class: "text-2 truncate", style: "display:block;max-width:320px", title: r.excerpt }, r.excerpt) },
      ],
    }),
  );
}
