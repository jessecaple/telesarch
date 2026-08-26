import type {
  DeliveryHandoffResult,
  DeliveryHandoffSummary,
  DeliveryManualHandoff,
} from './delivery-git-handoff-types.js';

export function pullRequestBody(summary: DeliveryHandoffSummary): string {
  return `## What Changed\n\n${summary.whatChanged}\n\n## Why\n\n${summary.why}`;
}

export function manualHandoff(
  input: { readonly branchName: string; readonly worktreePath: string },
  problem: string,
): DeliveryManualHandoff {
  return {
    status: 'manual',
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    problem,
    action: 'Push the branch and open a pull request manually.',
  };
}

export function recoveryHandoff(
  input: { readonly branchName: string; readonly worktreePath: string },
  problem: string,
): DeliveryHandoffResult {
  return {
    status: 'recovery-required',
    branchName: input.branchName,
    worktreePath: input.worktreePath,
    problem,
  };
}

export function handoffErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
