/**
 * Intégration start.gg : lecture du seeding d'un événement ET réécriture du seeding (mutation),
 * pour seeder un tournoi qui vit ENTIÈREMENT sur start.gg d'après le niveau Brawlhalla.
 *
 * API GraphQL publique (https://api.start.gg/gql/alpha). Exige un Personal Access Token
 * (start.gg → Settings → Developer → Personal Access Tokens). Pour réécrire le seeding, le
 * token doit appartenir à un compte ADMIN du tournoi.
 */

const STARTGG_GQL = "https://api.start.gg/gql/alpha";

/**
 * Extrait le "slug" d'événement attendu par l'API à partir d'un lien start.gg.
 * Accepte une URL complète ou un slug déjà au bon format.
 * Ex: https://www.start.gg/tournament/my-cup/event/1v1-singles?... -> "tournament/my-cup/event/1v1-singles"
 */
export function parseStartggEventSlug(input) {
  if (!input || typeof input !== "string") throw new Error("Lien start.gg manquant.");
  const s = input.trim();
  const m = s.match(/tournament\/([^/\s?#]+)\/event\/([^/\s?#]+)/i);
  if (!m) {
    throw new Error(
      "Lien start.gg invalide : il doit pointer vers un ÉVÉNEMENT (ex: .../tournament/<nom>/event/<event>).",
    );
  }
  return `tournament/${m[1]}/event/${m[2]}`;
}

// Normalise un nom pour comparer (sans accents, sans caractères spéciaux, minuscules).
export function normalizeName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

// Requête GraphQL générique vers start.gg, avec gestion des erreurs courantes.
async function gql(token, query, variables) {
  if (!token) throw new Error("Token start.gg requis.");
  const res = await fetch(STARTGG_GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Token start.gg refusé (401/403). Vérifie ton Personal Access Token.");
  }
  if (res.status === 429) {
    throw new Error("Trop de requêtes vers start.gg (429). Réessaie dans quelques secondes.");
  }
  if (!res.ok) throw new Error(`start.gg a répondu HTTP ${res.status}.`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`start.gg : ${json.errors.map((e) => e.message).join(" / ")}`);
  }
  return json.data;
}

const EVENT_PHASES_QUERY = `
  query EventPhases($slug: String!) {
    event(slug: $slug) {
      id
      name
      phases { id name }
    }
  }
`;

const PHASE_SEEDS_QUERY = `
  query PhaseSeeds($phaseId: ID!, $page: Int!, $perPage: Int!) {
    phase(id: $phaseId) {
      id
      name
      seeds(query: { page: $page, perPage: $perPage }) {
        pageInfo { totalPages }
        nodes {
          id
          seedNum
          entrant { id name participants { gamerTag } }
        }
      }
    }
  }
`;

const UPDATE_SEEDING_MUTATION = `
  mutation UpdateSeeding($phaseId: ID!, $seedMapping: [UpdatePhaseSeedInfo]!) {
    updatePhaseSeeding(phaseId: $phaseId, seedMapping: $seedMapping) {
      id
    }
  }
`;

/** Liste les phases d'un événement start.gg. Renvoie { eventName, phases: [{ id, name }] }. */
export async function fetchEventPhases(eventSlug, token) {
  const data = await gql(token, EVENT_PHASES_QUERY, { slug: eventSlug });
  const ev = data?.event;
  if (!ev) throw new Error("Événement start.gg introuvable (lien ou token invalide ?).");
  const phases = (ev.phases ?? []).map((p) => ({ id: String(p.id), name: p.name || "Phase" }));
  if (!phases.length) throw new Error("Cet événement n'a pas encore de phase (bracket non créé sur start.gg ?).");
  return { eventName: ev.name || "", phases };
}

/**
 * Récupère tous les seeds d'une phase (pagination). Renvoie un tableau :
 * [{ seedId, seedNum, entrantName, gamerTags: string[] }] dans l'ordre de seed actuel.
 */
export async function fetchPhaseSeeds(phaseId, token) {
  const perPage = 50;
  let page = 1;
  let totalPages = 1;
  const seeds = [];
  do {
    const data = await gql(token, PHASE_SEEDS_QUERY, { phaseId, page, perPage });
    const ph = data?.phase;
    if (!ph) throw new Error("Phase start.gg introuvable.");
    totalPages = ph.seeds?.pageInfo?.totalPages ?? 1;
    for (const node of ph.seeds?.nodes ?? []) {
      seeds.push({
        seedId: String(node.id),
        seedNum: node.seedNum ?? 0,
        entrantName: node.entrant?.name ?? "",
        gamerTags: (node.entrant?.participants ?? []).map((p) => p.gamerTag).filter(Boolean),
      });
    }
    page += 1;
  } while (page <= totalPages);
  seeds.sort((a, b) => a.seedNum - b.seedNum);
  return seeds;
}

/**
 * Réécrit le seeding d'une phase. mapping = [{ seedId, seedNum }] (seedNum à partir de 1).
 * Lève si le token n'a pas les droits admin sur le tournoi.
 */
export async function updatePhaseSeeding(phaseId, mapping, token) {
  if (!Array.isArray(mapping) || !mapping.length) throw new Error("Aucun seed à appliquer.");
  const seedMapping = mapping.map((m) => ({ seedId: String(m.seedId), seedNum: Number(m.seedNum) }));
  await gql(token, UPDATE_SEEDING_MUTATION, { phaseId, seedMapping });
  return { updated: seedMapping.length };
}

/**
 * Compat : liste les entrants (avec leur seed actuel) de la 1re phase d'un événement.
 * Utilisé pour seeder le tournoi INTERNE du bot. Renvoie { eventName, entrants:[{ seed, name, gamerTags }] }.
 */
export async function fetchStartggSeeding(eventSlug, token) {
  const { eventName, phases } = await fetchEventPhases(eventSlug, token);
  const seeds = await fetchPhaseSeeds(phases[0].id, token);
  const entrants = seeds.map((s) => ({ seed: s.seedNum, name: s.entrantName, gamerTags: s.gamerTags }));
  return { eventName, entrants };
}
