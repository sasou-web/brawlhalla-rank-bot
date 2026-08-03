import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags } from "discord.js";
import { applyVars, buildWelcomePayload, buildGoodbyePayload } from "../src/welcome.js";
import { buildLolWelcomePayload } from "../src/lol.js";

/**
 * Variables de message et construction des payloads.
 *
 * applyVars est partage par le module Bienvenue ET la section LoL : une regression
 * ici casse les deux d'un coup. On verifie aussi que le ping reste fonctionnel
 * (allowedMentions), point facile a casser en passant aux Components V2.
 */

const GUILD = { name: "Xray Brawl", memberCount: 1234 };

// Faux membre Discord minimal (forme attendue par applyVars / buildWelcomePayload).
function member({ id = "111", username = "kaya", displayName = "Kaya 🎮", globalName = null, tag = "kaya#0" } = {}) {
  return {
    id,
    displayName,
    user: { id, username, globalName, tag, displayAvatarURL: () => "https://cdn.example/a.png" },
  };
}

test("applyVars remplace toutes les variables connues", () => {
  const out = applyVars(
    "{user} / {username} / {user.name} / {user.tag} / {server} / {membercount} / {count}",
    member(),
    GUILD,
  );
  assert.equal(out, "<@111> / Kaya 🎮 / kaya / kaya#0 / Xray Brawl / 1234 / 1234");
});

test("applyVars remplace TOUTES les occurrences, pas seulement la premiere", () => {
  const out = applyVars("{username} et encore {username} ({server}, {server})", member(), GUILD);
  assert.equal(out, "Kaya 🎮 et encore Kaya 🎮 (Xray Brawl, Xray Brawl)");
});

test("applyVars : {username} suit la cascade displayName > globalName > username", () => {
  assert.equal(applyVars("{username}", member({ displayName: "Surnom" }), GUILD), "Surnom");
  assert.equal(
    applyVars("{username}", member({ displayName: null, globalName: "Global" }), GUILD),
    "Global",
    "sans surnom de serveur, on prend le nom global",
  );
  assert.equal(
    applyVars("{username}", member({ displayName: null, globalName: null, username: "brut" }), GUILD),
    "brut",
    "sinon le pseudo Discord",
  );
});

test("applyVars : repli sur « membre » quand aucun nom n'est disponible", () => {
  const anonyme = { id: "9", user: { id: "9", displayAvatarURL: () => "" } };
  assert.equal(applyVars("{username}", anonyme, GUILD), "membre");
});

test("applyVars : entrees vides renvoyees telles quelles (pas de « undefined »)", () => {
  for (const empty of ["", null, undefined]) {
    assert.equal(applyVars(empty, member(), GUILD), empty);
  }
});

test("applyVars : une variable inconnue est laissee intacte", () => {
  assert.equal(applyVars("{inconnue} {server}", member(), GUILD), "{inconnue} Xray Brawl");
});

test("applyVars fonctionne aussi si on passe l'utilisateur directement", () => {
  // member.user || member : certains appels transmettent un User et non un GuildMember.
  const user = { id: "222", username: "solo", tag: "solo#1", displayAvatarURL: () => "" };
  assert.equal(applyVars("{user} {user.name}", user, GUILD), "<@222> solo");
});

// ---------- Bienvenue ----------

test("bienvenue mode texte : message simple, ping du membre autorise", () => {
  const cfg = { mode: "text", pingUser: true, text: "Salut {username} !" };
  const p = buildWelcomePayload(member(), GUILD, cfg);
  assert.equal(p.components, undefined, "mode texte => pas de Components V2");
  assert.ok(p.content.includes("<@111>"), "la mention est ajoutee");
  assert.ok(p.content.includes("Kaya 🎮"));
  assert.deepEqual(p.allowedMentions.users, ["111"], "le ping doit reellement notifier");
});

test("bienvenue mode texte : pas de mention en double si {user} est deja dans le texte", () => {
  const cfg = { mode: "text", pingUser: true, text: "Bienvenue {user} !" };
  const p = buildWelcomePayload(member(), GUILD, cfg);
  assert.equal(p.content.match(/<@111>/g).length, 1, "une seule mention");
});

