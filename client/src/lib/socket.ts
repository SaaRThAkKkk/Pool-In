import { useEffect, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

// Real-time updates from the server. The browser's login cookie authenticates the connection (same origin, via
// the dev proxy or in production), so nothing needs to be passed in. If the connection fails the page still works:
// everything that uses this also polls, so a missed push only means seeing an update a few seconds later.
export function useServerEvent(event: string, onEvent: (payload: unknown) => void, enabled = true) {
  // Keep the latest handler without reconnecting every render.
  const handler = useRef(onEvent)
  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    let socket: Socket | undefined
    try {
      socket = io({ withCredentials: true, reconnectionAttempts: 5 })
      socket.on(event, (payload: unknown) => handler.current(payload))
      socket.on('connect_error', () => {
        // Not signed in, or the server is unreachable: stay quiet and rely on polling.
      })
    } catch {
      // Some environments cannot open a socket at all; polling still works.
    }
    return () => {
      socket?.off(event)
      socket?.disconnect()
    }
  }, [event, enabled])
}
