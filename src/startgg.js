/**
 * Intégration start.gg : récupère le SEEDING d'un événement start.gg pour l'appliquer au
 * tournoi du bot. Utilise l'API GraphQL publique (https://api.start.gg/gql/alpha), qui exige
 * un token développeur (https://start.gg → Developer Settings → Personal Access Token).
 *
 * On ne fait QUE de la lecture (entrants + seeds). Aucune écriture côté start.gg.
 */

const STARTGG_GQL = "https://api.start.gg/gql/alpha";

/**
 * Extrait le "slug" d'événement attendu par l'API GraphQL à partir d'un lien start.gg.
 * Accepte une URL complète ou un slug déjà au bon format.
 * Ex: https://www.start.gg/tournament/my-cup/event/1v1-singles?... -> "tournament/my-cup/event/1v1-singles"
 * Lève une erreur si le lien ne contient pas d'événement (.../event/...).
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

const SEEDING_QUERY = `
  query EventSeeding($slug: String!, $page: Int!, $perPage: Int!) {
    event(slug: $slug) {
      id
      name
      entrants(query: { page: $page, perPage: $perPage }) {
        pageInfo { totalPages }
        nodes {
          id
          name
          initialSeedNum
          participants { gamerTag }
        }
      }
    }
  }
`;

async function gqlRequest(token, variables) {
  const res = await fetch(STARTGG_GQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query: SEEDING_QUERY, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Token start.gg refusé (401/403). Vérifie ton Personal Access Token.");
  }
  if (res.status === 429) {
    throw new Error("Trop de requêtes vers start.gg (429). Réessaie dans quelques secondes.");
  }
  if (!res.ok) {
    throw new Error(`start.gg a répondu HTTP ${res.status}.`);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`start.gg : ${json.errors.map((e) => e.message).join(" / ")}`);
  }
  return json.data;
}

/**
 * Récupère tous les entrants d'un événement start.gg avec leur seed initial et les gamerTags.
 * Renvoie { eventName, entrants: [{ seed, name, gamerTags: string[] }] } trié par seed croissant.
 */
export async function fetchStartggSeeding(eventSlug, token) {
  if (!token) throw new Error("Token start.gg requis.");
  const perPage = 50;
  let page = 1;
  let totalPages = 1;
  let eventName = "";
  const entrants = [];

  do {
    const data = await gqlRequest(token, { slug: eventSlug, page, perPage });
    const ev = data?.event;
    if (!ev) throw new Error("Événement start.gg introuvable (lien ou token invalide ?).");
    eventName = ev.name || "";
    totalPages = ev.entrants?.pageInfo?.totalPages ?? 1;
    for (const node of ev.entrants?.nodes ?? []) {
      entrants.push({
        seed: node.initialSeedNum ?? Number.MAX_SAFE_INTEGER,
        name: node.name ?? "",
        gamerTags: (node.participants ?? []).map((p) => p.gamerTag).filter(Boolean),
      });
    }
    page += 1;
  } while (page <= totalPages);

  entrants.sort((a, b) => a.seed - b.seed);
  return { eventName, entrants };
}

// Normalise un nom pour comparer (sans accents, sans caractères spéciaux, minuscules).
export function normalizeName(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // diacritiques
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
