import test from "node:test";
import assert from "node:assert/strict";
import {
  createTournament,
  updateTournament,
  getTournament,
  registerEntrant,
  generateBracket,
  setMatchChannel,
} from "../src/tournament.js";
import { teardownTournament } from "../src/tournamentAutomation.js";
import { handleTournamentButton } from "../src/commands/tournament.js";

/**
 * Fin de tournoi : aucun salon de match orphelin, rôle participant retiré (sinon le check-in
 * du tournoi suivant mentionne tous les anciens inscrits). Base SQLite temporaire.
 */

async function withEntrants(guildId, entrants, patch = {}) {
  await createTournament(guildId, { name: "Cup", maxParticipants: 16, checkInEnabled: false, ...patch });
  await updateTournament(guildId, { status: "registration" });
  for (const [i, members] of entrants.entries()) await registerEntrant(guildId, { members, name: `E${i + 1}` });
}

// Serveur factice : salons existants + membres dont on note les retraits de rôle.
function mockGuild(channelIds) {
  const deleted = [];
  const roleRemovals = [];
  return {
    deleted,
    roleRemovals,
    channels: {
      fetch: async (id) => {
        if (!channelIds.includes(id)) throw new Error("Unknown Channel");
        return { id, delete: async () => deleted.push(id) };
      },
    },
    members: {
      fetch: async (uid) => ({ id: uid, roles: { remove: async (roleId) => roleRemovals.push([uid, roleId]) } }),
    },
  };
}

test("generateBracket refusé quand le tournoi est déjà lancé (matchs conservés)", async () => {
  const G = "g_trn_regen";
  await withEntrants(G, [["u1"], ["u2"], ["u3"], ["u4"]]);
  const first = await generateBracket(G);
  await assert.rejects(generateBracket(G), /déjà lancé/);
  const t = await getTournament(G);
  assert.equal(t.matches.r0m0.aId, first.matches.r0m0.aId);
  assert.equal(t.status, "running");
});

test("generateBracket refusé tant qu'un match a encore un salon (statut modifié à la main)", async () => {
  const G = "g_trn_regen_ch";
  await withEntrants(G, [["u1"], ["u2"]]);
  await generateBracket(G);
  await setMatchChannel(G, "r0m0", "chan-live", "voice-live");
  await updateTournament(G, { status: "registration" });
  await assert.rejects(generateBracket(G), /déjà lancé/);
});

test("teardownTournament : seuls les salons de t.matches sont supprimés, rôle retiré à tous", async () => {
  const t = {
    participantRoleId: "role-p",
    participants: [{ members: ["a1", "a2"] }, { members: ["b1", "b2"] }, { members: ["a1"] }],
    matches: {
      r0m0: { channelId: "m1", voiceChannelId: "v1" },
      r0m1: { channelId: "m2", voiceChannelId: "" },
      r1m0: { channelId: "", voiceChannelId: "" },
      r1m1: { channelId: "deja-supprime", voiceChannelId: "" },
    },
  };
  const guild = mockGuild(["m1", "v1", "m2", "autre-salon"]);
  await teardownTournament(guild, t);
  assert.deepEqual(guild.deleted.sort(), ["m1", "m2", "v1"], "aucun autre salon touché");
  assert.deepEqual(guild.roleRemovals.map(([uid]) => uid).sort(), ["a1", "a2", "b1", "b2"]);
  assert.ok(guild.roleRemovals.every(([, role]) => role === "role-p"));
});

test("teardownTournament : sans rôle participant, aucun membre chargé", async () => {
  const guild = mockGuild([]);
  await teardownTournament(guild, { participantRoleId: "", participants: [{ members: ["x"] }], matches: {} });
  assert.deepEqual(guild.roleRemovals, []);
});

test("trn_leave en 2v2 : l'équipe entière est désinscrite, les deux perdent le rôle", async () => {
  const G = "g_trn_leave_2v2";
  await withEntrants(G, [["a1", "a2"], ["b1", "b2"]], { format: "2v2", participantRoleId: "role-p" });
  const guild = mockGuild([]);
  const calls = [];
  const it = {
    customId: "trn_leave",
    guild: { id: G, members: guild.members },
    user: { id: "a1" },
    member: { roles: { cache: new Map(), remove: async () => {} } },
    client: { channels: { fetch: async () => null } },
    deferred: false,
    replied: false,
    deferReply: async () => { it.deferred = true; },
    editReply: async (p) => calls.push(p),
    reply: async (p) => calls.push(p),
  };
  await handleTournamentButton(it, {});
  assert.match(String(calls.at(-1)), /désinscrit/);
  assert.deepEqual(guild.roleRemovals.map(([uid]) => uid).sort(), ["a1", "a2"]);
  const t = await getTournament(G);
  assert.deepEqual(t.participants.map((p) => p.name), ["E2"]);
});
