import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { hostInstallationArtifacts, type SessionHost } from '@telesarch/engine';

export interface HostInstallationResult {
  readonly host: SessionHost;
  readonly configurationDirectory: string;
  readonly installedFiles: readonly string[];
  readonly mcpServers: readonly string[];
}

export interface HostInstallationOptions {
  readonly homeDirectory?: string;
  readonly cliCommand?: readonly [string, ...string[]];
  readonly registerMcp?: (
    host: SessionHost,
    name: string,
    command: readonly string[],
  ) => void;
}

/** Installs fixed host integration once; no repository files are touched. */
export async function installHostIntegration(
  host: SessionHost,
  options: HostInstallationOptions = {},
): Promise<HostInstallationResult> {
  const cli = options.cliCommand;
  if (cli === undefined) {
    throw new Error('The standalone CLI command is missing.');
  }
  const root = join(options.homeDirectory ?? homedir(), `.${host}`);
  const artifacts = hostInstallationArtifacts(host, cli);
  for (const artifact of artifacts) {
    const path = join(root, artifact.relativePath);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const scratch = `${path}.${randomUUID()}`;
    await writeFile(scratch, artifact.content, { mode: 0o600 });
    await rename(scratch, path);
  }
  const register = options.registerMcp ?? registerHostMcp;
  const servers = [
    ['telesarch', [...cli, 'mcp', 'session']],
    ['telesarch-role', [...cli, 'mcp', 'role']],
    ['telesarch-storybook', [...cli, 'mcp', 'storybook']],
  ] as const;
  for (const [name, command] of servers) register(host, name, command);
  return {
    host,
    configurationDirectory: root,
    installedFiles: artifacts.map((artifact) =>
      join(root, artifact.relativePath),
    ),
    mcpServers: servers.map(([name]) => name),
  };
}

function registerHostMcp(
  host: SessionHost,
  name: string,
  command: readonly string[],
): void {
  removeOwnedRegistration(host, name);
  const [executable, ...arguments_] = command;
  if (executable === undefined) throw new Error('MCP command is missing.');
  const args =
    host === 'claude'
      ? ['mcp', 'add', '--scope', 'user', name, '--', executable, ...arguments_]
      : ['mcp', 'add', name, '--', executable, ...arguments_];
  execFileSync(host, args, { stdio: 'pipe' });
}

function removeOwnedRegistration(host: SessionHost, name: string): void {
  try {
    execFileSync(
      host,
      host === 'claude'
        ? ['mcp', 'remove', '--scope', 'user', name]
        : ['mcp', 'remove', name],
      { stdio: 'pipe' },
    );
  } catch {
    // Absence is the expected first-install state.
  }
}
