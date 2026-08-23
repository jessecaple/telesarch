export type StorybookProblemCode =
  | 'storybook-missing'
  | 'configuration-missing'
  | 'start-script-missing'
  | 'unsupported-framework'
  | 'mcp-addon-missing'
  | 'mcp-addon-unregistered'
  | 'test-addon-missing'
  | 'test-addon-unregistered'
  | 'accessibility-addon-missing'
  | 'accessibility-addon-unregistered'
  | 'themes-addon-missing'
  | 'themes-addon-unregistered'
  | 'msw-missing'
  | 'msw-addon-missing'
  | 'msw-addon-unregistered'
  | 'start-failed'
  | 'mcp-unavailable'
  | 'mcp-tools-missing'
  | 'mcp-review-enabled';

export interface StorybookProblem {
  readonly code: StorybookProblemCode;
  readonly message: string;
  readonly automaticallyFixable: boolean;
}

export interface StorybookProject {
  readonly id: string;
  readonly relativeDirectory: string;
  readonly packageName: string;
  readonly packageManager: 'pnpm' | 'npm' | 'yarn';
  readonly configDirectory: string;
  readonly problems: readonly StorybookProblem[];
}

export interface StorybookReadiness {
  readonly status: 'ready' | 'repairable' | 'unsupported' | 'missing';
  readonly projects: readonly StorybookProject[];
}

export interface RunningStorybook {
  readonly project: StorybookProject;
  readonly worktreePath: string;
  readonly port: number;
  readonly url: string;
  readonly mcpUrl: string;
  readonly agentMcpUrl: string;
  readonly process: RepositoryProcessIdentity;
}

export interface StorybookAgentMcpEndpoint {
  readonly kind: 'unix';
  readonly socketPath: string;
}
import type { RepositoryProcessIdentity } from '@telesarch/repository-tooling';
