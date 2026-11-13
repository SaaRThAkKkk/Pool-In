import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forward } from './_proxy.js'

const env = { API_ORIGIN: 'https://api.example.com' }
const gatewayPage = (status = 502) => new Response('<html>Bad Gateway</html>', { status, headers: { 'content-type': 'text/html' } })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const get = (path, headers = {}) => new Request(`https://site.example.com${path}`, { headers })

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Runs the proxy while moving the clock forward, so the waits between attempts do not slow the test down.
async function run(request) {
  const result = forward({ request, env })
  await vi.runAllTimersAsync()
  return result
}

describe('the API proxy', () => {
  it('forwards the path and query to the API server, with the visitor address', async () => {
    const fetchMock = vi.fn(async () => json({ success: true }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await run(get('/api/maps/places?q=indira', { 'CF-Connecting-IP': '203.0.113.9' }))

    expect(res.status).toBe(200)
    const sent = fetchMock.mock.calls[0][0]
    expect(sent.url).toBe('https://api.example.com/api/maps/places?q=indira')
    expect(sent.headers.get('X-Forwarded-For')).toBe('203.0.113.9')
  })

  it('says so when the API address is not configured', async () => {
    const res = await forward({ request: get('/api/health'), env: {} })
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('NOT_CONFIGURED')
  })

  it('waits and tries again while the server is waking, then passes on the real answer', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(gatewayPage()).mockRejectedValueOnce(new Error('connect failed')).mockResolvedValueOnce(json({ success: true, data: { status: 'ok' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await run(get('/api/health'))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res.status).toBe(200)
  })

  it('gives up with a clear message if the server never wakes', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connect failed')
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await run(get('/api/health'))

    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(res.status).toBe(502)
    expect((await res.json()).error.code).toBe('API_UNREACHABLE')
  })

  it("passes the API's own errors straight through, without waiting", async () => {
    const fetchMock = vi.fn(async () => json({ success: false, error: { code: 'MAPS_UNAVAILABLE' } }, 502))
    vi.stubGlobal('fetch', fetchMock)
    const res = await run(get('/api/maps/places?q=x'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((await res.json()).error.code).toBe('MAPS_UNAVAILABLE')
  })

  it('never repeats a request that changes data', async () => {
    const fetchMock = vi.fn(async () => gatewayPage(503))
    vi.stubGlobal('fetch', fetchMock)
    const request = new Request('https://site.example.com/api/pools', { method: 'POST', body: '{}' })
    const res = await run(request)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(503)
  })
})
