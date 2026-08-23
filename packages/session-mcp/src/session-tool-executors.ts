import {
  DeliveryGraphProjections,
  DeliverySessionWorkflow,
  DeliverySourceProjections,
  configureRepositorySession,
  initializeRepositorySession,
  inspectRepositorySetup,
  projectDeliverySource,
  type DeliverySourceParameters,
  type DeliverySourceView,
} from '@telesarch/engine';
import {
  openRepositoryAuthority,
  readDelivery,
  type RepositoryAuthorityConfigurationInput,
} from '@telesarch/repository-authority';

export interface BeginDeliveryInput {
  readonly title: string;
  readonly goal: string;
  readonly provides: readonly string[];
  readonly consumes: readonly string[];
  readonly completionCriteria: readonly string[];
  readonly notInScope: readonly string[];
  readonly designHorizon: readonly string[];
}

export class RepositorySessionExecutors {
  readonly workflow: DeliverySessionWorkflow;
  private source?: {
    readonly deliveryId: string;
    readonly projections: DeliverySourceProjections;
  };

  constructor(
    readonly workingDirectory: string,
    contractsRoot: string,
  ) {
    this.workflow = new DeliverySessionWorkflow(
      workingDirectory,
      contractsRoot,
    );
  }

  repositoryStatus() {
    return inspectRepositorySetup(this.workingDirectory);
  }

  initializeRepository(
    configuration: Omit<RepositoryAuthorityConfigurationInput, 'occurredAtMs'>,
  ) {
    return initializeRepositorySession(this.workingDirectory, configuration);
  }

  configureRepository(
    configuration: Omit<RepositoryAuthorityConfigurationInput, 'occurredAtMs'>,
  ) {
    return configureRepositorySession(this.workingDirectory, configuration);
  }

  withProjections<T>(
    operation: (projections: DeliveryGraphProjections, deliveryId: string) => T,
  ): T {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const overview = this.workflow.context();
      return operation(
        new DeliveryGraphProjections(authority.database),
        overview.deliveryId,
      );
    } finally {
      authority.database.close();
    }
  }

  sourceContext(view: DeliverySourceView, params: DeliverySourceParameters) {
    const authority = openRepositoryAuthority(this.workingDirectory);
    try {
      const deliveryId = this.workflow.context().deliveryId;
      const delivery = readDelivery(authority.database, deliveryId);
      if (delivery === undefined) throw new Error('The delivery is missing.');
      if (this.source?.deliveryId !== deliveryId) {
        this.source?.projections.close();
        this.source = {
          deliveryId,
          projections: new DeliverySourceProjections(
            delivery.worktreePath,
            'refresh-on-change',
          ),
        };
      }
      return projectDeliverySource(this.source.projections, view, params);
    } finally {
      authority.database.close();
    }
  }
}
