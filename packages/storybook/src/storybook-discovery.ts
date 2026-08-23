import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

import type {
  StorybookProblem,
  StorybookProject,
  StorybookReadiness,
} from './storybook-types.js';

const packageManagers = ['pnpm', 'npm', 'yarn'] as const;

export async function discoverStorybook(
  repositoryPath: string,
): Promise<StorybookReadiness> {
  const root = resolve(repositoryPath);
  const packages = await findPackageFiles(root);
  const projects: StorybookProject[] = [];
  for (const packageFile of packages) {
    const packageJson = await readJson(packageFile);
    if (!isRecord(packageJson)) continue;
    const packageDirectory = dirname(packageFile);
    const config = await findConfig(packageDirectory);
    const dependencies = dependencyNames(packageJson);
    const isCandidate =
      config !== undefined ||
      dependencies.has('storybook') ||
      [...dependencies].some((name) => name.startsWith('@storybook/')) ||
      dependencies.has('react');
    if (!isCandidate) continue;
    const relativeDirectory = relative(root, packageDirectory) || '.';
    const configText =
      config === undefined ? '' : await readFile(config, 'utf8');
    projects.push({
      id: relativeDirectory,
      relativeDirectory,
      packageName:
        typeof packageJson.name === 'string'
          ? packageJson.name
          : basename(packageDirectory),
      packageManager: await detectPackageManager(root, packageDirectory),
      configDirectory:
        relativeDirectory === '.'
          ? '.storybook'
          : `${relativeDirectory}/.storybook`,
      problems: projectProblems(packageJson, dependencies, config, configText),
    });
  }
  if (projects.length === 0) return { status: 'missing', projects: [] };
  const problems = projects.flatMap((project) => project.problems);
  return {
    status:
      problems.length === 0
        ? 'ready'
        : problems.every((problem) => problem.automaticallyFixable)
          ? 'repairable'
          : 'unsupported',
    projects,
  };
}

export function canConfigureReactStorybook(
  readiness: StorybookReadiness,
): boolean {
  return readiness.projects.some((project) =>
    project.problems.every(
      (problem) => problem.code !== 'unsupported-framework',
    ),
  );
}

function projectProblems(
  packageJson: Readonly<Record<string, unknown>>,
  dependencies: ReadonlySet<string>,
  config: string | undefined,
  configText: string,
): readonly StorybookProblem[] {
  const scripts = isRecord(packageJson.scripts) ? packageJson.scripts : {};
  const problems: StorybookProblem[] = [];
  if (
    !dependencies.has('storybook') &&
    ![...dependencies].some((name) => name.startsWith('@storybook/'))
  ) {
    problems.push(problem('storybook-missing', 'Storybook is not installed.'));
  }
  if (config === undefined) {
    problems.push(
      problem('configuration-missing', 'Storybook configuration is missing.'),
    );
  }
  if (typeof scripts.storybook !== 'string') {
    problems.push(
      problem('start-script-missing', 'The package has no storybook script.'),
    );
  }
  if (
    !dependencies.has('react') &&
    !dependencies.has('react-dom') &&
    !configText.includes('@storybook/react') &&
    !dependencies.has('@storybook/react') &&
    !dependencies.has('@storybook/react-vite') &&
    !dependencies.has('@storybook/nextjs') &&
    !dependencies.has('@storybook/nextjs-vite')
  ) {
    problems.push({
      code: 'unsupported-framework',
      message: 'Storybook MCP currently requires a React Storybook project.',
      automaticallyFixable: false,
    });
  }
  addonProblems(
    problems,
    dependencies,
    configText,
    '@storybook/addon-mcp',
    'mcp-addon-missing',
    'mcp-addon-unregistered',
    'Storybook MCP',
  );
  addonProblems(
    problems,
    dependencies,
    configText,
    '@storybook/addon-vitest',
    'test-addon-missing',
    'test-addon-unregistered',
    'Storybook Test',
  );
  addonProblems(
    problems,
    dependencies,
    configText,
    '@storybook/addon-a11y',
    'accessibility-addon-missing',
    'accessibility-addon-unregistered',
    'Storybook accessibility testing',
  );
  addonProblems(
    problems,
    dependencies,
    configText,
    '@storybook/addon-themes',
    'themes-addon-missing',
    'themes-addon-unregistered',
    'Storybook themes',
  );
  if (!dependencies.has('msw')) {
    problems.push(problem('msw-missing', 'MSW is not installed.'));
  }
  addonProblems(
    problems,
    dependencies,
    configText,
    'msw-storybook-addon',
    'msw-addon-missing',
    'msw-addon-unregistered',
    'Storybook MSW',
  );
  return problems;
}

function addonProblems(
  problems: StorybookProblem[],
  dependencies: ReadonlySet<string>,
  configText: string,
  packageName: string,
  missing: StorybookProblem['code'],
  unregistered: StorybookProblem['code'],
  label: string,
): void {
  if (!dependencies.has(packageName)) {
    problems.push(problem(missing, `${label} is not installed.`));
  } else if (!configText.includes(packageName)) {
    problems.push(problem(unregistered, `${label} is not registered.`));
  }
}

function problem(
  code: StorybookProblem['code'],
  message: string,
): StorybookProblem {
  return { code, message, automaticallyFixable: true };
}

async function findPackageFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 5) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.worktrees' ||
        entry.name === 'dist' ||
        entry.name === 'coverage'
      ) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isFile() && entry.name === 'package.json') found.push(path);
      if (entry.isDirectory()) await visit(path, depth + 1);
    }
  }
  await visit(root, 0);
  return found;
}

async function findConfig(
  packageDirectory: string,
): Promise<string | undefined> {
  const directory = join(packageDirectory, '.storybook');
  try {
    const entries = await readdir(directory);
    const main = entries.find((name) => /^main\.(?:[cm]?[jt]s)$/.test(name));
    return main === undefined ? undefined : join(directory, main);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function detectPackageManager(
  root: string,
  packageDirectory: string,
): Promise<(typeof packageManagers)[number]> {
  let directory = packageDirectory;
  while (directory.startsWith(root)) {
    const packageJson = await readJson(join(directory, 'package.json'));
    if (
      isRecord(packageJson) &&
      typeof packageJson.packageManager === 'string'
    ) {
      const name = packageJson.packageManager.split('@', 1)[0];
      if (packageManagers.includes(name as (typeof packageManagers)[number])) {
        return name as (typeof packageManagers)[number];
      }
    }
    if (await exists(join(directory, 'pnpm-lock.yaml'))) return 'pnpm';
    if (await exists(join(directory, 'yarn.lock'))) return 'yarn';
    if (await exists(join(directory, 'package-lock.json'))) return 'npm';
    if (directory === root) break;
    directory = dirname(directory);
  }
  return 'npm';
}

function dependencyNames(
  packageJson: Readonly<Record<string, unknown>>,
): Set<string> {
  const result = new Set<string>();
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const value = packageJson[field];
    if (isRecord(value))
      for (const name of Object.keys(value)) result.add(name);
  }
  return result;
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
