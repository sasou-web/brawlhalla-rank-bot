import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import globals from "globals";

const DASH_DIR = join(dirname(fileURLToPath(import.meta.url)), "src", "web", "public");

/**
 * Surface partagée du dashboard.
 *
 * Les fichiers de src/web/public sont des scripts CLASSIQUES (pas des modules ES,
 * voir plus bas) : ils partagent donc un seul et même scope global. Découper app.js
 * en plusieurs fichiers rend ce partage invisible pour ESLint, qui signalerait
 * ~1200 faux `no-undef`.
 *
 * On dérive la liste de leurs déclarations de premier niveau au lieu de l'écrire à
 * la main : une liste figée de 100 noms dériverait à la première fonction ajoutée.
 * `no-undef` reste donc actif — un appel vers un nom qui n'existe nulle part est
 * toujours signalé, ce qui est le but (fautes de frappe).
 */
function dashboardSharedGlobals() {
  const out = {};
  for (const file of readdirSync(DASH_DIR).filter((n) => n.endsWith(".js"))) {
    for (const line of readFileSync(join(DASH_DIR, file), "utf8").split(/\r?\n/)) {
      // Premier niveau uniquement : la ligne commence sans indentation.
      const m = /^(?:async\s+)?(function|const|let)\s+([A-Za-z_$][\w$]*)/.exec(line);
      if (m) out[m[2]] = m[1] === "let" ? "writable" : "readonly";
    }
  }
  return out;
}

/**
 * Configuration ESLint (flat config).
 *
 * Objectif : attraper des BUGS, pas imposer un style. `node --check` (npm run check)
 * ne valide que la syntaxe : il ne voit ni une variable inutilisee, ni une faute de
 * frappe sur un nom de propriete, ni une cle dupliquee, ni du code inatteignable.
 * Aucune regle de mise en forme ici (indentation, guillemets, points-virgules) :
 * le style existant du projet est deja coherent, on ne veut pas de bruit.
 *
 * Trois environnements distincts :
 *   - src/**            : Node, ESM
 *   - src/web/public/** : navigateur, scripts classiques (globales partagees
 *                         entre app.js et catgirl.js, pas de modules ES)
 *   - test/ + scripts/  : Node, ESM, globales de node:test
 */

// Regles orientees "vrai bug", partagees par tous les environnements.
const bugRules = {
  // Code mort / oublis.
  //  - argsIgnorePattern ^ctx$ : tous les handlers de commandes partagent la
  //    signature (interaction, ctx) meme quand ctx est inutile. Convention
  //    assumee, pas du code mort.
  //  - ignoreRestSiblings : autorise l'idiome d'omission de cles
  //    `const { a, b, ...reste } = obj` ou a/b ne servent qu'a etre exclus.
  "no-unused-vars": [
    "warn",
    {
      args: "after-used",
      argsIgnorePattern: "^_|^ctx$",
      caughtErrors: "none",
      ignoreRestSiblings: true,
    },
  ],
  "no-unreachable": "error",
  "no-constant-condition": ["error", { checkLoops: false }],

  // Fautes de frappe et doublons silencieux
  "no-undef": "error",
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-duplicate-case": "error",
  "no-func-assign": "error",
  "no-import-assign": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",

  // Pieges asynchrones
  "no-async-promise-executor": "error",
  // Desactivees volontairement (bruit sans valeur sur ce projet) :
  //  - require-atomic-updates : signale le motif de garde `if (busy) return; busy = true;
  //    try { await ... } finally { busy = false; }`, utilise a dessein dans sync.js,
  //    index.js et roles.js. Faux positif en JS mono-thread.
  //  - no-promise-executor-return : signale `new Promise((r) => setTimeout(r, ms))`,
  //    l'idiome standard de pause, present dans brawlhalla.js et les tests.
  "require-atomic-updates": "off",
  "no-promise-executor-return": "off",

  // Divers pieges classiques
  "no-fallthrough": "error",
  "no-unsafe-optional-chaining": "error",
  "no-unsafe-negation": "error",
  "no-sparse-arrays": "error",
  // "except-parens" : signale le `if (x = 1)` accidentel, mais autorise l'idiome
  // volontaire et parenthese `while ((m = re.exec(s)) !== null)`.
  "no-cond-assign": ["error", "except-parens"],
  "no-compare-neg-zero": "error",
  "valid-typeof": "error",
  "use-isnan": "error",

  // `catch {}` volontairement vide est un choix assume du projet (best-effort).
  "no-empty": ["error", { allowEmptyCatch: true }],
};

export default [
  {
    ignores: ["node_modules/**", "data/**", "backups/**"],
  },

  // ---- Bot : Node + ESM ----
  {
    files: ["src/**/*.js", "scripts/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: bugRules,
  },

  // ---- Tests : globales de node:test ----
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, describe: "readonly", it: "readonly", before: "readonly", after: "readonly", beforeEach: "readonly", afterEach: "readonly" },
    },
  },

  // ---- Dashboard : navigateur, scripts classiques (pas de modules ES) ----
  // Pourquoi pas de modules : catgirl.js remplace des fonctions globales du
  // dashboard (toast, renderApp, renderOverview, showLogin) pour s'y greffer. En
  // modules ES, les appels internes resolveraient la liaison du module et non la
  // globale : la surcouche ne serait plus jamais appelee.
  // Consequence assumee : les fichiers dash-*.js partagent un scope global, dont
  // la surface est derivee du code (voir dashboardSharedGlobals ci-dessus).
  {
    files: ["src/web/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: { ...globals.browser, ...dashboardSharedGlobals() },
    },
    rules: {
      ...bugRules,
      // `vars: "local"` : en script classique, les declarations de premier niveau
      // SONT des globales. Sans ca, chaque fonction partagee serait signalee comme
      // inutilisee, ESLint ne voyant pas les appels venant des autres fichiers.
      // Les variables locales et les parametres restent verifies.
      "no-unused-vars": [
        "warn",
        { vars: "local", args: "after-used", argsIgnorePattern: "^_|^ctx$", caughtErrors: "none", ignoreRestSiblings: true },
      ],
    },
  },

  // ---- Config pm2 : CommonJS ----
  {
    files: ["*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: bugRules,
  },
];
