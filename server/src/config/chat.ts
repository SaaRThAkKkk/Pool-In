// Limits for chat between people whose trips match. Enforced on the server; the client only mirrors them.
export const CHAT = {
  MAX_TEXT_LENGTH: 1000,
  /** A voice note is kept whole in the database, so it is kept short and small. */
  MAX_VOICE_MS: 120_000,
  MAX_VOICE_BYTES: 2 * 1024 * 1024,
  /** Messages returned in one go. */
  PAGE_SIZE: 100,
  /** Conversations shown in the inbox. */
  MAX_CONVERSATIONS: 50,
} as const;

// Audio the browsers' recorders produce (Chrome/Firefox: webm or ogg; Safari: mp4), plus common formats.
export const VOICE_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'] as const;
