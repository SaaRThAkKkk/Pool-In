// Pools live in their own database on the same cluster, apart from users and OTPs, so ride search
// can be indexed, scaled and backed up independently of account data.
export const DEFAULT_POOLS_DB_NAME = 'pool-in-pools';

// Conservative subset of what MongoDB/Atlas accept in a database name.
export const DB_NAME_PATTERN = /^[A-Za-z0-9_-]{1,60}$/;

// MongoDB treats database names that differ only by case as the same database.
export function assertSeparateDatabases(mainName: string, poolsName: string): void {
  if (mainName.toLowerCase() === poolsName.toLowerCase()) {
    throw new Error(
      `POOLS_DB_NAME ("${poolsName}") must be a different database from the main one ("${mainName}"). ` +
        'Put a different database name in MONGODB_URI or set POOLS_DB_NAME.',
    );
  }
}
