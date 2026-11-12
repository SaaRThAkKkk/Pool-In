import { forward } from '../_proxy.js'

// Everything under /api goes to the API server.
export const onRequest = forward
