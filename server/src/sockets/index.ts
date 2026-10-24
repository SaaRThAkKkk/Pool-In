import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import type { Env } from '../config/env.js';
import { User } from '../models/User.js';
import type { SearchNotifier } from '../services/realtime/notifier.js';
import { AUTH_COOKIE } from '../utils/token.js';
import { logger } from '../utils/logger.js';

const userRoom = (userId: string) => `user:${userId}`;

// Reads one cookie out of the raw Cookie header the browser sent with the socket handshake.
function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export class SocketNotifier implements SearchNotifier {
  constructor(private readonly io: Server) {}

  notifyUser(userId: string, event: string, payload: unknown): void {
    this.io.to(userRoom(userId)).emit(event, payload);
  }
}

// Socket.IO with the same login as the REST API: the browser's HttpOnly session cookie is verified when the
// socket connects, and the socket is put in a private room named after the user. Clients cannot join rooms
// themselves, so nobody can listen to anyone else's updates.
export function createSocketServer(
  http: HttpServer,
  env: Pick<Env, 'CLIENT_ORIGIN' | 'JWT_SECRET'>,
): { io: Server; notifier: SocketNotifier } {
  const io = new Server(http, {
    cors: { origin: env.CLIENT_ORIGIN.split(',').map((o) => o.trim()), credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, AUTH_COOKIE);
      if (!token) return next(new Error('UNAUTHORIZED'));

      const payload = jwt.verify(token, env.JWT_SECRET);
      if (typeof payload === 'string' || typeof payload.sub !== 'string') return next(new Error('UNAUTHORIZED'));

      const user = await User.findById(payload.sub).select('accountStatus');
      if (!user || user.accountStatus !== 'ACTIVE') return next(new Error('UNAUTHORIZED'));

      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    void socket.join(userRoom(socket.data.userId as string));
    logger.debug({ id: socket.id }, 'socket connected');
  });

  return { io, notifier: new SocketNotifier(io) };
}
