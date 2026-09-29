/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · formulaires
   Gestion des brouillons (détection de modifications, barre d'enregistrement),
   champs, sélecteurs de salons / rôles, éditeurs de listes, actions communes
   (interrupteur de module, test, publication).
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js).

   Principe : chaque page crée ses formulaires via createForm / configForm.
   Un formulaire garde une copie de référence (base) ; il est « modifié »
   quand ses données diffèrent réellement de cette base. À l'enregistrement,
   seules les clés modifiées sont envoyées (les setters du bot fusionnent un
   patch partiel), ce qui évite d'écraser un état modifié entre-temps côté bot.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

// ═══════════════════ 1. Brouillons ═══════════════════
let FORMS = [];
let WATCHERS = [];
let CHANGE_RAF = 0;

function createForm({ initial = {}, save = null, register = true, section = null, normalize = null } = {}) {
  const data = structuredClone(initial || {});
  if (normalize) normalize(data);
  const form = { data, section, save, base: "", baseObj: null };
  markSaved(form);
  if (register) FORMS.push(form);
  return form;
}

// Formulaire lié à une section de /api/config.
function configForm(section, { normalize } = {}) {
  return createForm({
    initial: CONFIG[section] || {},
    section,
    normalize,
    save: async (data, form) => {
      const patch = diffPatch(form.baseObj, data);
      if (!Object.keys(patch).length) return;
      CONFIG[section] = await api(`/api/config/${section}`, "PUT", patch);
    },
  });
}

function diffPatch(baseObj, data) {
  const patch = {};
  for (const k of Object.keys(data)) {
    if (JSON.stringify(data[k]) !== JSON.stringify(baseObj ? baseObj[k] : undefined)) patch[k] = data[k];
  }
  return patch;
}

function markSaved(form) {
  form.base = JSON.stringify(form.data);
  form.baseObj = JSON.parse(form.base);
}

function formDirty(form) {
  return JSON.stringify(form.data) !== form.base;
}

// Formulaires enregistrables qui ont des modifications.
function pendingForms() {
  return FORMS.filter((f) => f.save && formDirty(f));
}

// Tout brouillon de la page (y compris ceux sans enregistrement, ex. annonce).
function hasUnsavedChanges() {
  return FORMS.some(formDirty);
}

// À appeler après toute modification programmatique (les saisies le font seules).
function touch() {
  if (CHANGE_RAF) return;
  CHANGE_RAF = requestAnimationFrame(() => {
    CHANGE_RAF = 0;
    afterChange();
  });
}

function afterChange() {
  WATCHERS = WATCHERS.filter((w) => {
    w.ticks += 1;
    if (!w.node.isConnected && w.ticks > 1) return false;
    try {
      w.fn();
    } catch {
      /* un observateur défaillant ne bloque pas les autres */
    }
    return true;
  });
  updateSaveBar();
}

// Recalcule `fn` à chaque modification tant que `node` est dans la page.
function watch(node, fn) {
  WATCHERS.push({ node, fn, ticks: 0 });
  fn();
  return node;
}

function showWhen(node, predicate) {
  return watch(node, () => {
    node.hidden = !predicate();
  });
}

function updateSaveBar() {
  const bar = document.getElementById("savebar");
  if (!bar) return;
  const show = pendingForms().length > 0;
  if (bar.hidden === !show) return;
  bar.hidden = !show;
  document.body.classList.toggle("has-savebar", show);
}

async function saveAllForms({ rerender = true, quiet = false } = {}) {
  const list = pendingForms();
  for (const f of list) {
    await f.save(f.data, f);
    markSaved(f);
  }
  if (!quiet && list.length) toast("Modifications enregistrées", "ok");
  if (rerender && list.length) rerenderPage();
  else touch();
  return list.length;
}

// ═══════════════════ 2. Mise en page des champs ═══════════════════

/**
 * Champ : libellé au-dessus, contrôle, aide en dessous.
 * Le libellé est relié au contrôle (for / aria-labelledby pour les groupes).
 */
function field(label, control, { help, optional, className } = {}) {
  const labelId = uid("lbl");
  const isGroup = control.getAttribute && (control.hasAttribute("data-group") || control.getAttribute("role") === "radiogroup");
  let target = null;
  if (!isGroup) {
    const selector = "[data-label-target], input:not([type=file]):not([type=color]), select, textarea, button";
    target = control.matches && control.matches(selector) ? control : control.querySelector && control.querySelector(selector);
    if (target && !target.id) target.id = uid("f");
  }
  const helpEl = help ? el("p", { class: "field-help", id: uid("help") }, help) : null;
  const describe = (n) => n && helpEl && n.setAttribute("aria-describedby", [n.getAttribute("aria-describedby"), helpEl.id].filter(Boolean).join(" "));
  if (isGroup) {
    control.setAttribute("aria-labelledby", labelId);
    describe(control);
  } else describe(target);
  return el(
    "div",
    { class: "field" + (className ? " " + className : "") },
    el(isGroup ? "span" : "label", { class: "field-label", id: labelId, for: !isGroup && target ? target.id : null }, label, optional ? el("span", { class: "field-opt" }, "Optionnel") : null),
    control,
    helpEl,
  );
}

function fieldRow(...fields) {
  return el("div", { class: "field-row" }, ...fields);
}

