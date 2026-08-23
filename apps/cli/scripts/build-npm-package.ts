import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

interface WorkspaceManifest {
  readonly name: string;
  readonly version: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(cliRoot, '../..');
const outputRoot = join(cliRoot, 'dist/npm');
const entryPath = join(outputRoot, 'bin/telesarch.js');

const manifests = await workspaceManifests();
const cli = requiredManifest(manifests, '@telesarch/cli');
const dependencies = await runtimeDependencies(manifests, cli);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(dirname(entryPath), { recursive: true });
await build({
  entryPoints: [join(cliRoot, 'src/cli.ts')],
  outfile: entryPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  conditions: ['@telesarch/source'],
  external: Object.keys(dependencies).flatMap((name) => [name, `${name}/*`]),
  define: {
    TELESARCH_PACKAGE_VERSION: JSON.stringify(cli.version),
  },
});
await chmod(entryPath, 0o755);
await copyContracts();
await cp(join(repositoryRoot, 'README.md'), join(outputRoot, 'README.md'));
await cp(join(repositoryRoot, 'LICENSE'), join(outputRoot, 'LICENSE'));
await writeFile(
  join(outputRoot, 'package.json'),
  `${JSON.stringify(publicManifest(cli.version, dependencies), null, 2)}\n`,
);

async function workspaceManifests(): Promise<
  ReadonlyMap<string, WorkspaceManifest>
> {
  const paths = [join(cliRoot, 'package.json')];
  const packagesRoot = join(repositoryRoot, 'packages');
  for (const name of await readdir(packagesRoot)) {
    paths.push(join(packagesRoot, name, 'package.json'));
  }
  const result = new Map<string, WorkspaceManifest>();
  for (const path of paths) {
    const manifest = JSON.parse(
      await readFile(path, 'utf8'),
    ) as WorkspaceManifest;
    result.set(manifest.name, manifest);
  }
  return result;
}

async function runtimeDependencies(
  manifests: ReadonlyMap<string, WorkspaceManifest>,
  root: WorkspaceManifest,
): Promise<Record<string, string>> {
  const external = new Map<string, string>();
  const visited = new Set<string>();
  const visit = async (manifest: WorkspaceManifest): Promise<void> => {
    if (visited.has(manifest.name)) return;
    visited.add(manifest.name);
    for (const [name, specifier] of Object.entries(
      manifest.dependencies ?? {},
    )) {
      if (specifier.startsWith('workspace:')) {
        await visit(requiredManifest(manifests, name));
        continue;
      }
      const normalized = await normalizedSpecifier(name, specifier);
      const existing = external.get(name);
      if (existing !== undefined && existing !== normalized) {
        throw new Error(`Conflicting runtime versions for ${name}.`);
      }
      external.set(name, normalized);
    }
  };
  await visit(root);
  return Object.fromEntries(
    [...external].sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function normalizedSpecifier(
  name: string,
  specifier: string,
): Promise<string> {
  if (specifier !== 'catalog:') return specifier;
  const workspace = await readFile(
    join(repositoryRoot, 'pnpm-workspace.yaml'),
    'utf8',
  );
  const catalog = /^catalog:\n((?: {2}.*\n?)*)/m.exec(workspace)?.[1];
  if (catalog === undefined) throw new Error('Workspace catalog missing.');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^ {2}${escaped}: (\\S+)$`, 'm').exec(catalog);
  if (match?.[1] === undefined) {
    throw new Error(`Catalog version missing for ${name}.`);
  }
  return match[1];
}

async function copyContracts(): Promise<void> {
  const source = join(repositoryRoot, 'packages/agent-contracts');
  const destination = join(outputRoot, 'agent-contracts');
  await mkdir(destination, { recursive: true });
  await cp(
    join(source, 'instruction-sets'),
    join(destination, 'instruction-sets'),
    {
      recursive: true,
    },
  );
  await cp(join(source, 'roles'), join(destination, 'roles'), {
    recursive: true,
  });
}

function requiredManifest(
  manifests: ReadonlyMap<string, WorkspaceManifest>,
  name: string,
): WorkspaceManifest {
  const manifest = manifests.get(name);
  if (manifest === undefined)
    throw new Error(`Workspace package missing: ${name}`);
  return manifest;
}

function publicManifest(
  version: string,
  dependencies: Readonly<Record<string, string>>,
): object {
  return {
    name: 'telesarch',
    version,
    description:
      'A local workflow engine that coordinates coding agents through small, dependency-aware work.',
    type: 'module',
    bin: { telesarch: 'bin/telesarch.js' },
    files: ['agent-contracts', 'bin'],
    engines: { node: '>=24.18.0 <25' },
    license: 'MIT',
    author: 'Jesse Caple',
    repository: {
      type: 'git',
      url: 'git+https://github.com/jessecaple/telesarch.git',
    },
    homepage: 'https://github.com/jessecaple/telesarch#readme',
    bugs: { url: 'https://github.com/jessecaple/telesarch/issues' },
    keywords: ['coding-agents', 'software-development', 'workflow'],
    dependencies,
    publishConfig: {
      access: 'public',
      registry: 'https://registry.npmjs.org/',
    },
  };
}
