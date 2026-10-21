import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLiveLocation } from './useLiveLocation'

type Success = (p: GeolocationPosition) => void
type Failure = (e: GeolocationPositionError) => void

function stubGeolocation() {
  let onSuccess: Success = () => {}
  let onError: Failure = () => {}
  const watchPosition = vi.fn((s: Success, e: Failure) => {
    onSuccess = s
    onError = e
    return 42
  })
  const clearWatch = vi.fn()
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch }, configurable: true })
  return {
    watchPosition,
    clearWatch,
    emit: (lat: number, lng: number, accuracy = 20) =>
      onSuccess({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp: 1000 } as GeolocationPosition),
    fail: (code: number) => onError({ code, message: 'x' } as GeolocationPositionError),
  }
}

afterEach(() => {
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('useLiveLocation', () => {
  it('reports "unavailable" when the browser has no geolocation', () => {
    const { result } = renderHook(() => useLiveLocation())
    expect(result.current.status).toBe('unavailable')
    expect(result.current.position).toBeNull()
  })

  it('starts locating, then reports each position as it arrives', () => {
    const geo = stubGeolocation()
    const { result } = renderHook(() => useLiveLocation())
    expect(result.current.status).toBe('locating')
    expect(geo.watchPosition).toHaveBeenCalledTimes(1)

    act(() => geo.emit(12.9716, 77.5946, 25))
    expect(result.current.status).toBe('active')
    expect(result.current.position).toEqual({ lat: 12.9716, lng: 77.5946, accuracy: 25, timestamp: 1000 })

    act(() => geo.emit(12.98, 77.6))
    expect(result.current.position).toMatchObject({ lat: 12.98, lng: 77.6 })
  })

  it('reports "denied" when permission is refused', () => {
    const geo = stubGeolocation()
    const { result } = renderHook(() => useLiveLocation())
    act(() => geo.fail(1))
    expect(result.current.status).toBe('denied')
    expect(result.current.position).toBeNull()
  })

  it('treats a timeout as a recoverable error and keeps the last position', () => {
    const geo = stubGeolocation()
    const { result } = renderHook(() => useLiveLocation())
    act(() => geo.emit(1, 2))
    act(() => geo.fail(3))
    expect(result.current.status).toBe('error')
    expect(result.current.position).toMatchObject({ lat: 1, lng: 2 })

    act(() => geo.emit(3, 4))
    expect(result.current.status).toBe('active')
  })

  it('stops watching when unmounted', () => {
    const geo = stubGeolocation()
    const { unmount } = renderHook(() => useLiveLocation())
    unmount()
    expect(geo.clearWatch).toHaveBeenCalledWith(42)
  })

  it('retry restarts the watch', () => {
    const geo = stubGeolocation()
    const { result } = renderHook(() => useLiveLocation())
    act(() => geo.fail(1))
    expect(result.current.status).toBe('denied')

    act(() => result.current.retry())
    expect(result.current.status).toBe('locating')
    expect(geo.clearWatch).toHaveBeenCalledTimes(1)
    expect(geo.watchPosition).toHaveBeenCalledTimes(2)

    act(() => geo.emit(5, 6))
    expect(result.current.status).toBe('active')
  })
})