// Ligne interrupteur : libellé et aide à gauche, interrupteur à droite.
function switchField(label, obj, key, { help, onChange, disabled } = {}) {
  const id = uid("sw");
  const helpId = help ? uid("help") : null;
  const sw = switchControl({
    checked: !!obj[key],
    id,
    disabled,
    onChange: (v) => {
      obj[key] = v;
      touch();
      if (onChange) onChange(v);
    },
  });
  if (helpId) sw.setAttribute("aria-describedby", helpId);
  return el(
    "div",
    { class: "switch-row" },
    el("div", { class: "switch-row-text" }, el("label", { class: "field-label", for: id }, label), help ? el("p", { class: "field-help", id: helpId }, help) : null),
    sw,
  );
}

// Groupe de réglages (deux colonnes : intitulé / champs).
function settingsGroup(title, description, ...children) {
  return el(
    "section",
    { class: "group" },
    el("div", { class: "group-head" }, el("h3", { class: "group-title" }, title), description ? el("p", { class: "group-desc" }, description) : null),
    el("div", { class: "group-body" }, ...children),
  );
}

function groups(...items) {
  return el("div", { class: "groups" }, ...items);
}

// Section repliable native (<details>) pour les options rarement utilisées.
function disclosure(summary, ...children) {
  return el("details", { class: "disclosure" }, el("summary", {}, icon("chevron-right", 14), summary), el("div", { class: "disclosure-body" }, ...children));
}

function setFieldError(input, message) {
  const f = input.closest(".field");
  if (!f) return;
  let err = f.querySelector(".field-error");
  if (!message) {
    input.removeAttribute("aria-invalid");
    if (err) err.remove();
    return;
  }
  input.setAttribute("aria-invalid", "true");
  if (!err) {
    err = el("p", { class: "field-error", id: uid("err") });
    f.append(err);
    input.setAttribute("aria-errormessage", err.id);
  }
  clearNode(err).append(icon("alert-circle", 14), el("span", {}, message));
}

// ═══════════════════ 3. Variables insérables ═══════════════════
let LAST_TEXT = null;

function trackTextFields() {
  document.addEventListener("focusin", (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[type="text"], input:not([type]), textarea')) LAST_TEXT = t;
  });
}

function insertToken(token) {
  const t = LAST_TEXT;
  if (!t || !document.contains(t) || t.disabled) {
    toast("Place d'abord le curseur dans un champ de texte.", "info");
    return;
  }
  const start = t.selectionStart ?? t.value.length;
  const end = t.selectionEnd ?? t.value.length;
  t.value = t.value.slice(0, start) + token + t.value.slice(end);
  t.focus();
  t.setSelectionRange(start + token.length, start + token.length);
  t.dispatchEvent(new Event("input", { bubbles: true }));
}

// vars : [["{user}", "Mention du membre"], …]
function varsHint(vars) {
  return el(
    "div",
    { class: "vars" },
    el("span", { class: "vars-label" }, "Variables"),
    vars.map(([token, desc]) => {
      const b = el("button", { type: "button", class: "var-chip", "data-tip": `${desc} · cliquer pour insérer` }, token);
      b.addEventListener("mousedown", (e) => e.preventDefault()); // garde le curseur dans le champ
      b.addEventListener("click", () => insertToken(token));
      return b;
    }),
  );
}

// ═══════════════════ 4. Contrôles liés à un objet ═══════════════════
function textInput(obj, key, { placeholder = "", maxLength, type = "text", size, mono = false, trim = false } = {}) {
  const i = el("input", {
    class: ["input", size && "w-" + size, mono && "mono"].filter(Boolean).join(" "),
    type,
    placeholder,
    maxlength: maxLength ? String(maxLength) : null,
    autocomplete: "off",
    spellcheck: mono || type !== "text" ? "false" : null,
  });
  i.value = obj[key] ?? "";
  i.addEventListener("input", () => {
    obj[key] = trim ? i.value.trim() : i.value;
  });
  return i;
}

// URL http(s) facultative, vérifiée en sortie de champ.
function urlInput(obj, key, { placeholder = "https://…" } = {}) {
  const i = textInput(obj, key, { placeholder, type: "url", trim: true });
  i.addEventListener("blur", () => {
    const v = i.value.trim();
    setFieldError(i, v && !/^https?:\/\/\S+$/i.test(v) ? "Adresse invalide : elle doit commencer par https://" : null);
  });
  return i;
}

function numberInput(obj, key, { min, max, step, suffix, size = "sm" } = {}) {
  const i = el("input", {
    class: "input num" + (suffix ? "" : " w-" + size),
    type: "number",
    min: min !== undefined ? String(min) : null,
    max: max !== undefined ? String(max) : null,
    step: step !== undefined ? String(step) : null,
    inputmode: step && step < 1 ? "decimal" : "numeric",
  });
  i.value = obj[key] ?? "";
  const commit = () => {
    if (i.value === "") return;
    let n = Number(i.value);
    if (!Number.isFinite(n)) return;
    if (min !== undefined && n < min) n = min;
    if (max !== undefined && n > max) n = max;
    obj[key] = n;
  };
  i.addEventListener("input", commit);
  i.addEventListener("change", () => {
    commit();
    i.value = obj[key] ?? "";
  });
  if (!suffix) return i;
  return el("div", { class: "input-affix w-" + size }, i, el("span", { class: "affix", "aria-hidden": "true" }, suffix));
}

function textArea(obj, key, { placeholder = "", rows = 4, maxLength, mono = false } = {}) {
  const t = el("textarea", { class: "textarea" + (mono ? " mono" : ""), rows: String(rows), placeholder, spellcheck: mono ? "false" : null });
  t.value = obj[key] ?? "";
  t.addEventListener("input", () => {
    obj[key] = t.value;
  });
  if (!maxLength) return t;
  const counter = el("span", { class: "counter", "aria-live": "polite" });
  const sync = () => {
    const n = t.value.length;
    counter.textContent = `${fmtNum(n)} / ${fmtNum(maxLength)}`;
    counter.classList.toggle("over", n > maxLength);
  };
  t.addEventListener("input", sync);
  sync();
  return el("div", { class: "textarea-wrap" }, t, counter);
}

