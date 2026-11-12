import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, ArrowRight, LoaderCircle, MapPin, Mic, Send, Square, X } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { useServerEvent } from '../../lib/socket'
import {
  CONVERSATIONS_KEY,
  MAX_TEXT_LENGTH,
  conversationKey,
  fetchConversation,
  fetchMessages,
  mapLink,
  markRead,
  messagesKey,
  sendLocation,
  sendText,
  sendVoice,
  type ChatMessage,
} from './chatApi'
import { useVoiceRecorder } from './useVoiceRecorder'

const POLL_MS = 8000

const seconds = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.mine
  return (
    <li className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[70%] ${
          mine ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-900'
        }`}
      >
        {message.type === 'TEXT' && <p className="whitespace-pre-wrap break-words">{message.text}</p>}

        {message.type === 'VOICE' && message.voice && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-xs opacity-80">
              <Mic aria-hidden className="h-3.5 w-3.5" /> Voice note · {seconds(message.voice.durationMs)}
            </p>
            <audio controls preload="none" src={message.voice.url} aria-label="Voice note" className="h-10 w-full max-w-[16rem]" />
          </div>
        )}

        {message.type === 'LOCATION' && message.location && (
          <div>
            <p className="flex items-center gap-1 font-medium">
              <MapPin aria-hidden className="h-4 w-4" /> Shared location
            </p>
            <p className="mt-0.5 text-xs opacity-80">
              {message.location.lat.toFixed(5)}, {message.location.lng.toFixed(5)}
            </p>
            <a
              href={mapLink(message.location.lat, message.location.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-1.5 inline-block rounded-lg px-2.5 py-1 text-xs font-semibold underline-offset-2 hover:underline ${
                mine ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-700'
              }`}
            >
              Open in maps
            </a>
          </div>
        )}

        <p className={`mt-1 text-right text-[10px] ${mine ? 'text-white/70' : 'text-slate-400'}`}>{format(new Date(message.createdAt), 'h:mm a')}</p>
      </div>
    </li>
  )
}

