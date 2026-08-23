import {
  DeliveryGraphProjections,
  DeliveryRoleWorkflow,
  DeliverySourceProjections,
  projectDeliverySource,
  type DeliverySourceParameters,
  type DeliverySourceView,
} from '@telesarch/engine';
import {
  openRepositoryAuthority,
  type DeliveryGraph,
} from '@telesarch/repository-authority';

export class RepositoryRoleExecutors {
  private readonly workflow: DeliveryRoleWorkflow;
  private source?: {
    readonly deliveryId: string;
    readonly projections: DeliverySourceProjections;
  };

  constructor(
    readonly workingDirectory: string,
    contractsRoot: string,
  ) {
    this.workflow = new DeliveryRoleWorkflow(workingDirectory, contractsRoot);
  }

  pullAssignment(nodeId: string) {
    const assignment = this.workflow.pullAssignment(nodeId);
    this.source?.projections.close();
    this.source = {
      deliveryId: assignment.deliveryId,
      projections: new DeliverySourceProjections(
        assignment.workingDirectory,
        assignment.role === 'leaf-review' ||
        assignment.role === 'integration-review'
          ? 'pinned'
          : 'refresh-on-change',
      ),
    };
    return assignment;
  }

  submitResult(nodeId: string, result: unknown) {
    return this.workflow.submitResult(nodeId, result);
  }

  withProjections<T>(
    deliveryId: string,
    operation: (projections: DeliveryGraphProjections) => T,
  ): T {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      return operation(new DeliveryGraphProjections(authority.database));
    } finally {
      authority.database.close();
    }
  }

  sourceContext(
    deliveryId: string,
    view: DeliverySourceView,
    params: DeliverySourceParameters,
  ) {
    if (this.source?.deliveryId !== deliveryId) {
      throw new Error(
        'Pull the current assignment before reading source context.',
      );
    }
    return projectDeliverySource(this.source.projections, view, params);
  }

  revisionImpact(
    deliveryId: string,
    graph: unknown,
    page: { readonly offset?: number; readonly limit?: number },
  ) {
    return this.withProjections(deliveryId, (projections) =>
      projections.revisionImpact(deliveryId, graph as DeliveryGraph, page),
    );
  }
}
