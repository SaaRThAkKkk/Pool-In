import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNowStrict } from 'date-fns'
import { ArrowRight, MessageCircle } from 'lucide-react'
import { useServerEvent } from '../../lib/socket'
import { CONVERSATIONS_KEY, INBOX_POLL_MS, fetchConversations, type Conversation } from './chatApi'

const preview = (c: Conversation) => {
  if (!c.lastMessage) return 'No messages yet. Say hello.'
  const who = c.lastMessage.mine ? 'You: ' : ''
  if (c.lastMessage.type === 'VOICE') return `${who}Voice note`
  if (c.lastMessage.type === 'LOCATION') return `${who}Shared a location`
  return `${who}${c.lastMessage.preview}`
}

export function InboxPage() {
  const queryClient = useQueryClient()
  const chats = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: fetchConversations, refetchInterval: INBOX_POLL_MS })
  useServerEvent('chat:message', () => void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }))

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Messages</h1>
        <p className="mt-1 text-sm text-slate-600">Chats with the drivers and travellers your trips matched with. Only first names are shown.</p>
      </div>

      {chats.isPending && <p role="status">Loading your chats…</p>}
      {chats.isError && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          We couldn't load your chats. Please try again in a moment.
        </p>
      )}

      {chats.data && chats.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-8 text-center">
          <MessageCircle aria-hidden className="mx-auto h-10 w-10 text-brand-600" />
          <h2 className="mt-3 text-lg font-bold">No chats yet</h2>
          <p className="mt-1 text-sm text-slate-600">When your trip matches a pool or another traveller, press Message on the match to start a chat.</p>
          <Link to="/pool-in" className="btn-primary mt-4">
            Pool In
          </Link>
        </div>
      )}

      {chats.data && chats.data.length > 0 && (
        <ul aria-label="Your chats" className="space-y-3">
          {chats.data.map((c) => (
            <li key={c.id}>
              <Link
                to={`/chat/${c.id}`}
                className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold">{c.with.name}</span>
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
                    {c.with.role === 'DRIVER' ? 'Driver' : 'Fellow traveller'}
                  </span>
                  {c.unread > 0 && (
                    <span aria-label={`${c.unread} unread`} className="ml-auto rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
                      {c.unread}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
                  <span className="truncate">{c.trip.from}</span>
                  <ArrowRight aria-hidden className="h-3 w-3 shrink-0" />
                  <span className="truncate">{c.trip.to}</span>
                </p>
                <p className={`mt-1 truncate text-sm ${c.unread > 0 ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{preview(c)}</p>
                {c.lastMessage && <p className="mt-0.5 text-xs text-slate-400">{formatDistanceToNowStrict(new Date(c.lastMessage.at), { addSuffix: true })}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
