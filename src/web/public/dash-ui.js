/* ════════════════════════════════════════════════════════════════════════
   Xray Kaya (XK) Bot — Dashboard · composants
   Boutons, statuts, interrupteurs, infobulles, popovers, menus, dialogues,
   toasts, onglets, contrôles segmentés, tableaux, états (vide, chargement,
   erreur), statistiques, barres.
   ────────────────────────────────────────────────────────────────────────
   Script classique (voir l'en-tête de dash-core.js). Aucun effet au
   chargement : uniquement des déclarations.
   ════════════════════════════════════════════════════════════════════════ */

"use strict";

// ═══════════════════ 1. Boutons ═══════════════════

// Remonte une erreur d'action à l'utilisateur (toast), sauf si déjà traitée.
function reportError(e) {
  if (e && e.silent) return;
  toast((e && e.message) || "Une erreur est survenue.", "err");
}

/**
 * Exécute une action liée à un bouton. Si elle renvoie une promesse, le bouton
 * passe en état « en cours » (spinner, désactivé) jusqu'à sa résolution.
 * Les erreurs sont affichées en toast.
 */
async function runBusy(btn, fn) {
  if (btn.getAttribute("aria-busy") === "true") return;
  let result;
  try {
    result = fn();
  } catch (e) {
    reportError(e);
    return;
  }
  if (!result || typeof result.then !== "function") return;
  const wasDisabled = btn.disabled;
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  try {
    await result;
  } catch (e) {
    reportError(e);
  } finally {
    btn.removeAttribute("aria-busy");
    btn.disabled = wasDisabled;
  }
}

/**
 * Bouton. variant : primary | secondary | ghost | danger | danger-secondary | link.
 * Une seule action primaire par zone.
 */
function button(label, opts = {}) {
  const { variant = "secondary", size, icon: ic, iconRight, onClick, type = "button", disabled, title, block, className } = opts;
  const cls = ["btn", "btn-" + variant, size && "btn-" + size, block && "btn-block", !label && "btn-icon", className];
  const b = el("button", { type, class: cls.filter(Boolean).join(" "), disabled: !!disabled, title });
  if (ic) b.append(icon(ic, size === "sm" ? 14 : 16));
  if (label) b.append(el("span", {}, label));
  if (iconRight) b.append(icon(iconRight, 14));
  if (onClick) b.addEventListener("click", (e) => runBusy(b, () => onClick(e)));
  return b;
}

// Bouton icône seul : toujours un nom accessible + une infobulle.
function iconButton(name, label, onClick, { variant = "ghost", size, tipPos, disabled, className } = {}) {
  const cls = ["btn", "btn-" + variant, "btn-icon", size && "btn-" + size, className].filter(Boolean).join(" ");
  const b = el("button", { type: "button", class: cls, "aria-label": label, "data-tip": label, "data-tip-pos": tipPos || null, disabled: !!disabled });
  b.append(icon(name, size === "sm" ? 14 : 16));
  if (onClick) b.addEventListener("click", (e) => runBusy(b, () => onClick(e)));
  return b;
}

function linkButton(label, href, { variant = "secondary", size, icon: ic, external } = {}) {
  const a = el("a", {
    class: ["btn", "btn-" + variant, size && "btn-" + size].filter(Boolean).join(" "),
    href,
    target: external ? "_blank" : null,
    rel: external ? "noopener noreferrer" : null,
  });
  if (ic) a.append(icon(ic, size === "sm" ? 14 : 16));
  a.append(el("span", {}, label));
  if (external) a.append(icon("external", 14));
  return a;
}

// ═══════════════════ 2. Statuts, badges ═══════════════════

// Point + texte : la couleur n'est jamais le seul indicateur.
function statusDot(kind, text, { strong = false } = {}) {
  return el("span", { class: `status status-${kind}${strong ? " status-strong" : ""}` }, el("span", { class: "dot", "aria-hidden": "true" }), text);
}

function badge(text, kind = "neutral") {
  return el("span", { class: `badge badge-${kind}` }, text);
}

function kbd(text) {
  return el("kbd", { class: "kbd" }, text);
}

// ═══════════════════ 3. Interrupteur ═══════════════════

