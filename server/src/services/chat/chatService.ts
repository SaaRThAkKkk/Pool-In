import { Types } from 'mongoose';
import { CHAT, VOICE_MIME_TYPES } from '../../config/chat.js';
import { CabPool } from '../../models/CabPool.js';
import { CarOwnerPool } from '../../models/CarOwnerPool.js';
import { Conversation, Message, VoiceNote, type ConversationDocument, type MessageDocument } from '../../models/Chat.js';
import { User, type UserDocument } from '../../models/User.js';
import { badRequest, badGateway, conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import type { SendMessageInput, StartConversationInput } from '../../validators/chat.js';
import { toOwnerCandidate, toPassengerRequest } from '../matching/candidateRepository.js';
import type { PoolMatcher } from '../matching/matcher.js';
import type { PassengerRequest } from '../matching/types.js';
import type { SearchNotifier } from '../realtime/notifier.js';
import { requestFromInput } from '../pools/searchService.js';

export interface ChatDeps {
  matcher: PoolMatcher;
  notifier: SearchNotifier;
}

const sameId = (a: unknown, b: unknown) => String(a) === String(b);
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? 'Traveller';

// --- Who may chat ------------------------------------------------------------------------------------------------

// The trips must really match, checked again here with the same rules as the search. Nobody can open a chat with
// an arbitrary person just by knowing an id.
async function requestFor(user: UserDocument, input: StartConversationInput): Promise<PassengerRequest & { id?: string }> {
  if ('trip' in input) {
    const request = requestFromInput(user.id, input.trip);
    if (!request) throw unprocessable('NEEDS_COORDINATES', 'Choose both places from the suggestions so we can check the match.');
    return request;
  }
  const doc = await CabPool.findOne({ _id: input.requestId, userId: user._id });
  if (!doc) throw notFound('Request not found');
  if (!['SEARCHING', 'OPEN'].includes(doc.status)) throw conflict('REQUEST_NOT_ACTIVE', 'This request is not active any more.');
  const request = toPassengerRequest(doc);
  if (!request) throw unprocessable('NEEDS_COORDINATES', 'This request has no coordinates, so it cannot be matched.');
  return request;
}

async function names(ids: Types.ObjectId[]): Promise<Map<string, string>> {
  const users = await User.find({ _id: { $in: ids } }).select('name');
  return new Map(users.map((u) => [u.id as string, firstName(u.name)]));
}

const keyFor = (kind: string, ids: Types.ObjectId[], extra = '') =>
  `${kind}:${ids.map(String).sort().join('+')}${extra ? `:${extra}` : ''}`;

export async function startConversation(user: UserDocument, input: StartConversationInput, deps: ChatDeps): Promise<ConversationDocument> {
  const request = await requestFor(user, input);

  if ('poolId' in input) {
    const pool = await CarOwnerPool.findOne({ _id: input.poolId, status: { $in: ['OPEN', 'PARTIALLY_FILLED'] } });
    if (!pool) throw notFound('Pool not found');
    if (sameId(pool.userId, user._id)) throw forbidden('You cannot chat about your own pool.');
    const candidate = toOwnerCandidate(pool);
    if (!candidate) throw unprocessable('NOT_MATCHABLE', 'This pool cannot be matched yet.');

    const verdict = await deps.matcher.evaluatePool(request, candidate);
    if (verdict === 'ROUTING_ERROR') throw badGateway('MAPS_UNAVAILABLE', "We couldn't check this match just now. Please try again shortly.");
    if (!verdict) throw conflict('NOT_A_MATCH', "This pool doesn't fit your trip any more, so there is no chat to open.");

    const people = [user._id, pool.userId];
    const first = await names(people);
    return upsert(keyFor('OWNER', people, pool.id), {
      participants: people,
      kind: 'OWNER_MATCH',
      ownerPoolId: pool._id,
      people: [
        { userId: user._id, name: first.get(user.id) ?? firstName(user.name), role: 'PASSENGER' },
        { userId: pool.userId, name: first.get(String(pool.userId)) ?? 'Driver', role: 'DRIVER' },
      ],
      trip: { from: pool.origin.label, to: pool.destination.label },
    });
  }

  // Another passenger: their request must be one of the groups proposed for this passenger.
  const other = await CabPool.findOne({ _id: input.otherRequestId, status: { $in: ['SEARCHING', 'OPEN'] } });
  if (!other) throw notFound('Request not found');
  if (sameId(other.userId, user._id)) throw forbidden('You cannot chat with yourself.');
  const groups = await deps.matcher.findPassengerMatches(request);
  if (!groups.matches.some((m) => m.requestId === other.id)) {
    throw conflict('NOT_A_MATCH', "This traveller doesn't fit your trip any more, so there is no chat to open.");
  }

  const mine = await CabPool.findById(input.requestId);
  const people = [user._id, other.userId];
  const first = await names(people);
  return upsert(keyFor('PAX', people), {
    participants: people,
    kind: 'PASSENGER_MATCH',
    people: [
      { userId: user._id, name: first.get(user.id) ?? firstName(user.name), role: 'PASSENGER' },
      { userId: other.userId, name: first.get(String(other.userId)) ?? 'Traveller', role: 'PASSENGER' },
    ],
    trip: { from: mine?.origin.label ?? other.origin.label, to: mine?.destination.label ?? other.destination.label },
  });
}

async function upsert(participantsKey: string, fields: Record<string, unknown>): Promise<ConversationDocument> {
  // Two people pressing "message" at the same moment must end up in the same chat.
  return Conversation.findOneAndUpdate(
    { participantsKey },
    { $setOnInsert: { participantsKey, ...fields } },
    { upsert: true, returnDocument: 'after' },
  ) as unknown as Promise<ConversationDocument>;
}

// --- Reading ------------------------------------------------------------------------------------------------------

async function loadMine(user: UserDocument, id: string): Promise<ConversationDocument> {
  const convo = await Conversation.findOne({ _id: id, participants: user._id });
  // Someone else's chat is answered exactly like one that does not exist.
  if (!convo) throw notFound('Chat not found');
  return convo;
}

const other = (convo: ConversationDocument, user: UserDocument) => convo.people.find((p) => !sameId(p.userId, user._id));

async function unread(convo: ConversationDocument, user: UserDocument): Promise<number> {
  const since = convo.reads.find((r) => sameId(r.userId, user._id))?.at;
  return Message.countDocuments({
    conversationId: convo._id,
    senderId: { $ne: user._id },
    ...(since ? { createdAt: { $gt: since } } : {}),
  });
}

export async function toConversationDto(convo: ConversationDocument, user: UserDocument) {
  const them = other(convo, user);
  return {
    id: convo.id as string,
    kind: convo.kind,
    with: { name: them?.name ?? 'Traveller', role: them?.role ?? 'PASSENGER' },
    trip: { from: convo.trip?.from ?? '', to: convo.trip?.to ?? '' },
    lastMessage: convo.lastMessage
      ? { type: convo.lastMessage.kind, preview: convo.lastMessage.preview, mine: sameId(convo.lastMessage.senderId, user._id), at: convo.lastMessage.at }
      : null,
    unread: await unread(convo, user),
    updatedAt: convo.updatedAt,
  };
}

export const toMessageDto = (m: MessageDocument, user: UserDocument) => ({
  id: m.id as string,
  conversationId: String(m.conversationId),
  mine: sameId(m.senderId, user._id),
  type: m.type,
  ...(m.text !== undefined && m.text !== null ? { text: m.text } : {}),
  ...(m.location ? { location: { lat: m.location.lat, lng: m.location.lng } } : {}),
  ...(m.voice ? { voice: { url: `/api/chat/voice/${m.id}`, durationMs: m.voice.durationMs, mime: m.voice.mime } } : {}),
  createdAt: m.createdAt,
});

export async function listConversations(user: UserDocument) {
  const convos = await Conversation.find({ participants: user._id }).sort({ updatedAt: -1 }).limit(CHAT.MAX_CONVERSATIONS);
  return Promise.all(convos.map((c) => toConversationDto(c, user)));
}

export async function getConversation(user: UserDocument, id: string) {
  return toConversationDto(await loadMine(user, id), user);
}

export async function getMessages(user: UserDocument, id: string, after?: string) {
  const convo = await loadMine(user, id);
  if (after) {
    const newer = await Message.find({ conversationId: convo._id, _id: { $gt: after } })
      .sort({ _id: 1 })
      .limit(CHAT.PAGE_SIZE);
    return newer.map((m) => toMessageDto(m, user));
  }
  // Opening a long chat shows the latest messages (oldest of those first), not the very first ones.
  const latest = await Message.find({ conversationId: convo._id }).sort({ _id: -1 }).limit(CHAT.PAGE_SIZE);
  return latest.reverse().map((m) => toMessageDto(m, user));
}

// Opening a chat marks everything in it as read for this person.
export async function markRead(user: UserDocument, id: string, now = new Date()): Promise<void> {
  const convo = await loadMine(user, id);
  const reads = convo.reads.filter((r) => !sameId(r.userId, user._id)).map((r) => ({ userId: r.userId, at: r.at }));
  reads.push({ userId: user._id, at: now });
  await Conversation.updateOne({ _id: convo._id }, { $set: { reads } }, { timestamps: false });
}

// --- Writing ------------------------------------------------------------------------------------------------------

async function record(
  convo: ConversationDocument,
  user: UserDocument,
  fields: Record<string, unknown>,
  preview: string,
  deps: ChatDeps,
): Promise<MessageDocument> {
  const message = await Message.create({ conversationId: convo._id, senderId: user._id, ...fields });
  await Conversation.updateOne(
    { _id: convo._id },
    { $set: { lastMessage: { kind: message.type, preview, senderId: user._id, at: message.createdAt } } },
  );
  // Tell the other person straight away. If they are offline the chat simply shows it next time.
  const them = other(convo, user);
  if (them) deps.notifier.notifyUser(String(them.userId), 'chat:message', { conversationId: convo.id });
  return message;
}

export async function sendMessage(user: UserDocument, id: string, input: SendMessageInput, deps: ChatDeps) {
  const convo = await loadMine(user, id);
  const message =
    input.type === 'TEXT'
      ? await record(convo, user, { type: 'TEXT', text: input.text }, input.text.slice(0, 80), deps)
      : await record(convo, user, { type: 'LOCATION', location: { lat: input.lat, lng: input.lng } }, 'Shared a location', deps);
  return toMessageDto(message, user);
}

// Just enough of the file header to tell audio from something else wearing an audio label.
export function looksLikeAudio(b: Buffer): boolean {
  if (b.length < 12) return false;
  const ascii = (from: number, to: number) => b.subarray(from, to).toString('latin1');
  return (
    (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) || // webm / matroska
    ascii(0, 4) === 'OggS' ||
    ascii(4, 8) === 'ftyp' || // mp4 / m4a
    ascii(0, 3) === 'ID3' ||
    (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) || // mp3 / aac frame
    (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
  );
}

export async function sendVoice(user: UserDocument, id: string, audio: Buffer, contentType: string, durationMs: number, deps: ChatDeps) {
  const convo = await loadMine(user, id);

  const mime = contentType.split(';')[0]!.trim().toLowerCase();
  if (!(VOICE_MIME_TYPES as readonly string[]).includes(mime)) throw badRequest('That audio format is not supported.');
  if (audio.length === 0) throw badRequest('The recording is empty.');
  if (audio.length > CHAT.MAX_VOICE_BYTES) throw badRequest('That voice note is too large.');
  if (!Number.isFinite(durationMs) || durationMs < 300 || durationMs > CHAT.MAX_VOICE_MS) {
    throw badRequest(`Voice notes can be up to ${CHAT.MAX_VOICE_MS / 1000} seconds long.`);
  }
  if (!looksLikeAudio(audio)) throw badRequest('That file is not a recording.');

  const note = await VoiceNote.create({ conversationId: convo._id, data: audio, mime, durationMs: Math.round(durationMs) });
  const message = await record(
    convo,
    user,
    { type: 'VOICE', voice: { noteId: note._id, durationMs: Math.round(durationMs), mime, bytes: audio.length } },
    'Sent a voice note',
    deps,
  );
  return toMessageDto(message, user);
}

// Only the two people in the chat can hear a voice note.
export async function getVoice(user: UserDocument, messageId: string): Promise<{ data: Buffer; mime: string }> {
  const message = await Message.findOne({ _id: messageId, type: 'VOICE' });
  if (!message?.voice?.noteId) throw notFound();
  await loadMine(user, String(message.conversationId));
  const note = await VoiceNote.findById(message.voice.noteId);
  if (!note) throw notFound();
  return { data: note.data, mime: note.mime };
}
