import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';

// Development-only. Requires an explicitly installed OpenCC CLI, never a runtime service.
// Read checked-in source/catalog definitions, never documents, tests, DB rows or user input.
if (process.argv.slice(2).some((arg) => arg !== '--check'))
  throw Error('Usage: node scripts/generate-ui-zh-cn.mjs [--check]');
const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'apps/public-api/src/ui-zh-cn.ts');
const phrases = new Set(['大雁初級', '大雁高級']);
for (const directory of ['apps/public-api/src', 'migrations']) {
  for (const name of await readdir(path.join(root, directory))) {
    if (!/\.(ts|sql)$/.test(name) || name === 'ui-zh-cn.ts') continue;
    const source = await readFile(path.join(root, directory, name), 'utf8');
    for (const match of source.matchAll(/[\p{Script=Han}]+/gu)) phrases.add(match[0]);
  }
}
const original = [...phrases].sort();
const converted = JSON.parse(
  execFileSync('opencc', ['-c', 't2s.json'], {
    input: JSON.stringify(original),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024
  })
);
if (
  !Array.isArray(converted) ||
  converted.length !== original.length ||
  converted.some((value) => typeof value !== 'string')
)
  throw Error('Invalid OpenCC phrase reference');
const pairs = original.flatMap((value, index) =>
  value === converted[index] ? [] : [[value, converted[index]]]
);
const header =
  '// Development-time OpenCC 1.2 t2s reference for source-owned UI phrases only.\n// No runtime converter, external service, or learner-content translation.\n';
const rendered = await format(
  header +
    'export const simplifiedUiPhrases: Readonly<Record<string,string>> = Object.freeze(' +
    JSON.stringify(Object.fromEntries(pairs)) +
    ');\n',
  { ...(await resolveConfig(target)), filepath: target }
);
if (process.argv.includes('--check')) {
  if ((await readFile(target, 'utf8')) !== rendered)
    throw Error('UI reference differs; regenerate and review source-owned phrase changes.');
} else await writeFile(target, rendered);
console.log(
  JSON.stringify({
    sourcePhrases: original.length,
    simplifiedMappings: pairs.length,
    check: process.argv.includes('--check')
  })
);
