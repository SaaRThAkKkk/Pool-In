import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatPage } from './ChatPage'
import type { ChatMessage, Conversation } from './chatApi'

// The recorder wraps the browser's microphone; here a test decides what it reports.
const recorderState = {
  state: 'idle' as 'idle' | 'recording',
  elapsedMs: 0,
  error: null as string | null,
  supported: true,
  start: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  finish: undefined as undefined | ((r: { blob: Blob; durationMs: number }) => void),
}
vi.mock('./useVoiceRecorder', () => ({
  useVoiceRecorder: (onFinished: (r: { blob: Blob; durationMs: number }) => void) => {
    recorderState.finish = onFinished
    return recorderState
  },
}))

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
const fail = (status: number, code: string, message: string) => new Response(JSON.stringify({ success: false, error: { code, message } }), { status })

const convo: Conversation = {
  id: 'c1',
  kind: 'OWNER_MATCH',
  with: { name: 'Ravi', role: 'DRIVER' },
  trip: { from: 'Whitefield', to: 'Kempegowda Airport' },
  lastMessage: null,
  unread: 0,
  updatedAt: '2030-01-01T00:00:00.000Z',
}
const msg = (over: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  conversationId: 'c1',
  mine: false,
  type: 'TEXT',
  text: 'hi',
  createdAt: '2030-01-01T09:30:00.000Z',
  ...over,
})

function stub(opts: { messages?: ChatMessage[]; convoStatus?: number; sendStatus?: number } = {}) {
  const calls: { method: string; path: string; body?: unknown; headers?: Record<string, string> }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname
      const method = init?.method ?? 'GET'
      const body = init?.body instanceof Blob ? init.body : typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ method, path, body, headers: init?.headers as Record<string, string> })
      if (path === '/api/chat/conversations/c1' && method === 'GET') {
        return opts.convoStatus && opts.convoStatus !== 200 ? fail(opts.convoStatus, 'NOT_FOUND', 'Chat not found') : ok({ conversation: convo })
      }
      if (path === '/api/chat/conversations/c1/messages' && method === 'GET') return ok({ messages: opts.messages ?? [] })
      if (path === '/api/chat/conversations/c1/messages' && method === 'POST') {
        return opts.sendStatus && opts.sendStatus !== 201 ? fail(opts.sendStatus, 'VALIDATION_ERROR', 'Could not send') : ok({ message: msg({ id: 'new', mine: true }) }, 201)
      }
      if (path === '/api/chat/conversations/c1/voice') return ok({ message: msg({ id: 'v', mine: true, type: 'VOICE' }) }, 201)
      if (path === '/api/chat/conversations/c1/read') return ok({})
      if (path === '/api/chat/conversations') return ok({ conversations: [] })
      throw new Error(`unexpected request ${method} ${path}`)
    }),
  )
  return { calls, posted: (path: string) => calls.filter((c) => c.method === 'POST' && c.path === path) }
}

