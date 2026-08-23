export class SqliteApplicationMismatchError extends Error {
  readonly code = 'sqlite-application-mismatch';

  constructor(applicationId: number) {
    super(`The SQLite file belongs to application ${applicationId}.`);
    this.name = 'SqliteApplicationMismatchError';
  }
}

export class SqliteUnrecognizedDatabaseError extends Error {
  readonly code = 'sqlite-database-unrecognized';

  constructor() {
    super('The SQLite file is not an empty or recognized Telesarch database.');
    this.name = 'SqliteUnrecognizedDatabaseError';
  }
}

export class SqliteMigrationHistoryError extends Error {
  readonly code = 'sqlite-migration-history-invalid';

  constructor(message: string) {
    super(message);
    this.name = 'SqliteMigrationHistoryError';
  }
}

export class SqliteNewerSchemaError extends Error {
  readonly code = 'sqlite-schema-newer';

  constructor(schemaVersion: number, supportedVersion: number) {
    super(
      `The database schema version ${schemaVersion} is newer than supported version ${supportedVersion}.`,
    );
    this.name = 'SqliteNewerSchemaError';
  }
}

export class SqliteDatabaseClosedError extends Error {
  readonly code = 'sqlite-database-closed';

  constructor() {
    super('The SQLite database is closed.');
    this.name = 'SqliteDatabaseClosedError';
  }
}

export class SqliteDatabaseInUseError extends Error {
  readonly code = 'sqlite-database-in-use';

  constructor() {
    super('The SQLite database cannot close during an active operation.');
    this.name = 'SqliteDatabaseInUseError';
  }
}
