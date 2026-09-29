/* Combo Lab — lecteur d'entraînement aux combos (page publique /lab/).
 *
 * Script classique enfermé dans une IIFE : aucune globale, pour ne jamais entrer en
 * collision avec les scripts du dashboard (qui partagent leur portée globale).
 * Données : GET /lab/api/combos ; vidéos : GET /lab/video/<id>.mp4 (même origine, CSP).
 */
(function () {
  "use strict";

  const FPS = 60; // les vidéos BrawlDB sont en 60 images/s
  const SPEEDS = [0.1, 0.25, 0.5, 0.75, 1];
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 4;
  const PREFS_KEY = "xk_lab_prefs";
  const MOBILE_QUERY = "(max-width: 960px)";

  // Icônes (tracés Lucide, 24×24, trait). Chaînes statiques uniquement.
  const ICONS = {
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    "skip-back": '<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/>',
    "skip-forward": '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
    "chevron-left": '<path d="m15 18-6-6 6-6"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    flip: '<path d="m3 7 5 5-5 5V7"/><path d="m21 7-5 5 5 5V7"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>',
    "zoom-in": '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
    "zoom-out": '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="8" x2="14" y1="11" y2="11"/>',
    "rotate-ccw": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    "volume-x": '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    "volume-2": '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };

  // Légende des mouvements (notation BrawlDB). Les modificateurs [..] ne sont pas traduits :
  // leur sens exact est détaillé sur la page du combo chez BrawlDatabase.
  const MOVE_LABELS = {
    nlight: "Attaque légère neutre",
    slight: "Attaque légère de côté",
    dlight: "Attaque légère bas",
    nair: "Aérienne neutre",
    sair: "Aérienne de côté",
    dair: "Aérienne bas",
    nsig: "Signature neutre",
    ssig: "Signature de côté",
    dsig: "Signature bas",
    jump: "Saut",
    dj: "Double saut",
    cd: "Chase dodge",
    dash: "Dash",
    gp: "Ground pound",
    rec: "Recovery",
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    layout: $("layout"),
    globalState: $("global-state"),
    weapon: $("weapon"),
    search: $("search"),
    sort: $("sort"),
    listCount: $("list-count"),
    list: $("combo-list"),
    player: $("player"),
    comboWeapon: $("combo-weapon"),
    title: $("combo-title"),
    steps: $("combo-steps"),
    notice: $("notice"),
    stage: $("stage"),
    pan: $("pan"),
    video: $("video"),
    badgeSpeed: $("badge-speed"),
    badgeZoom: $("badge-zoom"),
    badgeMirror: $("badge-mirror"),
    loading: $("stage-loading"),
    stageError: $("stage-error"),
    abRange: $("ab-range"),
    scrub: $("scrub"),
    frameInfo: $("frame-info"),
    speeds: $("speeds"),
    play: $("btn-play"),
    prev: $("btn-prev"),
    next: $("btn-next"),
    back: $("btn-back"),
    fwd: $("btn-fwd"),
    a: $("btn-a"),
    b: $("btn-b"),
    abClear: $("btn-ab-clear"),
    zoomIn: $("btn-zoom-in"),
    zoomOut: $("btn-zoom-out"),
    zoomReset: $("btn-zoom-reset"),
    zoomLevel: $("zoom-level"),
    mirror: $("btn-mirror"),
    loop: $("btn-loop"),
    mute: $("btn-mute"),
    fullscreen: $("btn-fullscreen"),
    stats: $("stats"),
    source: $("source-link"),
    share: $("btn-share"),
    helpBtn: $("btn-help"),
    help: $("help"),
    helpClose: $("help-close"),
    live: $("live"),
  };
  const video = els.video;

  const state = {
    catalog: null, // { weapons, combos }
    weapon: null,
    list: [], // combos affichés (arme + recherche + tri)
    current: null,
    speed: 1,
    mirror: false,
    loop: true,
    a: null, // début de boucle (secondes)
    b: null, // fin de boucle (secondes)
    zoom: { s: 1, x: 0, y: 0 },
    ready: false, // métadonnées de la vidéo courante chargées
    wantPlay: true, // lecture automatique au chargement (son coupé)
  };

  // ─────────────────────────── Utilitaires ───────────────────────────
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const speedLabel = (s) => `x${s}`;
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function svg(name) {
    const path = ICONS[name];
    if (!path) return "";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
  }

  // Remplace l'icône d'un bouton en conservant son libellé texte éventuel.
  function setIcon(btn, name) {
    const label = btn.querySelector("span")?.textContent ?? btn.textContent.trim();
    btn.innerHTML = svg(name);
    if (label) {
      const span = document.createElement("span");
      span.textContent = label;
      btn.append(span);
    }
  }

  function h(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }

  // Annonce pour lecteurs d'écran (réannonce aussi un texte identique).
  let liveTimer = 0;
  function announce(msg) {
    clearTimeout(liveTimer);
    els.live.textContent = "";
    liveTimer = setTimeout(() => (els.live.textContent = msg), 60);
  }

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (SPEEDS.includes(p.speed)) state.speed = p.speed;
      if (typeof p.mirror === "boolean") state.mirror = p.mirror;
      if (typeof p.loop === "boolean") state.loop = p.loop;
    } catch {
      /* stockage indisponible (navigation privée…) : valeurs par défaut */
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ speed: state.speed, mirror: state.mirror, loop: state.loop }));
    } catch {
      /* ignoré */
    }
  }

  // ─────────────────────────── États globaux ───────────────────────────
  function showGlobal({ title, text, retry }) {
    els.layout.hidden = true;
    els.globalState.hidden = false;
    els.globalState.replaceChildren(
      h("h2", { text: title }),
      h("p", { text }),
      retry ? h("button", { class: "btn btn-primary", type: "button", text: "Réessayer", onclick: () => loadCatalog() }) : null,
    );
    els.globalState.querySelector("button")?.focus();
  }

  function showNotice(text, kind = "warn") {
    els.notice.className = `callout callout-${kind}`;
    els.notice.textContent = text;
    els.notice.hidden = false;
  }
  const hideNotice = () => (els.notice.hidden = true);

  // ─────────────────────────── Catalogue ───────────────────────────
  async function loadCatalog() {
    els.globalState.hidden = true;
    els.layout.hidden = false;
    els.layout.setAttribute("aria-busy", "true");
    els.loading.hidden = false;
    let data = null;
    try {
      const res = await fetch("/lab/api/combos", { headers: { Accept: "application/json" } });
      data = await res.json().catch(() => null);
      if (!res.ok || !data || !Array.isArray(data.combos)) {
        throw new Error((data && data.error) || `Erreur ${res.status}`);
      }
    } catch (err) {
      const offline = err instanceof TypeError; // fetch rejeté : réseau
      showGlobal({
        title: "Impossible de charger les combos",
        text: offline ? "Le serveur ne répond pas. Vérifie ta connexion puis réessaie." : err.message,
        retry: true,
      });
      return;
    }
    state.catalog = data;
    if (!data.combos.length) {
      showGlobal({
        title: "Aucun combo pour l'instant",
        text: "La base de combos est vide. Un admin doit la mettre à jour depuis le dashboard. Reviens un peu plus tard.",
        retry: true,
      });
      return;
    }
    els.layout.setAttribute("aria-busy", "false");
    initFromUrl();
  }

  function comboById(id) {
    return state.catalog.combos.find((c) => String(c.id) === String(id)) || null;
  }

  function initFromUrl() {
    const params = new URLSearchParams(location.search);
    const sp = Number(params.get("speed"));
    if (SPEEDS.includes(sp)) state.speed = sp;
    const wanted = params.get("c");
    const combo = wanted ? comboById(wanted) : null;
    const weapons = state.catalog.weapons;
    const armParam = params.get("arme");
    const weapon = combo?.weapon || (weapons.some((w) => w.slug === armParam) ? armParam : weapons[0].slug);

    els.weapon.replaceChildren(
      ...weapons.map((w) => h("option", { value: w.slug, text: `${w.emoji} ${w.label} (${w.count})` })),
    );
    for (const el of [els.weapon, els.search, els.sort]) el.disabled = false;
    renderSpeeds();
    applyMirror();
    applyLoopButton();

    selectWeapon(weapon, combo ? combo.id : null);
    if (wanted && !combo) {
      showNotice("Ce combo n'existe plus ou le lien est incorrect : voici le premier combo de l'arme.");
    }
  }

  // ─────────────────────────── Liste ───────────────────────────
  function computeList() {
    const q = els.search.value.trim().toLowerCase();
    const sort = els.sort.value;
    const list = state.catalog.combos.filter(
      (c) => c.weapon === state.weapon && (!q || c.notation.toLowerCase().includes(q)),
    );
    const byEasy = (a, b) => b.usability - a.usability || b.avgDamage - a.avgDamage;
    if (sort === "damage") list.sort((a, b) => b.avgDamage - a.avgDamage || byEasy(a, b));
    else if (sort === "short") list.sort((a, b) => a.steps.length - b.steps.length || byEasy(a, b));
    else list.sort(byEasy);
    return list;
  }

  function dexLabel(d) {
    return !d || d === "Any" ? "Toutes" : d;
  }

  function renderList() {
    state.list = computeList();
    const total = state.catalog.combos.filter((c) => c.weapon === state.weapon).length;
    const q = els.search.value.trim();
    els.listCount.textContent = q
      ? `${state.list.length} combo${state.list.length > 1 ? "s" : ""} sur ${total}`
      : `${total} combo${total > 1 ? "s" : ""}`;
    if (!state.list.length) {
      els.list.replaceChildren(h("li", { class: "list-empty", text: `Aucun combo ne correspond à « ${q} ».` }));
      return;
    }
    els.list.replaceChildren(
      ...state.list.map((c) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              class: "combo-item",
              type: "button",
              "data-id": c.id,
              "aria-current": state.current && c.id === state.current.id ? "true" : null,
              onclick: () => {
                selectCombo(c.id);
                if (window.matchMedia(MOBILE_QUERY).matches) {
                  els.player.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
                }
              },
            },
            h("span", { class: "combo-item-notation", text: c.notation }),
            h("span", { class: "combo-item-meta", text: `Facilité ${c.usability}/10 · ${c.avgDamage} dmg moy. · Dextérité ${dexLabel(c.dexterity)}` }),
          ),
        ),
      ),
    );
    markCurrent();
  }

  function markCurrent() {
    let currentBtn = null;
    for (const btn of els.list.querySelectorAll(".combo-item")) {
      const on = state.current && btn.dataset.id === String(state.current.id);
      if (on) {
        btn.setAttribute("aria-current", "true");
        currentBtn = btn;
      } else {
        btn.removeAttribute("aria-current");
      }
    }
    // Garde le combo courant visible dans la liste, sans faire défiler la page.
    if (currentBtn) {
      const li = currentBtn.parentElement;
      const box = els.list;
      if (li.offsetTop < box.scrollTop) box.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = li.offsetTop + li.offsetHeight - box.clientHeight;
      }
    }
  }

  function selectWeapon(slug, comboId = null) {
    state.weapon = slug;
    els.weapon.value = slug;
    renderList();
    const target = (comboId != null && state.list.find((c) => c.id === comboId)) || state.list[0] || null;
    if (target) selectCombo(target.id);
  }

  function neighbour(delta) {
    if (!state.list.length) return;
    const i = state.list.findIndex((c) => state.current && c.id === state.current.id);
    const next = state.list[(i + delta + state.list.length) % state.list.length];
    if (next) selectCombo(next.id);
  }

  // ─────────────────────────── Combo courant ───────────────────────────
  function selectCombo(id) {
    const c = comboById(id);
    if (!c) return;
    state.current = c;
    hideNotice();
    markCurrent();
    history.replaceState(null, "", `${location.pathname}?c=${encodeURIComponent(c.id)}`);
    document.title = `${c.notation} · Combo Lab`;

    const w = state.catalog.weapons.find((x) => x.slug === c.weapon);
    els.comboWeapon.textContent = w ? `${w.emoji} ${w.label}` : c.weapon;
    els.title.textContent = c.notation;
    renderSteps(c);
    renderStats(c);
    els.source.href = /^https:\/\//.test(c.url || "") ? c.url : "https://www.brawldatabase.com";
    els.source.textContent = "BrawlDatabase.com";

    clearAB(true);
    resetZoom(true);
    loadVideo(c);
  }

  function renderSteps(c) {
    els.steps.replaceChildren(
      ...c.steps.map((s, i) => {
        const titles = s.move
          .split("/")
          .map((m) => MOVE_LABELS[m.trim().toLowerCase()])
          .filter(Boolean);
        const move = titles.length
          ? h("abbr", { class: "step-move", title: titles.join(" ou "), text: s.move })
          : h("span", { class: "step-move", text: s.move });
        return h(
          "li",
          { class: "step" },
          h(
            "span",
            { class: "step-chip" },
            h("span", { class: "step-num", text: String(i + 1) }),
            move,
            ...s.mods.map((m) => h("span", { class: "step-mod", title: "Modificateur BrawlDB (détails sur la page du combo)", text: m })),
          ),
        );
      }),
    );
  }

  function renderStats(c) {
    const item = (label, value) => h("div", { class: "stat" }, h("dt", { text: label }), h("dd", { text: value }));
    els.stats.replaceChildren(
      item("Facilité", `${c.usability}/10`),
      item("Dégâts", c.damage || "—"),
      item("Dégâts moyens", String(c.avgDamage ?? "—")),
      item("Dextérité", dexLabel(c.dexterity)),
      item("Étapes", String(c.steps.length)),
    );
  }

  // ─────────────────────────── Vidéo ───────────────────────────
  function setControlsEnabled(on) {
    for (const el of [els.scrub, els.back, els.fwd, els.a, els.b, els.play]) el.disabled = !on;
  }

  function loadVideo(c) {
    state.ready = false;
    setControlsEnabled(false);
    els.stageError.hidden = true;
    els.loading.hidden = false;
    els.frameInfo.textContent = "Image — / —";
    video.setAttribute("aria-label", `Vidéo du combo ${c.notation}`);
    video.src = `/lab/video/${encodeURIComponent(c.id)}.mp4`;
    video.load();
  }

  const totalFrames = () => (state.ready && video.duration > 0 ? Math.max(1, Math.round(video.duration * FPS)) : 0);
  const frameAt = (t) => clamp(Math.floor(t * FPS + 1e-4), 0, Math.max(0, totalFrames() - 1));
  const startPoint = () => state.a ?? 0;

  function seekFrame(f) {
    const n = totalFrames();
    if (!n) return;
    const frame = clamp(f, 0, n - 1);
    // Milieu de l'image visée : évite de retomber sur l'image voisine par arrondi.
    video.currentTime = Math.min(video.duration - 0.001, (frame + 0.5) / FPS);
    updateFrameInfo(frame);
  }

  function step(n) {
    if (!state.ready) return;
    video.pause();
    seekFrame(frameAt(video.currentTime) + n);
  }

  function updateFrameInfo(frame = frameAt(video.currentTime)) {
    const n = totalFrames();
    if (!n) return;
    const t = video.currentTime;
    els.frameInfo.textContent = `Image ${frame + 1} / ${n} · ${nf2.format(t)} s / ${nf2.format(video.duration)} s`;
    els.scrub.value = String(frame);
    els.scrub.setAttribute("aria-valuetext", `Image ${frame + 1} sur ${n}`);
  }

  function togglePlay() {
    if (!state.ready) return;
    if (video.paused || video.ended) {
      if (state.b != null && video.currentTime >= state.b - 0.5 / FPS) video.currentTime = startPoint();
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function updatePlayButton() {
    const playing = !video.paused && !video.ended;
    setIcon(els.play, playing ? "pause" : "play");
    els.play.setAttribute("aria-label", playing ? "Pause (K)" : "Lecture (K)");
  }

  // Boucle d'animation pendant la lecture : bornes A-B et compteur d'images.
  let raf = 0;
  function tick() {
    raf = 0;
    if (video.paused) return;
    const t = video.currentTime;
    if (state.b != null && t >= state.b) {
      if (state.loop) video.currentTime = startPoint();
      else {
        video.pause();
        video.currentTime = Math.max(0, state.b - 0.5 / FPS);
      }
    } else if (state.a != null && t < state.a - 0.5 / FPS) {
      video.currentTime = state.a;
    }
    updateFrameInfo();
    raf = requestAnimationFrame(tick);
  }

  video.addEventListener("loadedmetadata", () => {
    state.ready = true;
    els.scrub.max = String(Math.max(0, totalFrames() - 1));
    video.defaultPlaybackRate = state.speed;
    video.playbackRate = state.speed;
    applyLoopMode();
    setControlsEnabled(true);
    updateFrameInfo(0);
  });
  video.addEventListener("canplay", () => {
    els.loading.hidden = true;
    if (state.wantPlay && video.paused) video.play().catch(() => {});
  });
  video.addEventListener("waiting", () => {
    if (state.ready) els.loading.hidden = false;
  });
  video.addEventListener("playing", () => (els.loading.hidden = true));
  video.addEventListener("seeked", () => {
    els.loading.hidden = true;
    updateFrameInfo();
  });
  video.addEventListener("play", () => {
    state.wantPlay = true;
    updatePlayButton();
    if (!raf) raf = requestAnimationFrame(tick);
  });
  video.addEventListener("pause", () => {
    state.wantPlay = false;
    updatePlayButton();
    updateFrameInfo();
  });
  video.addEventListener("ended", () => {
    if (state.loop) {
      video.currentTime = startPoint();
      video.play().catch(() => {});
    } else {
      updatePlayButton();
    }
  });
  video.addEventListener("error", () => {
    if (!video.getAttribute("src")) return;
    state.ready = false;
    setControlsEnabled(false);
    els.loading.hidden = true;
    const c = state.current;
    els.stageError.replaceChildren(
      h("strong", { text: "Vidéo indisponible pour le moment." }),
      h("span", { text: "La source ne répond pas. Réessaie ou regarde le combo sur BrawlDatabase." }),
      h("div", { class: "ctrl-group" },
        h("button", { class: "btn btn-primary", type: "button", text: "Réessayer", onclick: () => c && loadVideo(c) }),
        c?.url ? h("a", { class: "btn", href: c.url, target: "_blank", rel: "noopener noreferrer", text: "Voir sur BrawlDB" }) : null,
      ),
    );
    els.stageError.hidden = false;
  });

  els.scrub.addEventListener("input", () => {
    if (!state.ready) return;
    video.pause();
    seekFrame(Number(els.scrub.value));
  });

  // ─────────────────────────── Vitesse ───────────────────────────
  function renderSpeeds() {
    els.speeds.replaceChildren(
      ...SPEEDS.map((s, i) =>
        h("button", {
          class: "btn",
          type: "button",
          "data-speed": s,
          "aria-pressed": String(s === state.speed),
          title: `Vitesse ${speedLabel(s)} (${i + 1})`,
          text: speedLabel(s),
          onclick: () => setSpeed(s),
        }),
      ),
    );
    els.badgeSpeed.textContent = speedLabel(state.speed);
  }

  function setSpeed(s) {
    state.speed = s;
    video.defaultPlaybackRate = s;
    video.playbackRate = s;
    for (const btn of els.speeds.children) btn.setAttribute("aria-pressed", String(Number(btn.dataset.speed) === s));
    els.badgeSpeed.textContent = speedLabel(s);
    savePrefs();
    announce(`Vitesse ${speedLabel(s)}`);
  }

  function shiftSpeed(delta) {
    const i = SPEEDS.indexOf(state.speed);
    setSpeed(SPEEDS[clamp((i < 0 ? SPEEDS.length - 1 : i) + delta, 0, SPEEDS.length - 1)]);
  }

  // ─────────────────────────── Boucle A-B ───────────────────────────
  function applyLoopMode() {
    // Boucle native seulement sans A-B : sinon on gère le retour au point A nous-mêmes.
    video.loop = state.loop && state.a == null && state.b == null;
  }

  function renderAB() {
    const d = video.duration;
    const any = state.a != null || state.b != null;
    els.a.setAttribute("aria-pressed", String(state.a != null));
    els.b.setAttribute("aria-pressed", String(state.b != null));
    els.abClear.disabled = !any;
    if (!any || !(d > 0)) {
      els.abRange.hidden = true;
    } else {
      const start = state.a ?? 0;
      const end = state.b ?? d;
      els.abRange.style.left = `${(start / d) * 100}%`;
      els.abRange.style.width = `${Math.max(0.5, ((end - start) / d) * 100)}%`;
      els.abRange.hidden = false;
    }
    applyLoopMode();
  }

  function setA() {
    if (!state.ready) return;
    const f = frameAt(video.currentTime);
    state.a = f / FPS;
    if (state.b != null && state.b <= state.a) state.b = null;
    renderAB();
    announce(`Début de boucle à l'image ${f + 1}`);
  }

  function setB() {
    if (!state.ready) return;
    const f = frameAt(video.currentTime);
    state.b = Math.min(video.duration, (f + 1) / FPS); // fin incluse de l'image
    if (state.a != null && state.a >= state.b) state.a = null;
    renderAB();
    announce(`Fin de boucle à l'image ${f + 1}`);
  }

  function clearAB(silent = false) {
    const had = state.a != null || state.b != null;
    state.a = null;
    state.b = null;
    renderAB();
    if (had && !silent) announce("Boucle A-B effacée");
  }

  function applyLoopButton() {
    els.loop.setAttribute("aria-pressed", String(state.loop));
    applyLoopMode();
  }

  // ─────────────────────────── Zoom / déplacement ───────────────────────────
  const z = state.zoom;

  function applyZoom() {
    els.pan.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    els.stage.classList.toggle("is-zoomed", z.s > 1.001);
    const label = `x${nf1.format(z.s)}`;
    els.zoomLevel.textContent = label;
    els.badgeZoom.textContent = `Zoom ${label}`;
    els.badgeZoom.hidden = z.s <= 1.001;
    els.zoomOut.disabled = z.s <= MIN_ZOOM + 0.001;
    els.zoomIn.disabled = z.s >= MAX_ZOOM - 0.001;
  }

  function clampPan() {
    const r = els.stage.getBoundingClientRect();
    z.x = clamp(z.x, r.width - r.width * z.s, 0);
    z.y = clamp(z.y, r.height - r.height * z.s, 0);
  }

  function zoomAt(target, px, py) {
    const s2 = clamp(target, MIN_ZOOM, MAX_ZOOM);
    const k = s2 / z.s;
    z.x = px - (px - z.x) * k;
    z.y = py - (py - z.y) * k;
    z.s = s2;
    if (s2 <= MIN_ZOOM + 0.001) {
      z.s = MIN_ZOOM;
      z.x = 0;
      z.y = 0;
    }
    clampPan();
    applyZoom();
  }

  function zoomCenter(factor) {
    const r = els.stage.getBoundingClientRect();
    zoomAt(z.s * factor, r.width / 2, r.height / 2);
    announce(`Zoom x${nf1.format(z.s)}`);
  }

  function resetZoom(silent = false) {
    z.s = 1;
    z.x = 0;
    z.y = 0;
    applyZoom();
    if (!silent) announce("Zoom réinitialisé");
  }

  const localPoint = (e) => {
    const r = els.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  els.stage.addEventListener(
    "wheel",
    (e) => {
      if (!state.ready) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const p = localPoint(e);
      zoomAt(z.s * Math.exp(-delta * 0.0015), p.x, p.y);
    },
    { passive: false },
  );

  // Pointeurs : glisser = déplacer (si zoomé), pincer = zoom, tap = lecture/pause,
  // double tap = zoom x2 / réinitialiser.
  const pointers = new Map();
  let gesture = null;
  let moved = false;
  let lastTap = 0;
  let tapTimer = 0;

  function startPan(p) {
    gesture = { type: "pan", sx: p.x, sy: p.y, ox: z.x, oy: z.y };
  }

  els.stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button")) return; // boutons des calques (erreur)
    if (e.pointerType === "mouse" && e.button !== 0) return;
    els.stage.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      moved = false;
      startPan(p);
    } else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      gesture = { type: "pinch", d0: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1, s0: z.s };
      moved = true;
    }
  });

  els.stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    const p = localPoint(e);
    pointers.set(e.pointerId, p);
    if (gesture.type === "pinch" && pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      zoomAt(gesture.s0 * (d / gesture.d0), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    } else if (gesture.type === "pan") {
      const dx = p.x - gesture.sx;
      const dy = p.y - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      if (moved && z.s > 1) {
        z.x = gesture.ox + dx;
        z.y = gesture.oy + dy;
        clampPan();
        applyZoom();
        els.stage.classList.add("is-dragging");
      }
    }
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      startPan([...pointers.values()][0]); // fin du pincement : on continue à déplacer
      return;
    }
    if (pointers.size) return;
    els.stage.classList.remove("is-dragging");
    gesture = null;
    if (e.type === "pointerup" && !moved) handleTap(localPoint(e));
  }
  els.stage.addEventListener("pointerup", endPointer);
  els.stage.addEventListener("pointercancel", endPointer);

  function handleTap(p) {
    const now = Date.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer);
      lastTap = 0;
      if (z.s > 1.001) resetZoom();
      else {
        zoomAt(2, p.x, p.y);
        announce("Zoom x2");
      }
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(togglePlay, 300);
  }

  // Les positions de déplacement sont en pixels : on repart à zéro si la taille change.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => resetZoom(true), 120);
  });
  document.addEventListener("fullscreenchange", () => resetZoom(true));

  // ─────────────────────────── Miroir, son, plein écran ───────────────────────────
  function applyMirror() {
    video.classList.toggle("is-mirrored", state.mirror);
    els.mirror.setAttribute("aria-pressed", String(state.mirror));
    els.badgeMirror.hidden = !state.mirror;
  }

  function toggleMirror() {
    state.mirror = !state.mirror;
    applyMirror();
    savePrefs();
    announce(state.mirror ? "Miroir activé" : "Miroir désactivé");
  }

  function toggleLoop() {
    state.loop = !state.loop;
    applyLoopButton();
    savePrefs();
    announce(state.loop ? "Lecture en boucle" : "Boucle désactivée");
  }

  function applyMute() {
    setIcon(els.mute, video.muted ? "volume-x" : "volume-2");
    els.mute.setAttribute("aria-pressed", String(!video.muted));
    els.mute.setAttribute("aria-label", video.muted ? "Activer le son" : "Couper le son");
  }

  const canFullscreen = Boolean(els.stage.requestFullscreen || els.stage.webkitRequestFullscreen);
  function toggleFullscreen() {
    if (!canFullscreen) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (els.stage.requestFullscreen || els.stage.webkitRequestFullscreen).call(els.stage);
  }
  if (!canFullscreen) els.fullscreen.hidden = true;

  // ─────────────────────────── Partage, aide ───────────────────────────
  async function copyLink() {
    if (!state.current) return;
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("c", String(state.current.id));
    if (state.speed !== 1) url.searchParams.set("speed", String(state.speed));
    try {
      await navigator.clipboard.writeText(url.href);
      announce("Lien copié");
      flashLabel(els.share, "Lien copié");
    } catch {
      window.prompt("Copie ce lien :", url.href);
    }
  }

  function flashLabel(btn, text) {
    const span = btn.querySelector("span");
    if (!span) return;
    const old = span.textContent;
    span.textContent = text;
    setTimeout(() => (span.textContent = old), 1600);
  }

  function openHelp() {
    if (typeof els.help.showModal === "function") els.help.showModal();
    else els.help.setAttribute("open", "");
    els.helpClose.focus();
  }
  function closeHelp() {
    if (typeof els.help.close === "function") els.help.close();
    else els.help.removeAttribute("open");
    els.helpBtn.focus();
  }

  // ─────────────────────────── Clavier ───────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (els.help.open) return; // Échap géré par <dialog>
    const t = e.target;
    if (t instanceof Element && t.closest("input, select, textarea, [contenteditable]")) {
      if (e.key === "Escape" && t === els.search) els.search.blur();
      return;
    }
    if (!state.current) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code || "");
    let handled = true;

    if (digit && digit[1] !== "0" && Number(digit[1]) <= SPEEDS.length) setSpeed(SPEEDS[Number(digit[1]) - 1]);
    else if (digit && digit[1] === "0") resetZoom();
    else if (key === "k") togglePlay();
    else if (key === " ") {
      // Espace sur un bouton : comportement natif (activer le bouton).
      if (t instanceof Element && t.closest("button, a")) handled = false;
      else togglePlay();
    } else if (key === "ArrowLeft") step(e.shiftKey ? -10 : -1);
    else if (key === "ArrowRight") step(e.shiftKey ? 10 : 1);
    else if (key === "ArrowUp" || key === "]") shiftSpeed(1);
    else if (key === "ArrowDown" || key === "[") shiftSpeed(-1);
    else if (key === "a") setA();
    else if (key === "b") setB();
    else if (key === "x") clearAB();
    else if (key === "+" || key === "=" || e.code === "NumpadAdd") zoomCenter(1.25);
    else if (key === "-" || key === "_" || e.code === "NumpadSubtract") zoomCenter(0.8);
    else if (key === "m") toggleMirror();
    else if (key === "l") toggleLoop();
    else if (key === "f") toggleFullscreen();
    else if (key === "n") neighbour(1);
    else if (key === "p") neighbour(-1);
    else if (key === "Home") {
      if (state.ready) {
        video.currentTime = startPoint();
        updateFrameInfo();
      }
    } else if (key === "?") openHelp();
    else handled = false;

    if (handled) e.preventDefault();
  });

  // ─────────────────────────── Branchements ───────────────────────────
  for (const btn of document.querySelectorAll("[data-icon]")) setIcon(btn, btn.dataset.icon);

  els.play.addEventListener("click", togglePlay);
  els.back.addEventListener("click", () => step(-1));
  els.fwd.addEventListener("click", () => step(1));
  els.prev.addEventListener("click", () => neighbour(-1));
  els.next.addEventListener("click", () => neighbour(1));
  els.a.addEventListener("click", setA);
  els.b.addEventListener("click", setB);
  els.abClear.addEventListener("click", () => clearAB());
  els.zoomIn.addEventListener("click", () => zoomCenter(1.25));
  els.zoomOut.addEventListener("click", () => zoomCenter(0.8));
  els.zoomReset.addEventListener("click", () => resetZoom());
  els.mirror.addEventListener("click", toggleMirror);
  els.loop.addEventListener("click", toggleLoop);
  els.mute.addEventListener("click", () => {
    video.muted = !video.muted;
    applyMute();
  });
  els.fullscreen.addEventListener("click", toggleFullscreen);
  els.share.addEventListener("click", copyLink);
  els.helpBtn.addEventListener("click", openHelp);
  els.helpClose.addEventListener("click", closeHelp);
  els.help.addEventListener("click", (e) => {
    if (e.target === els.help) closeHelp(); // clic sur le fond
  });
  els.weapon.addEventListener("change", () => selectWeapon(els.weapon.value));
  els.search.addEventListener("input", renderList);
  els.sort.addEventListener("change", renderList);

  loadPrefs();
  applyMute();
  applyZoom();
  setControlsEnabled(false);
  loadCatalog();
})();