test("bienvenue : pingUser desactive n'autorise aucune mention", () => {
  const cfg = { mode: "text", pingUser: false, text: "Salut {username}" };
  const p = buildWelcomePayload(member(), GUILD, cfg);
  assert.deepEqual(p.allowedMentions.users, []);
});

test("bienvenue mode embed : Components V2 et variables resolues dans la carte", () => {
  const cfg = {
    mode: "embed",
    pingUser: true,
    embed: { color: "#7c5cff", title: "Bienvenue {username}", description: "Tu es le membre {membercount} de {server}", thumbnailUser: true, footer: "{server}" },
  };
  const p = buildWelcomePayload(member(), GUILD, cfg);
  assert.ok(Array.isArray(p.components) && p.components.length > 0);
  assert.equal(p.flags, MessageFlags.IsComponentsV2);
  const dump = JSON.stringify(p.components);
  assert.ok(dump.includes("Kaya"), "le titre est interpole");
  assert.ok(dump.includes("1234"), "le nombre de membres est interpole");
  assert.ok(dump.includes("Xray Brawl"));
  assert.deepEqual(p.allowedMentions.users, ["111"], "le ping fonctionne meme en carte V2");
});

test("bienvenue mode both : le texte et la carte sont tous les deux presents", () => {
  const cfg = { mode: "both", pingUser: false, text: "Coucou {username}", embed: { title: "Carte {username}" } };
  const p = buildWelcomePayload(member(), GUILD, cfg);
  assert.equal(p.flags, MessageFlags.IsComponentsV2);
  const dump = JSON.stringify(p.components);
  assert.ok(dump.includes("Coucou Kaya"), "texte present");
  assert.ok(dump.includes("Carte Kaya"), "carte presente");
});

test("au revoir : texte interpole et aucune mention autorisee", () => {
  const cfg = { goodbyeText: "{username} nous quitte ({membercount} restants)" };
  const p = buildGoodbyePayload(member(), GUILD, cfg);
  assert.equal(p.content, "Kaya 🎮 nous quitte (1234 restants)");
  assert.deepEqual(p.allowedMentions, { parse: [] }, "un depart ne doit pinger personne");
});

// ---------- Section LoL (reutilise applyVars) ----------

test("accueil LoL mode texte : mention et variables resolues", () => {
  const cfg = { mode: "text", pingUser: true, text: "{user} rejoint la section LoL de {server}" };
  const p = buildLolWelcomePayload(member(), GUILD, cfg);
  assert.equal(p.components, undefined);
  assert.equal(p.content, "<@111> rejoint la section LoL de Xray Brawl");
  assert.deepEqual(p.allowedMentions.users, ["111"]);
});

test("accueil LoL mode carte : Components V2, variables et ping fonctionnels", () => {
  const cfg = {
    mode: "embed",
    pingUser: true,
    embed: { color: "#c89b3c", title: "Bienvenue {username} !", description: "Parle de LoL sur {server}", thumbnailUser: true, footer: "{server} • Section LoL" },
  };
  const p = buildLolWelcomePayload(member(), GUILD, cfg);
  assert.equal(p.flags, MessageFlags.IsComponentsV2);
  const dump = JSON.stringify(p.components);
  assert.ok(dump.includes("Kaya"));
  assert.ok(dump.includes("Xray Brawl"));
  assert.ok(dump.includes("Section LoL"));
  assert.deepEqual(p.allowedMentions.users, ["111"]);
});

test("accueil LoL : couleur invalide ne fait pas planter la construction", () => {
  for (const color of [undefined, "", "pas-une-couleur", "#12", "#c89b3c"]) {
    const p = buildLolWelcomePayload(member(), GUILD, { mode: "embed", pingUser: false, embed: { color, title: "T" } });
    assert.equal(p.flags, MessageFlags.IsComponentsV2, `couleur ${JSON.stringify(color)}`);
  }
});

test("accueil LoL : titre absent => titre par defaut avec le nom du membre", () => {
  const p = buildLolWelcomePayload(member(), GUILD, { mode: "embed", pingUser: false, embed: {} });
  assert.ok(JSON.stringify(p.components).includes("Kaya"), "le nom apparait dans le titre par defaut");
});
