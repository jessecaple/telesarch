import type {
  DeliveryActionRecord,
  DeliveryNodeContract,
  DeliveryNodeState,
} from '#repository-authority';

export interface BoundedDeliveryPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly truncated: boolean;
  readonly nextOffset?: number;
}

export interface DeliveryOverviewProjection {
  readonly deliveryId: string;
  readonly revision: number;
  readonly title: string;
  readonly status: 'active' | 'integration-ready';
  readonly designHorizon: readonly string[];
  readonly rootNodeId: string;
  readonly nodeCount: number;
  readonly stateCounts: Readonly<Record<DeliveryNodeState, number>>;
  readonly currentAction?: DeliveryActionRecord;
  readonly nodes: BoundedDeliveryPage<DeliveryNodeContract>;
}

export interface DeliveryNodeContextProjection {
  readonly deliveryId: string;
  readonly deliveryRevision: number;
  readonly designHorizon: readonly string[];
  readonly node: DeliveryNodeContract;
  readonly parent?: DeliveryNodeContract;
  readonly ancestors: BoundedDeliveryPage<DeliveryNodeContract>;
  readonly children: BoundedDeliveryPage<DeliveryNodeContract>;
  readonly dependencies: BoundedDeliveryPage<DeliveryNodeContract>;
  readonly dependents: BoundedDeliveryPage<DeliveryNodeContract>;
}

export interface DeliveryReadinessEntry {
  readonly node: DeliveryNodeContract;
  readonly eligible: boolean;
  readonly blockedBy: BoundedDeliveryPage<DeliveryNodeContract>;
}

export interface DeliveryDependencyChain {
  readonly nodeIds: BoundedDeliveryPage<string>;
  readonly complete: boolean;
}

export interface DeliveryDependencyProjection {
  readonly deliveryId: string;
  readonly nodeId: string;
  readonly chains: BoundedDeliveryPage<DeliveryDependencyChain>;
}

export type DeliveryRevisionImpactKind = 'added' | 'removed' | 'changed';

export interface DeliveryRevisionImpactEntry {
  readonly nodeId: string;
  readonly kind: DeliveryRevisionImpactKind;
  readonly affectedNodeIds: BoundedDeliveryPage<string>;
}

export interface DeliveryRevisionImpactProjection {
  readonly deliveryId: string;
  readonly baseRevision: number;
  readonly entries: BoundedDeliveryPage<DeliveryRevisionImpactEntry>;
}

export interface DeliverySearchResult {
  readonly node: DeliveryNodeContract;
  readonly matchedFields: readonly string[];
}
