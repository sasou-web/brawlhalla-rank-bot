// Handlers de l'API de configuration du dashboard, extraits de server.js pour être
// testables sans Express ni Discord (un faux `res` suffit).

/**
 * PUT /api/config/:section. `sections` : { [nom]: { get, set } } (voir buildSections).
 * Une erreur portant `httpStatus` (entier 400-599, ex. validation refusée) est renvoyée
 * avec ce statut ; toute autre erreur donne un 500.
 */
export function configPutHandler(sections) {
  return async (req, res) => {
    const s = sections[req.params.section];
    if (!s) return res.status(404).json({ error: "section inconnue" });
    try {
      // Anti mass-assignment : on ne garde que les clés déjà présentes dans le schéma
      // de config courant de la section (empêche d'injecter des champs arbitraires dans
      // les docs via Object.assign côté setters).
      const current = await s.get();
      const allowed = new Set(Object.keys(current || {}));
      const body = req.body || {};
      const filtered = {};
      for (const k of Object.keys(body)) if (allowed.has(k)) filtered[k] = body[k];
      const updated = await s.set(filtered);
      res.json(updated);
    } catch (err) {
      const status = Number.isInteger(err?.httpStatus) && err.httpStatus >= 400 && err.httpStatus <= 599 ? err.httpStatus : 500;
      res.status(status).json({ error: err.message });
    }
  };
}
