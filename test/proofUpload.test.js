import test from "node:test";
import assert from "node:assert/strict";
import {
  validateProofFiles,
  uploadLabel,
  uploadModal,
  textLabel,
  buildDisputeModal,
  proofFileTypes,
  proofMaxBytes,
  downloadProofFiles,
  showUploadModal,
  safeFileName,
  sendWithFilesFallback,
  PROOF_MAX_BYTES,
} from "../src/proofUpload.js";
import { buildLinkProofModal, handleLinkProofButton } from "../src/commands/linking.js";
import { buildTicketOpenModal } from "../src/commands/panels/tickets.js";
import { clampProofMaxFiles } from "../src/settings.js";

/**
 * Preuve par upload dans un modal : validation des fichiers (fonction pure), forme du
 * modal en JSON brut (Label 18 / File Upload 19 + filtre `file_types`), téléchargement
 * restreint au CDN Discord, repli d'envoi sans fichiers.
 */

const MB = 1024 * 1024;
const png = (size = 200_000, name = "rank.png") => ({ name, size, contentType: "image/png" });

test("validateProofFiles : accepte une image PNG", () => {
  const r = validateProofFiles([png()]);
  assert.equal(r.ok, true);
  assert.equal(r.files.length, 1);
});

test("validateProofFiles : refuse un PDF", () => {
  const r = validateProofFiles([{ name: "preuve.pdf", size: 1000, contentType: "application/pdf" }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /preuve\.pdf/);
});

test("validateProofFiles : refuse un fichier plus lourd que le maximum", () => {
  const r = validateProofFiles([png(9 * MB)], { maxBytes: 8 * MB });
  assert.equal(r.ok, false);
  assert.match(r.error, /trop lourd/);
});

test("validateProofFiles : MP4 accepté seulement si allowVideo", () => {
  const mp4 = { name: "clip.mp4", size: 3 * MB, contentType: "video/mp4" };
  assert.equal(validateProofFiles([mp4]).ok, false);
  assert.equal(validateProofFiles([mp4], { allowVideo: true }).ok, true);
  const mov = { name: "clip.mov", size: 3 * MB, contentType: "video/quicktime" };
  assert.equal(validateProofFiles([mov], { allowVideo: true }).ok, true);
});

test("validateProofFiles : limite le nombre de fichiers et le poids total", () => {
  assert.equal(validateProofFiles([png(), png(), png()], { maxFiles: 2 }).ok, false);
  assert.equal(validateProofFiles([png(), png()], { maxFiles: 2 }).ok, true);
  const big = [png(4 * MB), png(4 * MB), png(4 * MB)];
  const r = validateProofFiles(big, { maxBytes: 8 * MB, maxTotalBytes: 10 * MB });
  assert.equal(r.ok, false);
  assert.match(r.error, /au total/);
});

test("validateProofFiles : vide refusé si requis, accepté sinon ; extension si pas de MIME", () => {
  assert.equal(validateProofFiles([], { required: true }).ok, false);
  assert.deepEqual(validateProofFiles(null), { ok: true, files: [] });
  assert.equal(validateProofFiles([{ name: "a.JPG", size: 10 }]).ok, true);
  assert.equal(validateProofFiles([{ name: "a.exe", size: 10 }]).ok, false);
  // Un MIME menteur ne passe pas, même avec une extension d'image.
  assert.equal(validateProofFiles([{ name: "a.png", size: 10, contentType: "text/html" }]).ok, false);
  // Les Collection discord.js (Map) sont acceptées.
  assert.equal(validateProofFiles(new Map([["1", png()]])).ok, true);
});

test("proofMaxBytes : limite du salon plafonnée à 8 Mio", () => {
  assert.equal(proofMaxBytes({ attachmentSizeLimit: 25 * MB }), PROOF_MAX_BYTES);
  assert.equal(proofMaxBytes({ attachmentSizeLimit: 5 * MB }), 5 * MB);
  assert.equal(proofMaxBytes({}), PROOF_MAX_BYTES);
});

test("modal JSON brut : Label (18) + File Upload (19) avec file_types en extensions", () => {
  const label = uploadLabel({ label: "Capture", min: 1, max: 3, required: true });
  assert.equal(label.type, 18);
  assert.equal(label.component.type, 19);
  assert.equal(label.component.custom_id, "files");
  assert.equal(label.component.min_values, 1);
  assert.equal(label.component.max_values, 3);
  assert.equal(label.component.required, true);
  assert.ok(Array.isArray(label.component.file_types));
  // L'API n'accepte que des catégories ou des extensions « .xxx » (10 max), pas « image/* ».
  for (const t of proofFileTypes({ allowVideo: true })) assert.match(t, /^\.[a-z0-9]+$/);
  assert.ok(proofFileTypes({ allowVideo: true }).length <= 10);
  assert.ok(!proofFileTypes().includes(".mp4"));
  assert.ok(proofFileTypes({ allowVideo: true }).includes(".mp4"));

  const text = textLabel({ label: "Raison", customId: "reason", paragraph: true, required: true, maxLength: 300 });
  assert.equal(text.type, 18);
  assert.equal(text.component.type, 4);
  assert.equal(text.component.max_length, 300);

  const modal = uploadModal({ customId: "x", title: "Un titre bien trop long pour un modal Discord, coupé", components: [label] });
  assert.ok(modal.title.length <= 45);
});

test("modal de liaison : upload requis, nombre et vidéo selon les réglages", () => {
  const m = buildLinkProofModal(123456, { proofMaxFiles: 2, proofAllowVideo: false });
  assert.equal(m.custom_id, "lnkproof_modal:123456");
  const up = m.components.find((c) => c.component.type === 19).component;
  assert.equal(up.required, true);
  assert.equal(up.min_values, 1);
  assert.equal(up.max_values, 2);
  assert.ok(!up.file_types.includes(".mp4"));
  const withVideo = buildLinkProofModal(1, { proofMaxFiles: 3, proofAllowVideo: true });
  assert.ok(withVideo.components.find((c) => c.component.type === 19).component.file_types.includes(".mov"));
});

test("modal de litige : raison requise, capture facultative (réutilisable par le ladder)", () => {
  const m = buildDisputeModal("lad_dispute_modal:42");
  assert.equal(m.custom_id, "lad_dispute_modal:42");
  const reason = m.components.find((c) => c.component.type === 4).component;
  assert.equal(reason.custom_id, "reason");
  assert.equal(reason.required, true);
  const up = m.components.find((c) => c.component.type === 19).component;
  assert.equal(up.required, false);
  assert.equal(up.min_values, 0);
});

test("modal de ticket : sujet + pièces jointes facultatives", () => {
  const m = buildTicketOpenModal("t1", { label: "Signalement d'un joueur avec un nom très long" });
  assert.equal(m.custom_id, "tck_create_modal:t1");
  assert.ok(m.title.length <= 45);
  assert.equal(m.components.find((c) => c.component.custom_id === "subject").component.required, true);
  const up = m.components.find((c) => c.component.type === 19).component;
  assert.equal(up.required, false);
  assert.equal(up.min_values, 0);
  assert.equal(buildTicketOpenModal(null, null).custom_id, "tck_create_modal:");
});

test("showUploadModal : sur « Invalid Form Body », réessaie sans file_types", async () => {
  const sent = [];
  const it = {
    async showModal(m) {
      sent.push(m);
      if (sent.length === 1) throw Object.assign(new Error("Invalid Form Body"), { code: 50035 });
    },
  };
  await showUploadModal(it, buildDisputeModal("trn_dispute_modal:r0m0"));
  assert.equal(sent.length, 2);
  assert.ok(sent[0].components.some((c) => c.component.file_types));
  assert.ok(sent[1].components.every((c) => c.component.file_types === undefined));
  // Autre erreur : pas de second essai.
  const other = { async showModal() { throw Object.assign(new Error("Unknown interaction"), { code: 10062 }); } };
  await assert.rejects(showUploadModal(other, buildDisputeModal("x")), /Unknown interaction/);
});

test("downloadProofFiles : CDN Discord uniquement, taille réelle vérifiée", async () => {
  const fakeFetch = (bytes) => async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(bytes).buffer });
  const ok = await downloadProofFiles([{ name: "mon rank é.png", url: "https://cdn.discordapp.com/ephemeral-attachments/1/2/a.png?ex=1" }], { fetchImpl: fakeFetch(10) });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].attachment.length, 10);
  assert.equal(ok[0].name, "1_mon_rank_e.png");
  await assert.rejects(downloadProofFiles([{ name: "a.png", url: "https://evil.example/a.png" }], { fetchImpl: fakeFetch(1) }), /ne vient pas de Discord/);
  await assert.rejects(downloadProofFiles([{ name: "a.png", url: "http://cdn.discordapp.com/a.png" }], { fetchImpl: fakeFetch(1) }), /ne vient pas de Discord/);
  await assert.rejects(downloadProofFiles([{ name: "a.png", url: "https://cdn.discordapp.com/a.png" }], { maxBytes: 5, fetchImpl: fakeFetch(6) }), /dépasse/);
  const http404 = async () => ({ ok: false, status: 404 });
  await assert.rejects(downloadProofFiles([{ name: "a.png", url: "https://media.discordapp.net/a.png" }], { fetchImpl: http404 }), /HTTP 404/);
});