// Liste native (peu d'options fixes). Les valeurs gardent leur type d'origine.
function selectInput(obj, key, options, { allowNone = false, noneLabel = "Aucun", size } = {}) {
  const s = el("select", { class: "select" + (size ? " w-" + size : "") });
  if (allowNone) s.append(el("option", { value: "" }, noneLabel));
  for (const o of options) {
    const opt = el("option", { value: String(o.value) }, o.label);
    if (String(obj[key] ?? "") === String(o.value)) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener("change", () => {
    const o = options.find((x) => String(x.value) === s.value);
    obj[key] = o ? o.value : "";
  });
  return s;
}

function bindSegmented(obj, key, options, { onChange } = {}) {
  return segmented(options, obj[key], (v) => {
    obj[key] = v;
    touch();
    if (onChange) onChange(v);
  });
}

function toHex(v, fallback) {
  if (typeof v === "number" && Number.isFinite(v)) return "#" + v.toString(16).padStart(6, "0");
  if (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim())) return "#" + v.trim().replace("#", "").toLowerCase();
  return fallback;
}

function colorInput(obj, key, { fallback = "#5865f2" } = {}) {
  const current = toHex(obj[key], fallback);
  const sw = el("input", { type: "color", class: "color-swatch", "aria-label": "Nuancier" });
  sw.value = current;
  const tx = el("input", { type: "text", class: "input mono w-sm", maxlength: "7", spellcheck: "false", autocomplete: "off", placeholder: fallback, "data-label-target": "" });
  tx.value = obj[key] ? current : "";
  sw.addEventListener("input", () => {
    obj[key] = sw.value;
    tx.value = sw.value;
    setFieldError(tx, null);
  });
  tx.addEventListener("input", () => {
    const h = toHex(tx.value, null);
    if (h) {
      obj[key] = h;
      sw.value = h;
      setFieldError(tx, null);
    }
  });
  tx.addEventListener("blur", () => {
    setFieldError(tx, tx.value.trim() && !toHex(tx.value, null) ? "Couleur attendue au format #RRGGBB." : null);
  });
  return el("div", { class: "color-field" }, sw, tx);
}

function tierOptions() {
  return (GUILD.tiers || []).map((t) => ({ value: t, label: t }));
}

// ═══════════════════ 5. Sélecteurs de salons et de rôles ═══════════════════
const CHANNEL_ICON = { text: "hash", announcement: "megaphone", voice: "volume", category: "folder", thread: "thread" };

/**
 * Options des sélecteurs de salons. Les fils sont proposés partout où un salon textuel
 * l'est (le bot y écrit comme dans un salon), rangés juste sous leur salon parent.
 */
function channelOptions(kind = "text") {
  const c = GUILD.channels || {};
  const map = (list, type) => (list || []).map((x) => ({ value: x.id, label: x.name, icon: CHANNEL_ICON[type] }));
  if (kind === "voice") return map(c.voice, "voice");
  if (kind === "category") return map(c.category, "category");
  const threads = (c.thread || []).map((t) => ({ value: t.id, label: threadLabel(t), icon: "thread", parentId: t.parentId }));
  const placed = new Set();
  const text = [];
  for (const o of [...map(c.text, "text"), ...map(c.announcement, "announcement")]) {
    text.push(o);
    for (const t of threads) {
      if (t.parentId === o.value) {
        text.push(t);
        placed.add(t.value);
      }
    }
  }
  // Fils dont le parent n'est pas listé (forum, salon masqué au bot…) : en fin de liste.
  for (const t of threads) if (!placed.has(t.value)) text.push(t);
  return kind === "textvoice" ? [...text, ...map(c.voice, "voice")] : text;
}

function roleOptions() {
  return (GUILD.roles || []).filter((r) => r.name !== "@everyone").map((r) => ({ value: r.id, label: r.name, color: roleColor(r) || "" }));
}

function optionLead(o) {
  if (o.color !== undefined) return el("span", { class: "role-dot", style: o.color ? `background:${o.color}` : null, "aria-hidden": "true" });
  const i = icon(o.icon || "hash", 14);
  i.classList.add("lead-icon");
  return i;
}

/**
 * Liste de choix avec recherche (ARIA combobox + listbox), ancrée à `anchor`.
 * Clavier : flèches, Début/Fin, Entrée, Échap.
 */
