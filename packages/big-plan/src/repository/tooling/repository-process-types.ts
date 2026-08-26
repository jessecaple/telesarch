import type { Readable, Writable } from 'node:stream';

export type RepositoryProcessPurpose =
  | 'repository-command'
  | 'verification'
  | 'scenario';

export interface RepositoryProcessIdentity {
  readonly processId: string;
  readonly systemProcessId: number;
  readonly purpose: RepositoryProcessPurpose;
  readonly checkoutPath: string;
  readonly workingDirectory: string;
  readonly deliveryId?: string;
  readonly createdAtMs: number;
}

export interface RepositoryProcessCommand {
  readonly purpose: RepositoryProcessPurpose;
  readonly workingDirectory: string;
  readonly command: readonly string[];
  readonly deliveryId?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly input?: Readable;
  readonly output?: Writable;
  readonly errorOutput?: Writable;
  readonly started?: (
    identity: RepositoryProcessIdentity,
  ) => void | Promise<void>;
}

export interface RepositoryProcessResult {
  readonly identity: RepositoryProcessIdentity;
  readonly exitCode: number;
  readonly signal?: NodeJS.Signals;
}

export interface RunningRepositoryProcess {
  readonly identity: RepositoryProcessIdentity;
  readonly completion: Promise<RepositoryProcessResult>;
  stop(): Promise<void>;
}
