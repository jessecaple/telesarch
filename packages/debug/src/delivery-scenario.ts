import { readFile } from 'node:fs/promises';

import {
  DeliverySessionWorkflow,
  initializeRepositorySession,
  inspectRepositorySetup,
  type AcceptedDeliveryIntent,
  type DeliverySessionState,
} from '@telesarch/engine';

export interface DeliveryDebugStep {
  readonly role:
    | 'decomposition'
    | 'delivery-revision'
    | 'implementation'
    | 'leaf-review'
    | 'integration-review'
    | 'storybook-composition';
  readonly files?: readonly {
    readonly path: string;
    readonly contents: string;
  }[];
  readonly result: Readonly<Record<string, unknown>>;
}

export interface DeliveryDebugScenario {
  readonly name: string;
  readonly repository: {
    readonly lifecycle: 'pre-production' | 'maintained';
    readonly developmentMode: 'standard' | 'react-storybook';
    readonly verificationCommands: readonly string[];
    readonly additionalGuidance: string;
  };
  readonly delivery: Omit<
    AcceptedDeliveryIntent,
    'deliveryId' | 'occurredAtMs'
  >;
  readonly steps: readonly DeliveryDebugStep[];
}

export interface StartedDeliveryScenario {
  readonly workflow: DeliverySessionWorkflow;
  readonly state: DeliverySessionState;
}

export async function loadDeliveryScenario(
  path: string,
): Promise<DeliveryDebugScenario> {
  return validateScenario(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export async function startDeliveryScenario(
  workingDirectory: string,
  contractsRoot: string,
  scenario: DeliveryDebugScenario,
): Promise<StartedDeliveryScenario> {
  const setup = inspectRepositorySetup(workingDirectory);
  if (setup.initialized) {
    throw new Error('A debug scenario requires an uninitialized repository.');
  }
  initializeRepositorySession(workingDirectory, scenario.repository);
  const workflow = new DeliverySessionWorkflow(workingDirectory, contractsRoot);
  return {
    workflow,
    state: await workflow.beginDelivery(scenario.delivery),
  };
}

function validateScenario(value: unknown): DeliveryDebugScenario {
  const scenario = object(value, 'scenario');
  const repository = object(scenario.repository, 'repository');
  const delivery = object(scenario.delivery, 'delivery');
  const lifecycle = requiredString(
    repository.lifecycle,
    'repository.lifecycle',
  );
  const developmentMode = requiredString(
    repository.developmentMode,
    'repository.developmentMode',
  );
  if (!['pre-production', 'maintained'].includes(lifecycle)) {
    throw new Error('repository.lifecycle is invalid.');
  }
  if (!['standard', 'react-storybook'].includes(developmentMode)) {
    throw new Error('repository.developmentMode is invalid.');
  }
  return {
    name: requiredString(scenario.name, 'name'),
    repository: {
      lifecycle: lifecycle as 'pre-production' | 'maintained',
      developmentMode: developmentMode as 'standard' | 'react-storybook',
      verificationCommands: strings(
        repository.verificationCommands,
        'repository.verificationCommands',
      ),
      additionalGuidance: stringValue(
        repository.additionalGuidance,
        'repository.additionalGuidance',
      ),
    },
    delivery: {
      title: requiredString(delivery.title, 'delivery.title'),
      goal: requiredString(delivery.goal, 'delivery.goal'),
      provides: strings(delivery.provides, 'delivery.provides'),
      consumes: strings(delivery.consumes, 'delivery.consumes'),
      completionCriteria: strings(
        delivery.completionCriteria,
        'delivery.completionCriteria',
      ),
      notInScope: strings(delivery.notInScope, 'delivery.notInScope'),
      designHorizon: strings(delivery.designHorizon, 'delivery.designHorizon'),
    },
    steps: steps(scenario.steps),
  };
}

function steps(value: unknown): readonly DeliveryDebugStep[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('steps must be a non-empty array.');
  }
  return value.map((item, index) => {
    const step = object(item, `steps[${index}]`);
    const role = requiredString(step.role, `steps[${index}].role`);
    if (!roles.includes(role as DeliveryDebugStep['role'])) {
      throw new Error(`steps[${index}].role is invalid.`);
    }
    const result = object(step.result, `steps[${index}].result`);
    const files = step.files;
    return {
      role: role as DeliveryDebugStep['role'],
      ...(files === undefined
        ? {}
        : {
            files: fileChanges(files, `steps[${index}].files`),
          }),
      result,
    };
  });
}

const roles: readonly DeliveryDebugStep['role'][] = [
  'decomposition',
  'delivery-revision',
  'implementation',
  'leaf-review',
  'integration-review',
  'storybook-composition',
];

function fileChanges(
  value: unknown,
  name: string,
): readonly { readonly path: string; readonly contents: string }[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => {
    const file = object(item, `${name}[${index}]`);
    return {
      path: requiredString(file.path, `${name}[${index}].path`),
      contents: stringValue(file.contents, `${name}[${index}].contents`),
    };
  });
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value;
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string.`);
  }
  return value;
}

function strings(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a string array.`);
  }
  return value;
}