/**
 * Interrupteur (role=switch). `onChange(valeur)` peut renvoyer une promesse :
 * en cas d'échec, l'état est rétabli et l'erreur affichée.
 */
function switchControl({ checked = false, onChange, label, id, disabled } = {}) {
  const s = el("button", {
    type: "button",
    role: "switch",
    class: "switch",
    id: id || null,
    "aria-checked": String(!!checked),
    "aria-label": label || null,
    disabled: !!disabled,
  });
  s.addEventListener("click", async () => {
    if (s.getAttribute("aria-busy") === "true") return;
    const next = s.getAttribute("aria-checked") !== "true";
    s.setAttribute("aria-checked", String(next));
    if (!onChange) return;
    let r;
    try {
      r = onChange(next);
    } catch (e) {
      s.setAttribute("aria-checked", String(!next));
      reportError(e);
      return;
    }
    if (r && typeof r.then === "function") {
      s.setAttribute("aria-busy", "true");
      try {
        await r;
      } catch (e) {
        s.setAttribute("aria-checked", String(!next));
        reportError(e);
      } finally {
        s.removeAttribute("aria-busy");
      }
    }
  });
  s.setChecked = (v) => s.setAttribute("aria-checked", String(!!v));
  return s;
}

// ═══════════════════ 4. Contrôle segmenté (choix exclusif court) ═══════════════════
function segmented(options, value, onChange, { label } = {}) {
  let current = value;
  const g = el("div", { class: "seg", role: "radiogroup", "aria-label": label || null });
  const btns = options.map((o) => {
    const b = el("button", { type: "button", role: "radio", class: "seg-opt", "aria-checked": String(o.value === current), tabindex: o.value === current ? "0" : "-1" }, o.label);
    b.addEventListener("click", () => select(o.value));
    return b;
  });
  function select(v, focus) {
    const idx = options.findIndex((o) => o.value === v);
    btns.forEach((b, i) => {
      b.setAttribute("aria-checked", String(i === idx));
      b.tabIndex = i === idx ? 0 : -1;
    });
    if (focus) btns[idx].focus();
    if (v !== current) {
      current = v;
      onChange(v);
    }
  }
  g.addEventListener("keydown", (e) => {
    const idx = options.findIndex((o) => o.value === current);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % options.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + options.length) % options.length;
    if (next >= 0) {
      e.preventDefault();
      select(options[next].value, true);
    }
  });
  g.append(...btns);
  // Groupe sans sélection valide : le premier reste atteignable au clavier.
  if (!options.some((o) => o.value === current) && btns[0]) btns[0].tabIndex = 0;
  return g;
}

// ═══════════════════ 5. Infobulles (une seule, positionnée en JS) ═══════════════════
const TIP = { node: null, target: null, timer: 0 };

function showTip(target) {
  hideTip();
  const text = target.getAttribute("data-tip");
  if (!text || !document.contains(target)) return;
  const node = el("div", { class: "tooltip", role: "tooltip" }, text);
  document.body.append(node);
  const r = target.getBoundingClientRect();
  const pos = target.getAttribute("data-tip-pos") || "top";
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  let top;
  let left;
  if (pos === "right") {
    top = r.top + r.height / 2 - h / 2;
    left = r.right + 8;
  } else {
    top = pos === "bottom" || r.top - h - 8 < 4 ? r.bottom + 8 : r.top - h - 8;
    left = r.left + r.width / 2 - w / 2;
  }
  node.style.top = clamp(top, 4, innerHeight - h - 4) + "px";
  node.style.left = clamp(left, 4, innerWidth - w - 4) + "px";
  TIP.node = node;
  TIP.target = target;
}

function hideTip() {
  clearTimeout(TIP.timer);
  if (TIP.node) TIP.node.remove();
  TIP.node = null;
  TIP.target = null;
}

function initTooltips() {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (!t || t === TIP.target) return;
    clearTimeout(TIP.timer);
    TIP.timer = setTimeout(() => showTip(t), 400);
  });
  document.addEventListener("pointerout", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (t && !t.contains(e.relatedTarget)) hideTip();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target.closest && e.target.closest("[data-tip]");
    if (t && t.matches(":focus-visible")) showTip(t);
  });
  document.addEventListener("focusout", hideTip);
  document.addEventListener("pointerdown", hideTip, true);
  window.addEventListener("scroll", hideTip, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTip();
  });
}

