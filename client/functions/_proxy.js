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

  try {
    return await fetch(new Request(target, { method: request.method, headers, body: request.body, redirect: 'manual' }))
  } catch {
    return Response.json(
      { success: false, error: { code: 'API_UNREACHABLE', message: 'The server is waking up. Please try again in a moment.' } },
      { status: 502 },
    )
  }
}
