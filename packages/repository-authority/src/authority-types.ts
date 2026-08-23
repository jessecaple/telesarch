export type RepositoryLifecycle = 'pre-production' | 'maintained';
export type RepositoryDevelopmentMode = 'standard' | 'react-storybook';

export interface RepositoryAuthorityConfiguration {
  readonly revision: number;
  readonly lifecycle: RepositoryLifecycle;
  readonly developmentMode: RepositoryDevelopmentMode;
  readonly verificationCommands: readonly string[];
  readonly updatedAtMs: number;
}

export interface RepositoryAuthorityConfigurationInput {
  readonly lifecycle: RepositoryLifecycle;
  readonly developmentMode: RepositoryDevelopmentMode;
  readonly verificationCommands: readonly string[];
  readonly occurredAtMs: number;
}

export type DeliveryStatus = 'active' | 'integration-ready';
export type DeliveryNodeKind = 'pending' | 'parent' | 'leaf';
export type DeliveryNodeState =
  | 'planned'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'completed';

export interface DeliveryNodeContract {
  readonly nodeId: string;
  readonly parentNodeId?: string;
  readonly displayOrder: number;
  readonly kind: DeliveryNodeKind;
  readonly state: DeliveryNodeState;
  readonly title: string;
  readonly goal: string;
  readonly provides: readonly string[];
  readonly consumes: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly notInScope: readonly string[];
}

export interface DeliveryDependency {
  readonly nodeId: string;
  readonly dependencyNodeId: string;
}

export interface DeliveryGraph {
  readonly nodes: readonly DeliveryNodeContract[];
  readonly dependencies: readonly DeliveryDependency[];
}

export interface DeliveryRecord {
  readonly deliveryId: string;
  readonly revision: number;
  readonly title: string;
  readonly status: DeliveryStatus;
  readonly designHorizon: readonly string[];
  readonly primaryBranch: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseCommit: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly graph: DeliveryGraph;
}

export interface CreateDeliveryInput {
  readonly deliveryId: string;
  readonly title: string;
  readonly designHorizon: readonly string[];
  readonly primaryBranch: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseCommit: string;
  readonly root: DeliveryNodeContract;
  readonly occurredAtMs: number;
}

export type DeliveryActionStatus =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed';

export interface DeliveryActionRecord {
  readonly actionId: string;
  readonly deliveryId: string;
  readonly nodeId?: string;
  readonly sequence: number;
  readonly revision: number;
  readonly kind: string;
  readonly status: DeliveryActionStatus;
  readonly input: unknown;
  readonly result?: unknown;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface DeliveryProcessRecord {
  readonly processId: string;
  readonly deliveryId: string;
  readonly kind: string;
  readonly systemProcessId: number;
  readonly workingDirectory: string;
  readonly metadata: unknown;
  readonly startedAtMs: number;
  readonly stoppedAtMs?: number;
}

export type ExternalEffectStatus =
  | 'pending'
  | 'running'
  | 'uncertain'
  | 'succeeded'
  | 'failed'
  | 'safe-to-retry';

export interface ExternalEffectRecord {
  readonly effectId: string;
  readonly deliveryId: string;
  readonly idempotencyKey: string;
  readonly kind: string;
  readonly status: ExternalEffectStatus;
  readonly request: unknown;
  readonly result?: unknown;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface ExternalEffectAttempt {
  readonly deliveryId: string;
  readonly effectId: string;
  readonly attemptNumber: number;
  readonly startedAtMs: number;
  readonly uncertainAtMs?: number;
  readonly completedAtMs?: number;
  readonly outcome?: Exclude<
    ExternalEffectStatus,
    'pending' | 'running' | 'uncertain'
  >;
  readonly result?: unknown;
}
