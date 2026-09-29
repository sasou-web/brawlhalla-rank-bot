"use strict";

/* ════════════════════════════════════════════════════════════════════
   MODE CATGIRL — surcouche kawaii optionnelle pour le dashboard.
   100 % cloisonné : se branche sur les fonctions globales du dashboard
   (toast, renderOverview, showLogin) sans les réécrire, et s'expose via
   window.xkCatgirl ({ isOn, toggle, set }) : la bascule se trouve dans le
   menu du compte et dans la palette de commandes (Ctrl K).
   Exploite l'API https://nekos.best/api/v2 :
     • images : neko · waifu · kitsune · husbando
     • gifs    : pat · hug · happy · wink · smile · cuddle · cry · pout…
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const LS_KEY = "bh_catgirl";
  let catOn = false;
  try {
    catOn = localStorage.getItem(LS_KEY) === "1";
  } catch {
    /* stockage indisponible */
  }

  // ---------------------------------------------------------------- API
  const API = "https://nekos.best/api/v2";
  const pools = {}; // category -> [résultats] (réservoir préchargé)

  async function fetchNeko(category, amount = 1) {
    const n = Math.min(Math.max(amount, 1), 20);
    const res = await fetch(`${API}/${category}?amount=${n}`);
    if (!res.ok) throw new Error("nekos.best " + res.status);
    return (await res.json()).results || [];
  }

  async function pick(category) {
    if (!pools[category] || !pools[category].length) {
      pools[category] = await fetchNeko(category, 12);
    }
    const item = pools[category].shift();
    if (pools[category].length < 3) {
      fetchNeko(category, 12)
        .then((r) => (pools[category] = (pools[category] || []).concat(r)))
        .catch(() => {});
    }
    return item;
  }

  function warmup() {
    ["neko", "happy", "pat", "pout"].forEach((c) =>
      fetchNeko(c, 12)
        .then((r) => (pools[c] = r))
        .catch(() => {}),
    );
  }

  // Polices rondes chargées uniquement quand le mode est actif.
  function ensureFonts() {
    if (document.getElementById("catgirl-fonts")) return;
    const link = document.createElement("link");
    link.id = "catgirl-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;600;700&family=Quicksand:wght@400;500;600;700&display=swap";
    document.head.append(link);
  }

  // -------------------------------------------------------- Microcopie nya
  const GREETINGS = [
    "Nya~ bienvenue sur le dashboard !",
    "Prête à dompter ton serveur, master ?",
    "Clique-moi pour une nouvelle pose~",
    "Tout est rose et tout va bien uwu",
    "On configure des trucs trop mignons aujourd'hui ? owo",
    "Ronron… ton serveur est entre de bonnes pattes",
  ];
  const OK_WORDS = ["Yatta~ c'est fait !", "Nyaa~ bien joué master", "Parfait, tout doux", "Fait avec amour uwu"];
  const ERR_WORDS = ["Awwn… ça a raté", "Gomen ! Une erreur est passée par là", "Nyo… réessaie master ?"];
  const rand = (a) => a[Math.floor(Math.random() * a.length)];

  // ------------------------------------------------------------- Mascotte
  let mascotEl, bubbleEl, imgEl, bubbleTimer;

  function buildMascot() {
    if (mascotEl) return;
    mascotEl = document.createElement("div");
    mascotEl.className = "cat-mascot";
    bubbleEl = document.createElement("div");
    bubbleEl.className = "cat-bubble";
    bubbleEl.setAttribute("aria-live", "polite");
    imgEl = document.createElement("img");
    imgEl.className = "cm-img";
    imgEl.alt = "Mascotte neko";
    imgEl.title = "Clique-moi nya~";
    imgEl.addEventListener("click", () => newMascot(rand(GREETINGS)));
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cm-close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Cacher la mascotte");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      mascotEl.classList.remove("show");
    });
    mascotEl.append(close, bubbleEl, imgEl);
    document.body.append(mascotEl);
  }

  function sayBubble(text, gifUrl) {
    if (!bubbleEl) return;
    bubbleEl.textContent = text;
    if (gifUrl) {
      const g = document.createElement("img");
      g.className = "cb-gif";
      g.alt = "";
      g.src = gifUrl;
      bubbleEl.append(g);
    }
    bubbleEl.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove("show"), gifUrl ? 5200 : 4200);
  }

  async function newMascot(text) {
    buildMascot();
    mascotEl.classList.add("show");
    try {
      const it = await pick("neko");
      if (it) imgEl.src = it.url;
    } catch {
      /* l'API peut hoqueter, on garde l'ancienne image */
    }
    if (text) sayBubble(text);
  }

  async function reactTo(kind) {
    if (!catOn) return;
    buildMascot();
    mascotEl.classList.add("show");
    const cats = kind === "err" ? ["pout", "cry"] : ["happy", "pat", "smile", "wink"];
    const words = kind === "err" ? ERR_WORDS : OK_WORDS;
    try {
      const it = await pick(rand(cats));
      sayBubble(rand(words), it && it.url);
    } catch {
      sayBubble(rand(words));
    }
  }

  // -------------------------------------------------------------- Sparkles
  let sparkleLayer;
  function buildSparkles() {
    if (sparkleLayer) return;
    sparkleLayer = document.createElement("div");
    sparkleLayer.className = "cat-sparkles";
    sparkleLayer.setAttribute("aria-hidden", "true");
    const glyphs = ["✨", "🌸", "💕", "⭐", "🐾", "💗"];
    for (let i = 0; i < 22; i++) {
      const s = document.createElement("span");
      s.className = "spk";
      s.textContent = glyphs[i % glyphs.length];
      s.style.left = Math.random() * 100 + "vw";
      s.style.animationDuration = 9 + Math.random() * 12 + "s";
      s.style.animationDelay = -Math.random() * 18 + "s";
      s.style.fontSize = 11 + Math.random() * 16 + "px";
      sparkleLayer.append(s);
    }
    document.body.append(sparkleLayer);
  }

  let lastTrail = 0;
  function onMove(e) {
    if (!catOn) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = Date.now();
    if (now - lastTrail < 90) return;
    lastTrail = now;
    const t = document.createElement("div");
    t.className = "cat-trail";
    t.setAttribute("aria-hidden", "true");
    t.textContent = Math.random() > 0.5 ? "✨" : "🌸";
    t.style.left = e.clientX + "px";
    t.style.top = e.clientY + "px";
    document.body.append(t);
    setTimeout(() => t.remove(), 800);
  }

  // ------------------------------------------------------ Galerie Neko (vue d'ensemble)
  const GALLERY_CATS = [
    { id: "neko", label: "Neko" },
    { id: "waifu", label: "Waifu" },
    { id: "kitsune", label: "Kitsune" },
    { id: "husbando", label: "Husbando" },
  ];

  function buildGallery() {
    const section = document.createElement("section");
    section.className = "section cat-gallery";
    const head = document.createElement("div");
    head.className = "section-head";
    const text = document.createElement("div");
    const h = document.createElement("h2");
    h.className = "section-title";
    h.textContent = "Galerie Neko";
    const sub = document.createElement("p");
    sub.className = "section-desc";
    sub.textContent = "Une dose de mignonnerie offerte par nekos.best nya~";
    text.append(h, sub);
    head.append(text);
    const tabs = document.createElement("div");
    tabs.className = "neko-cat-tabs";
    const grid = document.createElement("div");
    grid.className = "neko-gallery";
    let active = "neko";

    async function load() {
      grid.innerHTML = "";
      for (let i = 0; i < 8; i++) {
        const sk = document.createElement("div");
        sk.className = "neko-cell skel";
        grid.append(sk);
      }
      let items = [];
      try {
        items = await fetchNeko(active, 12);
      } catch {
        /* hors ligne */
      }
      grid.innerHTML = "";
      if (!items.length) {
        const e = document.createElement("p");
        e.className = "text-sm text-2";
        e.textContent = "nekos.best est injoignable pour le moment.";
        grid.append(e);
        return;
      }
      for (const it of items) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "neko-cell";
        cell.setAttribute("aria-label", it.artist_name ? `Agrandir l'image de ${it.artist_name}` : "Agrandir l'image");
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = "";
        img.src = it.url;
        cell.append(img);
        if (it.artist_name) {
          const cr = document.createElement("span");
          cr.className = "nk-credit";
          cr.textContent = it.artist_name;
          cell.append(cr);
        }
        cell.addEventListener("click", () => openViewer(it));
        grid.append(cell);
      }
    }

    for (const c of GALLERY_CATS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "neko-chip" + (c.id === active ? " active" : "");
      chip.textContent = c.label;
      chip.setAttribute("aria-pressed", String(c.id === active));
      chip.addEventListener("click", () => {
        active = c.id;
        [...tabs.children].forEach((x) => {
          x.classList.remove("active");
          x.setAttribute("aria-pressed", "false");
        });
        chip.classList.add("active");
        chip.setAttribute("aria-pressed", "true");
        load();
      });
      tabs.append(chip);
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "neko-chip";
    refresh.textContent = "Rafraîchir";
    refresh.addEventListener("click", load);
    tabs.append(refresh);

    section.append(head, tabs, grid);
    load();
    return section;
  }

  // Visionneuse : réutilise le dialogue du dashboard s'il est disponible.
  function openViewer(it) {
    const img = document.createElement("img");
    img.className = "neko-viewer-img";
    img.alt = "";
    img.src = it.url;
    const body = document.createElement("div");
    body.append(img);
    if (it.artist_name) {
      const credit = document.createElement("p");
      credit.className = "text-sm text-2";
      credit.style.marginTop = "12px";
      credit.style.textAlign = "center";
      if (it.source_url && /^https?:\/\//.test(it.source_url)) {
        const a = document.createElement("a");
        a.href = it.source_url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = it.artist_name;
        credit.append("Illustration : ", a);
      } else credit.textContent = "Illustration : " + it.artist_name;
      body.append(credit);
    }
    if (typeof window.openDialog === "function") {
      window.openDialog({ title: "Galerie Neko", body, size: "md", actions: [{ label: "Fermer nya~", variant: "primary" }] });
    } else window.open(it.url, "_blank", "noopener");
  }

  // --------------------------------------------------- Bascule + activation
  function rerender() {
    const app = document.getElementById("app");
    if (typeof window.renderApp === "function" && app && app.classList.contains("active")) window.renderApp();
  }

  function setCatgirl(on, { greet = true } = {}) {
    catOn = !!on;
    try {
      localStorage.setItem(LS_KEY, catOn ? "1" : "0");
    } catch {
      /* stockage indisponible */
    }
    document.body.classList.toggle("catgirl", catOn);
    if (catOn) {
      ensureFonts();
      buildSparkles();
      warmup();
      newMascot(greet ? rand(GREETINGS) : null);
      decorateLogin();
    } else {
      if (mascotEl) mascotEl.classList.remove("show");
      if (bubbleEl) bubbleEl.classList.remove("show");
    }
    rerender();
  }

  window.xkCatgirl = {
    isOn: () => catOn,
    toggle: () => setCatgirl(!catOn),
    set: (v) => setCatgirl(v),
  };

  async function decorateLogin() {
    const login = document.getElementById("login");
    if (!login || !catOn) return;
    const card = login.querySelector(".login-card");
    if (!card || card.querySelector(".login-neko")) return;
    const img = document.createElement("img");
    img.className = "login-neko";
    img.alt = "";
    card.prepend(img);
    try {
      const it = await pick("neko");
      if (it) img.src = it.url;
    } catch {
      /* ok */
    }
  }

  // ------------------------------------------------------------- Branchements
  function hook() {
    // 1) Toast → réaction de la mascotte.
    if (typeof window.toast === "function" && !window.toast._catHooked) {
      const orig = window.toast;
      window.toast = function (msg, kind, opts) {
        orig(msg, kind, opts);
        reactTo(kind === "err" ? "err" : "ok");
      };
      window.toast._catHooked = true;
    }

    // 2) renderOverview → ajoute la galerie neko quand le mode est actif.
    if (typeof window.renderOverview === "function" && !window.renderOverview._catHooked) {
      const orig = window.renderOverview;
      window.renderOverview = function (content) {
        orig.call(this, content);
        if (catOn) content.append(buildGallery());
      };
      window.renderOverview._catHooked = true;
    }

    // 3) showLogin → décoration neko.
    if (typeof window.showLogin === "function" && !window.showLogin._catHooked) {
      const orig = window.showLogin;
      window.showLogin = function () {
        orig.apply(this, arguments);
        decorateLogin();
      };
      window.showLogin._catHooked = true;
    }
    return !!(window.toast && window.toast._catHooked && window.renderOverview && window.renderOverview._catHooked && window.showLogin && window.showLogin._catHooked);
  }

  function init() {
    document.body.classList.toggle("catgirl", catOn);
    document.addEventListener("mousemove", onMove, { passive: true });

    // Le dashboard définit ses fonctions globales puis démarre de façon
    // asynchrone : on se branche dès que possible, puis on relance un rendu
    // si l'application était déjà affichée (pour injecter la galerie).
    const app = document.getElementById("app");
    const wasActive = app && app.classList.contains("active");
    if (hook()) {
      if (catOn && wasActive) rerender();
    } else {
      let tries = 0;
      const iv = setInterval(() => {
        if (hook() || ++tries > 40) {
          clearInterval(iv);
          if (catOn) rerender();
        }
      }, 150);
    }

    if (catOn) {
      ensureFonts();
      buildSparkles();
      warmup();
      newMascot(rand(GREETINGS));
      decorateLogin();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
