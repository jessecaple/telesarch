import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DeliveryRoleWorkflow,
  DeliverySessionWorkflow,
  initializeRepositorySession,
  inspectDelivery,
  inspectRepositorySetup,
} from '../../../src/delivery/index.js';
import {
  child,
  git,
  intent,
  requireAssignment,
  writeFile,
} from './delivery-session-test-support.js';

const contractsRoot = fileURLToPath(
  new URL('../../../contracts/', import.meta.url),
);

describe('delivery session workflow', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects setup choices and initializes only from explicit configuration', () => {
    const repository = createRepository({
      scripts: {
        build: 'tsc',
        test: 'vitest run',
        lint: 'eslint .',
      },
    });

    expect(inspectRepositorySetup(repository)).toMatchObject({
      initialized: false,
      detectedVerificationCommands: ['pnpm build', 'pnpm test', 'pnpm lint'],
      choicesRequired: ['verificationCommands', 'lifecycle'],
    });

    initializeRepositorySession(repository, {
      lifecycle: 'pre-production',
      verificationCommands: ['pnpm test'],
    });

    expect(inspectRepositorySetup(repository)).toMatchObject({
      initialized: true,
      configuration: {
        lifecycle: 'pre-production',
        verificationCommands: ['pnpm test'],
      },
    });
  });

  it('runs a one-leaf interface delivery through every assigned phase', async () => {
    const repository = createRepository();
    initializeRepositorySession(repository, {
      lifecycle: 'pre-production',
      verificationCommands: [],
    });
    const session = new DeliverySessionWorkflow(repository, contractsRoot);

    const started = await session.beginDelivery({
      title: 'Add greeting',
      goal: 'Add a greeting file.',
      provides: ['A readable greeting'],
      consumes: [],
      completionCriteria: ['The repository contains the greeting.'],
      notInScope: [],
      designHorizon: ['Keep the change useful for later text output.'],
    });
    expect(started.state).toBe('Working');

    const decomposition = await session.nextAction();
    expect(decomposition).toMatchObject({
      state: 'Working',
      assignment: {
        role: 'decomposition',
        call: 'decomposition-pending-node',
        resultSchema: expect.objectContaining({
          anyOf: expect.any(Array),
          $defs: expect.objectContaining({ child: expect.any(Object) }),
        }),
      },
    });
    const firstAssignment = requireAssignment(decomposition);
    expect(firstAssignment.resume).toBe(false);
    expect(firstAssignment.instructions.join('\n')).toContain(
      'Do not split one outcome into cases, individual controls, styling states, tests, or presentation fragments.',
    );
    expect(firstAssignment.instructions.join('\n')).toContain(
      'it is not a search for the smallest possible fragment.',
    );
    expect(firstAssignment.instructions.join('\n')).toContain(
      'One-attempt size is necessary but not sufficient.',
    );
    const restartedSession = new DeliverySessionWorkflow(
      repository,
      contractsRoot,
    );
    restartedSession.selectDelivery(
      restartedSession.listDeliveries()[0].deliveryId,
    );
    const resumed = await restartedSession.nextAction();
    expect(requireAssignment(resumed)).toMatchObject({
      actionId: firstAssignment.actionId,
      resume: true,
    });
    const decomposer = new DeliveryRoleWorkflow(
      firstAssignment.workingDirectory,
      contractsRoot,
    );
    expect(() => decomposer.pullAssignment(firstAssignment.deliveryId)).toThrow(
      `The supplied value is the delivery ID. Retry with the complete current node ID: ${firstAssignment.subjectNodeId}`,
    );
    expect(
      decomposer.pullAssignment(firstAssignment.subjectNodeId),
    ).toMatchObject({ actionId: firstAssignment.actionId });
    await decomposer.submitResult(firstAssignment.subjectNodeId, {
      status: 'leaf',
    });

    const implementation = await session.nextAction();
    const implementationAssignment = requireAssignment(implementation);
    expect(implementationAssignment).toMatchObject({
      role: 'implementation',
      call: 'implementation-initial',
      workspaceAccess: 'read-write',
      resume: false,
    });
    writeFile(
      implementationAssignment.workingDirectory,
      'greeting.tsx',
      'export const greeting = "Hello";\n',
    );
    const implementer = new DeliveryRoleWorkflow(
      implementationAssignment.workingDirectory,
      contractsRoot,
    );
    await implementer.submitResult(implementationAssignment.subjectNodeId, {
      status: 'completed',
      manualTests: [],
    });
    const review = await session.nextAction();
    const reviewAssignment = requireAssignment(review);
    expect(reviewAssignment).toMatchObject({
      role: 'leaf-review',
      call: 'leaf-review-completed-leaf',
      workspaceAccess: 'read-only',
      input: {
        source: {
          changedPaths: ['greeting.tsx'],
          patch: expect.stringContaining('+export const greeting'),
        },
      },
    });
    const reviewer = new DeliveryRoleWorkflow(
      reviewAssignment.workingDirectory,
      contractsRoot,
    );
    await reviewer.submitResult(reviewAssignment.subjectNodeId, {
      status: 'accepted',
    });

    await expect(session.nextAction()).resolves.toMatchObject({
      state: 'Complete',
      message: 'The delivery is ready for handoff.',
    });
    const verification = inspectDelivery(
      repository,
      session.listDeliveries()[0].deliveryId,
    ).actions.find((action) => action.kind === 'verification');
    expect(verification?.result).toMatchObject({
      status: 'passed',
      commands: [],
      commit: expect.any(String),
    });
    expect(
      git(implementationAssignment.workingDirectory, 'status', '--porcelain'),
    ).toBe('');
  });

  it('refuses to choose between deliveries from the primary checkout', async () => {
    const repository = createRepository();
    initializeRepositorySession(repository, {
      lifecycle: 'pre-production',
      verificationCommands: [],
    });
    const creatingSession = new DeliverySessionWorkflow(
      repository,
      contractsRoot,
    );
    await creatingSession.beginDelivery(intent('First delivery'));
    await creatingSession.beginDelivery(intent('Second delivery'));
    const deliveries = creatingSession.listDeliveries();
    const assignments = [];
    for (const delivery of deliveries) {
      creatingSession.selectDelivery(delivery.deliveryId);
      assignments.push(requireAssignment(await creatingSession.nextAction()));
    }

    const role = new DeliveryRoleWorkflow(repository, contractsRoot);
    expect(
      assignments.map((assignment) =>
        role.pullAssignment(assignment.subjectNodeId),
      ),
    ).toMatchObject([
      { deliveryId: deliveries[0].deliveryId },
      { deliveryId: deliveries[1].deliveryId },
    ]);
    expect(assignments[0].subjectNodeId).not.toBe(assignments[1].subjectNodeId);
    for (const assignment of assignments) {
      await role.submitResult(assignment.subjectNodeId, {
        status: 'children',
        children: [child('contract', 0), child('behavior', 1)],
        dependencies: [{ nodeId: 'behavior', dependencyNodeId: 'contract' }],
      });
    }
    const nodeIds = creatingSession
      .listDeliveries()
      .flatMap((delivery) => delivery.graph.nodes.map((node) => node.nodeId));
    expect(new Set(nodeIds).size).toBe(nodeIds.length);

    const restartedSession = new DeliverySessionWorkflow(
      repository,
      contractsRoot,
    );
    expect(() => restartedSession.state()).toThrow(
      'Select an active delivery before changing delivery state',
    );
    expect(restartedSession.listDeliveries()).toHaveLength(2);
  });

  it('requires explicit selection when a new primary-checkout session resumes one delivery', async () => {
    const repository = createRepository();
    initializeRepositorySession(repository, {
      lifecycle: 'pre-production',
      verificationCommands: [],
    });
    const creatingSession = new DeliverySessionWorkflow(
      repository,
      contractsRoot,
    );
    await creatingSession.beginDelivery(intent('Interrupted delivery'));
    const [delivery] = creatingSession.listDeliveries();

    const restartedSession = new DeliverySessionWorkflow(
      repository,
      contractsRoot,
    );
    expect(() => restartedSession.state()).toThrow(
      'Select an active delivery before changing delivery state',
    );
    expect(restartedSession.selectDelivery(delivery.deliveryId)).toMatchObject({
      state: 'Working',
    });
  });

  it('inspects persisted workflow and Git evidence without changing state', async () => {
    const repository = createRepository();
    initializeRepositorySession(repository, {
      lifecycle: 'pre-production',
      verificationCommands: [],
    });
    const session = new DeliverySessionWorkflow(repository, contractsRoot);
    await session.beginDelivery(intent('Inspect delivery'));
    const [delivery] = session.listDeliveries();
    const assignment = requireAssignment(await session.nextAction());
    const revisionBeforeInspection = session.listDeliveries()[0].revision;

    const report = inspectDelivery(repository, delivery.deliveryId);
    expect(report).toMatchObject({
      repository: {
        rootDirectory: repository,
        configuration: { lifecycle: 'pre-production' },
      },
      delivery: { deliveryId: delivery.deliveryId },
      nextAction: {
        status: 'available',
        action: {
          kind: 'continue-action',
          action: { actionId: assignment.actionId },
        },
      },
      git: {
        status: 'available',
        branch: delivery.branchName,
        changedPaths: [],
      },
      actions: [{ actionId: assignment.actionId, status: 'pending' }],
      processes: [],
      externalEffects: [],
    });
    expect(inspectDelivery(delivery.worktreePath)).toMatchObject({
      repository: { databasePath: report.repository.databasePath },
      delivery: { deliveryId: delivery.deliveryId },
      actions: [{ actionId: assignment.actionId }],
    });
    expect(session.listDeliveries()[0].revision).toBe(revisionBeforeInspection);
  });

  function createRepository(manifest?: Record<string, unknown>): string {
    const directory = mkdtempSync(join(tmpdir(), 'big-plan-session-'));
    directories.push(directory);
    const repository = join(directory, 'repository');
    git(directory, 'init', '-q', '--initial-branch=main', repository);
    git(repository, 'config', 'user.name', 'Big Plan Test');
    git(repository, 'config', 'user.email', 'test@example.test');
    writeFile(repository, 'README.md', '# Test\n');
    if (manifest !== undefined) {
      writeFile(repository, 'package.json', `${JSON.stringify(manifest)}\n`);
    }
    git(repository, 'add', '.');
    git(repository, 'commit', '-qm', 'Initial commit');
    return repository;
  }
});
