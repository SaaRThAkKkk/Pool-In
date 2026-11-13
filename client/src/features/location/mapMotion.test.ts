import L from 'leaflet'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fadeJump } from './mapMotion'

// Just enough of a Leaflet map for the transition: a container, one tile layer, and setView.
function fakeMap() {
  const container = document.createElement('div')
  const tiles = new L.TileLayer('https://example.com/{z}/{x}/{y}.png')
  const setView = vi.fn()
  const map = {
    getContainer: () => container,
    eachLayer: (fn: (layer: L.Layer) => void) => fn(tiles),
    setView,
  } as unknown as L.Map
  return { map, container, tiles, setView }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('fadeJump (moving the home map to the user without a blurry zoom)', () => {
  it('hides the map, jumps in one step with no zoom animation, and shows it once the new tiles have loaded', () => {
    const { map, container, tiles, setView } = fakeMap()
    fadeJump(map, [12.97, 77.59], 15)

    expect(container).toHaveClass('map-hidden')
    expect(setView).not.toHaveBeenCalled() // it waits for the fade-out first

    vi.advanceTimersByTime(250)
    expect(setView).toHaveBeenCalledWith([12.97, 77.59], 15, { animate: false })
    expect(container).toHaveClass('map-hidden') // still hidden while tiles load

    tiles.fire('load')
    expect(container).not.toHaveClass('map-hidden')
  })

  it('shows the map anyway after a short wait, so a slow connection never leaves it hidden', () => {
    const { map, container } = fakeMap()
    fadeJump(map, [12.97, 77.59], 15)
    vi.advanceTimersByTime(250)
    expect(container).toHaveClass('map-hidden')

    vi.advanceTimersByTime(2500)
    expect(container).not.toHaveClass('map-hidden')
  })

  it('when cancelled, shows the map again and does not move it later', () => {
    const { map, container, setView } = fakeMap()
    const cancel = fadeJump(map, [12.97, 77.59], 15)
    cancel()

    expect(container).not.toHaveClass('map-hidden')
    vi.advanceTimersByTime(5000)
    expect(setView).not.toHaveBeenCalled()
  })
})
