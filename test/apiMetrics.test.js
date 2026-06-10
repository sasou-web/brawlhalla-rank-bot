import test from "node:test";
import assert from "node:assert/strict";
import {
  recordOutcome,
  recordRetry,
  recordCooldown,
  snapshot,
  resetMetrics,
} from "../src/apiMetrics.js";

test("compte les tentatives par catégorie", () => {
  resetMetrics();
  recordOutcome("ok", { status: 200 });
  recordOutcome("ok", { status: 200 });
  recordOutcome("rateLimited", { status: 429 });
  recordOutcome("serverErrors", { status: 502 });
  recordOutcome("notFound", { status: 404 });
  recordOutcome("networkErrors", { message: "ECONNRESET" });

  const s = snapshot();
  assert.equal(s.requests, 6);
  assert.equal(s.ok, 2);
  assert.equal(s.rateLimited, 1);
  assert.equal(s.serverErrors, 1);
  assert.equal(s.notFound, 1);
  assert.equal(s.networkErrors, 1);
});

test("successRate exclut les 404 et vaut ok/significatifs", () => {
  resetMetrics();
  recordOutcome("ok");
  recordOutcome("ok");
  recordOutcome("ok");
  recordOutcome("serverErrors", { status: 500 });
  recordOutcome("notFound", { status: 404 }); // ignoré dans le taux

  const s = snapshot();
  assert.equal(s.meaningful, 4); // 3 ok + 1 serveur (404 exclu)
  assert.equal(s.successRate, 0.75);
});

test("successRate = 1 quand aucun appel significatif", () => {
  resetMetrics();
  const s = snapshot();
  assert.equal(s.meaningful, 0);
  assert.equal(s.successRate, 1);
});

test("lastError renseigné pour les erreurs, pas pour ok/notFound", () => {
  resetMetrics();
  recordOutcome("ok");
  assert.equal(snapshot().lastError, null);
  recordOutcome("notFound", { status: 404 });
  assert.equal(snapshot().lastError, null);
  recordOutcome("serverErrors", { status: 503, message: "indispo" });
  const s = snapshot();
  assert.equal(s.lastError.status, 503);
  assert.equal(s.lastError.message, "indispo");
  assert.equal(typeof s.lastError.ts, "number");
});

test("retries / cooldowns et fusion des champs extra", () => {
  resetMetrics();
  recordRetry();
  recordRetry();
  recordCooldown();
  const s = snapshot({ cooldownActiveMs: 1234, pendingProfiles: 3 });
  assert.equal(s.retries, 2);
  assert.equal(s.cooldowns, 1);
  assert.equal(s.cooldownActiveMs, 1234);
  assert.equal(s.pendingProfiles, 3);
  assert.equal(typeof s.uptimeMs, "number");
});