test("safeFileName : ASCII, préfixe d'ordre, extension conservée", () => {
  assert.equal(safeFileName("Capture d'écran 2026.PNG", 0), "1_Capture_d_ecran_2026.png");
  assert.equal(safeFileName("", 2), "3_preuve.png");
  assert.equal(safeFileName("../../etc/passwd", 0), "1_etc_passwd.png");
});

test("sendWithFilesFallback : renvoie sans fichiers ni image si l'envoi avec fichiers échoue", async () => {
  const calls = [];
  const channel = {
    async send(p) {
      calls.push(p);
      if (p.files) throw new Error("Request entity too large");
      return { id: "m" };
    },
  };
  const payload = { content: "@staff", embeds: [{ title: "x", image: { url: "attachment://1_a.png" }, fields: [{ name: "Preuve", value: "📎" }, { name: "Compte", value: "y" }] }] };
  const r = await sendWithFilesFallback(channel, payload, [{ attachment: Buffer.from("x"), name: "1_a.png" }]);
  assert.equal(r.filesPosted, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].embeds[0].image, undefined);
  assert.deepEqual(calls[1].embeds[0].fields.map((f) => f.name), ["Compte"]);
  assert.match(calls[1].content, /n'a pas pu être jointe/);

  const ok = await sendWithFilesFallback({ send: async () => ({ id: "m" }) }, payload, [{ attachment: Buffer.from("x"), name: "a.png" }]);
  assert.equal(ok.filesPosted, true);
});

test("clampProofMaxFiles : borne entre 1 et 3, défaut 3", () => {
  assert.equal(clampProofMaxFiles(undefined), 3);
  assert.equal(clampProofMaxFiles(0), 3);
  assert.equal(clampProofMaxFiles(1), 1);
  assert.equal(clampProofMaxFiles("2"), 2);
  assert.equal(clampProofMaxFiles(9), 3);
});

test("bouton « Envoyer ma capture » : réservé à l'auteur de /lier, ouvre le modal en premier", async () => {
  const calls = [];
  const mk = (userId) => ({
    customId: "lnkproof:owner:777",
    user: { id: userId },
    reply: async (p) => calls.push(["reply", p]),
    showModal: async (m) => calls.push(["showModal", m]),
  });
  await handleLinkProofButton(mk("intrus"));
  assert.equal(calls[0][0], "reply");
  await handleLinkProofButton(mk("owner"));
  assert.equal(calls[1][0], "showModal");
  assert.equal(calls[1][1].custom_id, "lnkproof_modal:777");
});
