export interface CliProcessInvocation {
  readonly executablePath: string;
  readonly executableArguments: readonly string[];
  readonly entryPath?: string;
}

/** The exact standalone CLI invocation that remains valid without PATH. */
export function currentCliLaunchCommand(
  invocation: CliProcessInvocation = {
    executablePath: process.execPath,
    executableArguments: process.execArgv,
    entryPath: process.argv[1],
  },
): readonly [string, ...string[]] {
  if (invocation.executablePath.trim() === '') {
    throw new Error('The CLI runtime path is unavailable.');
  }
  if (
    invocation.entryPath === undefined ||
    invocation.entryPath.trim() === ''
  ) {
    throw new Error('The standalone CLI entry point is unavailable.');
  }
  return [
    invocation.executablePath,
    ...invocation.executableArguments,
    invocation.entryPath,
  ];
}
