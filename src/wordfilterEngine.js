/**
 * Moteur du filtre de mots — PUR (aucun import Discord, base ou config).
 * Utilisé par le bot (wordfilter.js), par l'API du dashboard (testeur) et par le
 * serveur de prévisualisation (scripts/dash-mock.js).
 *
 * ── Syntaxe des termes ────────────────────────────────────────────────────────────────
 *   mot        mot entier uniquement            « con » ne touche pas « concert »
 *   mot*       mots qui commencent par « mot »  « encul* » → enculé, enculer…
 *   *mot       mots qui finissent par « mot »
 *   *mot*      « mot » n'importe où, même au milieu d'un mot (à réserver aux termes longs)
 *   deux mots  expression : les mots doivent se suivre
 *
 * ── Normalisation (texte et termes passent par la même) ───────────────────────────────
 *   Toujours : minuscules, accents retirés (é → e), ligatures (œ → oe), caractères
 *   invisibles supprimés. Mentions, emojis personnalisés et (option) liens ignorés.
 *   Contournements (option `evasion`, active par défaut) :
 *     - chiffres et symboles à la place des lettres : c0nn4rd, $alope, t@pette ;
 *     - lettres d'autres alphabets qui ressemblent aux latines (а cyrillique…) ;
 *     - lettres répétées : connnnnard ;
 *     - ponctuation au milieu d'un mot : con.nard, c-o-n-n-a-r-d ;
 *     - lettres espacées : c o n n a r d (au moins 3 lettres isolées à la suite).
 *
 * Deux lectures du texte sont comparées aux termes : ponctuation = séparateur
 * (« fils-de-pute » → fils de pute) et ponctuation retirée (« con.nard » → connard).
 * Les positions renvoyées sont celles du texte d'origine (pour masquer / surligner).
 */

const ZERO_WIDTH = new Set(["\u200B", "\u200C", "\u200D", "\u2060", "\uFEFF", "\u00AD"]);
const LIGATURES = { "œ": "oe", "æ": "ae", "ß": "ss", "ﬁ": "fi", "ﬂ": "fl" };
// Lettres cyrilliques / grecques visuellement identiques à des lettres latines.
const HOMOGLYPHS = {
  "а": "a", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h", "о": "o", "р": "p", "с": "c", "т": "t",
  "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ɡ": "g", "α": "a", "β": "b", "ε": "e", "ι": "i",
  "κ": "k", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
};
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "€": "e" };
// Ponctuation « molle » : sépare les mots, mais peut aussi servir à couper un mot pour
// échapper au filtre (con.nard). Le reste (espaces, ! ? ( ) emojis…) sépare toujours.
const SOFT_SEPARATORS = new Set([".", "-", "_", "*", "~", "^", "+", "=", "#", "|", "\\", "/", "•", "·", ",", "'", "’", "`", "´", ":", ";"]);
const WORD_CHAR = /[\p{L}\p{N}]/u;
const MARKS = /\p{M}/gu;