function openListbox(anchor, { options, value = null, allowNone = false, noneLabel = "Aucun", onSelect, searchPlaceholder = "Rechercher…" } = {}) {
  const listId = uid("lb");
  const input = el("input", {
    class: "lb-search",
    type: "text",
    placeholder: searchPlaceholder,
    "aria-label": searchPlaceholder,
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": listId,
    "aria-autocomplete": "list",
    autocomplete: "off",
    spellcheck: "false",
  });
  const list = el("ul", { class: "lb-list", role: "listbox", id: listId });
  const all = allowNone ? [{ value: "", label: noneLabel, none: true }, ...options] : options;
  const LIMIT = 150;
  let shown = [];
  let active = 0;

  const setActive = (i) => {
    const items = $$(".lb-opt", list);
    if (!items.length) return;
    active = clamp(i, 0, items.length - 1);
    items.forEach((n, idx) => n.classList.toggle("active", idx === active));
    input.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  };
  const choose = (o) => {
    closePopover();
    anchor.focus({ preventScroll: true });
    onSelect(o.value);
  };
  const draw = () => {
    const q = normText(input.value.trim());
    shown = q ? all.filter((o) => !o.none && normText(o.label).includes(q)) : all;
    clearNode(list);
    input.removeAttribute("aria-activedescendant");
    if (!shown.length) {
      list.append(el("li", { class: "lb-empty", role: "presentation" }, options.length ? "Aucun résultat" : "Aucun élément disponible"));
      return;
    }
    shown.slice(0, LIMIT).forEach((o, idx) => {
      const selected = value !== null && String(o.value) === String(value ?? "");
      const li = el("li", { role: "option", id: `${listId}-${idx}`, class: "lb-opt" + (o.none ? " lb-none" : ""), "aria-selected": String(selected) });
      if (!o.none) li.append(optionLead(o));
      li.append(el("span", { class: "lb-label" }, o.label));
      if (selected) {
        const c = icon("check", 14);
        c.classList.add("lb-check");
        li.append(c);
      }
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("pointermove", () => {
        if (active !== idx) setActive(idx);
      });
      li.addEventListener("click", () => choose(o));
      list.append(li);
    });
    if (shown.length > LIMIT) list.append(el("li", { class: "lb-more", role: "presentation" }, `${fmtNum(shown.length - LIMIT)} autres : affine ta recherche.`));
    const sel = shown.findIndex((o) => value !== null && String(o.value) === String(value ?? ""));
    setActive(q || sel < 0 ? 0 : sel);
  };
  input.addEventListener("input", draw);
  input.addEventListener("keydown", (e) => {
    const n = Math.min(shown.length, LIMIT);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((active + 1) % Math.max(1, n));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((active - 1 + n) % Math.max(1, n));
    } else if (e.key === "Home" && e.ctrlKey) setActive(0);
    else if (e.key === "End" && e.ctrlKey) setActive(n - 1);
    else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (e.key === "Tab") closePopover();
  });

  const content = document.createDocumentFragment();
  content.append(input, list);
  openPopover(anchor, content, { matchWidth: true, className: "popover-listbox" });
  draw();
  input.focus();
}

// Liste déroulante avec recherche (salons, rôles).
function combobox({ options, value, onChange, allowNone = true, noneLabel = "Aucun", placeholder = "Choisir…", searchPlaceholder, missingLabel = "Élément introuvable" } = {}) {
  let current = value ?? "";
  const btn = el("button", { type: "button", class: "cbx", "aria-haspopup": "listbox", "aria-expanded": "false" });
  const render = () => {
    clearNode(btn);
    const opt = options.find((o) => String(o.value) === String(current));
    if (opt) btn.append(optionLead(opt), el("span", { class: "cbx-value" }, opt.label));
    else if (current) {
      const w = icon("alert-triangle", 14);
      w.classList.add("lead-warn");
      btn.append(w, el("span", { class: "cbx-value cbx-missing" }, missingLabel));
      btn.title = `Identifiant enregistré : ${current}`;
    } else btn.append(el("span", { class: "cbx-value cbx-placeholder" }, allowNone ? noneLabel : placeholder));
    const chev = icon("chevrons-up-down", 14);
    chev.classList.add("cbx-chev");
    btn.append(chev);
  };
  btn.addEventListener("click", () => {
    if (isPopoverFor(btn)) return closePopover();
    openListbox(btn, {
      options,
      value: current,
      allowNone,
      noneLabel,
      searchPlaceholder,
      onSelect: (v) => {
        current = v;
        btn.removeAttribute("title");
        render();
        onChange(v);
        touch();
      },
    });
  });
  btn.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !isPopoverFor(btn)) {
      e.preventDefault();
      btn.click();
    }
  });
  render();
  btn.setValue = (v) => {
    current = v ?? "";
    render();
  };
  return btn;
}

function channelPicker(obj, key, kind = "text", { allowNone = true, noneLabel } = {}) {
  const isCat = kind === "category";
  return combobox({
    options: channelOptions(kind),
    value: obj[key],
    allowNone,
    noneLabel: noneLabel || (isCat ? "Aucune catégorie" : "Aucun salon"),
    placeholder: isCat ? "Choisir une catégorie" : "Choisir un salon",
    searchPlaceholder: isCat ? "Rechercher une catégorie" : "Rechercher un salon",
    missingLabel: isCat ? "Catégorie introuvable" : "Salon introuvable",
    onChange: (v) => {
      obj[key] = v;
    },
  });
}

function rolePicker(obj, key, { allowNone = true, noneLabel = "Aucun rôle" } = {}) {
  return combobox({
    options: roleOptions(),
    value: obj[key],
    allowNone,
    noneLabel,
    placeholder: "Choisir un rôle",
    searchPlaceholder: "Rechercher un rôle",
    missingLabel: "Rôle introuvable",
    onChange: (v) => {
      obj[key] = v;
    },
  });
}

// Sélection multiple : puces retirables + bouton d'ajout.
function multiPicker({ obj, key, options, addLabel = "Ajouter", emptyText = "Aucun élément.", missingLabel = "Introuvable", searchPlaceholder }) {
  const get = () => (Array.isArray(obj[key]) ? obj[key] : []);
  const chips = el("div", { class: "chips", role: "list" });
  const add = button(addLabel, { size: "sm", icon: "plus" });
  add.setAttribute("aria-haspopup", "listbox");
  add.setAttribute("aria-expanded", "false");
  add.addEventListener("click", () => {
    if (isPopoverFor(add)) return closePopover();
    openListbox(add, {
      options: options.filter((o) => !get().includes(o.value)),
      searchPlaceholder,
      onSelect: (v) => {
        obj[key] = [...get(), v];
        draw();
        touch();
      },
    });
  });
  function draw() {
    clearNode(chips);
    const vals = get();
    if (!vals.length) chips.append(el("span", { class: "text-sm text-2", role: "listitem" }, emptyText));
    for (const v of vals) {
      const o = options.find((x) => x.value === v);
      const name = o ? o.label : missingLabel;
      chips.append(
        el(
          "span",
          { class: "chip" + (o ? "" : " missing"), role: "listitem", title: o ? null : `Identifiant : ${v}` },
          o ? optionLead(o) : icon("alert-triangle", 14),
          el("span", { class: "chip-label" }, name),
          iconButton("x", `Retirer ${name}`, () => {
            obj[key] = get().filter((x) => x !== v);
            draw();
            touch();
            add.focus();
          }, { size: "sm" }),
        ),
      );
    }
  }
  draw();
  return el("div", { class: "stack", style: "gap:8px", "data-group": "", role: "group" }, chips, el("div", {}, add));
}

