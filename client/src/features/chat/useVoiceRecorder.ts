import { useCallback, useEffect, useRef, useState } from 'react'
import { MAX_VOICE_MS } from './chatApi'

export type RecorderState = 'idle' | 'recording'

export interface Recording {
  blob: Blob
  durationMs: number
}

// The first recording format this browser can make (Chrome and Firefox: webm or ogg; Safari: mp4).
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
}

export const canRecord = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'

// Records one voice note at a time from the microphone. The browser asks for permission the first time, and the
// microphone is released as soon as the note is finished or cancelled. A note stops by itself at the length limit.
export function useVoiceRecorder(onFinished: (recording: Recording) => void) {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<Blob[]>([])
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const discard = useRef(false)
  const finished = useRef(onFinished)
  useEffect(() => {
    finished.current = onFinished
  })

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    recorder.current = null
    setState('idle')
    setElapsedMs(0)
  }, [])

  const stop = useCallback(() => {
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
  }, [])

  const cancel = useCallback(() => {
    discard.current = true
    stop()
  }, [stop])

  const start = useCallback(async () => {
    setError(null)
    if (!canRecord()) {
      setError("Voice notes aren't supported in this browser.")
      return
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = media
      const mimeType = pickMimeType()
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
      recorder.current = rec
      chunks.current = []
      discard.current = false

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      rec.onstop = () => {
        const durationMs = Date.now() - startedAt.current
        const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || 'audio/webm' })
        const keep = !discard.current && blob.size > 0
        release()
        if (keep) finished.current({ blob, durationMs })
      }

      startedAt.current = Date.now()
      rec.start()
      setState('recording')
      timer.current = setInterval(() => {
        const elapsed = Date.now() - startedAt.current
        setElapsedMs(elapsed)
        if (elapsed >= MAX_VOICE_MS) stop()
      }, 200)
    } catch (err) {
      release()
      setError(
        err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
          ? 'Allow microphone access in your browser to send voice notes.'
          : "We couldn't start the microphone.",
      )
    }
  }, [release, stop])

  // Leaving the page must never leave the microphone on.
  useEffect(() => {
    return () => {
      discard.current = true
      if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
      if (timer.current) clearInterval(timer.current)
    }
  }, [])

  return { state, elapsedMs, error, start, stop, cancel, supported: canRecord() }
}
