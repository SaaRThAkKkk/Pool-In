import { api } from '../../lib/api'
import type { PoolCabPayload } from '../pools/poolsApi'

// Limits mirrored from the server (server/src/config/chat.ts), only to give instant feedback.
export const MAX_TEXT_LENGTH = 1000
export const MAX_VOICE_MS = 120_000
/** How often the chat list is refreshed on its own, as a fallback for the real-time push. */
export const INBOX_POLL_MS = 15_000

export interface Conversation {
  id: string
  kind: 'OWNER_MATCH' | 'PASSENGER_MATCH'
  /** First name only, and their part in the trip. */
  with: { name: string; role: 'DRIVER' | 'PASSENGER' }
  trip: { from: string; to: string }
  lastMessage: { type: 'TEXT' | 'VOICE' | 'LOCATION'; preview: string; mine: boolean; at: string } | null
  unread: number
  updatedAt: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  mine: boolean
  type: 'TEXT' | 'VOICE' | 'LOCATION'
  text?: string
  location?: { lat: number; lng: number }
  voice?: { url: string; durationMs: number; mime: string }
  createdAt: string
}

// Who to chat with. The server checks that the trips really match before it opens anything.
export type StartChatInput =
  | { poolId: string; requestId: string }
  | { poolId: string; trip: PoolCabPayload }
  | { requestId: string; otherRequestId: string }

export const CONVERSATIONS_KEY = ['conversations'] as const
export const conversationKey = (id: string) => ['conversation', id] as const
export const messagesKey = (id: string) => ['messages', id] as const

export async function startChat(input: StartChatInput) {
  return (await api<{ conversation: Conversation }>('/chat/conversations', { method: 'POST', body: JSON.stringify(input) })).conversation
}

export async function fetchConversations() {
  return (await api<{ conversations: Conversation[] }>('/chat/conversations')).conversations
}

export async function fetchConversation(id: string) {
  return (await api<{ conversation: Conversation }>(`/chat/conversations/${id}`)).conversation
}

export async function fetchMessages(id: string, after?: string) {
  const query = after ? `?after=${encodeURIComponent(after)}` : ''
  return (await api<{ messages: ChatMessage[] }>(`/chat/conversations/${id}/messages${query}`)).messages
}

export async function sendText(id: string, text: string) {
  return (await api<{ message: ChatMessage }>(`/chat/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ type: 'TEXT', text }) })).message
}

export async function sendLocation(id: string, lat: number, lng: number) {
  return (await api<{ message: ChatMessage }>(`/chat/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ type: 'LOCATION', lat, lng }) })).message
}

// The recording itself is the request body; its length goes in a header.
export async function sendVoice(id: string, audio: Blob, durationMs: number) {
  const type = audio.type || 'audio/webm'
  return (
    await api<{ message: ChatMessage }>(`/chat/conversations/${id}/voice`, {
      method: 'POST',
      body: audio,
      headers: { 'Content-Type': type, 'X-Duration-Ms': String(Math.round(durationMs)) },
    })
  ).message
}

export function markRead(id: string) {
  return api<Record<string, never>>(`/chat/conversations/${id}/read`, { method: 'POST' })
}

export const mapLink = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`