function multiChannelPicker(obj, key, kind = "text") {
  return multiPicker({ obj, key, options: channelOptions(kind), addLabel: "Ajouter un salon", emptyText: "Aucun salon sélectionné.", missingLabel: "Salon introuvable", searchPlaceholder: "Rechercher un salon" });
}

function multiRolePicker(obj, key) {
  return multiPicker({ obj, key, options: roleOptions(), addLabel: "Ajouter un rôle", emptyText: "Aucun rôle sélectionné.", missingLabel: "Rôle introuvable", searchPlaceholder: "Rechercher un rôle" });
}

// ═══════════════════ 6. Actions communes ═══════════════════

/** Interrupteur d'activation d'un module, appliqué immédiatement. */
function moduleSwitch(section, name) {
  const on = !!(CONFIG[section] && CONFIG[section].enabled);
  const text = el("span", { class: "ms-label", "aria-hidden": "true" }, on ? "Actif" : "Inactif");
  const wrap = el("div", { class: "module-switch" + (on ? " on" : "") });
  const sw = switchControl({
    checked: on,
    label: `Module ${name}`,
    onChange: async (v) => {
      const updated = await api(`/api/config/${section}`, "PUT", { enabled: v });
      CONFIG[section] = updated;
      const value = !!updated.enabled;
      for (const f of FORMS) {
        if (f.section !== section) continue;
        f.data.enabled = value;
        f.baseObj.enabled = value;
        f.base = JSON.stringify(f.baseObj);
      }
      text.textContent = value ? "Actif" : "Inactif";
      wrap.classList.toggle("on", value);
      toast(value ? `Module « ${name} » activé` : `Module « ${name} » désactivé`, "ok");
      touch();
    },
  });
  wrap.append(text, sw);
  return wrap;
}

/** Envoi d'un test : enregistre d'abord les modifications (avec accord). */
async function sendTest(endpoint, successMessage) {
  const pending = pendingForms().length;
  if (pending) {
    const ok = await confirmDialog({
      title: "Enregistrer avant le test ?",
      message: "Le test utilise la configuration enregistrée. Tes modifications seront enregistrées avant l'envoi.",
      confirmLabel: "Enregistrer et envoyer",
    });
    if (!ok) return;
    await saveAllForms({ rerender: false, quiet: true });
  }
  await api(endpoint, "POST", {});
  toast(successMessage, "ok");
  if (pending) rerenderPage();
}

/** Publication d'un panneau dans un salon choisi (effet public : dialogue). */
function publishDialog({ title, description, initialChannel = "", channelKind = "text", confirmLabel = "Publier", onPublish }) {
  const state = { channelId: initialChannel || "" };
  const pending = pendingForms().length;
  openDialog({
    title,
    description,
    body: el(
      "div",
      { class: "stack" },
      field("Salon", channelPicker(state, "channelId", channelKind, { allowNone: false })),
      pending ? callout("info", "Tes modifications non enregistrées seront enregistrées avant la publication.") : null,
    ),
    actions: [
      { label: "Annuler" },
      {
        label: confirmLabel,
        variant: "primary",
        onClick: async () => {
          if (!state.channelId) {
            toast("Choisis un salon.", "err");
            return false;
          }
          if (pending) await saveAllForms({ rerender: false, quiet: true });
          await onPublish(state.channelId);
          toast(`Publié dans ${channelName(state.channelId)}`, "ok");
          if (pending) rerenderPage();
        },
      },
    ],
  });
}

// ═══════════════════ 7. Éditeurs de listes ═══════════════════

// Déplace l'élément i d'un tableau de `delta` positions.
function moveItem(arr, i, delta) {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return arr;
  const copy = [...arr];
  [copy[i], copy[j]] = [copy[j], copy[i]];
  return copy;
}

function rowsBox(label) {
  return el("div", { class: "rows", role: "group", "aria-label": label, "data-group": "" });
}

function reorderButtons(i, n, onMove, what) {
  return [
    iconButton("arrow-up", `Monter ${what}`, () => onMove(i, -1), { size: "sm", disabled: i === 0 }),
    iconButton("arrow-down", `Descendre ${what}`, () => onMove(i, 1), { size: "sm", disabled: i === n - 1 }),
  ];
}

