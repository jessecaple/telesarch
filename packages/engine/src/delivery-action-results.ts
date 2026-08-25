import type { DeliveryActionRecord } from '@telesarch/repository-authority';

import { DeliveryLifecycleDataError } from './delivery-lifecycle-error.js';
import type {
  DeliveryRevisionResult,
  DecompositionResult,
  ImplementationResult,
  ManualTestResult,
  ReviewResult,
  UserDecisionResult,
  VerificationResult,
  VisualAdjustmentResult,
  VisualReviewResult,
} from './delivery-lifecycle-types.js';

export function decompositionResult(
  action: DeliveryActionRecord,
): DecompositionResult {
  const result = objectResult(action);
  if (result.status === 'leaf') return { status: 'leaf' };
  if (
    result.status === 'children' &&
    Array.isArray(result.children) &&
    Array.isArray(result.dependencies)
  ) {
    return result as unknown as DecompositionResult;
  }
  return invalid(action);
}

export function implementationResult(
  action: DeliveryActionRecord,
): ImplementationResult {
  const result = objectResult(action);
  if (result.status === 'revision-required' && text(result.reason)) {
    return { status: 'revision-required', reason: result.reason };
  }
  if (
    result.status === 'completed' &&
    (result.manualTests === undefined || textList(result.manualTests))
  ) {
    return {
      status: 'completed',
      ...(result.manualTests === undefined
        ? {}
        : { manualTests: result.manualTests }),
    };
  }
  return invalid(action);
}

export function verificationResult(
  action: DeliveryActionRecord,
): VerificationResult {
  const result = objectResult(action);
  if (result.status === 'passed') return { status: 'passed' };
  if (result.status === 'failed' && text(result.problem)) {
    return { status: 'failed', problem: result.problem };
  }
  return invalid(action);
}

export function reviewResult(action: DeliveryActionRecord): ReviewResult {
  const result = objectResult(action);
  if (result.status === 'accepted') return { status: 'accepted' };
  if (result.status === 'findings' && nonEmptyTextList(result.findings)) {
    return { status: 'findings', findings: result.findings };
  }
  return invalid(action);
}

export function manualTestResult(
  action: DeliveryActionRecord,
): ManualTestResult {
  const result = objectResult(action);
  if (result.status === 'passed') return { status: 'passed' };
  if (result.status === 'failed' && nonEmptyTextList(result.observations)) {
    return { status: 'failed', observations: result.observations };
  }
  return invalid(action);
}

export function visualReviewResult(
  action: DeliveryActionRecord,
): VisualReviewResult {
  const result = objectResult(action);
  if (result.status === 'approved' || result.status === 'superseded') {
    return { status: result.status };
  }
  return invalid(action);
}

export function visualAdjustmentResult(
  action: DeliveryActionRecord,
): VisualAdjustmentResult {
  const result = objectResult(action);
  if (result.status === 'revision-required' && text(result.reason)) {
    return { status: 'revision-required', reason: result.reason };
  }
  if (
    result.status === 'preview-ready' &&
    (result.commit === undefined || text(result.commit)) &&
    (result.changedPaths === undefined || textList(result.changedPaths))
  ) {
    return {
      status: 'preview-ready',
      ...(result.commit === undefined ? {} : { commit: result.commit }),
      ...(result.changedPaths === undefined
        ? {}
        : { changedPaths: result.changedPaths }),
    };
  }
  return invalid(action);
}

export function deliveryRevisionResult(
  action: DeliveryActionRecord,
): DeliveryRevisionResult {
  const result = objectResult(action);
  if (result.status === 'applied' && object(result.graph)) {
    return result as unknown as DeliveryRevisionResult;
  }
  if (
    result.status === 'decision-required' &&
    text(result.question) &&
    (result.recommendation === undefined || text(result.recommendation))
  ) {
    return {
      status: 'decision-required',
      question: result.question,
      ...(result.recommendation === undefined
        ? {}
        : { recommendation: result.recommendation }),
    };
  }
  return invalid(action);
}

export function userDecisionResult(
  action: DeliveryActionRecord,
): UserDecisionResult {
  const result = objectResult(action);
  if (text(result.answer)) return { answer: result.answer };
  return invalid(action);
}

function objectResult(action: DeliveryActionRecord): Record<string, unknown> {
  if (!object(action.result)) return invalid(action);
  return action.result;
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}

function nonEmptyTextList(value: unknown): value is string[] {
  return textList(value) && value.length > 0;
}

function invalid(action: DeliveryActionRecord): never {
  throw new DeliveryLifecycleDataError(
    `Delivery action ${action.actionId} has an invalid ${action.kind} result.`,
  );
}
