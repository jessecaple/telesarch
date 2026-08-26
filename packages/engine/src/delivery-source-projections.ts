import {
  findCodePrecedents,
  readArtifactConventions,
  readChangeImpact,
  readEntityContext,
  readModulePaths,
  readRepositoryOrientation,
  readVerificationContext,
} from '@big-plan/code-context';
import {
  openSourceIndexDatabase,
  readSourceIndexEvidence,
  refreshSourceIndex,
  requireCurrentSourceIndex,
  SourceIndexStaleError,
  type SourceFileCategory,
  type SourceIndexDatabase,
} from '@big-plan/source-index';

export type DeliverySourceSnapshot = 'refresh-on-change' | 'pinned';
export type DeliverySourceView =
  | 'orientation'
  | 'entity'
  | 'impact'
  | 'path'
  | 'verification'
  | 'conventions'
  | 'precedents';

export interface DeliverySourceParameters {
  readonly path?: string;
  readonly paths?: readonly string[];
  readonly symbol?: string;
  readonly fromPath?: string;
  readonly toPath?: string;
  readonly category?: string;
  readonly query?: string;
  readonly limit?: number;
  readonly packageLimit?: number;
}

/** Bounded, evidence-backed source context for one delivery checkout. */
export class DeliverySourceProjections {
  private index: SourceIndexDatabase | undefined;
  private pinned = false;

  constructor(
    private readonly workingDirectory: string,
    private readonly snapshot: DeliverySourceSnapshot,
  ) {}

  orientation(packageLimit?: number) {
    return this.use((index) =>
      readRepositoryOrientation(index, {
        ...(packageLimit === undefined ? {} : { packageLimit }),
      }),
    );
  }

  entity(input: {
    readonly path: string;
    readonly symbol?: string;
    readonly limit?: number;
  }) {
    return this.use(
      (index) =>
        readEntityContext(index, input) ?? { indexed: false, path: input.path },
    );
  }

  impact(input: {
    readonly paths: readonly string[];
    readonly limit?: number;
  }) {
    return this.use((index) => readChangeImpact(index, input));
  }

  modulePaths(input: {
    readonly fromPath: string;
    readonly toPath: string;
    readonly limit?: number;
  }) {
    return this.use((index) => readModulePaths(index, input));
  }

  verification(input: {
    readonly paths: readonly string[];
    readonly limit?: number;
  }) {
    return this.use((index) => readVerificationContext(index, input));
  }

  conventions(category: SourceFileCategory) {
    return this.use((index) => readArtifactConventions(index, category));
  }

  precedents(input: {
    readonly query: string;
    readonly category?: string;
    readonly limit?: number;
  }) {
    return this.use((index) => ({
      evidence: readSourceIndexEvidence(index),
      ...findCodePrecedents(index, input),
    }));
  }

  close(): void {
    this.index?.close();
    this.index = undefined;
    this.pinned = false;
  }

  private use<T>(operation: (index: SourceIndexDatabase) => T): T {
    const index = (this.index ??= openSourceIndexDatabase(
      this.workingDirectory,
    ));
    if (this.snapshot === 'pinned') {
      if (!this.pinned) {
        refreshSourceIndex(index, this.workingDirectory);
        this.pinned = true;
      } else {
        requireCurrentSourceIndex(index, this.workingDirectory);
      }
      return operation(index);
    }
    try {
      requireCurrentSourceIndex(index, this.workingDirectory);
    } catch (error) {
      if (!(error instanceof SourceIndexStaleError)) throw error;
      refreshSourceIndex(index, this.workingDirectory);
    }
    return operation(index);
  }
}

export function projectDeliverySource(
  projections: DeliverySourceProjections,
  view: DeliverySourceView,
  params: DeliverySourceParameters,
): unknown {
  switch (view) {
    case 'orientation':
      return projections.orientation(params.packageLimit);
    case 'entity':
      return projections.entity({
        path: required(params.path, 'path'),
        ...(params.symbol === undefined ? {} : { symbol: params.symbol }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
      });
    case 'impact':
      return projections.impact({
        paths: requiredPaths(params),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
      });
    case 'path':
      return projections.modulePaths({
        fromPath: required(params.fromPath, 'fromPath'),
        toPath: required(params.toPath, 'toPath'),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
      });
    case 'verification':
      return projections.verification({
        paths: requiredPaths(params),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
      });
    case 'conventions':
      return projections.conventions(
        required(params.category, 'category') as SourceFileCategory,
      );
    case 'precedents':
      return projections.precedents({
        query: required(params.query, 'query'),
        ...(params.category === undefined ? {} : { category: params.category }),
        ...(params.limit === undefined ? {} : { limit: params.limit }),
      });
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required.`);
  return value;
}

function requiredPaths(params: DeliverySourceParameters): readonly string[] {
  const paths =
    params.paths ?? (params.path === undefined ? [] : [params.path]);
  if (paths.length === 0) throw new Error('paths is required.');
  return paths;
}