/** Paliers de récompense : niveau → rôle (objet { "10": roleId }). */
function rewardsEditor(obj) {
  const box = rowsBox("Paliers de récompense");
  let rows = Object.entries(obj.rewards && typeof obj.rewards === "object" ? obj.rewards : {})
    .map(([lvl, roleId]) => ({ lvl: Number(lvl), roleId }))
    .sort((a, b) => a.lvl - b.lvl);
  const commit = () => {
    const out = {};
    for (const r of rows) if (r.lvl > 0 && r.roleId) out[String(r.lvl)] = r.roleId;
    obj.rewards = out;
    touch();
  };
  const draw = () => {
    clearNode(box);
    if (!rows.length) box.append(el("div", { class: "rows-empty" }, "Aucun palier. Ajoute un niveau pour attribuer un rôle automatiquement."));
    const counts = {};
    for (const r of rows) counts[r.lvl] = (counts[r.lvl] || 0) + 1;
    rows.forEach((r, i) => {
      const lvl = el("input", { class: "input num fixed w-xs", type: "number", min: "1", "aria-label": `Niveau du palier ${i + 1}`, placeholder: "Niv." });
      lvl.value = r.lvl || "";
      lvl.addEventListener("input", () => {
        r.lvl = Math.max(0, parseInt(lvl.value, 10) || 0);
        commit();
      });
      lvl.addEventListener("change", () => {
        rows.sort((a, b) => a.lvl - b.lvl);
        draw();
      });
      if (counts[r.lvl] > 1) lvl.setAttribute("aria-invalid", "true");
      const role = combobox({ options: roleOptions(), value: r.roleId, allowNone: false, placeholder: "Choisir un rôle", searchPlaceholder: "Rechercher un rôle", missingLabel: "Rôle introuvable", onChange: (v) => { r.roleId = v; commit(); } });
      role.setAttribute("aria-label", `Rôle du palier ${i + 1}`);
      box.append(
        el(
          "div",
          { class: "rows-item" },
          el("div", { class: "rows-item-main" }, lvl, role),
          el("div", { class: "rows-item-actions" }, iconButton("trash", "Supprimer ce palier", () => { rows.splice(i, 1); commit(); draw(); }, { size: "sm" })),
        ),
      );
    });
    if (Object.values(counts).some((n) => n > 1)) box.append(el("div", { class: "rows-empty field-error", style: "justify-content:center" }, "Deux paliers ont le même niveau : seul le dernier sera conservé."));
    box.append(
      el(
        "div",
        { class: "rows-foot" },
        button("Ajouter un palier", {
          size: "sm",
          variant: "ghost",
          icon: "plus",
          onClick: () => {
            const next = rows.reduce((m, r) => Math.max(m, r.lvl), 0) + 5;
            rows.push({ lvl: next, roleId: "" });
            draw();
            const inputs = $$('input[type="number"]', box);
            if (inputs.length) inputs[inputs.length - 1].focus();
          },
        }),
      ),
    );
  };
  draw();
  return box;
}

/** Hubs vocaux : { [salonVocalId]: { nameTemplate, userLimit } }. */
function hubsEditor(obj) {
  const box = rowsBox("Salons hubs");
  const draw = () => {
    clearNode(box);
    const hubs = obj.hubs && typeof obj.hubs === "object" ? obj.hubs : {};
    const ids = Object.keys(hubs);
    if (!ids.length) box.append(el("div", { class: "rows-empty" }, "Aucun hub. Ajoute un salon vocal : y entrer créera un salon personnel."));
    for (const id of ids) {
      const h = hubs[id];
      const c = channelById(id);
      const name = el("input", { class: "input", type: "text", "aria-label": "Nom des salons créés", placeholder: "{user}", value: null });
      name.value = h.nameTemplate || "";
      name.addEventListener("input", () => {
        h.nameTemplate = name.value;
      });
      const limit = numberInput(h, "userLimit", { min: 0, max: 99, suffix: "places" });
      limit.querySelector("input").setAttribute("aria-label", "Limite de membres (0 = illimité)");
      box.append(
        el(
          "div",
          { class: "rows-item" },
          el(
            "div",
            { class: "rows-item-main" },
            el("div", { class: "row fixed", style: "min-width:160px;height:var(--control-h)" }, icon("volume", 14), el("span", { class: "truncate" + (c ? "" : " text-3") }, c ? c.name : "Salon introuvable")),
            name,
            el("div", { class: "fixed", style: "width:150px" }, limit),
          ),
          el("div", { class: "rows-item-actions" }, iconButton("trash", "Supprimer ce hub", () => { delete hubs[id]; touch(); draw(); }, { size: "sm" })),
        ),
      );
    }
    const add = button("Ajouter un hub", { size: "sm", variant: "ghost", icon: "plus" });
    add.addEventListener("click", () => {
      if (isPopoverFor(add)) return closePopover();
      openListbox(add, {
        options: channelOptions("voice").filter((o) => !ids.includes(o.value)),
        searchPlaceholder: "Rechercher un salon vocal",
        onSelect: (v) => {
          if (!obj.hubs || typeof obj.hubs !== "object") obj.hubs = {};
          obj.hubs[v] = { nameTemplate: "{user}", userLimit: 0 };
          touch();
          draw();
        },
      });
    });
    box.append(el("div", { class: "rows-foot" }, add));
  };
  draw();
  return box;
}