// Segments jamais analysés : mentions, salons, rôles, emojis personnalisés, horodatages.
const DISCORD_TOKENS = /<(?:@[!&]?|#)\d+>|<a?:\w{1,32}:\d+>|<t:-?\d+(?::[tTdDfFR])?>|<\/[\w -]+:\d+>/g;
const URLS = /\bhttps?:\/\/\S+/gi;

export const MAX_SCAN_LENGTH = 4000;

// Remplace les segments ignorés par des espaces de même longueur (positions conservées).
function blankIgnored(text, ignoreLinks) {
  const blank = (m) => " ".repeat(m.length);
  let out = text.replace(DISCORD_TOKENS, blank);
  if (ignoreLinks) out = out.replace(URLS, blank);
  return out;
}

/**
 * Découpe le texte en unités normalisées, chacune rattachée à sa position d'origine.
 * kind : "w" (lettre / chiffre), "s" (séparateur mou), "h" (séparateur dur).
 */
function units(text, { evasion, ignoreLinks }) {
  const src = blankIgnored(String(text || "").slice(0, MAX_SCAN_LENGTH), ignoreLinks);
  const out = [];
  let i = 0;
  for (const ch of src) {
    const start = i;
    i += ch.length;
    if (ZERO_WIDTH.has(ch)) continue; // invisible : ni lettre ni séparateur (c\u200Bon = con)
    const lower = ch.toLowerCase();
    let c = LIGATURES[lower] || (evasion && HOMOGLYPHS[lower]) || lower;
    c = c.normalize("NFD").replace(MARKS, "");
    if (evasion && LEET[c]) c = LEET[c];
    if (!c) continue;
    const kind = WORD_CHAR.test(c) ? "w" : SOFT_SEPARATORS.has(ch) ? "s" : "h";
    out.push({ c, start, end: i, kind });
  }
  return { src, list: out };
}

function collapseRepeats(s) {
  return s.replace(/(.)\1+/gu, "$1");
}

// Regroupe les unités en mots. `joinSoft` : la ponctuation molle ne coupe pas les mots.
function tokenize(list, { joinSoft }) {
  const tokens = [];
  let cur = null;
  for (const u of list) {
    if (u.kind === "w") {
      if (!cur) cur = { text: "", start: u.start, end: u.end };
      cur.text += u.c;
      cur.end = u.end;
    } else if (u.kind === "s" && joinSoft) {
      continue;
    } else if (cur) {
      tokens.push(cur);
      cur = null;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

// Lettres espacées (c o n n a r d) : au moins 3 mots d'une seule lettre séparés
// uniquement par des espaces ou de la ponctuation molle deviennent un seul mot.
function joinSpacedLetters(tokens, src) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) out.push({ text: run.map((t) => t.text).join(""), start: run[0].start, end: run[run.length - 1].end });
    else out.push(...run);
    run = [];
  };
  for (const t of tokens) {
    const single = [...t.text].length === 1;
    const prev = run[run.length - 1];
    const gapOk = prev && /^[\s.\-_*~·•,'’]*$/u.test(src.slice(prev.end, t.start));
    if (single && (!prev || gapOk)) run.push(t);
    else {
      flush();
      if (single) run.push(t);
      else out.push(t);
    }
  }
  flush();
  return out;
}

/** Les deux lectures du texte à comparer aux termes. */
function readings(text, opts) {
  const { src, list } = units(text, opts);
  const split = tokenize(list, { joinSoft: false });
  const views = [split];
  if (opts.evasion) {
    const joined = joinSpacedLetters(tokenize(list, { joinSoft: true }), src);
    views.push(joined);
    for (const view of views) for (const t of view) t.text = collapseRepeats(t.text);
  }
  return views;
}

/**
 * Compile un terme. Renvoie null s'il est vide après normalisation.
 * { raw, words: string[], mode: "exact" | "prefix" | "suffix" | "contains" }
 */
export function compileTerm(raw, { evasion = true } = {}) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const lead = s.startsWith("*");
  const trail = s.length > 1 && s.endsWith("*");
  const body = s.replace(/^\*+|\*+$/g, "");
  const { list } = units(body, { evasion, ignoreLinks: false });
  let words = tokenize(list, { joinSoft: false }).map((t) => t.text);
  if (evasion) words = words.map(collapseRepeats);
  words = words.filter(Boolean);
  if (!words.length) return null;
  const mode = lead && trail ? "contains" : lead ? "suffix" : trail ? "prefix" : "exact";
  return { raw: s, words, mode };
}

/** Compile une configuration complète (à mettre en cache par l'appelant). */
export function compileFilter({ words = [], allowed = [], evasion = true, ignoreLinks = true } = {}) {
  const opts = { evasion: Boolean(evasion), ignoreLinks: Boolean(ignoreLinks) };
  const terms = words.map((w) => compileTerm(w, opts)).filter(Boolean);
  const allow = allowed.map((w) => compileTerm(w, opts)).filter(Boolean);
  // Index des termes « mot entier » d'un seul mot : recherche directe par mot.
  const exact = new Map();
  const others = [];
  for (const t of terms) {
    if (t.mode === "exact" && t.words.length === 1) {
      if (!exact.has(t.words[0])) exact.set(t.words[0], []);
      exact.get(t.words[0]).push(t);
    } else others.push(t);
  }
  return { opts, terms, allow, exact, others };
}

function wordMatches(token, word, mode) {
  if (mode === "exact") return token === word;
  if (mode === "prefix") return token.startsWith(word);
  if (mode === "suffix") return token.endsWith(word);
  return token.includes(word);
}

// Positions (dans le texte d'origine) où le terme apparaît dans une lecture.
function spansFor(term, tokens) {
  const spans = [];
  const n = term.words.length;
  if (n === 1) {
    for (const t of tokens) if (wordMatches(t.text, term.words[0], term.mode)) spans.push([t.start, t.end]);
    return spans;
  }
  const first = term.mode === "suffix" || term.mode === "contains" ? "suffix" : "exact";
  const last = term.mode === "prefix" || term.mode === "contains" ? "prefix" : "exact";
  for (let i = 0; i + n <= tokens.length; i++) {
    let ok = true;
    for (let j = 0; j < n && ok; j++) {
      const mode = j === 0 ? first : j === n - 1 ? last : "exact";
      ok = wordMatches(tokens[i + j].text, term.words[j], mode);
    }
    if (ok) spans.push([tokens[i].start, tokens[i + n - 1].end]);
  }
  // Expression collée ou coupée par de la ponctuation (fils-de-pute, filsdepute).
  const glued = term.words.join("");
  for (const t of tokens) if (wordMatches(t.text, glued, term.mode)) spans.push([t.start, t.end]);
  return spans;
}

/**
 * Cherche les termes interdits dans un texte.
 * @returns {{ start: number, end: number, terms: string[] }[]} triés, sans chevauchement.
 *   `terms` = termes de la configuration (tels que saisis) qui ont déclenché.
 */
export function findMatches(text, filter) {
  if (!text || !filter || !filter.terms.length) return [];
  const views = readings(text, filter.opts);
  const hits = [];
  for (const tokens of views) {
    for (const t of tokens) {
      const terms = filter.exact.get(t.text);
      if (terms) for (const term of terms) hits.push({ start: t.start, end: t.end, term: term.raw });
    }
    for (const term of filter.others) for (const [start, end] of spansFor(term, tokens)) hits.push({ start, end, term: term.raw });
  }
  if (!hits.length) return [];

  // Termes autorisés : un passage entièrement couvert par un terme autorisé est ignoré.
  const allowed = [];
  for (const tokens of views) for (const term of filter.allow) allowed.push(...spansFor(term, tokens));
  const kept = hits.filter((h) => !allowed.some(([s, e]) => s <= h.start && h.end <= e));

  // Fusion des passages qui se chevauchent.
  kept.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const h of kept) {
    const last = merged[merged.length - 1];
    if (last && h.start < last.end) {
      last.end = Math.max(last.end, h.end);
      if (!last.terms.includes(h.term)) last.terms.push(h.term);
    } else merged.push({ start: h.start, end: h.end, terms: [h.term] });
  }
  return merged;
}

