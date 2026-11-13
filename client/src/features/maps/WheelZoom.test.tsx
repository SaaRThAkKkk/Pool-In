import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WheelZoom } from './WheelZoom'

// A stand-in for the Leaflet map: its container, its events, and the scroll-zoom switch.
const handlers: Record<string, () => void> = {}
const container = document.createElement('div')
const scrollWheelZoom = { enable: vi.fn(), disable: vi.fn() }
const map = {
  getContainer: () => container,
  on: (event: string, fn: () => void) => void (handlers[event] = fn),
  off: (event: string) => void delete handlers[event],
  scrollWheelZoom,
}
vi.mock('react-leaflet', () => ({ useMap: () => map }))

beforeEach(() => {
  scrollWheelZoom.enable.mockClear()
  scrollWheelZoom.disable.mockClear()
  container.className = ''
})

describe('WheelZoom', () => {
  it('leaves scrolling to the page until the map is clicked', () => {
    render(<WheelZoom />)
    expect(scrollWheelZoom.disable).toHaveBeenCalled()
    expect(scrollWheelZoom.enable).not.toHaveBeenCalled()
    expect(container).toHaveClass('wheel-zoom')
    expect(container).not.toHaveClass('wheel-zoom-on')
  })

  it('zooms with the scroll wheel after a click, and hands scrolling back when the pointer leaves', () => {
    render(<WheelZoom />)
    handlers.click!()
    expect(scrollWheelZoom.enable).toHaveBeenCalledTimes(1)
    expect(container).toHaveClass('wheel-zoom-on')

    scrollWheelZoom.disable.mockClear()
    handlers.mouseout!()
    expect(scrollWheelZoom.disable).toHaveBeenCalledTimes(1)
    expect(container).not.toHaveClass('wheel-zoom-on')
  })

  it('cleans up when the map goes away', () => {
    const { unmount } = render(<WheelZoom />)
    unmount()
    expect(handlers.click).toBeUndefined()
    expect(handlers.mouseout).toBeUndefined()
    expect(container).not.toHaveClass('wheel-zoom')
  })
})
