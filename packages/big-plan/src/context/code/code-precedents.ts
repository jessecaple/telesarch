import {
  readSourceFile,
  searchDeclarations,
  type SourceIndexDatabase,
} from '#source-index';

export interface CodePrecedent {
  /** Always a candidate to inspect, never an owner or a recommendation. */
  readonly candidate: true;
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly line: number;
  /** The indexed evidence that caused this candidate's selection. */
  readonly selectionEvidence: readonly string[];
}

export interface CodePrecedentResult {
  readonly precedents: readonly CodePrecedent[];
  readonly returned: number;
  readonly hasMore: boolean;
}

/**
 * Ranked existing implementations that may demonstrate an applicable
 * repository-owned pattern. Selection is explained per candidate; similarity
 * never implies ownership, applicability, or a recommendation.
 */
export function findCodePrecedents(
  session: SourceIndexDatabase,
  input: {
    readonly query: string;
    readonly category?: string;
    readonly limit?: number;
  },
): CodePrecedentResult {
  const limit = input.limit ?? 10;
  const matches = searchDeclarations(session, input.query, {
    limit: Math.min(limit * 3, 100),
  });
  const precedents: CodePrecedent[] = [];
  for (const declaration of matches.items) {
    const file = readSourceFile(session, declaration.path)?.file;
    if (input.category !== undefined && file?.category !== input.category) {
      continue;
    }
    precedents.push({
      candidate: true,
      path: declaration.path,
      name: declaration.name,
      kind: declaration.kind,
      line: declaration.line,
      selectionEvidence: [
        `declaration name matches "${input.query}"`,
        ...(declaration.exported ? ['exported declaration'] : []),
        ...(file?.category === undefined
          ? []
          : [`indexed category: ${file.category}`]),
      ],
    });
    if (precedents.length > limit) break;
  }
  const hasMore = precedents.length > limit || matches.hasMore;
  return {
    precedents: precedents.slice(0, limit),
    returned: Math.min(precedents.length, limit),
    hasMore,
  };
}
