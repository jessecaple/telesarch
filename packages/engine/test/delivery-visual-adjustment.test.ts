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
} from '../src/index.js';
import {
  git,
  intent,
  requireAssignment,
  writeFile,
} from './delivery-session-test-support.js';

const contractsRoot = fileURLToPath(
  new URL('../../agent-contracts', import.meta.url),
);

describe('delivery visual adjustment', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps one review open across adjustments and verifies once on approval', async () => {
    const repository = createRepository();
    initializeRepositorySession(repository, {
      lifecycle: 'pre-production',
      developmentMode: 'react-storybook',
      verificationCommands: [],
    });
    const session = new DeliverySessionWorkflow(repository, contractsRoot);
    await session.beginDelivery(intent('Adjust interface'));

    const decomposition = requireAssignment(await session.nextAction());
    await role(decomposition).submitResult(decomposition.subjectNodeId, {
      status: 'leaf',
    });
    const implementation = requireAssignment(await session.nextAction());
    writeFile(
      implementation.workingDirectory,
      'interface.tsx',
      'export const label = "First";\n',
    );
    await role(implementation).submitResult(implementation.subjectNodeId, {
      status: 'completed',
      manualTests: [],
    });
    const composition = requireAssignment(await session.nextAction());
    writeFile(
      composition.workingDirectory,
      'interface.stories.tsx',
      'export const story = "First";\n',
    );
    await role(composition).submitResult(composition.subjectNodeId, {
      status: 'completed',
    });
    const leafReview = requireAssignment(await session.nextAction());
    await role(leafReview).submitResult(leafReview.subjectNodeId, {
      status: 'accepted',
    });

    const waiting = await session.nextAction();
    expect(waiting).toMatchObject({
      state: 'Needs your input',
      action: { kind: 'visual-review', status: 'waiting' },
    });
    const visualReviewActionId = waiting.action?.actionId as string;

    session.requestVisualAdjustment('Use the shorter label.');
    const first = requireAssignment(await session.nextAction());
    expect(first).toMatchObject({
      role: 'visual-adjustment',
      call: 'visual-adjustment-requested-change',
      resume: false,
      input: { unresolved: { feedback: 'Use the shorter label.' } },
    });
    writeFile(
      first.workingDirectory,
      'interface.tsx',
      'export const label = "Short";\n',
    );
    await role(first).submitResult(first.subjectNodeId, {
      status: 'preview-ready',
    });
    await expect(session.nextAction()).resolves.toMatchObject({
      state: 'Needs your input',
      action: { actionId: visualReviewActionId },
    });

    const restarted = new DeliverySessionWorkflow(repository, contractsRoot);
    restarted.selectDelivery(restarted.listDeliveries()[0].deliveryId);
    restarted.requestVisualAdjustment('Use sentence case.');
    const second = requireAssignment(await restarted.nextAction());
    expect(second).toMatchObject({
      role: 'visual-adjustment',
      responsibilityKey: first.responsibilityKey,
      resume: true,
    });
    writeFile(
      second.workingDirectory,
      'interface.stories.tsx',
      'export const story = "Short";\n',
    );
    await role(second).submitResult(second.subjectNodeId, {
      status: 'preview-ready',
    });
    await restarted.nextAction();
    restarted.approveVisualReview();

    const adjustmentReview = requireAssignment(await restarted.nextAction());
    expect(adjustmentReview).toMatchObject({
      role: 'integration-review',
      call: 'integration-review-visual-adjustment',
    });
    await role(adjustmentReview).submitResult(adjustmentReview.subjectNodeId, {
      status: 'accepted',
    });
    await expect(restarted.nextAction()).resolves.toMatchObject({
      state: 'Complete',
    });

    const report = inspectDelivery(
      repository,
      restarted.listDeliveries()[0].deliveryId,
    );
    const adjustments = report.actions.filter(
      (action) => action.kind === 'visual-adjustment',
    );
    expect(adjustments).toHaveLength(2);
    expect(adjustments[0].result).toMatchObject({
      status: 'preview-ready',
      commit: expect.any(String),
      changedPaths: ['interface.tsx'],
    });
    expect(
      report.actions.filter(
        (action) =>
          action.kind === 'verification' &&
          object(action.input).visualReviewActionId === visualReviewActionId,
      ),
    ).toHaveLength(1);
    expect(
      report.actions.filter(
        (action) => action.kind === 'visual-adjustment-review',
      ),
    ).toHaveLength(1);
  });

  function role(assignment: ReturnType<typeof requireAssignment>) {
    return new DeliveryRoleWorkflow(assignment.workingDirectory, contractsRoot);
  }

  function createRepository(): string {
    const directory = mkdtempSync(join(tmpdir(), 'telesarch-visual-'));
    directories.push(directory);
    const repository = join(directory, 'repository');
    git(directory, 'init', '-q', '--initial-branch=main', repository);
    git(repository, 'config', 'user.name', 'Telesarch Test');
    git(repository, 'config', 'user.email', 'test@example.test');
    writeFile(repository, 'README.md', '# Test\n');
    git(repository, 'add', '.');
    git(repository, 'commit', '-qm', 'Initial commit');
    return repository;
  }
});

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