/** Liste ordonnée de textes (rappels). */
function messagesEditor(obj, key, { max = 25, placeholder = "", what = "message" } = {}) {
  const box = rowsBox("Messages");
  const get = () => (Array.isArray(obj[key]) ? obj[key] : []);
  const draw = (focusLast) => {
    clearNode(box);
    const list = get();
    if (!list.length) box.append(el("div", { class: "rows-empty" }, "Aucun message. Ajoute au moins un rappel."));
    list.forEach((msg, i) => {
      const t = el("textarea", { class: "textarea", rows: "3", placeholder, "aria-label": `Message ${i + 1}` });
      t.value = msg || "";
      t.addEventListener("input", () => {
        obj[key][i] = t.value;
      });
      box.append(
        el(
          "div",
          { class: "rows-item" },
          el("span", { class: "rows-item-index" }, String(i + 1)),
          el("div", { class: "rows-item-main" }, t),
          el(
            "div",
            { class: "rows-item-actions" },
            ...reorderButtons(i, list.length, (idx, d) => { obj[key] = moveItem(get(), idx, d); touch(); draw(); }, `le ${what} ${i + 1}`),
            iconButton("trash", `Supprimer le ${what} ${i + 1}`, () => { obj[key] = get().filter((_, j) => j !== i); touch(); draw(); }, { size: "sm" }),
          ),
        ),
      );
    });
    box.append(
      el(
        "div",
        { class: "rows-foot" },
        button(`Ajouter un ${what}`, {
          size: "sm",
          variant: "ghost",
          icon: "plus",
          disabled: list.length >= max,
          onClick: () => {
            obj[key] = [...get(), ""];
            touch();
            draw(true);
          },
        }),
      ),
    );
    if (focusLast) {
      const ts = $$("textarea", box);
      if (ts.length) ts[ts.length - 1].focus();
    }
  };
  draw();
  return box;
}

/** Motifs de tickets : [{ id, emoji, label, description, message }]. */
function topicsEditor(obj) {
  const box = rowsBox("Motifs de ticket");
  const get = () => (Array.isArray(obj.topics) ? obj.topics : []);
  const draw = (focusLast) => {
    clearNode(box);
    const list = get();
    if (!list.length) box.append(el("div", { class: "rows-empty" }, "Aucun motif : le panneau affichera un simple bouton « Ouvrir un ticket »."));
    list.forEach((t, i) => {
      const inp = (k, ph, label, cls = "") => {
        const n = el("input", { class: "input " + cls, type: "text", placeholder: ph, "aria-label": label, maxlength: k === "description" ? "100" : k === "label" ? "80" : null });
        n.value = t[k] || "";
        n.addEventListener("input", () => {
          t[k] = n.value;
        });
        return n;
      };
      const msg = el("textarea", { class: "textarea", rows: "2", placeholder: "Message affiché à l'ouverture (optionnel)", "aria-label": `Message d'ouverture du motif ${i + 1}`, style: "flex-basis:100%;min-height:56px" });
      msg.value = t.message || "";
      msg.addEventListener("input", () => {
        t.message = msg.value;
      });
      box.append(
        el(
          "div",
          { class: "rows-item" },
          el(
            "div",
            { class: "rows-item-main" },
            el("div", { class: "fixed", style: "width:64px" }, inp("emoji", "Emoji", `Emoji du motif ${i + 1}`, "w-xs")),
            inp("label", "Nom du motif", `Nom du motif ${i + 1}`),
            inp("description", "Description courte", `Description du motif ${i + 1}`),
            msg,
          ),
          el(
            "div",
            { class: "rows-item-actions" },
            ...reorderButtons(i, list.length, (idx, d) => { obj.topics = moveItem(get(), idx, d); touch(); draw(); }, `le motif ${i + 1}`),
            iconButton("trash", `Supprimer le motif ${i + 1}`, () => { obj.topics = get().filter((_, j) => j !== i); touch(); draw(); }, { size: "sm" }),
          ),
        ),
      );
    });
    box.append(
      el(
        "div",
        { class: "rows-foot" },
        button("Ajouter un motif", {
          size: "sm",
          variant: "ghost",
          icon: "plus",
          disabled: list.length >= 25,
          onClick: () => {
            obj.topics = [...get(), { label: "", emoji: "", description: "", message: "" }];
            touch();
            draw(true);
          },
        }),
      ),
    );
    if (focusLast) {
      const labels = $$('input[aria-label^="Nom du motif"]', box);
      if (labels.length) labels[labels.length - 1].focus();
    }
  };
  draw();
  return box;
}

/** Champs d'un embed : [{ name, value, inline }]. */
function embedFieldsEditor(embed) {
  const box = rowsBox("Champs de l'embed");
  const get = () => (Array.isArray(embed.fields) ? embed.fields : []);
  const draw = (focusLast) => {
    clearNode(box);
    const list = get();
    if (!list.length) box.append(el("div", { class: "rows-empty" }, "Aucun champ."));
    list.forEach((f, i) => {
      const name = el("input", { class: "input", type: "text", placeholder: "Titre du champ", "aria-label": `Titre du champ ${i + 1}`, maxlength: "256" });
      name.value = f.name || "";
      name.addEventListener("input", () => {
        f.name = name.value;
      });
      const value = el("textarea", { class: "textarea", rows: "2", placeholder: "Valeur", "aria-label": `Valeur du champ ${i + 1}`, style: "flex-basis:100%;min-height:56px", maxlength: "1024" });
      value.value = f.value || "";
      value.addEventListener("input", () => {
        f.value = value.value;
      });
      const inlineId = uid("sw");
      const inline = switchControl({ checked: !!f.inline, id: inlineId, onChange: (v) => { f.inline = v; touch(); } });
      box.append(
        el(
          "div",
          { class: "rows-item" },
          el("div", { class: "rows-item-main" }, name, el("div", { class: "row fixed", style: "height:var(--control-h)" }, inline, el("label", { for: inlineId, class: "text-sm text-2" }, "En ligne")), value),
          el(
            "div",
            { class: "rows-item-actions" },
            ...reorderButtons(i, list.length, (idx, d) => { embed.fields = moveItem(get(), idx, d); touch(); draw(); }, `le champ ${i + 1}`),
            iconButton("trash", `Supprimer le champ ${i + 1}`, () => { embed.fields = get().filter((_, j) => j !== i); touch(); draw(); }, { size: "sm" }),
          ),
        ),
      );
    });
    box.append(
      el(
        "div",
        { class: "rows-foot" },
        button("Ajouter un champ", {
          size: "sm",
          variant: "ghost",
          icon: "plus",
          disabled: list.length >= 25,
          onClick: () => {
            embed.fields = [...get(), { name: "", value: "", inline: false }];
            touch();
            draw(true);
          },
        }),
      ),
    );
    if (focusLast) {
      const n = $$('input[aria-label^="Titre du champ"]', box);
      if (n.length) n[n.length - 1].focus();
    }
  };
  draw();
  return box;
}

