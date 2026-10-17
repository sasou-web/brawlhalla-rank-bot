import test from "node:test";
import assert from "node:assert/strict";
import { MessageType, SystemChannelFlagsBitField } from "discord.js";
import { setWelcomeConfig } from "../src/welcome.js";
import {
  GROUP_WINDOW_MS,
  STAFF_GO_ID,
  buildStaffAlertPayload,
  flushStaffAlerts,
  handleStaffAlertButton,
  markStaffAlertLeft,
  parseHelpers,
  queueStaffAlert,
  resetStaffAlerts,
  staffPingCooldownMs,
  toggleHelper,
  withHelpers,
} from "../src/welcomeStaff.js";

/**
 * Alerte staff à l'arrivée : lien vers le message de bienvenue de Discord, regroupement
 * des arrivées proches, ping du rôle limité par délai, seul ce rôle notifié, bouton
 * « J'y vais » qui marche aussi sans état en mémoire.
 */

const STAFF = "700000000000000001";
const SYS = "700000000000000002";
const CHAT = "700000000000000003";
const ROLE = "800000000000000001";
const T0 = 1_800_000_000_000;
let guildSeq = 0;

function fakeGuild({ joins = [], suppressJoins = false, roles = [ROLE] } = {}) {
  const id = String(900000000000000000n + BigInt(++guildSeq));
  const sent = [];
  const edits = [];
  let fetches = 0;
  let msgSeq = 0;
  const makeMessage = (payload) => {
    const msg = {
      id: `m${++msgSeq}`,
      payload,
      content: payload.content,
      edit: async (p) => {
        edits.push(p);
        msg.payload = p;
        msg.content = p.content;
        return msg;
      },
    };
    return msg;
  };
  const staff = {
    id: STAFF,
    isTextBased: () => true,
    send: async (p) => {
      const m = makeMessage(p);
      sent.push(m);
      return m;
    },
  };
  const guild = {
    id,
    systemChannelId: SYS,
    systemChannelFlags: new SystemChannelFlagsBitField(suppressJoins ? SystemChannelFlagsBitField.Flags.SuppressJoinNotifications : 0),
    systemChannel: {
      messages: {
        fetch: async () => {
          fetches++;
          return new Map(joins.map((j, i) => [`j${i}`, j]));
        },
      },
    },
    roles: { cache: new Map(roles.map((r) => [r, {}])) },
    channels: { fetch: async (cid) => (cid === STAFF ? staff : null) },
  };
  return { guild, sent, edits, fetches: () => fetches };
}

function member(guild, id, { bot = false } = {}) {
  return { id, guild, user: { id, bot } };
}

function joinMessage(userId, url) {
  return { type: MessageType.UserJoin, author: { id: userId }, url };
}

async function configure(guild, patch = {}) {
  await setWelcomeConfig(guild.id, { staffEnabled: true, staffChannelId: STAFF, staffRoleId: ROLE, staffChatChannelId: "", staffPingCooldownMin: 10, ...patch });
}

// Le délai réel n'est jamais atteint : les tests appellent flushStaffAlerts eux-mêmes.
const queue = (m, opts = {}) => queueStaffAlert(m, { delayMs: 60_000, ...opts });

test.afterEach(() => resetStaffAlerts());

test("une arrivée : lien vers le message de bienvenue de Discord, seul le rôle est notifié", async () => {
  const url = "https://discord.com/channels/g/sys/join1";
  const { guild, sent } = fakeGuild({ joins: [joinMessage("111111111111111111", url)] });
  await configure(guild);
  await queue(member(guild, "111111111111111111"));
  await flushStaffAlerts(guild, { now: T0 });

  assert.equal(sent.length, 1);
  const p = sent[0].payload;
  assert.match(p.content, new RegExp(`^<@&${ROLE}> 🚨 \\*\\*Nouveau membre !\\*\\*`));
  assert.ok(p.content.includes(`<@111111111111111111> · [**Dire bienvenue** 💬](${url})`));
  assert.deepEqual(p.allowedMentions, { parse: [], roles: [ROLE] }, "le nouveau membre n'est pas notifié, @everyone impossible");
  assert.equal(p.components[0].components[0].data.custom_id, STAFF_GO_ID);
});

