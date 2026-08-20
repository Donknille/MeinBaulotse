/**
 * Baut die Vercel-Function zu einer einzigen, abhängigkeitsfreien Datei.
 *
 * Ergebnis: `api/index.js`, CommonJS, mit allem darin — Hono, der Adapter, die
 * Anwendung, `pg`, `jose`, `zod`. Die Datei wird eingecheckt. Das Repository
 * kennt dieses Muster schon von `docs/db-setup.sql` und `plan-fixture.ts`: Was
 * erzeugt wird, liegt trotzdem im Repository, und die CI prüft, dass es zu
 * seiner Quelle passt.
 *
 * Der Grund ist hier ein anderer als dort, und er wiegt schwerer. Vercel
 * übersetzt den Einstiegspunkt und legt Abhängigkeiten daneben, statt zu
 * bündeln. Alles, was die Function zur Laufzeit auflösen muss, ist damit eine
 * Wette auf das Verhalten der Plattform, und vier verlorene Wetten sind genug.
 * Ein Bündel ohne Importe kann diese Wette nicht verlieren.
 *
 * Deshalb prüft dieses Skript sein eigenes Ergebnis: Steht im Bündel ein
 * `require` auf etwas, das kein Node-Baustein ist, bricht es ab. Diese Prüfung
 * hätte jeden der vier Fehler vorher gemeldet.
 *
 * Aufruf: `pnpm build:function`
 */

import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const entry = join(here, '..', 'src', 'vercel.ts');
const outfile = join(root, 'api', 'index.js');

/**
 * `pg` lädt seinen optionalen nativen Treiber über `require('pg-native')` und
 * fängt den Fehler selbst ab. Das Paket ist nicht installiert und soll es auch
 * nicht sein; esbuild darf daran nicht scheitern.
 */
const OPTIONAL = ['pg-native'];

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: OPTIONAL,
  legalComments: 'none',
  banner: {
    js:
      '// ERZEUGT von apps/api/scripts/build-vercel-function.ts — nicht von Hand bearbeiten.\n' +
      '// Quelle: apps/api/src/vercel.ts. Neu erzeugen: pnpm build:function\n',
  },
});

// -- Selbstprüfung ----------------------------------------------------------
//
// Ein Bündel, das noch etwas auflösen muss, ist kein Bündel. Jedes `require`
// muss auf einen Node-Baustein zeigen oder auf das bewusst ausgenommene
// `pg-native`, das `pg` selbst abfängt.

const bundle = readFileSync(outfile, 'utf8');
const required = new Set<string>();
for (const match of bundle.matchAll(/require\(["']([^"']+)["']\)/g)) {
  required.add(match[1]!);
}

const unresolved = [...required].filter(
  (name) => !NODE_BUILTINS.has(name) && !OPTIONAL.includes(name),
);

if (unresolved.length > 0) {
  console.error(
    'Das Bündel verlangt zur Laufzeit Module, die im Lambda nicht liegen:\n' +
      unresolved.map((name) => `  ${name}`).join('\n') +
      '\nGenau daran ist das Deployment viermal gescheitert. Abbruch.',
  );
  process.exit(1);
}

const sizeKb = Math.round(Buffer.byteLength(bundle) / 1024);
console.log(`Function gebaut: ${relative(root, outfile)} (${sizeKb} kB)`);
console.log(`  Laufzeit-Importe: ${[...required].sort().join(', ')}`);
