import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackResult {
  readonly name: string;
  readonly version: string;
  readonly files: readonly { readonly path: string }[];
}

interface PublicManifest {
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = resolve(cliRoot, 'dist/npm');
const cache = await mkdtemp(resolve(tmpdir(), 'telesarch-npm-cache-'));
let output: string;
try {
  output = execFileSync('npm', ['pack', '--dry-run', '--json', packageRoot], {
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: cache },
  });
} finally {
  await rm(cache, { recursive: true, force: true });
}
const [pack] = JSON.parse(output) as readonly PackResult[];
if (pack === undefined) throw new Error('npm did not describe the package.');

const paths = new Set(pack.files.map(({ path }) => path));
for (const required of [
  'LICENSE',
  'README.md',
  'bin/telesarch.js',
  'agent-contracts/roles/implementation/schemas/implementation-result.schema.json',
]) {
  if (!paths.has(required))
    throw new Error(`Package file missing: ${required}`);
}

const entry = await readFile(resolve(packageRoot, 'bin/telesarch.js'), 'utf8');
if (!entry.startsWith('#!/usr/bin/env node')) {
  throw new Error('The packaged CLI is not executable through Node.');
}
if (/from\s+["']@telesarch\//.test(entry)) {
  throw new Error('The package still imports a private workspace package.');
}

const manifest = JSON.parse(
  await readFile(resolve(packageRoot, 'package.json'), 'utf8'),
) as PublicManifest;
if (manifest.private === true) throw new Error('The package is private.');
for (const [name, specifier] of Object.entries(manifest.dependencies ?? {})) {
  if (
    specifier === 'true' ||
    specifier.startsWith('catalog:') ||
    specifier.startsWith('workspace:')
  ) {
    throw new Error(`Invalid published dependency ${name}@${specifier}.`);
  }
}

process.stdout.write(
  `Checked ${pack.name}@${pack.version}: ${String(pack.files.length)} files.\n`,
);