test("les bots et la config désactivée ne déclenchent rien", async () => {
  const { guild, sent } = fakeGuild();
  await configure(guild);
  await queue(member(guild, "222222222222222222", { bot: true }));
  assert.equal(await flushStaffAlerts(guild, { now: T0 }), null);

  await configure(guild, { staffEnabled: false });
  await queue(member(guild, "222222222222222223"));
  assert.equal(await flushStaffAlerts(guild, { now: T0 }), null);
  assert.equal(sent.length, 0);
});

test("arrivées proches regroupées, ping du rôle limité par le délai", async () => {
  const { guild, sent, edits } = fakeGuild();
  await configure(guild, { staffPingCooldownMin: 10 });
  await queue(member(guild, "311111111111111111"));
  await queue(member(guild, "311111111111111112"));
  await flushStaffAlerts(guild, { now: T0 });
  assert.equal(sent.length, 1, "deux arrivées dans la même attente = un seul message");
  assert.match(sent[0].content, /2 nouveaux membres/);

  // Dans la fenêtre : on complète le même message (une modification ne notifie pas).
  await queue(member(guild, "311111111111111113"));
  await flushStaffAlerts(guild, { now: T0 + 60_000 });
  assert.equal(sent.length, 1);
  assert.equal(edits.length, 1);
  assert.match(edits[0].content, /3 nouveaux membres/);

  // Fenêtre passée mais délai de ping pas écoulé : nouveau message, rôle affiché sans ping.
  await queue(member(guild, "311111111111111114"));
  await flushStaffAlerts(guild, { now: T0 + GROUP_WINDOW_MS + 1 });
  assert.equal(sent.length, 2);
  assert.ok(sent[1].content.includes(`<@&${ROLE}>`));
  assert.deepEqual(sent[1].payload.allowedMentions.roles, []);

  // Délai écoulé : le rôle est de nouveau notifié.
  await queue(member(guild, "311111111111111115"));
  await flushStaffAlerts(guild, { now: T0 + 11 * 60_000 });
  assert.equal(sent.length, 3);
  assert.deepEqual(sent[2].payload.allowedMentions.roles, [ROLE]);
});

test("liens de secours : accueil du bot, puis salon de discussion", async () => {
  const { guild, sent } = fakeGuild();
  await configure(guild, { staffChatChannelId: CHAT });
  await queue(member(guild, "411111111111111111"), { welcomeUrl: "https://discord.com/channels/g/w/bot1" });
  await queue(member(guild, "411111111111111112"));
  await flushStaffAlerts(guild, { now: T0 });
  assert.ok(sent[0].content.includes("(https://discord.com/channels/g/w/bot1)"));
  assert.ok(sent[0].content.includes(`(https://discord.com/channels/${guild.id}/${CHAT})`));
});

test("messages d'arrivée désactivés dans Discord : pas de lecture du salon système", async () => {
  const { guild, sent, fetches } = fakeGuild({ suppressJoins: true });
  await configure(guild);
  await queue(member(guild, "511111111111111111"));
  await flushStaffAlerts(guild, { now: T0 });
  assert.equal(fetches(), 0);
  assert.ok(sent[0].content.includes(`(https://discord.com/channels/${guild.id}/${SYS})`), "repli sur le salon système");
});

test("rôle invalide ou @everyone : personne n'est notifié", async () => {
  for (const staffRoleId of ["", "800000000000000999", "abc"]) {
    const { guild, sent } = fakeGuild();
    await configure(guild, { staffRoleId });
    await queue(member(guild, "611111111111111111"));
    await flushStaffAlerts(guild, { now: T0 });
    assert.deepEqual(sent[0].payload.allowedMentions, { parse: [], roles: [] }, staffRoleId);
    assert.ok(!sent[0].content.includes("<@&"), staffRoleId);
  }
  const { guild, sent } = fakeGuild();
  await configure(guild, { staffRoleId: guild.id });
  await queue(member(guild, "611111111111111112"));
  await flushStaffAlerts(guild, { now: T0 });
  assert.deepEqual(sent[0].payload.allowedMentions.roles, []);
});

test("membre reparti avant d'être accueilli : barré dans l'alerte", async () => {
  const { guild, edits } = fakeGuild();
  await configure(guild);
  const m = member(guild, "711111111111111111");
  await queue(m);
  await flushStaffAlerts(guild, { now: T0 });
  await markStaffAlertLeft(m);
  assert.equal(edits.length, 1);
  assert.ok(edits[0].content.includes("~~<@711111111111111111>~~ est déjà reparti"));
});

