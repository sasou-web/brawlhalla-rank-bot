/**
 * Combo Lab : routes PUBLIQUES (sans authentification) de la page d'entraînement /lab/.
 * Partagées par le vrai serveur (src/web/server.js) et le mock (scripts/dash-mock.js) :
 * aucun import Discord ni base ici, les sources de données sont injectées.
 *
 *   GET /lab/api/combos      → catalogue public (armes + combos), lecture seule
 *   GET /lab/video/<id>.mp4  → vidéo d'un combo, avec requêtes Range (lecture, recherche,
 *                              image par image dans le navigateur)
 *
 * Sécurité : aucune donnée membre ; le proxy vidéo ne résout QUE des ids du dataset
 * (jamais une URL fournie par le client), donc pas de SSRF ; compteurs de rate-limit
 * distincts de ceux du dashboard (/api).
 * La page elle-même (src/web/public/lab/) est servie par express.static.
 */
import { buildLabCatalog } from "../comboData.js";

const pass = (req, res, next) => next();

/**
 * Analyse un en-tête Range (une seule plage d'octets) pour une ressource de `size` octets.
 * Renvoie null (pas de Range exploitable → réponse complète), "invalid" (→ 416),
 * ou { start, end } (bornes incluses).
 */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m) return null; // plages multiples ou unité inconnue : ignorées (RFC 9110), réponse complète
  const [, s, e] = m;
  if (s === "" && e === "") return "invalid";
  let start;
  let end;
  if (s === "") {
    // Suffixe : les N derniers octets.
    const n = Number(e);
    if (!(n > 0)) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(s);
    end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || size <= 0 || start >= size || start > end) {
    return "invalid";
  }
  return { start, end };
}

/** Envoie un buffer MP4 en respectant l'en-tête Range (200, 206 ou 416). */
export function sendVideoBuffer(req, res, buf) {
  const size = buf.length;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "public, max-age=86400");
  const range = parseRange(req.headers.range, size);
  if (range === "invalid") {
    res.setHeader("Content-Range", `bytes */${size}`);
    return res.status(416).end();
  }
  const body = range ? buf.subarray(range.start, range.end + 1) : buf;
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  }
  res.setHeader("Content-Length", body.length);
  return req.method === "HEAD" ? res.end() : res.end(body);
}

/**
 * Monte les routes du Combo Lab. À appeler AVANT le 404 `/api`, `express.static` et le
 * fallback SPA du dashboard.
 * deps.getCombos()  → Promise<combo[]> (dataset complet, avec `video` et `url`)
 * deps.getVideo(c)  → Promise<Buffer|null>
 * deps.apiLimiter / deps.videoLimiter : middlewares de rate-limit (optionnels)
 * deps.catalogCacheControl : cache du catalogue (5 min par défaut ; "no-store" dans le mock
 *                            pour que les scénarios vide / erreur s'appliquent immédiatement)
 */
export function mountComboLab(app, { getCombos, getVideo, apiLimiter = pass, videoLimiter = pass, catalogCacheControl = "public, max-age=300" }) {
  app.use("/lab/api", apiLimiter);
  app.use("/lab/video", videoLimiter);

  app.get("/lab/api/combos", async (req, res) => {
    try {
      const catalog = buildLabCatalog(await getCombos());
      res.setHeader("Cache-Control", catalogCacheControl);
      res.json(catalog);
    } catch (err) {
      console.warn("Combo Lab : lecture des combos impossible :", err.message);
      res.status(500).json({ error: "Impossible de lire la base de combos pour le moment." });
    }
  });

  app.get("/lab/video/:file", async (req, res) => {
    const m = /^(\d{1,6})\.mp4$/.exec(req.params.file);
    if (!m) return res.status(404).json({ error: "Vidéo inconnue." });
    try {
      const combos = await getCombos();
      const combo = combos.find((c) => String(c.id) === m[1]);
      if (!combo) return res.status(404).json({ error: "Vidéo inconnue." });
      const buf = await getVideo(combo);
      if (!buf) return res.status(502).json({ error: "Vidéo indisponible pour le moment." });
      return sendVideoBuffer(req, res, buf);
    } catch (err) {
      console.warn("Combo Lab : vidéo indisponible :", err.message);
      return res.status(500).json({ error: "Vidéo indisponible pour le moment." });
    }
  });

  // Toute autre route sous /lab/api : 404 JSON (et non la page HTML).
  app.use("/lab/api", (req, res) => res.status(404).json({ error: "route inconnue" }));
}