// ═══════════════════ 6. Popovers (menus, listes de choix) ═══════════════════
let POPOVER = null;

function positionFloating(pop, anchor, placement, matchWidth) {
  const r = anchor.getBoundingClientRect();
  const m = 8;
  const gap = 4;
  if (matchWidth) pop.style.minWidth = Math.max(r.width, 200) + "px";
  pop.style.maxHeight = "";
  const below = innerHeight - r.bottom - gap - m;
  const above = r.top - gap - m;
  const ph = pop.offsetHeight;
  const pw = pop.offsetWidth;
  let top;
  if (ph > below && above > below) {
    const hgt = Math.min(ph, above);
    top = r.top - gap - hgt;
    pop.style.maxHeight = above + "px";
  } else {
    top = r.bottom + gap;
    pop.style.maxHeight = below + "px";
  }
  let left = placement.endsWith("end") ? r.right - pw : r.left;
  left = clamp(left, m, Math.max(m, innerWidth - pw - m));
  pop.style.top = Math.max(m, top) + "px";
  pop.style.left = left + "px";
}

function openPopover(anchor, content, { placement = "bottom-start", matchWidth = false, className = "", onClose } = {}) {
  closePopover();
  const pop = el("div", { class: "popover " + className });
  pop.append(content);
  document.body.append(pop);
  const place = () => positionFloating(pop, anchor, placement, matchWidth);
  place();

  const onDown = (e) => {
    if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopover();
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      closePopover();
      anchor.focus({ preventScroll: true });
    }
  };
  const onMove = (e) => {
    if (e.target && e.target.nodeType === 1 && pop.contains(e.target)) return;
    if (!document.contains(anchor)) return closePopover();
    place();
  };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  anchor.setAttribute("aria-expanded", "true");

  POPOVER = {
    pop,
    anchor,
    cleanup() {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      anchor.setAttribute("aria-expanded", "false");
      pop.remove();
      if (onClose) onClose();
    },
  };
  return POPOVER;
}

function closePopover() {
  if (!POPOVER) return;
  const p = POPOVER;
  POPOVER = null;
  p.cleanup();
}

function isPopoverFor(anchor) {
  return !!(POPOVER && POPOVER.anchor === anchor);
}

/**
 * Menu d'actions. items : { label, icon, onSelect, danger, disabled, hint,
 * checked, radio } | "-" (séparateur) | { heading }.
 */
function openMenu(anchor, items, { placement = "bottom-end" } = {}) {
  const menu = el("div", { class: "menu", role: "menu" });
  const buttons = [];
  for (const it of items) {
    if (!it) continue;
    if (it === "-") {
      if (menu.lastChild && !menu.lastChild.classList.contains("menu-sep")) menu.append(el("div", { class: "menu-sep", role: "separator" }));
      continue;
    }
    if (it.heading) {
      menu.append(el("div", { class: "menu-heading", role: "presentation" }, it.heading));
      continue;
    }
    const role = it.checked === undefined ? "menuitem" : it.radio ? "menuitemradio" : "menuitemcheckbox";
    const b = el("button", {
      type: "button",
      class: "menu-item" + (it.danger ? " danger" : ""),
      role,
      tabindex: "-1",
      disabled: !!it.disabled,
      "aria-checked": it.checked === undefined ? null : String(!!it.checked),
    });
    if (it.icon) b.append(icon(it.icon, 16));
    b.append(el("span", { class: "menu-label" }, it.label));
    if (it.hint) b.append(el("span", { class: "menu-hint" }, it.hint));
    if (it.checked) {
      const c = icon("check", 14);
      c.classList.add("menu-check");
      b.append(c);
    }
    b.addEventListener("click", () => {
      closePopover();
      if (document.contains(anchor)) anchor.focus({ preventScroll: true });
      if (it.onSelect) Promise.resolve().then(() => it.onSelect()).catch(reportError);
    });
    menu.append(b);
    buttons.push(b);
  }
  if (menu.lastChild && menu.lastChild.classList.contains("menu-sep")) menu.lastChild.remove();

  menu.addEventListener("keydown", (e) => {
    const enabled = buttons.filter((b) => !b.disabled);
    if (!enabled.length) return;
    const i = enabled.indexOf(document.activeElement);
    let next = null;
    if (e.key === "ArrowDown") next = enabled[(i + 1) % enabled.length];
    else if (e.key === "ArrowUp") next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    else if (e.key === "Tab") closePopover();
    if (next) {
      e.preventDefault();
      next.focus();
    }
  });

  openPopover(anchor, menu, { placement });
  const first = buttons.find((b) => !b.disabled);
  if (first) first.focus();
}

