import { forward } from '../_proxy.js'

// Real-time updates (Socket.IO) go to the API server too. If this connection cannot be made, the pages still
// work: they also poll.
export const onRequest = forward
