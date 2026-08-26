import {
  listSourceFiles,
  type SourceFileCategory,
  type SourceIndexDatabase,
} from '@big-plan/source-index';

export interface MeasuredPattern {
  readonly pattern: string;
  readonly files: number;
  readonly examplePaths: readonly string[];
}

export interface ArtifactConventions {
  readonly category: SourceFileCategory;
  readonly files: number;
  /** How widely each observed naming pattern holds, largest first. */
  readonly namePatterns: readonly MeasuredPattern[];
  /** How widely each observed placement holds, largest first. */
  readonly placements: readonly MeasuredPattern[];
  /**
   * Paths that do not follow the dominant name and placement patterns. A
   * measured convention describes the repository; it never becomes a
   * requirement without an owning contract or standard.
   */
  readonly exceptions: readonly string[];
  /** True when the survey stopped at its bound before seeing every file. */
  readonly surveyTruncated: boolean;
}

const surveyLimit = 5000;

/**
 * Measures how one kind of artifact is named and placed across the
 * repository, with counts, examples, and exceptions established solely by
 * indexed evidence.
 */
export function readArtifactConventions(
  session: SourceIndexDatabase,
  category: SourceFileCategory,
): ArtifactConventions {
  const paths: string[] = [];
  let afterPath: string | undefined;
  let surveyTruncated = false;
  for (;;) {
    const page = listSourceFiles(session, {
      category,
      limit: 500,
      ...(afterPath === undefined ? {} : { afterPath }),
    });
    paths.push(...page.items.map((file) => file.path));
    if (!page.hasMore) break;
    if (paths.length >= surveyLimit) {
      surveyTruncated = true;
      break;
    }
    afterPath = page.items[page.items.length - 1]?.path;
  }
  const namePatterns = measure(paths, namePattern);
  const placements = measure(paths, placement);
  const dominantName = namePatterns[0]?.pattern;
  const dominantPlacement = placements[0]?.pattern;
  const exceptions = paths
    .filter(
      (path) =>
        namePattern(path) !== dominantName ||
        placement(path) !== dominantPlacement,
    )
    .slice(0, 20);
  return {
    category,
    files: paths.length,
    namePatterns,
    placements,
    exceptions,
    surveyTruncated,
  };
}

function measure(
  paths: readonly string[],
  patternOf: (path: string) => string,
): readonly MeasuredPattern[] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const pattern = patternOf(path);
    const group = groups.get(pattern);
    if (group === undefined) groups.set(pattern, [path]);
    else group.push(path);
  }
  return [...groups.entries()]
    .map(([pattern, group]) => ({
      pattern,
      files: group.length,
      examplePaths: group.slice(0, 3),
    }))
    .sort((left, right) => right.files - left.files);
}

function namePattern(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const match = /((\.[a-z]+)+)$/.exec(name);
  return match?.[1] === undefined ? 'other' : `*${match[1]}`;
}

function placement(path: string): string {
  const segments = path.split('/');
  if (
    segments.some((segment) =>
      ['test', 'tests', '__tests__', 'migrations'].includes(segment),
    )
  ) {
    return 'dedicated-directory';
  }
  return 'co-located';
}