// Bouton « … » qui ouvre un menu (items figés ou calculés à l'ouverture).
function menuButton(items, { label = "Plus d'actions", variant = "ghost", size, iconName = "more", text } = {}) {
  const b = text
    ? button(text, { variant, size, iconRight: "chevron-down" })
    : iconButton(iconName, label, null, { variant, size });
  b.setAttribute("aria-haspopup", "menu");
  b.setAttribute("aria-expanded", "false");
  b.addEventListener("click", () => {
    if (isPopoverFor(b)) return closePopover();
    openMenu(b, typeof items === "function" ? items() : items);
  });
  b.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !isPopoverFor(b)) {
      e.preventDefault();
      b.click();
    }
  });
  return b;
}

// ═══════════════════ 7. Dialogues et tiroirs ═══════════════════
const DIALOGS = [];

function focusables(root) {
  return $$('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root).filter(
    (n) => n.offsetParent !== null || n === document.activeElement,
  );
}

/**
 * Dialogue modal (ou tiroir latéral avec kind: "drawer").
 * actions : [{ label, variant, icon, onClick(dlg) → false pour garder ouvert, autofocus, left }]
 * beforeClose() → Promise<boolean> : permet de bloquer la fermeture (brouillon).
 */
function openDialog({ title, description, body, actions = [], size = "sm", kind = "dialog", dismissible = true, onClose, beforeClose, initialFocus } = {}) {
  closePopover();
  hideTip();
  const prevFocus = document.activeElement;
  const titleId = uid("dlg-title");
  const descId = description ? uid("dlg-desc") : null;
  const isDrawer = kind === "drawer";

  const backdrop = el("div", { class: "dialog-backdrop" + (isDrawer ? " drawer-backdrop" : "") });
  const box = el("div", {
    class: isDrawer ? "dialog drawer" : `dialog dialog-${size}`,
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": titleId,
    "aria-describedby": descId,
  });
  const head = el(
    "div",
    { class: "dialog-head" },
    el("div", { class: "ph-text" }, el("h2", { class: "dialog-title", id: titleId }, title), description ? el("p", { class: "dialog-desc", id: descId }, description) : null),
  );
  const bodyEl = el("div", { class: "dialog-body" });
  appendKids(bodyEl, [body]);
  const foot = el("div", { class: "dialog-foot" });

  let closed = false;
  const dlg = { root: box, body: bodyEl, foot, close, requestClose };

  async function requestClose() {
    if (beforeClose && !(await beforeClose())) return;
    close();
  }

  function close(value) {
    if (closed) return;
    closed = true;
    backdrop.remove();
    const i = DIALOGS.indexOf(dlg);
    if (i >= 0) DIALOGS.splice(i, 1);
    if (!DIALOGS.length) document.documentElement.classList.remove("scroll-lock");
    document.removeEventListener("keydown", onKey);
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    if (onClose) onClose(value);
  }

  if (dismissible) head.append(iconButton("x", "Fermer", () => requestClose(), { size: "sm" }));

  let primary = null;
  for (const a of actions) {
    const b = button(a.label, { variant: a.variant || "secondary", icon: a.icon, className: a.left ? "foot-left" : null });
    b.addEventListener("click", () =>
      runBusy(b, async () => {
        const r = a.onClick ? await a.onClick(dlg) : undefined;
        if (r !== false) close(a.value);
      }),
    );
    if (a.autofocus) b.dataset.autofocus = "1";
    if (a.variant === "primary" || a.variant === "danger") primary = b;
    foot.append(b);
  }

  function onKey(e) {
    if (DIALOGS[DIALOGS.length - 1] !== dlg) return;
    if (e.key === "Escape" && dismissible) {
      e.preventDefault();
      requestClose();
    } else if (e.key === "Tab") {
      const f = focusables(box);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Enter" && primary && e.target.matches && e.target.matches("input:not([type=checkbox]):not([type=file])") && box.contains(e.target)) {
      e.preventDefault();
      primary.click();
    }
  }

  box.append(head, bodyEl);
  if (actions.length) box.append(foot);
  backdrop.append(box);
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop && dismissible) requestClose();
  });
  document.body.append(backdrop);
  document.documentElement.classList.add("scroll-lock");
  document.addEventListener("keydown", onKey);
  DIALOGS.push(dlg);

  requestAnimationFrame(() => {
    const target =
      (initialFocus && box.querySelector(initialFocus)) ||
      box.querySelector("[data-autofocus]") ||
      bodyEl.querySelector("input, textarea, select, .cbx") ||
      primary ||
      focusables(box)[0];
    if (target) target.focus();
  });
  return dlg;
}

