import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  initializeRepositoryAuthority,
  inspectRepositoryAuthority,
  openRepositoryAuthority,
  readRepositoryConfiguration,
  updateRepositoryConfiguration,
  type RepositoryAuthorityConfiguration,
  type RepositoryAuthorityConfigurationInput,
} from '@big-plan/repository-authority';

export interface RepositorySetupInspection {
  readonly initialized: boolean;
  readonly repositoryRoot: string;
  readonly detectedVerificationCommands: readonly string[];
  readonly choicesRequired: readonly ('verificationCommands' | 'lifecycle')[];
  readonly configuration?: RepositoryAuthorityConfiguration;
}

export function inspectRepositorySetup(
  workingDirectory: string,
): RepositorySetupInspection {
  const location = inspectRepositoryAuthority(workingDirectory);
  if (location.initialized) {
    const authority = openRepositoryAuthority(workingDirectory);
    try {
      return {
        initialized: true,
        repositoryRoot: location.checkout.rootDirectory,
        detectedVerificationCommands: [],
        choicesRequired: [],
        configuration: readRepositoryConfiguration(authority.database),
      };
    } finally {
      authority.database.close();
    }
  }
  const manifest = readManifest(location.checkout.rootDirectory);
  return {
    initialized: false,
    repositoryRoot: location.checkout.rootDirectory,
    detectedVerificationCommands: detectedCommands(manifest),
    choicesRequired: ['verificationCommands', 'lifecycle'],
  };
}

export function initializeRepositorySession(
  workingDirectory: string,
  configuration: Omit<RepositoryAuthorityConfigurationInput, 'occurredAtMs'>,
  occurredAtMs = Date.now(),
): RepositoryAuthorityConfiguration {
  const authority = initializeRepositoryAuthority(workingDirectory, {
    ...configuration,
    occurredAtMs,
  });
  try {
    return readRepositoryConfiguration(authority.database);
  } finally {
    authority.database.close();
  }
}

export function configureRepositorySession(
  workingDirectory: string,
  configuration: Omit<RepositoryAuthorityConfigurationInput, 'occurredAtMs'>,
  occurredAtMs = Date.now(),
): RepositoryAuthorityConfiguration {
  const authority = openRepositoryAuthority(workingDirectory);
  try {
    const current = readRepositoryConfiguration(authority.database);
    return updateRepositoryConfiguration(authority.database, {
      ...configuration,
      expectedRevision: current.revision,
      occurredAtMs,
    });
  } finally {
    authority.database.close();
  }
}

function readManifest(root: string): Record<string, unknown> | undefined {
  const path = join(root, 'package.json');
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return object(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function detectedCommands(
  manifest: Record<string, unknown> | undefined,
): readonly string[] {
  const scripts = object(manifest?.scripts) ? manifest.scripts : {};
  return ['build', 'test', 'lint', 'typecheck', 'format:check']
    .filter((name) => typeof scripts[name] === 'string')
    .map((name) => `pnpm ${name}`);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