export function ChatPage() {
  const { id = '' } = useParams()
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [asking, setAsking] = useState(false) // confirming "share my location"
  const [problem, setProblem] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const convo = useQuery({ queryKey: conversationKey(id), queryFn: () => fetchConversation(id), retry: false })
  const messages = useQuery({
    queryKey: messagesKey(id),
    queryFn: () => fetchMessages(id),
    enabled: convo.isSuccess,
    refetchInterval: POLL_MS,
  })

  // The other person just wrote: look again straight away.
  useServerEvent('chat:message', (payload) => {
    if ((payload as { conversationId?: string } | null)?.conversationId === id) void messages.refetch()
  })

  const list = messages.data ?? []
  const lastId = list.at(-1)?.id

  // Opening the chat (and every new message while it is open) marks it read.
  const read = useMutation({
    mutationFn: () => markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
  })
  useEffect(() => {
    if (lastId) read.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId])

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [lastId])

  const afterSend = () => {
    setProblem(null)
    void queryClient.invalidateQueries({ queryKey: messagesKey(id) })
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY })
  }
  const failed = (err: unknown) => setProblem(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.')

  const send = useMutation({ mutationFn: (t: string) => sendText(id, t), onSuccess: () => { setText(''); afterSend() }, onError: failed })
  const share = useMutation({
    mutationFn: ({ lat, lng }: { lat: number; lng: number }) => sendLocation(id, lat, lng),
    onSuccess: afterSend,
    onError: failed,
  })
  const voice = useMutation({
    mutationFn: ({ blob, durationMs }: { blob: Blob; durationMs: number }) => sendVoice(id, blob, durationMs),
    onSuccess: afterSend,
    onError: failed,
  })
  const recorder = useVoiceRecorder((rec) => voice.mutate({ blob: rec.blob, durationMs: rec.durationMs }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (t && !send.isPending) send.mutate(t)
  }

  // One-off position, taken only after the person confirms. It is not tracking: it is a single message.
  const shareLocation = () => {
    setAsking(false)
    if (!navigator.geolocation) {
      setProblem("Your browser can't share a location.")
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => share.mutate({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setProblem(err.code === err.PERMISSION_DENIED ? 'Allow location access in your browser to share where you are.' : "We couldn't get your location."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    )
  }

  if (convo.isError) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-xl font-bold">We couldn't open this chat</h1>
        <p className="mt-2 text-sm text-slate-600">
          {convo.error instanceof ApiError && convo.error.status === 404 ? "It doesn't exist, or it isn't yours." : 'Please try again in a moment.'}
        </p>
        <Link to="/chat" className="btn-primary mt-4">
          Back to messages
        </Link>
      </div>
    )
  }

  const them = convo.data?.with
  const recording = recorder.state === 'recording'
  const busy = send.isPending || share.isPending || voice.isPending

  return (
    <div className="mx-auto flex h-[calc(100dvh-11rem)] min-h-[24rem] max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-xl shadow-brand-500/10">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-3">
        <Link to="/chat" aria-label="Back to messages" className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
          <ArrowLeft aria-hidden className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold">
            {them ? them.name : 'Chat'}
            {them && (
              <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-brand-100">
                {them.role === 'DRIVER' ? 'Driver' : 'Fellow traveller'}
              </span>
            )}
          </h1>
          {convo.data && (
            <p className="flex items-center gap-1 truncate text-xs text-slate-500">
              <span className="truncate">{convo.data.trip.from}</span>
              <ArrowRight aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate">{convo.data.trip.to}</span>
            </p>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {(convo.isPending || messages.isPending) && !convo.isError && (
          <p role="status" className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin" /> Loading messages…
          </p>
        )}
        {messages.isSuccess && list.length === 0 && (
          <p className="mx-auto max-w-xs text-center text-sm text-slate-500">
            Say hello. Agree where to meet and when. You can send text, a voice note, or share where you are.
          </p>
        )}
        <ul role="log" aria-label="Messages" aria-live="polite" className="space-y-2">
          {list.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
        </ul>
        <div ref={endRef} />
      </div>

      <div className="border-t border-slate-200 bg-white p-3">
        {problem && (
          <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
            {problem}
          </p>
        )}
        {recorder.error && (
          <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">
            {recorder.error}
          </p>
        )}

        {asking && (
          <div role="dialog" aria-label="Share your location" className="mb-2 rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm">
            <p className="font-medium text-slate-900">Share where you are right now?</p>
            <p className="mt-0.5 text-slate-600">It is sent once, as a single message. It is not live tracking, and only {them?.name ?? 'the other person'} can see it.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={shareLocation} className="btn-primary !px-3 !py-2 text-sm">
                Share my location
              </button>
              <button type="button" onClick={() => setAsking(false)} className="btn-secondary !px-3 !py-2 text-sm">
                Cancel
              </button>
            </div>
          </div>
        )}

        {recording ? (
          <div className="flex items-center gap-3" role="group" aria-label="Recording a voice note">
            <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-red-600" />
            <p role="timer" aria-label="Recording time" className="flex-1 font-mono text-sm tabular-nums">
              Recording… {seconds(recorder.elapsedMs)}
            </p>
            <button type="button" onClick={recorder.cancel} aria-label="Cancel recording" className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 text-slate-700 hover:bg-slate-100">
              <X aria-hidden className="h-5 w-5" />
            </button>
            <button type="button" onClick={recorder.stop} aria-label="Send voice note" className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700">
              <Square aria-hidden className="h-4 w-4 fill-current" />
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setAsking((a) => !a)}
              disabled={busy}
              aria-label="Share my location"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <MapPin aria-hidden className="h-5 w-5" />
            </button>
            <label htmlFor="chat-text" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-text"
              rows={1}
              value={text}
              maxLength={MAX_TEXT_LENGTH}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Write a message"
              className="field-input max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm"
            />
            {text.trim() ? (
              <button type="submit" disabled={send.isPending} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60">
                <Send aria-hidden className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void recorder.start()}
                disabled={busy || !recorder.supported}
                aria-label="Record a voice note"
                title={recorder.supported ? 'Record a voice note' : "Voice notes aren't supported in this browser"}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                <Mic aria-hidden className="h-5 w-5" />
              </button>
            )}
          </form>
        )}
        {(voice.isPending || share.isPending) && (
          <p role="status" className="mt-2 flex items-center gap-2 text-xs text-slate-500">
            <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" /> Sending…
          </p>
        )}
      </div>
    </div>
  )
}
