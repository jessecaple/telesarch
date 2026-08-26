import type {
  DeliveryActionRecord,
  DeliveryDependency,
  DeliveryGraph,
  DeliveryNodeContract,
  DeliveryRecord,
} from '#repository-authority';

export type DeliveryLifecycleActionKind =
  | 'decomposition'
  | 'implementation'
  | 'verification'
  | 'leaf-review'
  | 'integration-review'
  | 'manual-test'
  | 'delivery-revision'
  | 'user-decision';

export interface ApprovedDeliveryIntent {
  readonly deliveryId: string;
  readonly title: string;
  readonly goal: string;
  readonly provides: readonly string[];
  readonly consumes: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly notInScope: readonly string[];
  readonly designHorizon: readonly string[];
  readonly primaryBranch: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseCommit: string;
  readonly occurredAtMs: number;
}

export interface DeliveryChildDefinition {
  readonly nodeId: string;
  readonly displayOrder: number;
  readonly title: string;
  readonly goal: string;
  readonly provides: readonly string[];
  readonly consumes: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly notInScope: readonly string[];
}

export type DecompositionResult =
  | { readonly status: 'leaf' }
  | {
      readonly status: 'children';
      readonly children: readonly DeliveryChildDefinition[];
      readonly dependencies: readonly DeliveryDependency[];
    };

export type ImplementationResult =
  | {
      readonly status: 'completed';
      readonly manualTests?: readonly string[];
    }
  | { readonly status: 'revision-required'; readonly reason: string };

export interface VerificationCommandEvidence {
  readonly command: string;
  readonly exitCode: number;
  readonly elapsedMs: number;
  readonly output: string;
}

export type VerificationResult =
  | {
      readonly status: 'passed';
      readonly commands?: readonly VerificationCommandEvidence[];
      readonly commit?: string;
    }
  | {
      readonly status: 'failed';
      readonly problem: string;
      readonly commands?: readonly VerificationCommandEvidence[];
    };

export type ReviewResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'findings'; readonly findings: readonly string[] };

export type ManualTestResult =
  | { readonly status: 'passed' }
  | {
      readonly status: 'failed';
      readonly observations: readonly string[];
    };

export interface UserDecisionResult {
  readonly answer: string;
}

export type DeliveryRevisionResult =
  | { readonly status: 'applied'; readonly graph: DeliveryGraph }
  | {
      readonly status: 'decision-required';
      readonly question: string;
      readonly recommendation?: string;
    };

export type DeliveryActionResult =
  | DecompositionResult
  | ImplementationResult
  | VerificationResult
  | ReviewResult
  | ManualTestResult
  | UserDecisionResult
  | DeliveryRevisionResult;

export type DeliveryRevisionTrigger =
  | {
      readonly kind:
        | 'changed-intent'
        | 'discovered-requirement'
        | 'manual-observation';
      readonly summary: string;
    }
  | {
      readonly kind: 'implementation-discovery';
      readonly actionId: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'integration-findings';
      readonly actionId: string;
      readonly findings: readonly string[];
    }
  | {
      readonly kind: 'manual-test-failure';
      readonly actionId: string;
      readonly observations: readonly string[];
    }
  | {
      readonly kind: 'user-decision';
      readonly actionId: string;
      readonly answer: string;
    };

export type DeliveryNextAction =
  | { readonly kind: 'integration-ready'; readonly delivery: DeliveryRecord }
  | { readonly kind: 'continue-action'; readonly action: DeliveryActionRecord }
  | { readonly kind: 'wait-for-user'; readonly action: DeliveryActionRecord }
  | {
      readonly kind: 'run-decomposition';
      readonly node: DeliveryNodeContract;
    }
  | {
      readonly kind: 'run-implementation';
      readonly node: DeliveryNodeContract;
      readonly mode: 'initial' | 'correction';
      readonly findings?: readonly string[];
      readonly failedVerification?: string;
    }
  | {
      readonly kind: 'run-verification';
      readonly node: DeliveryNodeContract;
      readonly implementationActionId: string;
    }
  | {
      readonly kind: 'run-leaf-review';
      readonly node: DeliveryNodeContract;
      readonly implementationActionId: string;
      readonly verificationActionId: string;
    }
  | {
      readonly kind: 'run-integration-review';
      readonly node: DeliveryNodeContract;
      readonly childNodeIds: readonly string[];
    }
  | {
      readonly kind: 'request-manual-test';
      readonly node: DeliveryNodeContract;
      readonly tests: readonly string[];
      readonly sourceActionIds: readonly string[];
    }
  | {
      readonly kind: 'run-delivery-revision';
      readonly node: DeliveryNodeContract;
      readonly trigger: DeliveryRevisionTrigger;
    }
  | {
      readonly kind: 'request-decision';
      readonly node: DeliveryNodeContract;
      readonly question: string;
      readonly recommendation?: string;
    }
  | { readonly kind: 'complete-parent'; readonly node: DeliveryNodeContract }
  | {
      readonly kind: 'mark-integration-ready';
      readonly delivery: DeliveryRecord;
    }
  | { readonly kind: 'blocked'; readonly reason: string };

export interface StartedDeliveryAction {
  readonly delivery: DeliveryRecord;
  readonly action: DeliveryActionRecord;
  readonly directive: Exclude<
    DeliveryNextAction,
    | { kind: 'integration-ready' | 'continue-action' | 'wait-for-user' }
    | { kind: 'complete-parent' | 'mark-integration-ready' | 'blocked' }
  >;
}
