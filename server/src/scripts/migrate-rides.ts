// One-off: copy pools created before the separate pools database existed.
// Usage (from server/):  npm run migrate:rides
// Safe to re-run. It only reads the old collection and never deletes it; remove that collection yourself
// once you have checked the pools database.
import dns from 'dns';
import mongoose from 'mongoose';
import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../config/db.js';
import { poolsDb } from '../models/poolsDb.js';
import { migrateRidesToPoolsDb } from './migrateRides.js';

async function main() {
  const env = loadEnv();
  if (env.DNS_SERVERS) dns.setServers(env.DNS_SERVERS.split(',').map((s) => s.trim()));
  await connectDb(env.MONGODB_URI);

  const source = mongoose.connection.db!;
  const target = poolsDb.db!;
  console.log(`Copying rides from "${mongoose.connection.name}" to "${poolsDb.name}"...`);

  const res = await migrateRidesToPoolsDb(source, target);
  console.log(`Found ${res.found} ride(s): ${res.inserted} copied, ${res.alreadyThere} already in the pools database.`);
  if (res.found > 0) {
    console.log(`The originals were left untouched in "${mongoose.connection.name}.rides". Delete that collection once you have checked.`);
  }
  await disconnectDb();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
