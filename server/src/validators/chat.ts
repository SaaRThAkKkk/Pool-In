import { z } from 'zod';
import { CHAT } from '../config/chat.js';
import { poolCabSchema } from './pools.js';

const objectId = z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id');

// Who to chat with. The server checks that the two trips really match; the client cannot just name anyone.
export const startConversationSchema = z.union([
  // A driver's pool, for a passenger whose request is already saved.
  z.object({ poolId: objectId, requestId: objectId }).strict(),
  // A driver's pool, for a passenger who has only just searched (nothing was saved because a pool already fit).
  z.object({ poolId: objectId, trip: poolCabSchema }).strict(),
  // Another passenger's request, for a passenger whose request is saved.
  z.object({ requestId: objectId, otherRequestId: objectId }).strict(),
]);
export type StartConversationInput = z.infer<typeof startConversationSchema>;

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const sendMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TEXT'),
    text: z
      .string()
      .trim()
      .min(1, 'Write a message first')
      .max(CHAT.MAX_TEXT_LENGTH, `Messages can be at most ${CHAT.MAX_TEXT_LENGTH} characters`),
  }),
  z.object({ type: z.literal('LOCATION'), lat, lng }),
]);
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const messagesQuerySchema = z.object({
  after: objectId.optional(),
});
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;
