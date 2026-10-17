import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TEXTS,
  buildLinkPanelPayload,
  getLinkPanelConfig,
  setLinkPanelConfig,
  resetLinkPanelTexts,
  getLinkPanelPosted,
  setLinkPanelPosted,
  hasCustomId,
  isLinkPanelMessage,
} from "../src/linkpanel.js";

const GUILD = "lp-guild";

test("panneau par défaut : un seul conseil corehalla, bouton lnkp_open", () => {
  const json = JSON.stringify(buildLinkPanelPayload({ ...DEFAULT_TEXTS, color: "#4ea1ff" }).components.map((c) => c.toJSON()));
  assert.equal(json.split("corehalla.com").length - 1, 1);
  assert.match(json, /3v3/);
  assert.match(json, /"custom_id":"lnkp_open"/);
});

test("hasCustomId : trouve un bouton imbriqué (objets discord.js ou JSON brut)", () => {
  const raw = buildLinkPanelPayload(DEFAULT_TEXTS).components.map((c) => c.toJSON());
  assert.equal(hasCustomId(raw, "lnkp_open"), true);
  assert.equal(hasCustomId(raw, "autre"), false);
  const lib = [{ components: [{ components: [{ customId: "lnkp_open" }] }] }];
  assert.equal(hasCustomId(lib, "lnkp_open"), true);
  assert.equal(hasCustomId(null, "lnkp_open"), false);
});

test("isLinkPanelMessage : seulement les panneaux postés par le bot", () => {
  const components = [{ components: [{ customId: "lnkp_open" }] }];
  assert.equal(isLinkPanelMessage({ author: { id: "bot" }, components }, "bot"), true);
  assert.equal(isLinkPanelMessage({ author: { id: "membre" }, components }, "bot"), false);
  assert.equal(isLinkPanelMessage({ author: { id: "bot" }, components: [] }, "bot"), false);
  assert.equal(isLinkPanelMessage(null, "bot"), false);
});

test("resetLinkPanelTexts : remet les textes, garde salon et apparence", async () => {
  await setLinkPanelConfig(GUILD, { title: "Ancien", footerText: "Vieux conseil", color: "#ff0000", channelId: "123" });
  const cfg = await resetLinkPanelTexts(GUILD);
  for (const [k, v] of Object.entries(DEFAULT_TEXTS)) assert.equal(cfg[k], v, k);
  assert.equal(cfg.color, "#ff0000");
  assert.equal(cfg.channelId, "123");
});

test("panneau publié : suivi hors de la config éditable", async () => {
  await setLinkPanelPosted(GUILD, { channelId: "123", messageId: "456" });
  assert.deepEqual(await getLinkPanelPosted(GUILD), { channelId: "123", messageId: "456" });
  assert.equal("posted" in (await getLinkPanelConfig(GUILD)), false);
  await setLinkPanelPosted(GUILD, null);
  assert.equal(await getLinkPanelPosted(GUILD), null);
});
