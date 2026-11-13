import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiStatus } from './ApiStatus'

const ok = () => new Response(JSON.stringify({ success: true, data: { status: 'ok', db: 'connected' } }), { status: 200 })
const down = () => new Response('<html>502 Bad Gateway</html>', { status: 502 })

function renderStatus() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiStatus />
    </QueryClientProvider>,
  )
}
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ApiStatus', () => {
  it('says the server is fine when it answers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    renderStatus()
    await tick(10)
    expect(screen.getByRole('status')).toHaveTextContent('Server ok · database connected')
  })

  it('says the server is waking (not "unreachable") when it does not answer, and recovers by itself', async () => {
    let awake = false
    const fetchMock = vi.fn(async () => (awake ? ok() : down()))
    vi.stubGlobal('fetch', fetchMock)
    renderStatus()
    await tick(10)
    expect(screen.getByRole('status')).toHaveTextContent(/waking the server/i)

    await tick(5000) // it keeps checking on its own
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('status')).toHaveTextContent(/waking the server/i)

    awake = true
    await tick(5000)
    expect(screen.getByRole('status')).toHaveTextContent('Server ok · database connected')
  })

  it('only says "unreachable" after well over a minute of trying, and still keeps checking', async () => {
    const fetchMock = vi.fn(async () => down())
    vi.stubGlobal('fetch', fetchMock)
    renderStatus()
    await tick(10)
    await tick(60_000)
    expect(screen.getByRole('status')).toHaveTextContent(/waking the server/i)

    await tick(60_000)
    expect(screen.getByRole('status')).toHaveTextContent('Server unreachable')
    const before = fetchMock.mock.calls.length
    await tick(5000)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before)
  })
})
