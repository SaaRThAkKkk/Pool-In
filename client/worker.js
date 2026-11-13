import { forward } from './functions/_proxy.js'

// Cloudflare Worker entry point. The built site (dist/) is served as static files; only /api and /socket.io
// reach this code, and are forwarded to the API server so the browser only ever talks to this one address.
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/') || pathname.startsWith('/socket.io/')) return forward({ request, env })
    return env.ASSETS.fetch(request)
  },

  // Runs on a timer (see "triggers" in wrangler.jsonc). The API server is on free hosting that goes to sleep
  // after about 15 minutes without visitors; asking it "are you ok?" every few minutes keeps it awake, so the
  // first visitor never has to wait for it to start.
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(keepAwake(env))
  },
}

export async function keepAwake(env) {
  if (!env.API_ORIGIN) return 'not configured'
  try {
    const response = await fetch(new URL('/api/health', env.API_ORIGIN), { headers: { 'User-Agent': 'pool-in-keep-awake' } })
    return response.ok ? 'awake' : `answered ${response.status}`
  } catch {
    // Still starting up, or briefly unreachable: the next run tries again.
    return 'unreachable'
  }
}
