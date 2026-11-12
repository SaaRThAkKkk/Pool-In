import express, { Router, type RequestHandler } from 'express';
import { CHAT } from '../config/chat.js';
import { makeChatController } from '../controllers/chatController.js';
import { makeLimiter } from '../middleware/rateLimit.js';
import { validateBody, validateObjectIdParam, validateQuery } from '../middleware/validate.js';
import type { ChatDeps } from '../services/chat/chatService.js';
import { messagesQuerySchema, sendMessageSchema, startConversationSchema } from '../validators/chat.js';

export interface ChatRouterOptions extends ChatDeps {
  requireAuth: RequestHandler;
  rateLimitEnabled: boolean;
}

export function createChatRouter({ requireAuth, rateLimitEnabled, ...deps }: ChatRouterOptions): Router {
  const router = Router();
  const controller = makeChatController(deps);
  const id = validateObjectIdParam('id');
  const writes = makeLimiter(rateLimitEnabled, { windowMs: 60 * 1000, limit: 60 });

  router.use(requireAuth);

  router.post('/conversations', makeLimiter(rateLimitEnabled, { windowMs: 60 * 60 * 1000, limit: 60 }), validateBody(startConversationSchema), controller.start);
  router.get('/conversations', controller.list);
  router.get('/conversations/:id', id, controller.one);
  router.get('/conversations/:id/messages', id, makeLimiter(rateLimitEnabled, { windowMs: 60 * 1000, limit: 120 }), validateQuery(messagesQuerySchema), controller.messages);
  router.post('/conversations/:id/messages', id, writes, validateBody(sendMessageSchema), controller.send);
  // A voice note is the audio file itself as the body, not JSON.
  router.post(
    '/conversations/:id/voice',
    id,
    writes,
    express.raw({ type: () => true, limit: CHAT.MAX_VOICE_BYTES }),
    controller.voice,
  );
  router.post('/conversations/:id/read', id, controller.read);
  router.get('/voice/:messageId', validateObjectIdParam('messageId'), controller.audio);

  return router;
}
