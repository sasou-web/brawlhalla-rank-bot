import test from "node:test";
import assert from "node:assert/strict";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import { handleTimeout } from "../src/commands/moderation.js";
import { setRoleTimeoutConfig, getTimeoutCooldownRemaining } from "../src/roleTimeout.js";
import { getSettings, setSetting } from "../src/settings.js";
import { setWordFilterConfig } from "../src/wordfilter.js";

// Handler /timeout testé avec des objets Discord simulés : aucun appel réseau.
// Par défaut le journal ne part nulle part (aucun salon configuré sur la base de test,
// et channels.fetch simulé renvoie null) ; les tests « journal » simulent des salons.

let seq = 0;
const gid = () => `rt-cmd-${process.pid}-${++seq}`;
const BOT_ID = "bot";

async function configure(guildId, { enabled = true, allowedRoleIds = ["helper"], cooldownSec = 300 } = {}) {
  await setRoleTimeoutConfig(guildId, { enabled, allowedRoleIds, cooldownSec }, {
    resolveRoles: async () => ({ roleIds: new Set(["helper", "autre"]), everyoneRoleId: guildId }),
  });
}

// `timeout()` simulé : renseigne communicationDisabledUntilTimestamp comme Discord.
function mockMember(id, { roleIds = [], position = 1, perms = [], bot = false, moderatable = true, timedOutUntil = null, onTimeout } = {}) {
  const m = {
    id,
    user: { id, bot, tag: `${id}#0001` },
    permissions: { has: (flag) => perms.includes(flag) },
    roles: { cache: new Map(roleIds.map((r) => [r, { id: r }])), highest: { position } },
    moderatable,
    communicationDisabledUntilTimestamp: timedOutUntil,
    timeoutCalls: [],
    async timeout(ms, reason) {
      m.timeoutCalls.push({ ms, reason });
      if (onTimeout) await onTimeout(ms, reason);
      m.communicationDisabledUntilTimestamp = Date.now() + ms;
      return m;
    },
  };
  return m;
}

function mockGuild(id, members) {
  const map = new Map(members.map((m) => [m.id, m]));
  return {
    id,
    ownerId: "owner",
    members: {
      fetch: async (userId) => {
        if (!map.has(userId)) throw Object.assign(new Error("Unknown Member"), { code: 10007 });
        return map.get(userId);
      },
    },
    channels: { fetch: async () => null },
  };
}

function mockInteraction(guild, executor, targetId, { duree = "10m", raison = null } = {}) {
  const calls = { reply: [], editReply: [], deferReply: [] };
  return {
    commandName: "timeout",
    guild,
    member: executor,
    user: executor.user,
    client: { user: { id: BOT_ID } },
    memberPermissions: executor.permissions,
    deferred: false,
    replied: false,
    options: {
      getUser: (name) => (name === "membre" ? { id: targetId, tag: `${targetId}#0001` } : null),
      getString: (name) => (name === "duree" ? duree : name === "raison" ? raison : null),
    },
    reply: async (p) => {
      calls.reply.push(p);
    },
    deferReply: async (p) => {
      calls.deferReply.push(p);
    },
    editReply: async (p) => {
      calls.editReply.push(p);
    },
    _calls: calls,
  };
}

// Serveur type : un exécutant du rôle autorisé (position 5), des cibles (position 1), le bot.
function setup(guildId, extra = []) {
  const executor = mockMember("exec", { roleIds: ["helper"], position: 5 });
  const targets = ["t1", "t2", "t3"].map((id) => mockMember(id));
  const bot = mockMember(BOT_ID, { bot: true, position: 10, moderatable: false });
  const guild = mockGuild(guildId, [executor, bot, ...targets, ...extra]);
  return { guild, executor, targets, bot };
}

const lastText = (it) => {
  const p = it._calls.editReply.at(-1) ?? it._calls.reply.at(-1);
  return typeof p === "string" ? p : p?.content;
};

function assertRefused(it, re) {
  assert.equal(it._calls.reply.length, 1, "une réponse de refus attendue");
  assert.equal(it._calls.reply[0].flags, MessageFlags.Ephemeral);
  assert.equal(it._calls.deferReply.length, 0, "aucun deferReply sur un refus");
  if (re) assert.match(it._calls.reply[0].content, re);
}

