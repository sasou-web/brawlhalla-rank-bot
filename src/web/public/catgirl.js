"use strict";

/* ════════════════════════════════════════════════════════════════════
   🐾 MODE CATGIRL — surcouche kawaii pour le dashboard.
   100 % cloisonné : se branche sur les fonctions globales d'app.js
   (toast, renderApp, renderOverview, showLogin) sans les réécrire.
   Exploite l'API https://nekos.best/api/v2 à fond :
     • images  : neko · waifu · kitsune · husbando
     • gifs     : pat · hug · happy · wink · smile · cuddle · cry · pout…
   ════════════════════════════════════════════════════════════════════ */

(function () {
  const LS_KEY = "bh_catgirl";
  let catOn = localStorage.getItem(LS_KEY) === "1";

  // ---------------------------------------------------------------- API
  const API = "https://nekos.best/api/v2";
  const pools = {}; // category -> [résultats] (réservoir préchargé)

  // Récupère `amount` éléments d'une catégorie (max 20 par appel API).
  async function fetchNeko(category, amount = 1) {
    const n = Math.min(Math.max(amount, 1), 20);
    const res = await fetch(`${API}/${category}?amount=${n}`);
    if (!res.ok) throw new Error("nekos.best " + res.status);
    return (await res.json()).results || [];
  }

  // Pioche 1 élément depuis un réservoir, le recharge en arrière-plan.
  async function pick(category) {
    if (!pools[category] || !pools[category].length) {
      pools[category] = await fetchNeko(category, 12);
    }
    const item = pools[category].shift();
    if (pools[category].length < 3) {
      fetchNeko(category, 12).then((r) => (pools[category] = (pools[category] || []).concat(r))).catch(() => {});
    }
    return item;
  }

  // Précharge quelques catégories utiles dès l'activation.
  function warmup() {
    ["neko", "happy", "pat", "pout"].forEach((c) => fetchNeko(c, 12).then((r) => (pools[c] = r)).catch(() => {}));
  }

  // -------------------------------------------------------- Microcopie nya
  const GREETINGS = [
    "Nya~ bienvenue sur le dashboard ! ✨",
    "Prête à dompter ton serveur, master ? 🐾",
    "Clique-moi pour une nouvelle pose~ 💕",
    "Tout est rose et tout va bien uwu",
    "On configure des trucs trop mignons aujourd'hui ? owo",
    "Ronron… ton serveur est entre de bonnes pattes 🐱",
  ];
  const OK_WORDS = ["Yatta~ c'est sauvegardé ! ✨", "Nyaa~ bien joué master 💕", "Parfait, tout doux 🐾", "Enregistré avec amour uwu"];
  const ERR_WORDS = ["Awwn… ça a raté 🥺", "Gomen ! Une erreur est passée par là 💔", "Nyo… réessaie master ?"];
  const rand = (a) => a[Math.floor(Math.random() * a.length)];

  // ------------------------------------------------------------- Mascotte
  let mascotEl, bubbleEl, imgEl, bubbleTimer;

  function buildMascot() {
    if (mascotEl) return;
    mascotEl = document.createElement("div");
    mascotEl.className = "cat-mascot";
    bubbleEl = document.createElement("div");
    bubbleEl.className = "cat-bubble";
    imgEl = document.createElement("img");
    imgEl.className = "cm-img";
    imgEl.alt = "Mascotte neko";
    imgEl.title = "Clique-moi nya~";
    imgEl.addEventListener("click", () => newMascot(rand(GREETINGS)));
    const close = document.createElement("div");
    close.className = "cm-close";
    close.textContent = "✕";
    close.title = "Cacher la mascotte";
    close.addEventListener("click", (e) => { e.stopPropagation(); mascotEl.classList.remove("show"); });
    mascotEl.append(close, bubbleEl, imgEl);
    document.body.append(mascotEl);
  }

  function sayBubble(text, gifUrl) {
    if (!bubbleEl) return;
    bubbleEl.innerHTML = "";
    bubbleEl.append(document.createTextNode(text));
    if (gifUrl) {
      const g = document.createElement("img");
      g.className = "cb-gif";
      g.src = gifUrl;
      bubbleEl.append(g);
    }
    bubbleEl.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubbleEl.classList.remove("show"), gifUrl ? 5200 : 4200);
  }

  // Nouvelle image de mascotte + bulle.
  async function newMascot(text) {
    buildMascot();
    mascotEl.classList.add("show");
    try {
      const it = await pick("neko");
      if (it) imgEl.src = it.url;
    } catch { /* l'API peut hoqueter, on garde l'ancienne image */ }
    if (text) sayBubble(text);
  }

  // Réaction de la mascotte à un toast (succès → happy/pat, erreur → pout/cry).
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

  // Traînée de curseur (légère, throttlée).
  let lastTrail = 0;
  function onMove(e) {
    if (!catOn) return;
    const now = Date.now();
    if (now - lastTrail < 90) return;
    lastTrail = now;
    const t = document.createElement("div");
    t.className = "cat-trail";
    t.textContent = Math.random() > 0.5 ? "✨" : "🌸";
    t.style.left = e.clientX + "px";
    t.style.top = e.clientY + "px";
    document.body.append(t);
    setTimeout(() => t.remove(), 800);
  }

  // ------------------------------------------------------ Galerie Neko (overview)
  const GALLERY_CATS = [
    { id: "neko", label: "🐱 Neko" },
    { id: "waifu", label: "🌸 Waifu" },
    { id: "kitsune", label: "🦊 Kitsune" },
    { id: "husbando", label: "💙 Husbando" },
  ];

  function buildGalleryCard() {
    const card = document.createElement("div");
    card.className = "card";
    card.style.marginTop = "18px";
    const h = document.createElement("h3");
    h.textContent = "🐾 Galerie Neko";
    const sub = document.createElement("div");
    sub.className = "card-sub";
    sub.textContent = "Une dose de mignonnerie offerte par nekos.best — change de catégorie ou rafraîchis nya~";
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
      try { items = await fetchNeko(active, 12); } catch { /* offline */ }
      grid.innerHTML = "";
      if (!items.length) {
        const e = document.createElement("div");
        e.className = "empty-row";
        e.style.gridColumn = "1/-1";
        e.textContent = "nekos.best est injoignable pour le moment 🥺";
        grid.append(e);
        return;
      }
      for (const it of items) {
        const cell = document.createElement("div");
        cell.className = "neko-cell";
        const img = document.createElement("img");
        img.loading = "lazy";
        img.src = it.url;
        cell.append(img);
        if (it.artist_name) {
          const cr = document.createElement("div");
          cr.className = "nk-credit";
          cr.textContent = "🎨 " + it.artist_name;
          cell.append(cr);
        }
        cell.addEventListener("click", () => openViewer(it));
        grid.append(cell);
      }
    }

    for (const c of GALLERY_CATS) {
      const chip = document.createElement("button");
      chip.className = "neko-chip" + (c.id === active ? " active" : "");
      chip.textContent = c.label;
      chip.addEventListener("click", () => {
        active = c.id;
        [...tabs.children].forEach((x) => x.classList.remove("active"));
        chip.classList.add("active");
        load();
      });
      tabs.append(chip);
    }
    const refresh = document.createElement("button");
    refresh.className = "neko-chip";
    refresh.textContent = "🔄 Rafraîchir";
    refresh.addEventListener("click", load);
    tabs.append(refresh);

    card.append(h, sub, tabs, grid);
    load();
    return card;
  }

  // Visionneuse modale (réutilise le style .modal-overlay d'app.js).
  function openViewer(it) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const close = () => { overlay.classList.remove("show"); setTimeout(() => overlay.remove(), 200); };
    const card = document.createElement("div");
    card.className = "modal-card";
    card.style.maxWidth = "560px";
    card.style.width = "92vw";
    const img = document.createElement("img");
    img.className = "neko-viewer-img";
    img.src = it.url;
    card.append(img);
    if (it.artist_name) {
      const credit = document.createElement("div");
      credit.className = "card-sub";
      credit.style.marginTop = "12px";
      credit.style.textAlign = "center";
      credit.innerHTML = it.source_url
        ? `🎨 <a href="${it.source_url}" target="_blank" rel="noopener">${it.artist_name}</a>`
        : "🎨 " + it.artist_name;
      card.append(credit);
    }
    const btn = document.createElement("button");
    btn.className = "modal-btn primary";
    btn.textContent = "Fermer nya~";
    btn.onclick = close;
    const acts = document.createElement("div");
    acts.className = "modal-actions";
    acts.append(btn);
    card.append(acts);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.append(card);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
  }

  // --------------------------------------------------- Bascule + activation
  function setCatgirl(on, { greet = true } = {}) {
    catOn = on;
    localStorage.setItem(LS_KEY, on ? "1" : "0");
    document.body.classList.toggle("catgirl", on);
    syncToggleLabel();
    if (on) {
      buildSparkles();
      warmup();
      newMascot(greet ? rand(GREETINGS) : null);
      // Recharge la vue courante pour injecter les éléments catgirl (galerie…).
      if (typeof window.renderApp === "function" && document.getElementById("app").classList.contains("active")) {
        window.renderApp();
      }
      decorateLogin();
    } else {
      if (mascotEl) mascotEl.classList.remove("show");
      if (bubbleEl) bubbleEl.classList.remove("show");
      if (typeof window.renderApp === "function" && document.getElementById("app").classList.contains("active")) {
        window.renderApp();
      }
    }
  }

  let toggleBtn;
  function syncToggleLabel() {
    if (toggleBtn) toggleBtn.textContent = catOn ? "🐾 Mode normal" : "🐾 Mode Catgirl";
  }

  // Ajoute le bouton de bascule dans la sidebar (après chaque renderApp).
  function ensureToggle() {
    const foot = document.querySelector(".sidebar-foot");
    if (!foot) return;
    if (foot.querySelector(".catgirl-toggle")) { toggleBtn = foot.querySelector(".catgirl-toggle"); syncToggleLabel(); return; }
    toggleBtn = document.createElement("button");
    toggleBtn.className = "catgirl-toggle";
    toggleBtn.addEventListener("click", () => setCatgirl(!catOn));
    syncToggleLabel();
    foot.append(toggleBtn);
  }

  // Décore l'écran de login avec une neko si le mode est actif.
  async function decorateLogin() {
    const login = document.getElementById("login");
    if (!login || !catOn) return;
    const card = login.querySelector(".login-card");
    if (!card || card.querySelector(".login-neko")) return;
    const img = document.createElement("img");
    img.className = "login-neko";
    card.prepend(img);
    try { const it = await pick("neko"); if (it) img.src = it.url; } catch { /* ok */ }
  }

  // ------------------------------------------------------------- Branchements
  function hook() {
    // 1) Toast → réaction de la mascotte.
    if (typeof window.toast === "function" && !window.toast._catHooked) {
      const orig = window.toast;
      window.toast = function (msg, kind) {
        orig(msg, kind);
        reactTo(kind === "err" ? "err" : "ok");
      };
      window.toast._catHooked = true;
    }

    // 2) renderApp → réinjecte le bouton de bascule.
    if (typeof window.renderApp === "function" && !window.renderApp._catHooked) {
      const orig = window.renderApp;
      window.renderApp = function () {
        orig.apply(this, arguments);
        ensureToggle();
      };
      window.renderApp._catHooked = true;
    }

    // 3) renderOverview → ajoute la galerie neko quand le mode est actif.
    if (typeof window.renderOverview === "function" && !window.renderOverview._catHooked) {
      const orig = window.renderOverview;
      window.renderOverview = function (content) {
        orig.call(this, content);
        if (catOn) content.append(buildGalleryCard());
      };
      window.renderOverview._catHooked = true;
    }

    // 4) showLogin → décoration neko.
    if (typeof window.showLogin === "function" && !window.showLogin._catHooked) {
      const orig = window.showLogin;
      window.showLogin = function () {
        orig.apply(this, arguments);
        decorateLogin();
      };
      window.showLogin._catHooked = true;
    }
  }

  // ------------------------------------------------------------------- Boot
  function init() {
    document.body.classList.toggle("catgirl", catOn);
    document.addEventListener("mousemove", onMove, { passive: true });

    // app.js définit ses fonctions globales puis appelle boot() de façon async ;
    // on tente de se brancher plusieurs fois le temps que tout soit prêt.
    let tries = 0;
    let forced = false;
    const iv = setInterval(() => {
      hook();
      ensureToggle();
      // Une fois branché, si le mode est déjà actif au chargement,
      // on relance un rendu pour injecter la galerie neko dans la vue.
      if (catOn && !forced && window.renderApp && window.renderApp._catHooked) {
        const app = document.getElementById("app");
        if (app && app.classList.contains("active")) { forced = true; window.renderApp(); }
      }
      if (++tries > 40 || (window.toast && window.toast._catHooked && window.renderApp && window.renderApp._catHooked && forced)) {
        clearInterval(iv);
      }
    }, 150);

    if (catOn) {
      buildSparkles();
      warmup();
      newMascot(rand(GREETINGS));
      decorateLogin();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
