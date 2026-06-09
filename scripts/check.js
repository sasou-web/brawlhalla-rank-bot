// Lint syntaxique : passe `node --check` sur tous les .js de src/ (portable Windows/Linux).
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function walk(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (entry.endsWith(".js")) out.push(p);
  }
  return out;
}

const files = walk("src");
let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    failed++;
    console.error(`✗ ${f}\n${e.stderr?.toString() || e.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} fichier(s) en échec sur ${files.length}.`);
  process.exit(1);
}
console.log(`✓ ${files.length} fichiers OK (node --check).`);
