import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceRecorder } from './useVoiceRecorder'

// A stand-in for the browser's MediaRecorder that produces one chunk of audio when stopped.
class FakeRecorder {
  static instances: FakeRecorder[] = []
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus'
  state: 'inactive' | 'recording' = 'inactive'
  mimeType: string
  stream: MediaStream
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(stream: MediaStream, opts?: { mimeType?: string }) {
    this.stream = stream
    this.mimeType = opts?.mimeType ?? ''
    FakeRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType || 'audio/webm' }) })
    this.onstop?.()
  }
}

const track = { stop: vi.fn() }
const getUserMedia = vi.fn()

beforeEach(() => {
  FakeRecorder.instances = []
  track.stop.mockReset()
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] })
  vi.stubGlobal('MediaRecorder', FakeRecorder)
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices
})

describe('useVoiceRecorder', () => {
  it('records, then hands over the audio and how long it was, and lets go of the microphone', async () => {
    const done = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder(done))
    expect(result.current.supported).toBe(true)

    await act(() => result.current.start())
    expect(result.current.state).toBe('recording')
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(FakeRecorder.instances[0]!.mimeType).toBe('audio/webm;codecs=opus') // the first format the browser supports

    act(() => result.current.stop())
    expect(done).toHaveBeenCalledTimes(1)
    const { blob, durationMs } = done.mock.calls[0]![0] as { blob: Blob; durationMs: number }
    expect(blob.size).toBeGreaterThan(0)
    expect(blob.type).toBe('audio/webm;codecs=opus')
    expect(durationMs).toBeGreaterThanOrEqual(0)
    expect(track.stop).toHaveBeenCalled() // the microphone is released
    expect(result.current.state).toBe('idle')
  })

  it('throws the recording away on cancel, and still releases the microphone', async () => {
    const done = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder(done))
    await act(() => result.current.start())

    act(() => result.current.cancel())
    expect(done).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('explains when the microphone is blocked', async () => {
    getUserMedia.mockRejectedValue(new DOMException('no', 'NotAllowedError'))
    const { result } = renderHook(() => useVoiceRecorder(vi.fn()))
    await act(() => result.current.start())
    expect(result.current.state).toBe('idle')
    expect(result.current.error).toMatch(/allow microphone access/i)
  })

  it('explains other microphone failures too', async () => {
    getUserMedia.mockRejectedValue(new Error('device busy'))
    const { result } = renderHook(() => useVoiceRecorder(vi.fn()))
    await act(() => result.current.start())
    expect(result.current.error).toMatch(/couldn't start the microphone/i)
  })

  it('says it is unsupported when the browser cannot record', async () => {
    vi.unstubAllGlobals()
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices
    const { result } = renderHook(() => useVoiceRecorder(vi.fn()))
    expect(result.current.supported).toBe(false)
    await act(() => result.current.start())
    expect(result.current.error).toMatch(/aren't supported/i)
  })

  it('turns the microphone off if the person leaves the page mid-recording', async () => {
    const done = vi.fn()
    const { result, unmount } = renderHook(() => useVoiceRecorder(done))
    await act(() => result.current.start())
    unmount()
    expect(track.stop).toHaveBeenCalled()
    await waitFor(() => expect(done).not.toHaveBeenCalled())
  })

  it('keeps counting the time while recording', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useVoiceRecorder(vi.fn()))
      await act(async () => {
        await result.current.start()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100)
      })
      expect(result.current.elapsedMs).toBeGreaterThanOrEqual(2000)
    } finally {
      vi.useRealTimers()
    }
  })
})