/**
 * Masque les passages trouvés. Les espaces sont conservés pour la lisibilité.
 * `char` : caractère de masquage ("\\*" pour Discord, où * seul met en italique).
 */
export function maskText(text, matches, { char = "*", max = 12 } = {}) {
  let out = "";
  let pos = 0;
  for (const m of matches) {
    out += text.slice(pos, m.start);
    const n = Math.max(1, Math.min(max, [...text.slice(m.start, m.end).replace(/\s+/g, "")].length));
    out += char.repeat(n);
    pos = m.end;
  }
  return out + text.slice(pos);
}

/** Termes distincts ayant déclenché. */
export function matchedTerms(matches) {
  return [...new Set(matches.flatMap((m) => m.terms))];
}

/** Clé de dédoublonnage d'un terme saisi (même normalisation que le moteur). */
export function termKey(raw) {
  const t = compileTerm(raw, { evasion: false });
  if (!t) return "";
  const lead = t.mode === "suffix" || t.mode === "contains" ? "*" : "";
  const trail = t.mode === "prefix" || t.mode === "contains" ? "*" : "";
  return lead + t.words.join(" ") + trail;
}

/**
 * Liste de départ proposée dans le dashboard (jamais appliquée sans action du staff).
 * Insultes courantes en français ; le staff la complète selon son serveur.
 */
export const STARTER_TERMS = [
  "connard",
  "connasse",
  "salope",
  "salaud",
  "pute",
  "encul*",
  "fdp",
  "fils de pute",
  "ntm",
  "nique ta mère",
  "batard",
  "pd",
  "pédé",
  "tapette",
  "negro",
  "bougnoule",
];
