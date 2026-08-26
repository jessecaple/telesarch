import type {
  DeliveryActionRecord,
  DeliveryRecord,
} from '@big-plan/repository-authority';

import type { DeliveryRoleAssignment } from './delivery-role-assignment.js';
import type { DeliveryNextAction } from './delivery-lifecycle-types.js';

export type DeliverySessionState =
  | {
      readonly state: 'Working';
      readonly message: string;
      readonly assignment?: DeliveryRoleAssignment;
    }
  | {
      readonly state: 'Needs your input';
      readonly message: string;
      readonly action?: DeliveryActionRecord;
    }
  | { readonly state: 'Blocked'; readonly message: string }
  | {
      readonly state: 'Complete';
      readonly message: string;
      readonly delivery?: DeliveryRecord;
    };

export function stateForDirective(
  next: DeliveryNextAction,
): DeliverySessionState {
  if (next.kind === 'integration-ready') {
    return {
      state: 'Complete',
      message: 'The delivery is ready for handoff.',
      delivery: next.delivery,
    };
  }
  if (next.kind === 'wait-for-user') return userState(next.action);
  if (next.kind === 'blocked') {
    return { state: 'Blocked', message: next.reason };
  }
  if (next.kind === 'continue-action') {
    return {
      state: 'Working',
      message: `Continue ${humanAction(next.action.kind)}.`,
    };
  }
  return {
    state: 'Working',
    message: `The next step is ${next.kind.replaceAll('-', ' ')}.`,
  };
}

export function userState(action: DeliveryActionRecord): DeliverySessionState {
  const input = object(action.input);
  return {
    state: 'Needs your input',
    message:
      action.kind === 'manual-test'
        ? `Please test: ${stringList(input.tests).join('; ')}`
        : String(input.question ?? 'A decision is required.'),
    action,
  };
}

export function humanAction(kind: string): string {
  return kind.replaceAll('-', ' ');
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
