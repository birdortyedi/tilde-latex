// Writes public/licenses/npm-packages.txt: the license file of every npm
// package that ends up in Tilde's page. Run `npm run licenses` after
// adding, removing or updating a dependency.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dirs = execSync('npm ls --omit=dev --all --parseable', { encoding: 'utf8' }).trim().split('\n').slice(1);
const seen = new Set();
let out = "Licenses of the npm packages bundled into Tilde's page (npm ls --omit=dev).\n";
for (const dir of dirs.sort()) {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const id = `${pkg.name}@${pkg.version}`;
  // texlyre-busytex is listed in NOTICE.txt with the engine; @napi-rs is only used when PDF.js runs in Node.
  if (seen.has(id) || pkg.name === 'texlyre-busytex' || pkg.name.startsWith('@napi-rs')) continue;
  seen.add(id);
  const file = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '(no license file in the package)';
  out += `\n\n==== ${id} (${pkg.license ?? '?'}) ====\n\n${text}`;
}
fs.writeFileSync('public/licenses/npm-packages.txt', `${out}\n`);
console.log(`Wrote the licenses of ${seen.size} packages to public/licenses/npm-packages.txt`);
