import test from "node:test";
import assert from "node:assert/strict";
import { checkCooldown, resetCooldowns } from "../src/commands/cooldowns.js";

test("première utilisation autorisée, seconde immédiate bloquée", () => {
  resetCooldowns();
  const a = checkCooldown("carte", "u1", 5000);
  assert.equal(a.ok, true);
  const b = checkCooldown("carte", "u1", 5000);
  assert.equal(b.ok, false);
  assert.ok(b.remainingMs > 0 && b.remainingMs <= 5000);
});

test("cooldowns indépendants par utilisateur", () => {
  resetCooldowns();
  assert.equal(checkCooldown("carte", "u1", 5000).ok, true);
  assert.equal(checkCooldown("carte", "u2", 5000).ok, true); // autre membre = pas affecté
});

test("cooldowns indépendants par catégorie", () => {
  resetCooldowns();
  assert.equal(checkCooldown("carte", "u1", 5000).ok, true);
  assert.equal(checkCooldown("versus", "u1", 5000).ok, true); // autre commande = bucket distinct
});

test("ms <= 0 autorise toujours", () => {
  resetCooldowns();
  assert.equal(checkCooldown("x", "u1", 0).ok, true);
  assert.equal(checkCooldown("x", "u1", 0).ok, true);
});

test("remainingMs décroît avec le temps écoulé (cooldown court)", async () => {
  resetCooldowns();
  assert.equal(checkCooldown("short", "u1", 40).ok, true);
  assert.equal(checkCooldown("short", "u1", 40).ok, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(checkCooldown("short", "u1", 40).ok, true); // expiré -> de nouveau autorisé
});
