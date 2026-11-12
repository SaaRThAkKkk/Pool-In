import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const CONVERSATION_KINDS = ['OWNER_MATCH', 'PASSENGER_MATCH'] as const;
export const MESSAGE_TYPES = ['TEXT', 'VOICE', 'LOCATION'] as const;

// A chat between two people whose trips matched. There is one per pair (and per pool, when one of them is a driver).
const conversationSchema = new Schema(
  {
    participants: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], required: true },
    // Makes "start a chat" safe to repeat: the same two people about the same pool always get the same chat.
    participantsKey: { type: String, required: true, unique: true },
    kind: { type: String, enum: CONVERSATION_KINDS, required: true },
    // The pool or request that brought them together (in the pools database, so these are plain ids).
    ownerPoolId: { type: Schema.Types.ObjectId, required: false },
    // What each person is called in this chat, and their part in it. Only a first name is ever shown.
    people: {
      type: [
        new Schema(
          {
            userId: { type: Schema.Types.ObjectId, required: true },
            name: { type: String, required: true },
            role: { type: String, enum: ['DRIVER', 'PASSENGER'], required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // A short description of the trip that matched, for the inbox.
    trip: { from: String, to: String },
    lastMessage: {
      type: new Schema(
        { kind: String, preview: String, senderId: Schema.Types.ObjectId, at: Date },
        { _id: false },
      ),
      required: false,
    },
    // When each person last opened the chat, to count what is unread.
    reads: {
      type: [new Schema({ userId: { type: Schema.Types.ObjectId, required: true }, at: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
  },
  { timestamps: true },
);
conversationSchema.index({ participants: 1, updatedAt: -1 });

const messageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: MESSAGE_TYPES, required: true },
    text: { type: String, required: false },
    // Shared once, at the moment the sender pressed the button. This is a snapshot, not live tracking.
    location: { type: new Schema({ lat: Number, lng: Number }, { _id: false }), required: false },
    voice: {
      type: new Schema({ noteId: Schema.Types.ObjectId, durationMs: Number, mime: String, bytes: Number }, { _id: false }),
      required: false,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
messageSchema.index({ conversationId: 1, _id: 1 });

// The audio itself, kept apart from messages so listing a chat never loads any audio.
const voiceNoteSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, required: true },
    data: { type: Buffer, required: true },
    mime: { type: String, required: true },
    durationMs: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

export type ConversationDocument = HydratedDocument<InferSchemaType<typeof conversationSchema>>;
export type MessageDocument = HydratedDocument<InferSchemaType<typeof messageSchema>>;
export const Conversation = model('Conversation', conversationSchema);
export const Message = model('Message', messageSchema);
export const VoiceNote = model('VoiceNote', voiceNoteSchema);
