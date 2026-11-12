import type { RequestHandler } from 'express';
import { badRequest } from '../utils/errors.js';
import {
  getConversation,
  getMessages,
  getVoice,
  listConversations,
  markRead,
  sendMessage,
  sendVoice,
  startConversation,
  toConversationDto,
  type ChatDeps,
} from '../services/chat/chatService.js';
import type { MessagesQuery, SendMessageInput, StartConversationInput } from '../validators/chat.js';

export function makeChatController(deps: ChatDeps) {
  const start: RequestHandler = async (req, res) => {
    const convo = await startConversation(req.user!, req.body as StartConversationInput, deps);
    res.json({ success: true, data: { conversation: await toConversationDto(convo, req.user!) } });
  };

  const list: RequestHandler = async (req, res) => {
    res.json({ success: true, data: { conversations: await listConversations(req.user!) } });
  };

  const one: RequestHandler = async (req, res) => {
    res.json({ success: true, data: { conversation: await getConversation(req.user!, String(req.params.id)) } });
  };

  const messages: RequestHandler = async (req, res) => {
    const { after } = res.locals.query as MessagesQuery;
    res.json({ success: true, data: { messages: await getMessages(req.user!, String(req.params.id), after) } });
  };

  const send: RequestHandler = async (req, res) => {
    const message = await sendMessage(req.user!, String(req.params.id), req.body as SendMessageInput, deps);
    res.status(201).json({ success: true, data: { message } });
  };

  // The recording is the raw request body; its length in milliseconds comes in a header.
  const voice: RequestHandler = async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the recording as the request body.');
    const durationMs = Number(req.header('x-duration-ms'));
    const message = await sendVoice(req.user!, String(req.params.id), req.body, req.header('content-type') ?? '', durationMs, deps);
    res.status(201).json({ success: true, data: { message } });
  };

  const read: RequestHandler = async (req, res) => {
    await markRead(req.user!, String(req.params.id));
    res.json({ success: true, data: {} });
  };

  const audio: RequestHandler = async (req, res) => {
    const { data, mime } = await getVoice(req.user!, String(req.params.messageId));
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(data.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  };

  return { start, list, one, messages, send, voice, read, audio };
}