test("/timeout : un rôle autorisé exclut, réponse éphémère, cooldown armé", async () => {
  const g = gid();
  await configure(g);
  const { guild, executor, targets } = setup(g);
  const it = mockInteraction(guild, executor, "t1", { duree: "10m", raison: "spam en vocal" });
  await handleTimeout(it);
  assert.equal(targets[0].timeoutCalls.length, 1);
  assert.equal(targets[0].timeoutCalls[0].ms, 600_000);
  assert.match(targets[0].timeoutCalls[0].reason, /spam en vocal/);
  assert.match(targets[0].timeoutCalls[0].reason, /exec#0001/);
  assert.deepEqual(it._calls.deferReply, [{ flags: MessageFlags.Ephemeral }]);
  assert.match(lastText(it), /✅/);
  assert.deepEqual(it._calls.editReply.at(-1).allowedMentions, { parse: [] });
  assert.ok(getTimeoutCooldownRemaining(g, "exec", 300) > 0);
});

test("/timeout : le cooldown bloque un 2e usage, avec le temps restant", async () => {
  const g = gid();
  await configure(g);
  const { guild, executor, targets } = setup(g);
  await handleTimeout(mockInteraction(guild, executor, "t1"));
  const second = mockInteraction(guild, executor, "t2");
  await handleTimeout(second);
  assertRefused(second, /⏳/);
  assert.match(second._calls.reply[0].content, /\d+ (min|s)/);
  assert.equal(targets[1].timeoutCalls.length, 0);
});

test("/timeout : échec Discord 50013 → message clair, cooldown non consommé", async () => {
  const g = gid();
  await configure(g);
  let fail = true;
  const target = mockMember("t9", {
    onTimeout: async () => {
      if (fail) throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
    },
  });
  const { guild, executor } = setup(g, [target]);
  const it = mockInteraction(guild, executor, "t9");
  await handleTimeout(it);
  assert.match(lastText(it), /permission « Exclure temporairement des membres »/);
  assert.match(lastText(it), /cooldown n'est pas consommé/);
  assert.equal(getTimeoutCooldownRemaining(g, "exec", 300), 0);
  // Nouvel essai : il atteint bien Discord (pas bloqué par un cooldown).
  fail = false;
  const retry = mockInteraction(guild, executor, "t9");
  await handleTimeout(retry);
  assert.equal(target.timeoutCalls.length, 2);
  assert.match(lastText(retry), /✅/);
});

test("/timeout : échec Discord 10007 → membre parti", async () => {
  const g = gid();
  await configure(g);
  const target = mockMember("t9", {
    onTimeout: async () => {
      throw Object.assign(new Error("Unknown Member"), { code: 10007 });
    },
  });
  const { guild, executor } = setup(g, [target]);
  const it = mockInteraction(guild, executor, "t9");
  await handleTimeout(it);
  assert.match(lastText(it), /a quitté le serveur/);
  assert.equal(getTimeoutCooldownRemaining(g, "exec", 300), 0);
});

test("/timeout : cooldown 0 → deux timeouts consécutifs", async () => {
  const g = gid();
  await configure(g, { cooldownSec: 0 });
  const { guild, executor, targets } = setup(g);
  await handleTimeout(mockInteraction(guild, executor, "t1"));
  await handleTimeout(mockInteraction(guild, executor, "t2"));
  assert.equal(targets[0].timeoutCalls.length, 1);
  assert.equal(targets[1].timeoutCalls.length, 1);
});

test("/timeout : membre sans rôle autorisé refusé", async () => {
  const g = gid();
  await configure(g);
  const intrus = mockMember("intrus", { roleIds: ["autre"], position: 5 });
  const { guild, targets } = setup(g, [intrus]);
  const it = mockInteraction(guild, intrus, "t1");
  await handleTimeout(it);
  assertRefused(it, /permission d'utiliser \/timeout/);
  assert.equal(targets[0].timeoutCalls.length, 0);
});

test("/timeout : module désactivé → refus du rôle, un modérateur passe sans cooldown", async () => {
  const g = gid();
  await configure(g, { enabled: false });
  const mod = mockMember("mod", { position: 5, perms: [PermissionFlagsBits.ModerateMembers] });
  const { guild, executor, targets } = setup(g, [mod]);
  const it = mockInteraction(guild, executor, "t1");
  await handleTimeout(it);
  assertRefused(it, /désactivée/);
  await handleTimeout(mockInteraction(guild, mod, "t1"));
  await handleTimeout(mockInteraction(guild, mod, "t2"));
  assert.equal(targets[0].timeoutCalls.length, 1);
  assert.equal(targets[1].timeoutCalls.length, 1);
  assert.equal(getTimeoutCooldownRemaining(g, "mod", 300), 0, "aucun cooldown armé pour un modérateur");
});

test("/timeout : cible de rôle égal refusée (hiérarchie)", async () => {
  const g = gid();
  await configure(g);
  const pair = mockMember("pair", { position: 5 });
  const { guild, executor } = setup(g, [pair]);
  const it = mockInteraction(guild, executor, "pair");
  await handleTimeout(it);
  assertRefused(it, /égal ou supérieur/);
  assert.equal(pair.timeoutCalls.length, 0);
});

test("/timeout : soi-même et le bot refusés", async () => {
  const g = gid();
  await configure(g);
  const { guild, executor, bot } = setup(g);
  const self = mockInteraction(guild, executor, "exec");
  await handleTimeout(self);
  assertRefused(self, /toi-même/);
  const onBot = mockInteraction(guild, executor, BOT_ID);
  await handleTimeout(onBot);
  assertRefused(onBot, /m'exclure moi-même/);
  assert.equal(executor.timeoutCalls.length + bot.timeoutCalls.length, 0);
});

test("/timeout : durée invalide refusée", async () => {
  const g = gid();
  await configure(g);
  const { guild, executor, targets } = setup(g);
  const it = mockInteraction(guild, executor, "t1", { duree: "2.5h" });
  await handleTimeout(it);
  assertRefused(it, /Durée invalide/);
  assert.equal(targets[0].timeoutCalls.length, 0);
});

test("/timeout : cible déjà exclue refusée", async () => {
  const g = gid();
  await configure(g);
  const muted = mockMember("muted", { timedOutUntil: Date.now() + 3_600_000 });
  const { guild, executor } = setup(g, [muted]);
  const it = mockInteraction(guild, executor, "muted");
  await handleTimeout(it);
  assertRefused(it, /déjà exclu/);
  assert.equal(muted.timeoutCalls.length, 0);
});

test("/timeout : deux commandes simultanées du même membre → une seule passe", async () => {
  const g = gid();
  await configure(g);
  let release;
  let reached;
  const reachedP = new Promise((r) => (reached = r));
  const slow = mockMember("slow", {
    onTimeout: () => {
      reached();
      return new Promise((r) => (release = r));
    },
  });
  const { guild, executor, targets } = setup(g, [slow]);
  const first = handleTimeout(mockInteraction(guild, executor, "slow"));
  await reachedP;
  const second = mockInteraction(guild, executor, "t1");
  await handleTimeout(second);
  assertRefused(second, /déjà en cours/);
  release();
  await first;
  assert.equal(slow.timeoutCalls.length, 1);
  assert.equal(targets[0].timeoutCalls.length, 0);
});

test("/timeout : cible absente (10007) → membre pas sur le serveur", async () => {
  const g = gid();
  await configure(g);
  const { guild, executor } = setup(g);
  const it = mockInteraction(guild, executor, "fantome");
  await handleTimeout(it);
  assertRefused(it, /n'est pas \(ou plus\) sur le serveur/);
});

test("/timeout : échec temporaire de Discord sur la cible → « réessaie », pas « membre absent »", async () => {
  const g = gid();
  await configure(g);
  const { guild, executor, targets } = setup(g);
  const original = guild.members.fetch;
  guild.members.fetch = async (userId) => {
    if (userId === "t1") throw Object.assign(new Error("Service Unavailable"), { status: 503 });
    return original(userId);
  };
  const it = mockInteraction(guild, executor, "t1");
  await handleTimeout(it);
  assertRefused(it, /Réessaie/);
  assert.doesNotMatch(it._calls.reply[0].content, /n'est pas \(ou plus\)/);
  assert.equal(targets[0].timeoutCalls.length, 0);
  assert.equal(getTimeoutCooldownRemaining(g, "exec", 300), 0);
});

// ---------- Journal ----------

const LOG_ID = "100000000000000001";
const AUDIT_ID = "100000000000000002";
// Raison piégée : ne doit jamais produire de vraie mention.
const INJECTION = "@everyone @here <@&999> <@t2>";

function mockChannel({ fail = false } = {}) {
  const ch = {
    sent: [],
    isTextBased: () => true,
    async send(payload) {
      if (fail) throw Object.assign(new Error("Missing Permissions"), { code: 50013 });
      ch.sent.push(payload);
      return payload;
    },
  };
  return ch;
}

function withChannels(guild, byId) {
  guild.channels.fetch = async (id) => byId[id] ?? null;
}

// Le salon d'audit est un réglage global : il est restauré après chaque test.
async function withAuditChannel(fn) {
  const prev = (await getSettings()).auditChannelId;
  await setSetting("auditChannelId", AUDIT_ID);
  try {
    await fn();
  } finally {
    await setSetting("auditChannelId", prev);
  }
}

test("/timeout journal : embed dans le Journal de modération, sans mention", async () => {
  const g = gid();
  await configure(g);
  await setWordFilterConfig(g, { logChannelId: LOG_ID });
  const { guild, executor } = setup(g);
  const logCh = mockChannel();
  const auditCh = mockChannel();
  withChannels(guild, { [LOG_ID]: logCh, [AUDIT_ID]: auditCh });
  await withAuditChannel(async () => {
    const it = mockInteraction(guild, executor, "t1", { raison: INJECTION });
    await handleTimeout(it);
    assert.match(lastText(it), /✅/);
  });
  assert.equal(logCh.sent.length, 1);
  assert.equal(auditCh.sent.length, 0, "pas de doublon dans le salon d'audit");
  const payload = logCh.sent[0];
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  const embed = payload.embeds[0];
  assert.match(embed.description, /<@exec> a exclu <@t1>/);
  assert.equal(embed.fields.find((f) => f.name === "Raison").value, INJECTION);
  assert.equal(embed.fields.find((f) => f.name === "Autorisation").value, "Rôle <@&helper>");
});

test("/timeout journal : envoi de l'embed en échec → repli sur le salon d'audit, mentions neutralisées", async () => {
  const g = gid();
  await configure(g);
  await setWordFilterConfig(g, { logChannelId: LOG_ID });
  const { guild, executor } = setup(g);
  const logCh = mockChannel({ fail: true });
  const auditCh = mockChannel();
  withChannels(guild, { [LOG_ID]: logCh, [AUDIT_ID]: auditCh });
  await withAuditChannel(async () => {
    const it = mockInteraction(guild, executor, "t1", { raison: INJECTION });
    await handleTimeout(it);
    assert.match(lastText(it), /✅/, "un journal en échec ne fait pas échouer la commande");
  });
  assert.equal(logCh.sent.length, 0);
  assert.equal(auditCh.sent.length, 1);
  const payload = auditCh.sent[0];
  assert.equal(typeof payload, "object");
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.match(payload.content, /<@exec> a exclu <@t1> .*via \/timeout/);
  assert.ok(payload.content.includes(INJECTION));
});

test("/timeout journal : aucun Journal de modération → salon d'audit, mentions neutralisées", async () => {
  const g = gid();
  await configure(g);
  const { guild, executor } = setup(g);
  const auditCh = mockChannel();
  withChannels(guild, { [AUDIT_ID]: auditCh });
  await withAuditChannel(async () => {
    await handleTimeout(mockInteraction(guild, executor, "t1", { raison: INJECTION }));
  });
  assert.equal(auditCh.sent.length, 1);
  assert.deepEqual(auditCh.sent[0].allowedMentions, { parse: [] });
  assert.ok(auditCh.sent[0].content.includes(INJECTION));
});
