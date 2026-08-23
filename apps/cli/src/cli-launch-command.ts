export interface CliProcessInvocation {
  readonly executablePath: string;
  readonly executableArguments: readonly string[];
  readonly entryPath?: string;
  readonly packageSpecifier?: string;
}

declare const TELESARCH_PACKAGE_VERSION: string | undefined;

/** The exact standalone CLI invocation that remains valid without PATH. */
export function currentCliLaunchCommand(
  invocation: CliProcessInvocation = {
    executablePath: process.execPath,
    executableArguments: process.execArgv,
    entryPath: process.argv[1],
    packageSpecifier:
      process.env.TELESARCH_PACKAGE_SPEC?.trim() ||
      (typeof TELESARCH_PACKAGE_VERSION === 'string'
        ? `telesarch@${TELESARCH_PACKAGE_VERSION}`
        : undefined),
  },
): readonly [string, ...string[]] {
  if (invocation.packageSpecifier !== undefined) {
    return [
      'npm',
      'exec',
      '--yes',
      `--package=${invocation.packageSpecifier}`,
      '--',
      'telesarch',
    ];
  }
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