// Rendu d'un emoji stocké : custom (<:nom:id>) en image, unicode en texte.
function renderEmoji(token) {
  const m = /^<(a?):(\w+):(\d+)>$/.exec(String(token || "").trim());
  if (m) return el("span", { class: "emoji-slot" }, el("img", { src: `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] ? "gif" : "webp"}?size=48`, alt: `:${m[2]}:`, loading: "lazy" }));
  return el("span", { class: "emoji-slot" }, token);
}

function emojiLabel(token) {
  const m = /^<a?:(\w+):\d+>$/.exec(String(token || "").trim());
  return m ? `:${m[1]}:` : token;
}

/** Réactions ordonnées (emojis unicode ou du serveur). `captions` : légende par position. */
function reactionsEditor(obj, key, { captions = null } = {}) {
  const get = () => (Array.isArray(obj[key]) ? obj[key] : []);
  const chips = el("div", { class: "chips", role: "list" });
  const input = el("input", { class: "input w-md", type: "text", placeholder: "Emoji ou <:nom:id>", "aria-label": "Emoji à ajouter", autocomplete: "off" });
  const addToken = (tok) => {
    const t = String(tok || "").trim();
    if (!t) return;
    if (get().includes(t)) {
      toast("Cet emoji est déjà dans la liste.", "info");
      return;
    }
    obj[key] = [...get(), t];
    touch();
    draw();
  };
  const addBtn = button("Ajouter", {
    size: "sm",
    onClick: () => {
      for (const tok of input.value.split(/\s+/)) addToken(tok);
      input.value = "";
      input.focus();
    },
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addBtn.click();
    }
  });
  const serverBtn = GUILD.emojis && GUILD.emojis.length ? button("Emojis du serveur", { size: "sm", variant: "ghost", icon: "smile" }) : null;
  if (serverBtn) {
    serverBtn.setAttribute("aria-haspopup", "dialog");
    serverBtn.addEventListener("click", () => {
      if (isPopoverFor(serverBtn)) return closePopover();
      const grid = el("div", { class: "emoji-grid", role: "list", "aria-label": "Emojis du serveur" });
      for (const e of GUILD.emojis) {
        const b = el("button", { type: "button", "aria-label": `Ajouter :${e.name}:`, "data-tip": `:${e.name}:` }, el("img", { src: e.url, alt: "", loading: "lazy" }));
        b.addEventListener("click", () => addToken(e.token));
        grid.append(b);
      }
      openPopover(serverBtn, grid, { placement: "bottom-start" });
      const first = grid.querySelector("button");
      if (first) first.focus();
    });
  }
  function draw() {
    clearNode(chips);
    const list = get();
    if (!list.length) chips.append(el("span", { class: "text-sm text-2", role: "listitem" }, "Aucune réaction."));
    list.forEach((tok, i) => {
      const caption = captions && captions[i];
      const top = el(
        "span",
        { class: "reaction-chip-top" },
        renderEmoji(tok),
        iconButton("x", `Retirer ${emojiLabel(tok)}`, () => { obj[key] = get().filter((_, j) => j !== i); touch(); draw(); }, { size: "sm" }),
      );
      chips.append(el("span", { class: "chip" + (caption ? " reaction-chip" : ""), role: "listitem", title: emojiLabel(tok) }, top, caption ? el("span", { class: "reaction-chip-caption" }, caption) : null));
    });
  }
  draw();
  return el("div", { class: "stack", style: "gap:10px", "data-group": "", role: "group" }, chips, el("div", { class: "row" }, input, addBtn, serverBtn));
}

/** Domaines (hébergeurs vidéo supplémentaires). */
function domainsEditor(obj, key) {
  const get = () => (Array.isArray(obj[key]) ? obj[key] : []);
  const chips = el("div", { class: "chips", role: "list" });
  const input = el("input", { class: "input w-md", type: "text", placeholder: "exemple.com", "aria-label": "Domaine à ajouter", autocomplete: "off", spellcheck: "false" });
  const add = () => {
    const parts = input.value.split(/[\s,;]+/).map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
    const bad = parts.filter((d) => !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
    if (bad.length) {
      setFieldError(input, `Domaine invalide : ${bad[0]}`);
      return;
    }
    setFieldError(input, null);
    const next = [...get()];
    for (const d of parts) if (!next.includes(d)) next.push(d);
    obj[key] = next;
    input.value = "";
    touch();
    draw();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  });
  function draw() {
    clearNode(chips);
    const list = get();
    if (!list.length) chips.append(el("span", { class: "text-sm text-2", role: "listitem" }, "Aucun domaine supplémentaire."));
    for (const d of list) {
      chips.append(el("span", { class: "chip", role: "listitem" }, el("span", { class: "chip-label mono" }, d), iconButton("x", `Retirer ${d}`, () => { obj[key] = get().filter((x) => x !== d); touch(); draw(); }, { size: "sm" })));
    }
  }
  draw();
  return el("div", { class: "stack", style: "gap:10px", "data-group": "", role: "group" }, chips, el("div", { class: "row" }, input, button("Ajouter", { size: "sm", onClick: add })));
}
