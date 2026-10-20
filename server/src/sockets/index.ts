import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import type { Env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Socket.IO bootstrap. Authentication middleware and Pool Room membership checks are added
// in the Pool Room phase; until then no room or data events are handled.
export function createSocketServer(http: HttpServer, env: Pick<Env, 'CLIENT_ORIGIN'>): Server {
  const io = new Server(http, {
    cors: { origin: env.CLIENT_ORIGIN.split(',').map((o) => o.trim()), credentials: true },
  });

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id }, 'socket connected');
  });

  return io;
}
