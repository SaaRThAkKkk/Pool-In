import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { keepAwake } from './worker.js'

afterEach(() => vi.unstubAllGlobals())

describe('keeping the API server awake', () => {
  it('asks the API server for its health', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(await keepAwake({ API_ORIGIN: 'https://api.example.com' })).toBe('awake')
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/api/health')
  })

  it('does nothing when the API address is not set, and never throws when the server is down', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connect failed')
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await keepAwake({})).toBe('not configured')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(await keepAwake({ API_ORIGIN: 'https://api.example.com' })).toBe('unreachable')
  })

  it('reports a server that answers with an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad gateway', { status: 502 })))
    expect(await keepAwake({ API_ORIGIN: 'https://api.example.com' })).toBe('answered 502')
  })

  it('runs on the timer without blocking it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const waitUntil = vi.fn()
    await worker.scheduled({}, { API_ORIGIN: 'https://api.example.com' }, { waitUntil })
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(await waitUntil.mock.calls[0][0]).toBe('awake')
  })
})
