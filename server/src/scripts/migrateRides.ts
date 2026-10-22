import type { mongo } from 'mongoose';

export interface MigrationResult {
  /** Rides found in the source database. */
  found: number;
  /** Rides newly written to the pools database. */
  inserted: number;
  /** Rides that already existed there (nothing is duplicated). */
  alreadyThere: number;
}

const point = (c?: { lat?: number; lng?: number }) =>
  c && typeof c.lat === 'number' && typeof c.lng === 'number'
    ? { type: 'Point', coordinates: [c.lng, c.lat] }
    : undefined;

// Copies rides from the old location (the `rides` collection of the main database) into the pools
// database, keeping each ride's _id and adding the geo points the search indexes need.
// Safe to run repeatedly, and it never modifies or deletes anything in the source.
export async function migrateRidesToPoolsDb(source: mongo.Db, target: mongo.Db): Promise<MigrationResult> {
  const result: MigrationResult = { found: 0, inserted: 0, alreadyThere: 0 };
  const rides = target.collection('rides');

  let batch: mongo.AnyBulkWriteOperation[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const res = await rides.bulkWrite(batch, { ordered: false });
    result.inserted += res.upsertedCount;
    result.alreadyThere += res.matchedCount;
    batch = [];
  };

  for await (const doc of source.collection('rides').find()) {
    result.found += 1;
    const originPoint = point(doc.origin?.coordinates);
    const destinationPoint = point(doc.destination?.coordinates);
    batch.push({
      replaceOne: {
        filter: { _id: doc._id },
        replacement: {
          ...doc,
          ...(originPoint ? { originPoint } : {}),
          ...(destinationPoint ? { destinationPoint } : {}),
        },
        upsert: true,
      },
    });
    if (batch.length >= 500) await flush();
  }
  await flush();
  return result;
}
