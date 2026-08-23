import {
  roleConfigurations,
  roleToolAllowlists,
  runtimeRoles,
  storybookRoleTools,
  type RuntimeRole,
} from '@telesarch/agent-contracts';

import {
  entrySkillBody,
  entrySkillDescription,
  entrySkillName,
  roleDefinitionPreamble,
} from './guidance-host-content.js';

export interface HostInstallationArtifact {
  /** Path relative to the supported host's user configuration directory. */
  readonly relativePath: string;
  readonly content: string;
}

export type SessionHost = 'claude' | 'codex';

/**
 * Produces the fixed, project-neutral files installed once for a session host.
 * Project instructions and guidance arrive later through `pull_assignment`.
 */
export function hostInstallationArtifacts(
  host: SessionHost,
): readonly HostInstallationArtifact[] {
  return host === 'claude' ? claudeArtifacts() : codexArtifacts();
}

const claudeTierModels = { standard: 'sonnet', elevated: 'opus' } as const;
const codexTierModels = {
  standard: 'gpt-5.6-terra',
  elevated: 'gpt-5.6-sol',
} as const;

function claudeArtifacts(): readonly HostInstallationArtifact[] {
  return [
    ...runtimeRoles.map((role) => ({
      relativePath: `agents/telesarch-${role}.md`,
      content: [
        '---',
        `name: telesarch-${role}`,
        `description: Telesarch ${role} role agent. Launch only for a current delivery action.`,
        `model: ${claudeTierModels[roleConfigurations[role].capabilityTier]}`,
        `tools: ${claudeToolList(role)}`,
        '---',
        '',
        roleDefinitionPreamble(role),
        '',
      ].join('\n'),
    })),
    skillArtifact(),
  ];
}

function codexArtifacts(): readonly HostInstallationArtifact[] {
  return [
    ...runtimeRoles.map((role) => ({
      relativePath: `agents/telesarch-${role}.toml`,
      content: [
        `name = ${tomlString(`telesarch-${role}`)}`,
        `description = ${tomlString(`Telesarch ${role} role agent. Launch only for a current delivery action.`)}`,
        `model = ${tomlString(codexTierModels[roleConfigurations[role].capabilityTier])}`,
        'model_reasoning_effort = "medium"',
        `developer_instructions = ${tomlString(roleDefinitionPreamble(role))}`,
        `sandbox_mode = ${tomlString(codexSandbox(role))}`,
        'project_doc_max_bytes = 0',
        '',
        '[mcp_servers.telesarch]',
        'enabled = false',
        '',
        '[mcp_servers.telesarch-role]',
        'enabled = true',
        `enabled_tools = ${tomlArray(hostServableTools(role))}`,
        '',
        '[mcp_servers.telesarch-storybook]',
        `enabled = ${role === 'storybook-composition' ? 'true' : 'false'}`,
        `enabled_tools = ${tomlArray(storybookTools(role))}`,
        '',
      ].join('\n'),
    })),
    skillArtifact(),
  ];
}

function skillArtifact(): HostInstallationArtifact {
  return {
    relativePath: `skills/${entrySkillName}/SKILL.md`,
    content: [
      '---',
      `name: ${entrySkillName}`,
      `description: ${entrySkillDescription}`,
      '---',
      '',
      entrySkillBody,
      '',
    ].join('\n'),
  };
}

function hostServableTools(role: RuntimeRole): readonly string[] {
  return roleToolAllowlists[role].filter(
    (tool) => !storybookToolNames.has(tool),
  );
}

const storybookToolNames = new Set<string>(storybookRoleTools);

const builtInReadWriteTools = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Glob',
  'Grep',
] as const;
const builtInReadOnlyTools = ['Read', 'Glob', 'Grep'] as const;

function claudeToolList(role: RuntimeRole): string {
  return hostServableTools(role)
    .map((tool) => `mcp__telesarch-role__${tool}`)
    .concat(
      storybookTools(role).map((tool) => `mcp__telesarch-storybook__${tool}`),
    )
    .concat(
      roleConfigurations[role].workspaceAccess === 'read-write'
        ? builtInReadWriteTools
        : builtInReadOnlyTools,
    )
    .join(', ');
}

function storybookTools(role: RuntimeRole): readonly string[] {
  return role === 'storybook-composition' ? storybookRoleTools : [];
}

function codexSandbox(role: RuntimeRole): 'read-only' | 'workspace-write' {
  return roleConfigurations[role].workspaceAccess === 'read-write'
    ? 'workspace-write'
    : 'read-only';
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlArray(values: readonly string[]): string {
  return `[${values.map(tomlString).join(', ')}]`;
}