function renderChat() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/chat/c1']}>
        <Routes>
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/chat" element={<p>inbox page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.assign(recorderState, { state: 'idle', elapsedMs: 0, error: null, supported: true })
  recorderState.start.mockReset()
  recorderState.stop.mockReset()
  recorderState.cancel.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('ChatPage', () => {
  it('shows who you are talking to (first name and role) and the trip', async () => {
    stub()
    renderChat()
    expect(await screen.findByRole('heading', { name: /ravi/i })).toHaveTextContent('Driver')
    expect(screen.getByText('Whitefield')).toBeInTheDocument()
    expect(screen.getByText('Kempegowda Airport')).toBeInTheDocument()
    expect(await screen.findByText(/say hello/i)).toBeInTheDocument()
  })

  it('shows text, a voice note you can play, and a shared location with a link to the map', async () => {
    stub({
      messages: [
        msg({ id: 'm1', text: 'Hi, I am at the metro' }),
        msg({ id: 'm2', mine: true, text: 'On my way' }),
        msg({ id: 'm3', type: 'VOICE', text: undefined, voice: { url: '/api/chat/voice/m3', durationMs: 7000, mime: 'audio/webm' } }),
        msg({ id: 'm4', mine: true, type: 'LOCATION', text: undefined, location: { lat: 13.0001, lng: 77.6771 } }),
      ],
    })
    renderChat()
    const log = await screen.findByRole('log', { name: /messages/i })

    expect(await within(log).findByText('Hi, I am at the metro')).toBeInTheDocument()
    expect(within(log).getByText('On my way')).toBeInTheDocument()
    expect(within(log).getByText(/voice note · 0:07/i)).toBeInTheDocument()
    expect(within(log).getByLabelText('Voice note')).toHaveAttribute('src', '/api/chat/voice/m3')
    expect(within(log).getByText('13.00010, 77.67710')).toBeInTheDocument()
    const link = within(log).getByRole('link', { name: /open in maps/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('mlat=13.0001&mlon=77.6771'))
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  it('shows message text as plain text, never as markup', async () => {
    stub({ messages: [msg({ id: 'm1', text: '<img src=x onerror=alert(1)>' })] })
    renderChat()
    const log = await screen.findByRole('log')
    expect(await within(log).findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(log.querySelector('img')).toBeNull()
  })

  it('marks the chat as read when it has messages', async () => {
    const api = stub({ messages: [msg({ id: 'm1' })] })
    renderChat()
    await screen.findByText('hi')
    await waitFor(() => expect(api.posted('/api/chat/conversations/c1/read').length).toBeGreaterThan(0))
  })

  it('sends a text message, and clears the box', async () => {
    const api = stub()
    const u = userEvent.setup()
    renderChat()
    await screen.findByRole('heading', { name: /ravi/i })

    const box = screen.getByLabelText('Message')
    await u.type(box, 'See you at 8')
    await u.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(api.posted('/api/chat/conversations/c1/messages')).toHaveLength(1))
    expect(api.posted('/api/chat/conversations/c1/messages')[0]!.body).toEqual({ type: 'TEXT', text: 'See you at 8' })
    await waitFor(() => expect(box).toHaveValue(''))
  })

  it('sends with Enter, but Shift+Enter makes a new line', async () => {
    const api = stub()
    const u = userEvent.setup()
    renderChat()
    await screen.findByRole('heading', { name: /ravi/i })
    const box = screen.getByLabelText('Message')

    await u.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(box).toHaveValue('line one\nline two')
    expect(api.posted('/api/chat/conversations/c1/messages')).toHaveLength(0)

    await u.type(box, '{Enter}')
    await waitFor(() => expect(api.posted('/api/chat/conversations/c1/messages')).toHaveLength(1))
    expect(api.posted('/api/chat/conversations/c1/messages')[0]!.body).toEqual({ type: 'TEXT', text: 'line one\nline two' })
  })

  it('does not send a blank message: the button becomes the microphone', async () => {
    stub()
    const u = userEvent.setup()
    renderChat()
    await screen.findByRole('heading', { name: /ravi/i })
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /record a voice note/i })).toBeInTheDocument()
    await u.type(screen.getByLabelText('Message'), '   ')
    expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument()
  })

  it('says so when the message could not be sent', async () => {
    stub({ sendStatus: 400 })
    const u = userEvent.setup()
    renderChat()
    await screen.findByRole('heading', { name: /ravi/i })
    await u.type(screen.getByLabelText('Message'), 'hello')
    await u.click(screen.getByRole('button', { name: /send message/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not send/i)
  })

  describe('sharing a location', () => {
    const geolocation = (impl: (ok: PositionCallback, err: PositionErrorCallback) => void) =>
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: vi.fn(impl) }, configurable: true })

    it('asks first, explains it is a one-off, and sends nothing if you cancel', async () => {
      const api = stub()
      const getPosition = vi.fn()
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: getPosition }, configurable: true })
      const u = userEvent.setup()
      renderChat()
      await screen.findByRole('heading', { name: /ravi/i })

      await u.click(screen.getByRole('button', { name: /^share my location$/i }))
      const dialog = screen.getByRole('dialog', { name: /share your location/i })
      expect(within(dialog).getByText(/not live tracking/i)).toBeInTheDocument()
      expect(within(dialog).getByText(/only ravi can see it/i)).toBeInTheDocument()

      await u.click(within(dialog).getByRole('button', { name: /cancel/i }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(getPosition).not.toHaveBeenCalled()
      expect(api.posted('/api/chat/conversations/c1/messages')).toHaveLength(0)
    })

    it('after you confirm, sends your position once as a location message', async () => {
      geolocation((success) => success({ coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 20 } } as GeolocationPosition))
      const api = stub()
      const u = userEvent.setup()
      renderChat()
      await screen.findByRole('heading', { name: /ravi/i })

      await u.click(screen.getByRole('button', { name: /^share my location$/i }))
      await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: /share my location/i }))

      await waitFor(() => expect(api.posted('/api/chat/conversations/c1/messages')).toHaveLength(1))
      expect(api.posted('/api/chat/conversations/c1/messages')[0]!.body).toEqual({ type: 'LOCATION', lat: 12.9716, lng: 77.5946 })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('explains when location access is denied, and sends nothing', async () => {
      geolocation((_ok, error) => error({ code: 1, PERMISSION_DENIED: 1, message: 'denied' } as GeolocationPositionError))
      const api = stub()
      const u = userEvent.setup()
      renderChat()
      await screen.findByRole('heading', { name: /ravi/i })

      await u.click(screen.getByRole('button', { name: /^share my location$/i }))
      await u.click(within(screen.getByRole('dialog')).getByRole('button', { name: /share my location/i }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/allow location access/i)
      expect(api.posted('/api/chat/conversations/c1/messages')).toHaveLength(0)
    })
  })

  describe('voice notes', () => {
    it('starts recording when the microphone button is pressed', async () => {
      stub()
      const u = userEvent.setup()
      renderChat()
      await screen.findByRole('heading', { name: /ravi/i })
      await u.click(screen.getByRole('button', { name: /record a voice note/i }))
      expect(recorderState.start).toHaveBeenCalled()
    })

    it('shows the recording time with cancel and send controls, and hides the text box while recording', async () => {
      recorderState.state = 'recording'
      recorderState.elapsedMs = 12_000
      stub()
      const u = userEvent.setup()
      renderChat()
      await screen.findByRole('heading', { name: /ravi/i })

      expect(screen.getByRole('timer', { name: /recording time/i })).toHaveTextContent('0:12')
      expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
      await u.click(screen.getByRole('button', { name: /cancel recording/i }))
      expect(recorderState.cancel).toHaveBeenCalled()
      await u.click(screen.getByRole('button', { name: /send voice note/i }))
      expect(recorderState.stop).toHaveBeenCalled()
    })

    it('uploads a finished recording with its type and length', async () => {
      const api = stub()
      renderChat()
      await screen.findByRole('heading', { name: /ravi/i })

      recorderState.finish!({ blob: new Blob(['audio-bytes'], { type: 'audio/webm' }), durationMs: 5234 })

      await waitFor(() => expect(api.posted('/api/chat/conversations/c1/voice')).toHaveLength(1))
      const call = api.posted('/api/chat/conversations/c1/voice')[0]!
      expect(call.body).toBeInstanceOf(Blob)
      expect(call.headers).toMatchObject({ 'Content-Type': 'audio/webm', 'X-Duration-Ms': '5234' })
    })

    it('shows why recording failed (for example, microphone blocked)', async () => {
      recorderState.error = 'Allow microphone access in your browser to send voice notes.'
      stub()
      renderChat()
      expect(await screen.findByRole('alert')).toHaveTextContent(/allow microphone access/i)
    })

    it('disables the microphone where the browser cannot record', async () => {
      recorderState.supported = false
      stub()
      renderChat()
      await screen.findByRole('heading', { name: /ravi/i })
      expect(screen.getByRole('button', { name: /record a voice note/i })).toBeDisabled()
    })
  })

  it('says the chat is not available when it does not exist or is not yours', async () => {
    stub({ convoStatus: 404 })
    renderChat()
    expect(await screen.findByRole('heading', { name: /couldn't open this chat/i })).toBeInTheDocument()
    expect(screen.getByText(/doesn't exist, or it isn't yours/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to messages/i })).toHaveAttribute('href', '/chat')
  })
})
