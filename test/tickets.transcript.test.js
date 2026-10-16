import test from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import {
  fetchAllChannelMessages,
  attachmentsBytes,
  TRANSCRIPT_MAX_MESSAGES,
  TRANSCRIPT_MAX_IMAGES_BYTES,
} from "../src/commands/panels/tickets.js";

/**
 * Transcript de ticket : le bouton est accessible à l'auteur du ticket, la génération doit
 * donc rester bornée (nombre de messages récupérés, poids des images intégrées).
 */

// Salon factice au contenu « infini » : chaque page renvoie `limit` messages plus anciens.
function endlessChannel() {
  const calls = [];
  let next = 10_000_000;
  return {
    calls,
    messages: {
      fetch: async (opts) => {
        calls.push(opts);
        const page = new Collection();
        for (let i = 0; i < opts.limit; i++) {
          const id = String(next--);
          page.set(id, { id, attachments: new Collection() });
        }
        return page;
      },
    },
  };
}

test("fetchAllChannelMessages s'arrête au plafond, sans dépasser 100 par page", async () => {
  const ch = endlessChannel();
  const all = await fetchAllChannelMessages(ch);
  assert.equal(all.length, TRANSCRIPT_MAX_MESSAGES);
  assert.equal(ch.calls.length, Math.ceil(TRANSCRIPT_MAX_MESSAGES / 100));
  assert.ok(ch.calls.every((o) => o.limit <= 100));
  // Ordre chronologique : le plus ancien d'abord.
  assert.ok(Number(all[0].id) < Number(all.at(-1).id));
});

test("fetchAllChannelMessages : dernière page réduite au reste du plafond", async () => {
  const ch = endlessChannel();
  const all = await fetchAllChannelMessages(ch, 250);
  assert.equal(all.length, 250);
  assert.deepEqual(ch.calls.map((o) => o.limit), [100, 100, 50]);
});

test("fetchAllChannelMessages : un salon court est lu en entier", async () => {
  const page = new Collection([["2", { id: "2" }], ["1", { id: "1" }]]);
  const calls = [];
  const all = await fetchAllChannelMessages({ messages: { fetch: async (o) => (calls.push(o), page) } });
  assert.deepEqual(all.map((m) => m.id), ["1", "2"]);
  assert.equal(calls.length, 1);
});

test("attachmentsBytes : somme des pièces jointes, seuil d'intégration des images", () => {
  const mb = 1024 * 1024;
  const msg = (...sizes) => ({ attachments: new Collection(sizes.map((size, i) => [String(i), { size }])) });
  const light = [msg(2 * mb), msg(), msg(3 * mb, 1 * mb)];
  assert.equal(attachmentsBytes(light), 6 * mb);
  assert.ok(attachmentsBytes(light) <= TRANSCRIPT_MAX_IMAGES_BYTES, "images intégrées");

  // 10 images de 10 Mo (limite d'un compte gratuit) : pas d'intégration.
  const heavy = Array.from({ length: 10 }, () => msg(10 * mb));
  assert.ok(attachmentsBytes(heavy) > TRANSCRIPT_MAX_IMAGES_BYTES, "repli sans images");
  assert.equal(attachmentsBytes([{}, { attachments: null }]), 0, "messages sans pièces jointes");
});
