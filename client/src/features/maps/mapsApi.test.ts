import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchRoute, formatDistance, formatDuration, searchPlaces } from './mapsApi'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
afterEach(() => vi.unstubAllGlobals())

describe('formatDistance', () => {
  it.each([
    [450, '450 m'],
    [999.4, '999 m'],
    [1000, '1.0 km'],
    [35214.6, '35.2 km'],
  ])('%s m -> %s', (meters, expected) => expect(formatDistance(meters)).toBe(expected))
})

describe('formatDuration', () => {
  it.each([
    [10, '1 min'],
    [2140.4, '36 min'],
    [3600, '1 h'],
    [5400, '1 h 30 min'],
    [7260, '2 h 1 min'],
  ])('%s s -> %s', (seconds, expected) => expect(formatDuration(seconds)).toBe(expected))
})

describe('maps API calls', () => {
  it('searchPlaces sends the text, and the bias only when given', async () => {
    const fetchMock = vi.fn(async () => ok({ places: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchPlaces('indira nagar')
    await searchPlaces('mall', { lat: 12.9, lng: 77.5 })

    const urls = (fetchMock.mock.calls as unknown as [string][]).map(([u]) => u)
    expect(urls[0]).toBe('/api/maps/places?q=indira+nagar')
    expect(urls[1]).toBe('/api/maps/places?q=mall&lat=12.9&lng=77.5')
  })

  it('fetchRoute sends both ends', async () => {
    const fetchMock = vi.fn(async () => ok({ route: { distanceMeters: 1, durationSeconds: 2, path: [] } }))
    vi.stubGlobal('fetch', fetchMock)

    const route = await fetchRoute({ lat: 1, lng: 2 }, { lat: 3, lng: 4 })
    expect(route).toEqual({ distanceMeters: 1, durationSeconds: 2, path: [] })
    expect((fetchMock.mock.calls as unknown as [string][])[0]![0]).toBe('/api/maps/route?fromLat=1&fromLng=2&toLat=3&toLng=4')
  })
})
