import { runGitSyncRaw } from './git-command.js';

export interface TrackedFile {
  /** Repository-relative path using forward slashes. */
  readonly path: string;
  /** The staged blob object id recorded by Git for this path. */
  readonly blobId: string;
  readonly mode: string;
}

/** Lists every tracked file in the checkout with its staged blob evidence. */
export function listTrackedFiles(
  workingDirectory: string,
): readonly TrackedFile[] {
  const output = runGitSyncRaw(workingDirectory, ['ls-files', '-z', '-s']);
  if (!output) return [];
  return output
    .split('\0')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const tab = entry.indexOf('\t');
      const [mode, blobId] = entry.slice(0, tab).split(' ');
      return {
        path: entry.slice(tab + 1),
        blobId: blobId ?? '',
        mode: mode ?? '',
      };
    });
}
