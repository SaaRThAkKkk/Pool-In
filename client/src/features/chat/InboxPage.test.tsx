import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InboxPage } from './InboxPage'
import { StartChatButton } from './StartChatButton'
import type { Conversation } from './chatApi'

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
const fail = (status: number, code: string, message: string) => new Response(JSON.stringify({ success: false, error: { code, message } }), { status })

const chat = (over: Partial<Conversation> & { id: string }): Conversation => ({
  kind: 'OWNER_MATCH',
  with: { name: 'Ravi', role: 'DRIVER' },
  trip: { from: 'Whitefield', to: 'Airport' },
  lastMessage: null,
  unread: 0,
  updatedAt: new Date().toISOString(),
  ...over,
})

function renderAt(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/start']}>
        <Routes>
          <Route path="/start" element={ui} />
          <Route path="/chat/:id" element={<p>thread page</p>} />
          <Route path="/pool-in" element={<p>pool in page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('InboxPage', () => {
  it('invites the user to match first when there are no chats', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok({ conversations: [] })))
    renderAt(<InboxPage />)
    expect(await screen.findByRole('heading', { name: /no chats yet/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /pool in/i })).toHaveAttribute('href', '/pool-in')
  })

  it('lists chats with first name, role, trip, latest message and unread count', async () => {
    const now = new Date().toISOString()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ok({
          conversations: [
            chat({ id: 'a', unread: 3, lastMessage: { type: 'TEXT', preview: 'On my way', mine: false, at: now } }),
            chat({ id: 'b', with: { name: 'Bala', role: 'PASSENGER' }, lastMessage: { type: 'VOICE', preview: 'Sent a voice note', mine: true, at: now } }),
            chat({ id: 'c', with: { name: 'Meena', role: 'DRIVER' }, lastMessage: { type: 'LOCATION', preview: 'Shared a location', mine: false, at: now } }),
            chat({ id: 'd', with: { name: 'Dev', role: 'DRIVER' } }),
          ],
        }),
      ),
    )
    renderAt(<InboxPage />)
    const list = await screen.findByRole('list', { name: /your chats/i })
    const rows = within(list).getAllByRole('link')

    expect(rows[0]).toHaveAttribute('href', '/chat/a')
    expect(rows[0]).toHaveTextContent('Ravi')
    expect(rows[0]).toHaveTextContent('Driver')
    expect(rows[0]).toHaveTextContent('On my way')
    expect(within(rows[0]!).getByLabelText('3 unread')).toBeInTheDocument()

    expect(rows[1]).toHaveTextContent('Fellow traveller')
    expect(rows[1]).toHaveTextContent('You: Voice note')
    expect(rows[2]).toHaveTextContent('Shared a location')
    expect(rows[3]).toHaveTextContent(/no messages yet/i)
    expect(within(rows[3]!).queryByLabelText(/unread/i)).not.toBeInTheDocument()
  })

  it('says so when the chats could not be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(500, 'INTERNAL', 'boom')))
    renderAt(<InboxPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load your chats/i)
  })
})

describe('StartChatButton', () => {
  it('asks the server to open the chat, then goes to it', async () => {
    const fetchMock = vi.fn(async () => ok({ conversation: chat({ id: 'new1' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const u = userEvent.setup()
    renderAt(<StartChatButton label="Message the driver" input={{ poolId: 'p1', requestId: 'r1' }} />)

    await u.click(screen.getByRole('button', { name: /message the driver/i }))
    expect(await screen.findByText('thread page')).toBeInTheDocument()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/chat/conversations')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ poolId: 'p1', requestId: 'r1' })
  })

  it('shows the server\'s reason when the trips no longer match, and stays on the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(409, 'NOT_A_MATCH', "This pool doesn't fit your trip any more, so there is no chat to open.")))
    const u = userEvent.setup()
    renderAt(<StartChatButton label="Message this traveller" input={{ requestId: 'r1', otherRequestId: 'r2' }} />)

    await u.click(screen.getByRole('button', { name: /message this traveller/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't fit your trip any more/i)
    expect(screen.queryByText('thread page')).not.toBeInTheDocument()
  })
})