function fakeInteraction(guild, message, userId) {
  const calls = [];
  return {
    calls,
    guildId: guild.id,
    message: { ...message, fetch: async () => message },
    user: { id: userId },
    deferUpdate: async () => calls.push("defer"),
    editReply: async (p) => {
      calls.push(p);
      if (p.content !== undefined) message.content = p.content;
      return message;
    },
  };
}

test("bouton « J'y vais » : ajoute puis retire le membre, sans notifier", async () => {
  const { guild, sent } = fakeGuild();
  await configure(guild);
  await queue(member(guild, "811111111111111111"));
  await flushStaffAlerts(guild, { now: T0 });

  const i1 = fakeInteraction(guild, sent[0], "811111111111111999");
  await handleStaffAlertButton(i1);
  assert.equal(i1.calls[0], "defer");
  assert.ok(i1.calls[1].content.includes("🙋 **En route :** <@811111111111111999>"));
  assert.deepEqual(i1.calls[1].allowedMentions.roles, []);

  // Une arrivée suivante garde la liste.
  await queue(member(guild, "811111111111111112"));
  const edited = await flushStaffAlerts(guild, { now: T0 + 1000 });
  assert.ok(edited.content.includes("<@811111111111111999>"));

  const i2 = fakeInteraction(guild, sent[0], "811111111111111999");
  await handleStaffAlertButton(i2);
  assert.ok(!i2.calls[1].content.includes("En route"));
});

test("bouton sur une alerte hors mémoire (bot redémarré) : liste relue dans le message", async () => {
  const { guild } = fakeGuild();
  const alert = buildStaffAlertPayload({ roleId: ROLE, members: [{ id: "911111111111111111", url: "https://x" }], helpers: ["911111111111111998"] });
  const message = { id: "old", content: alert.content };
  const i = fakeInteraction(guild, message, "911111111111111999");
  await handleStaffAlertButton(i);
  assert.deepEqual(parseHelpers(i.calls[1].content), ["911111111111111998", "911111111111111999"]);
  assert.deepEqual(i.calls[1].allowedMentions, { parse: [] });
});

test("helpers : lecture, bascule, remplacement de ligne", () => {
  const base = buildStaffAlertPayload({ members: [{ id: "1", url: "" }] }).content;
  assert.deepEqual(parseHelpers(base), []);
  const withOne = withHelpers(base, toggleHelper([], "42"));
  assert.deepEqual(parseHelpers(withOne), ["42"]);
  assert.equal(withHelpers(withOne, toggleHelper(["42"], "42")), base);
  assert.equal(withOne.split("\n").length, base.split("\n").length, "la ligne est remplacée, pas ajoutée");
});

test("payload : test sans notification, liste limitée, délai borné", () => {
  const test1 = buildStaffAlertPayload({ roleId: ROLE, members: [{ id: "1", url: "" }] }, { notifyRole: true, test: true });
  assert.deepEqual(test1.allowedMentions.roles, []);
  assert.match(test1.content, /^-# 🧪 Test/);

  const many = Array.from({ length: 14 }, (_, k) => ({ id: String(k), url: "" }));
  const p = buildStaffAlertPayload({ members: many });
  assert.match(p.content, /14 nouveaux membres/);
  assert.match(p.content, /… et \*\*4\*\* de plus/);

  assert.equal(staffPingCooldownMs({ staffPingCooldownMin: -5 }), 0);
  assert.equal(staffPingCooldownMs({ staffPingCooldownMin: 9999 }), 240 * 60_000);
  assert.equal(staffPingCooldownMs({ staffPingCooldownMin: "x" }), 10 * 60_000);
});

test("bouton : une erreur Discord ne remplace pas l'alerte, réponse privée à la place", async () => {
  const { guild } = fakeGuild();
  const message = { id: "x", content: buildStaffAlertPayload({ members: [{ id: "1", url: "" }] }).content };
  const i = fakeInteraction(guild, message, "2");
  const followUps = [];
  i.editReply = async () => {
    throw new Error("Unknown Message");
  };
  i.followUp = async (p) => followUps.push(p);
  await handleStaffAlertButton(i);
  assert.equal(followUps.length, 1);
  assert.match(followUps[0].content, /Impossible/);
});
