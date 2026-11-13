// Cloudflare Pages Function helper: forwards a request to the API server, so the browser only ever talks to this
// site. That keeps the login cookie first-party (same address as the pages), which browsers require.
// API_ORIGIN is set in the Cloudflare Pages project settings, e.g. https://pool-in-api.onrender.com
export async function forward({ request, env }) {
  if (!env.API_ORIGIN) {
    return Response.json(
      { success: false, error: { code: 'NOT_CONFIGURED', message: 'The API address is not configured.' } },
      { status: 502 },
    )
  }

  const incoming = new URL(request.url)
  const target = new URL(incoming.pathname + incoming.search, env.API_ORIGIN)

  const headers = new Headers(request.headers)
  // Tell the server who the visitor is (for rate limiting); Cloudflare supplies the real address.
  const visitor = request.headers.get('CF-Connecting-IP')
  if (visitor) headers.set('X-Forwarded-For', visitor)
  headers.set('X-Forwarded-Host', incoming.host)

  // A sleeping server (free hosting) answers with a gateway error, or not at all, while it wakes up. Reads are
  // safe to repeat, so wait and try again a few times; anything that changes data is sent exactly once.
  const repeatable = request.method === 'GET' || request.method === 'HEAD'
  const attempts = repeatable ? WAKE_ATTEMPTS : 1

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: request.body,
          redirect: 'manual',
          // Required by the standard whenever a body is passed on as a stream.
          ...(request.body ? { duplex: 'half' } : {}),
        }),
      )
      // The API's own errors are JSON (e.g. "maps unavailable") and are passed on as they are. Only the hosting
      // platform's gateway pages, which are not JSON, mean "still waking".
      const fromApi = (response.headers.get('content-type') ?? '').includes('application/json')
      if (fromApi || !WAKING_STATUSES.has(response.status) || attempt === attempts) return response
    } catch {
      // Could not connect at all: treated like "still waking".
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, WAKE_WAIT_MS))
  }

  return Response.json(
    { success: false, error: { code: 'API_UNREACHABLE', message: 'The server is waking up. Please try again in a moment.' } },
    { status: 502 },
  )
}

const WAKING_STATUSES = new Set([502, 503, 504])
const WAKE_ATTEMPTS = 5
const WAKE_WAIT_MS = 8000
