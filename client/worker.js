import { forward } from './functions/_proxy.js'

// Cloudflare Worker entry point. The built site (dist/) is served as static files; only /api and /socket.io
// reach this code, and are forwarded to the API server so the browser only ever talks to this one address.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/') || pathname.startsWith('/socket.io/')) return forward({ request, env })
    return env.ASSETS.fetch(request)
  },
}