/** Confirmation. Pour une action destructive, le focus initial va sur « Annuler ». */
function confirmDialog({ title = "Confirmer", message, confirmLabel = "Confirmer", cancelLabel = "Annuler", danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    openDialog({
      title,
      body: el("div", { class: "dialog-text" }, message),
      actions: [
        { label: cancelLabel, variant: "secondary", autofocus: danger, onClick: () => { answered = true; resolve(false); } },
        { label: confirmLabel, variant: danger ? "danger" : "primary", autofocus: !danger, onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}

// ═══════════════════ 8. Toasts ═══════════════════

/**
 * Notification éphémère. kind : ok | err | warn | info.
 * Signature conservée (msg, kind) : catgirl.js s'y greffe.
 */
function toast(msg, kind = "ok", opts = {}) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const ic = { err: "alert-circle", warn: "alert-triangle", info: "info" }[kind] || "check-circle";
  const t = el("div", { class: `toast toast-${kind}`, role: kind === "err" ? "alert" : "status" }, icon(ic, 16), el("div", { class: "toast-msg" }, msg));
  let timer = 0;
  const dismiss = () => {
    clearTimeout(timer);
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 160);
  };
  if (opts.action) t.append(button(opts.action.label, { variant: "ghost", size: "sm", onClick: () => { dismiss(); return opts.action.onClick(); } }));
  t.append(iconButton("x", "Fermer la notification", dismiss, { size: "sm" }));
  host.append(t);
  while (host.children.length > 4) host.firstElementChild.remove();
  const life = kind === "err" ? 7000 : 4000;
  timer = setTimeout(dismiss, life);
  t.addEventListener("pointerenter", () => clearTimeout(timer));
  t.addEventListener("pointerleave", () => {
    timer = setTimeout(dismiss, 2000);
  });
}

// ═══════════════════ 9. Onglets ═══════════════════

// Onglets clavier (flèches, Début, Fin) à activation automatique.
function tabBar(items, active, onChange, { label = "Sections de la page" } = {}) {
  let current = active;
  const bar = el("div", { class: "tabs", role: "tablist", "aria-label": label });
  const btns = items.map((it) => {
    const b = el("button", {
      type: "button",
      role: "tab",
      class: "tab",
      id: "tab-" + it.id,
      "aria-selected": String(it.id === current),
      "aria-controls": "tabpanel",
      tabindex: it.id === current ? "0" : "-1",
    });
    b.append(el("span", {}, it.label));
    if (it.count !== undefined && it.count !== null) b.append(el("span", { class: "tab-count" }, fmtNum(it.count)));
    if (it.attention) b.append(el("span", { class: "tab-attn", role: "img", "aria-label": it.attention }));
    b.addEventListener("click", () => select(it.id));
    return b;
  });
  function select(id, focus) {
    const idx = items.findIndex((i) => i.id === id);
    btns.forEach((b, i) => {
      b.setAttribute("aria-selected", String(i === idx));
      b.tabIndex = i === idx ? 0 : -1;
    });
    if (focus) btns[idx].focus();
    if (id !== current) {
      current = id;
      onChange(id);
    }
  }
  bar.addEventListener("keydown", (e) => {
    const idx = items.findIndex((i) => i.id === current);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      select(items[next].id, true);
    }
  });
  bar.append(...btns);
  return bar;
}

// ═══════════════════ 10. États ═══════════════════
function emptyState({ icon: ic = "inbox", title, text, actions = [], compact = false } = {}) {
  return el(
    "div",
    { class: "empty" + (compact ? " compact" : "") },
    el("div", { class: "empty-icon", "aria-hidden": "true" }, icon(ic, 18)),
    el("div", { class: "empty-title" }, title),
    text ? el("p", { class: "empty-text" }, text) : null,
    actions.length ? el("div", { class: "empty-actions" }, ...actions) : null,
  );
}

function callout(kind, content, { title, actions = [], iconName } = {}) {
  const ic = iconName || { warn: "alert-triangle", danger: "alert-circle", ok: "check-circle" }[kind] || "info";
  return el(
    "div",
    { class: `callout callout-${kind}` },
    icon(ic, 16),
    el("div", { class: "callout-body" }, title ? el("div", { class: "callout-title" }, title) : null, content ? el("div", { class: "callout-text" }, content) : null),
    actions.length ? el("div", { class: "callout-actions" }, ...actions) : null,
  );
}

function inlineError(message, onRetry) {
  return el(
    "div",
    { class: "inline-error", role: "alert" },
    icon("alert-circle", 16),
    el("span", { class: "spacer" }, message),
    onRetry ? button("Réessayer", { size: "sm", variant: "secondary", icon: "refresh", onClick: onRetry }) : null,
  );
}

function skelLines(n = 3, widths = ["70%", "90%", "55%", "80%", "65%"]) {
  const w = el("div", { class: "skel-rows", "aria-hidden": "true" });
  for (let i = 0; i < n; i++) w.append(el("span", { class: "skel skel-line", style: `width:${widths[i % widths.length]}` }));
  return w;
}

function skelBlock(height = 80) {
  return el("span", { class: "skel", style: `height:${height}px`, "aria-hidden": "true" });
}

// ═══════════════════ 11. Conteneurs & données ═══════════════════
function panel(...kids) {
  return el("div", { class: "panel" }, ...kids);
}

function panelHead(title, actions = []) {
  return el("div", { class: "panel-head" }, el("h3", { class: "panel-title" }, title), actions.length ? el("div", { class: "row" }, ...actions) : null);
}

function sectionBlock(title, { description, actions = [] } = {}, ...kids) {
  return el(
    "section",
    { class: "section" },
    el(
      "div",
      { class: "section-head" },
      el("div", { class: "ph-text" }, el("h2", { class: "section-title" }, title), description ? el("p", { class: "section-desc" }, description) : null),
      actions.length ? el("div", { class: "section-actions" }, ...actions) : null,
    ),
    ...kids,
  );
}

function toolbar(text, actions = []) {
  return el("div", { class: "toolbar" }, el("p", { class: "toolbar-text" }, text || ""), actions.length ? el("div", { class: "toolbar-actions" }, ...actions) : null);
}

// Statistiques en ligne, séparées par des filets.
function statGrid(items, { inPanel = false } = {}) {
  return el(
    "div",
    { class: "stats" + (inPanel ? " in-panel" : "") },
    items.map((s) =>
      el("div", { class: "stat" }, el("div", { class: "stat-label" }, s.label), el("div", { class: "stat-value", title: s.title || null }, s.value), s.hint ? el("div", { class: "stat-hint" }, s.hint) : null),
    ),
  );
}

/**
 * Bande d'indicateurs d'état (même rendu que la santé de la vue d'ensemble).
 * items : [{ label, value (texte ou nœud), meta }]
 */
function infoStrip(items, { label } = {}) {
  return el(
    "div",
    { class: "health", role: "list", "aria-label": label || null },
    items.map((it) =>
      el(
        "div",
        { class: "health-cell", role: "listitem" },
        el("div", { class: "health-label" }, it.label),
        el("div", { class: "health-value" }, typeof it.value === "string" ? el("span", { class: "status status-strong" }, it.value) : it.value),
        it.meta ? el("div", { class: "health-meta" }, it.meta) : null,
      ),
    ),
  );
}

// Barres horizontales : comparaison de quelques catégories.
function barList(items, { total } = {}) {
  const sum = total ?? items.reduce((a, i) => a + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  return el(
    "div",
    { class: "bars", role: "list" },
    items.map((it) => {
      const pct = sum ? it.value / sum : 0;
      return el(
        "div",
        { class: "bar-row", role: "listitem", "aria-label": `${it.label} : ${fmtNum(it.value)} (${fmtPct(pct)})` },
        el("span", { class: "bar-label" }, el("span", { class: "bar-swatch", style: `background:${it.color || "var(--accent)"}` }), el("span", { class: "truncate" }, it.label)),
        el("span", { class: "bar-track", "aria-hidden": "true" }, el("span", { class: "bar-fill", style: `display:block;width:${(it.value / max) * 100}%;background:${it.color || "var(--accent)"}` })),
        el("span", { class: "bar-value" }, el("strong", {}, fmtNum(it.value)), " · ", fmtPct(pct)),
      );
    }),
  );
}

// ═══════════════════ 12. Tableau ═══════════════════

/**
 * Tableau triable, filtrable et paginé, empilé en lignes sur petit écran.
 * columns : [{ key, label, render(row), sortValue(row), sortable, align,
 *              primary, meta, hideSm, width, className }]
 * Renvoie un élément avec .update(rows) pour rafraîchir sans reconstruire.
 */
function dataTable({ columns, rows, empty, searchable = false, searchPlaceholder = "Rechercher", searchText, initialSort = null, pageSize = 25, toolbarItems = [], label, rowClass } = {}) {
  let data = rows || [];
  const state = { q: "", sort: initialSort, page: 0 };
  const wrap = el("div", { class: "dt" });

  if (searchable || toolbarItems.length) {
    const bar = el("div", { class: "dt-toolbar" });
    if (searchable) {
      const input = el("input", { class: "input input-sm", type: "search", placeholder: searchPlaceholder, "aria-label": searchPlaceholder, autocomplete: "off" });
      input.addEventListener(
        "input",
        debounce(() => {
          state.q = input.value.trim();
          state.page = 0;
          draw();
        }, 120),
      );
      wrap.searchInput = input;
      bar.append(el("div", { class: "dt-search" }, icon("search", 14), input));
    }
    appendKids(bar, [el("div", { class: "spacer" }), toolbarItems]);
    wrap.append(bar);
  }

  const table = el("table", { class: "table responsive" });
  if (label) table.append(el("caption", { class: "sr-only" }, label));
  const trh = el("tr");
  const ths = columns.map((c) => {
    const th = el("th", { scope: "col", class: [c.align === "right" && "num", c.hideSm && "hide-sm", c.className].filter(Boolean).join(" ") || null, style: c.width ? `width:${c.width}` : null });
    if (c.sortable) {
      const b = el("button", { type: "button", class: "th-sort" }, c.label, icon("chevrons-up-down", 12));
      b.addEventListener("click", () => {
        const dir = state.sort && state.sort.key === c.key && state.sort.dir === "asc" ? "desc" : "asc";
        state.sort = { key: c.key, dir };
        state.page = 0;
        draw();
      });
      th.append(b);
    } else if (c.label) th.append(c.label);
    else th.append(el("span", { class: "sr-only" }, c.srLabel || "Actions"));
    trh.append(th);
    return th;
  });
  const tbody = el("tbody");
  table.append(el("thead", {}, trh), tbody);
  const foot = el("div", { class: "dt-foot" });
  wrap.append(el("div", { class: "dt-container" }, table), foot);

  const valueOf = (c, r) => (c.sortValue ? c.sortValue(r) : r[c.key]);

  function fullRow(node) {
    return el("tr", { class: "dt-empty" }, el("td", { colspan: String(columns.length) }, node));
  }

  function draw() {
    clearNode(tbody);
    let list = data;
    if (state.q) {
      const q = normText(state.q);
      list = list.filter((r) => normText(searchText ? searchText(r) : columns.map((c) => valueOf(c, r)).join(" ")).includes(q));
    }
    if (state.sort) {
      const c = columns.find((x) => x.key === state.sort.key);
      const mul = state.sort.dir === "asc" ? 1 : -1;
      if (c) {
        list = [...list].sort((a, b) => {
          const va = valueOf(c, a);
          const vb = valueOf(c, b);
          if (typeof va === "number" && typeof vb === "number") return (va - vb) * mul;
          return String(va ?? "").localeCompare(String(vb ?? ""), "fr", { numeric: true, sensitivity: "base" }) * mul;
        });
      }
    }
    ths.forEach((th, i) => {
      const c = columns[i];
      if (!c.sortable) return;
      const active = state.sort && state.sort.key === c.key;
      if (active) th.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
      const btn = th.querySelector(".th-sort");
      const old = btn && btn.querySelector(".i");
      if (old) old.replaceWith(icon(active ? (state.sort.dir === "asc" ? "arrow-up" : "arrow-down") : "chevrons-up-down", 12));
    });

    if (!data.length) {
      tbody.append(fullRow(empty || emptyState({ title: "Aucune donnée", compact: true })));
      foot.hidden = true;
      return;
    }
    if (!list.length) {
      const clear = button("Effacer la recherche", {
        size: "sm",
        onClick: () => {
          wrap.searchInput.value = "";
          state.q = "";
          draw();
          wrap.searchInput.focus();
        },
      });
      tbody.append(fullRow(emptyState({ icon: "search", title: "Aucun résultat", text: `Rien ne correspond à « ${state.q} ».`, actions: [clear], compact: true })));
      foot.hidden = true;
      return;
    }

    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    state.page = clamp(state.page, 0, pages - 1);
    const start = state.page * pageSize;
    const slice = list.slice(start, start + pageSize);
    for (const r of slice) {
      const tr = el("tr", { class: rowClass ? rowClass(r) || null : null });
      for (const c of columns) {
        const cls = [
          c.align === "right" && "num",
          c.primary && "cell-primary",
          c.meta && "cell-meta",
          c.hideSm && "hide-sm",
          c.key === "actions" && "cell-actions",
          c.className,
        ].filter(Boolean);
        const td = el("td", { class: cls.join(" ") || null, "data-label": c.meta && c.label ? c.label : null });
        const v = c.render ? c.render(r) : r[c.key];
        const blank = v === null || v === undefined || v === "";
        if (!blank) appendKids(td, [v]);
        else if (c.key !== "actions") td.append(el("span", { class: "text-3" }, "—"));
        tr.append(td);
      }
      tbody.append(tr);
    }

    clearNode(foot);
    // Pied de tableau utile seulement s'il y a de quoi compter : filtre actif, pagination ou longue liste.
    if (pages === 1 && !state.q && data.length < 10) {
      foot.hidden = true;
      return;
    }
    const count = list.length === data.length ? plural(data.length, "élément", "éléments") : `${fmtNum(list.length)} sur ${fmtNum(data.length)}`;
    foot.append(el("span", {}, pages > 1 ? `${fmtNum(start + 1)}–${fmtNum(start + slice.length)} · ${count}` : count));
    if (pages > 1) {
      foot.append(
        el(
          "div",
          { class: "row" },
          iconButton("chevron-left", "Page précédente", () => { state.page -= 1; draw(); }, { size: "sm", disabled: state.page === 0 }),
          el("span", { class: "num" }, `${state.page + 1} / ${pages}`),
          iconButton("chevron-right", "Page suivante", () => { state.page += 1; draw(); }, { size: "sm", disabled: state.page >= pages - 1 }),
        ),
      );
    }
    foot.hidden = false;
  }

  wrap.update = (next) => {
    data = next || [];
    draw();
  };
  draw();
  return wrap;
}

// Cellule principale d'un tableau : titre + sous-titre.
function cellTitle(title, sub) {
  return el("div", { class: "cell-strong" }, el("span", {}, title), sub ? el("span", { class: "cell-sub" }, sub) : null);
}

// Groupe d'actions de ligne (alignées à droite).
function rowActions(...btns) {
  return el("div", { class: "row" }, ...btns);
}
