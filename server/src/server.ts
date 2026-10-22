import dns from 'dns';
import http from 'http';
import { loadEnv } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { createApp } from './app.js';
import { createSmsProvider } from './services/sms/index.js';
import { CachedMapsProvider } from './services/maps/cachedMapsProvider.js';
import { OpenStreetMapProvider } from './services/maps/openStreetMapProvider.js';
import { UnimplementedMatcher } from './services/pools/matching.js';
import { createSocketServer } from './sockets/index.js';
import { logger } from './utils/logger.js';

async function main() {
  const env = loadEnv();
  if (env.DNS_SERVERS) {
    dns.setServers(env.DNS_SERVERS.split(',').map((s) => s.trim()));
  }
  await connectDb(env.MONGODB_URI);

  const maps = new CachedMapsProvider(
    new OpenStreetMapProvider({ photonUrl: env.PHOTON_URL, osrmUrl: env.OSRM_URL, userAgent: env.MAPS_USER_AGENT }),
  );
  const app = createApp(env, { sms: createSmsProvider(env), maps, matcher: new UnimplementedMatcher() });
  const server = http.createServer(app);
  createSocketServer(server, env);

  server.listen(env.PORT, () => logger.info(`Pool-In API listening on port ${env.PORT}`));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
