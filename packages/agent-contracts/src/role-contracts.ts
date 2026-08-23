import { resolve } from 'node:path';

export const runtimeRoles = [
  'decomposition',
  'delivery-revision',
  'implementation',
  'leaf-review',
  'integration-review',
  'storybook-composition',
] as const;

export type RuntimeRole = (typeof runtimeRoles)[number];

export const runtimeCalls = [
  'decomposition-pending-node',
  'delivery-revision-required-change',
  'implementation-initial',
  'implementation-correction',
  'leaf-review-completed-leaf',
  'integration-review-completed-parent',
  'storybook-composition-interface',
] as const;

export type RuntimeCall = (typeof runtimeCalls)[number];
export type RoleCapabilityTier = 'standard' | 'elevated';

export interface RoleConfiguration {
  readonly capabilityTier: RoleCapabilityTier;
  readonly workspaceAccess: 'read-only' | 'read-write';
  readonly instructionSetPaths: readonly string[];
  readonly sharedInstructionPath?: string;
}

export interface CallConfiguration {
  readonly role: RuntimeRole;
  readonly instructionPath: string;
  readonly resultSchemaPath: string;
}

export interface InstructionSourceDefinition {
  readonly sourcePath: string;
  readonly kind: 'instruction-set' | 'role' | 'call';
  readonly role?: RuntimeRole;
  readonly call?: RuntimeCall;
}

const contextInstructions =
  'instruction-sets/context-tools/shared.instructions.md';
const engineeringInstructions =
  'instruction-sets/engineering/shared.instructions.md';

export const roleConfigurations: Record<RuntimeRole, RoleConfiguration> = {
  decomposition: role('elevated', 'read-only', [contextInstructions]),
  'delivery-revision': role('elevated', 'read-only', [contextInstructions]),
  implementation: role(
    'standard',
    'read-write',
    [contextInstructions, engineeringInstructions],
    'roles/implementation/shared.instructions.md',
  ),
  'leaf-review': role('standard', 'read-only', [
    contextInstructions,
    engineeringInstructions,
  ]),
  'integration-review': role('elevated', 'read-only', [
    contextInstructions,
    engineeringInstructions,
  ]),
  'storybook-composition': role(
    'standard',
    'read-write',
    [
      contextInstructions,
      engineeringInstructions,
      'instruction-sets/storybook/shared.instructions.md',
    ],
    'roles/storybook-composition/shared.instructions.md',
  ),
};

export const callConfigurations: Record<RuntimeCall, CallConfiguration> = {
  'decomposition-pending-node': contract(
    'decomposition',
    'pending-node',
    'decomposition-result',
  ),
  'delivery-revision-required-change': contract(
    'delivery-revision',
    'required-change',
    'delivery-revision-result',
  ),
  'implementation-initial': contract(
    'implementation',
    'initial',
    'implementation-result',
  ),
  'implementation-correction': contract(
    'implementation',
    'correction',
    'implementation-result',
  ),
  'leaf-review-completed-leaf': contract(
    'leaf-review',
    'completed-leaf',
    'review-result',
  ),
  'integration-review-completed-parent': contract(
    'integration-review',
    'completed-parent',
    'review-result',
  ),
  'storybook-composition-interface': contract(
    'storybook-composition',
    'interface',
    'storybook-composition-result',
  ),
};

const contextTools = [
  'delivery_overview',
  'node_context',
  'delivery_readiness',
  'dependency_chains',
  'delivery_search',
  'delivery_revision_impact',
  'source_context',
] as const;

export const storybookRoleTools = [
  'list_projects',
  'find_stories',
  'changed_stories',
  'preview_stories',
  'run_tests',
  'list_components',
  'component_documentation',
  'story_documentation',
] as const;

export const roleToolAllowlists: Record<RuntimeRole, readonly string[]> = {
  decomposition: ['pull_assignment', 'submit_result', ...contextTools],
  'delivery-revision': ['pull_assignment', 'submit_result', ...contextTools],
  implementation: ['pull_assignment', 'submit_result', ...contextTools],
  'leaf-review': ['pull_assignment', 'submit_result', ...contextTools],
  'integration-review': ['pull_assignment', 'submit_result', ...contextTools],
  'storybook-composition': [
    'pull_assignment',
    'submit_result',
    ...contextTools,
    ...storybookRoleTools,
  ],
};

export const instructionSourceDefinitions: readonly InstructionSourceDefinition[] =
  [
    ...[
      ...new Set(
        runtimeRoles.flatMap(
          (name) => roleConfigurations[name].instructionSetPaths,
        ),
      ),
    ].map<InstructionSourceDefinition>((sourcePath) => ({
      sourcePath,
      kind: 'instruction-set',
    })),
    ...runtimeRoles.flatMap<InstructionSourceDefinition>((name) => {
      const sourcePath = roleConfigurations[name].sharedInstructionPath;
      return sourcePath === undefined
        ? []
        : [{ sourcePath, kind: 'role', role: name }];
    }),
    ...runtimeCalls.map<InstructionSourceDefinition>((call) => ({
      sourcePath: callConfigurations[call].instructionPath,
      kind: 'call',
      role: callConfigurations[call].role,
      call,
    })),
  ];

export function roleInstructions(
  contractsRoot: string,
  call: RuntimeCall,
): {
  readonly role: RuntimeRole;
  readonly instructionPaths: readonly string[];
  readonly resultSchemaPath: string;
} {
  const callConfiguration = callConfigurations[call];
  const roleConfiguration = roleConfigurations[callConfiguration.role];
  return {
    role: callConfiguration.role,
    instructionPaths: [
      ...roleConfiguration.instructionSetPaths,
      ...(roleConfiguration.sharedInstructionPath === undefined
        ? []
        : [roleConfiguration.sharedInstructionPath]),
      callConfiguration.instructionPath,
    ].map((path) => resolve(contractsRoot, path)),
    resultSchemaPath: resolve(
      contractsRoot,
      callConfiguration.resultSchemaPath,
    ),
  };
}

export function resultStatus(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.result)) return 'invalid-result';
  return typeof value.result.status === 'string'
    ? value.result.status
    : 'invalid-result';
}

function role(
  capabilityTier: RoleCapabilityTier,
  workspaceAccess: 'read-only' | 'read-write',
  instructionSetPaths: readonly string[],
  sharedInstructionPath?: string,
): RoleConfiguration {
  return {
    capabilityTier,
    workspaceAccess,
    instructionSetPaths,
    ...(sharedInstructionPath === undefined ? {} : { sharedInstructionPath }),
  };
}

function contract(
  roleName: RuntimeRole,
  state: string,
  output: string,
): CallConfiguration {
  return {
    role: roleName,
    instructionPath: `roles/${roleName}/calls/${state}.instructions.md`,
    resultSchemaPath: `roles/${roleName}/schemas/${output}.schema.json`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
