import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeHero } from './HomeHero'

// Leaflet needs a real layout engine; the map itself is verified in the browser, not in jsdom.
vi.mock('./LiveMap', () => ({
  LiveMap: ({ position }: { position: { lat: number } | null }) => (
    <div data-testid="map">{position ? `map at ${position.lat}` : 'map default'}</div>
  ),
}))

function stubGeolocation(mode: 'fix' | 'denied') {
  const watchPosition = vi.fn((success: PositionCallback, error: PositionErrorCallback) => {
    if (mode === 'fix') {
      success({ coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 25 }, timestamp: 1 } as GeolocationPosition)
    } else {
      error({ code: 1, message: 'denied' } as GeolocationPositionError)
    }
    return 7
  })
  Object.defineProperty(navigator, 'geolocation', {
    value: { watchPosition, clearWatch: vi.fn() },
    configurable: true,
  })
}

function renderHero() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<HomeHero />} />
        <Route path="/pool-in" element={<p>pool in page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('HomeHero', () => {
  it('puts the live map behind the hero and centres it on the user', () => {
    stubGeolocation('fix')
    renderHero()

    expect(screen.getByText('map at 12.9716')).toBeInTheDocument()
    expect(screen.getByText(/using your current location/i)).toBeInTheDocument()
    expect(screen.getByText(/stays in your browser/i)).toBeInTheDocument()
  })

  it('explains how to recover when location is blocked, and the map still renders', () => {
    stubGeolocation('denied')
    renderHero()

    expect(screen.getByText(/location access is blocked/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByText('map default')).toBeInTheDocument()
  })

  it('works when the browser has no geolocation at all', () => {
    renderHero()
    expect(screen.getByText(/doesn't support location/i)).toBeInTheDocument()
  })
})

describe('HomeHero: the single Pool In button', () => {
  it('is the only way in: no separate create or join buttons', () => {
    stubGeolocation('fix')
    renderHero()

    expect(screen.getByRole('link', { name: /pool in/i })).toHaveAttribute('href', '/pool-in')
    expect(screen.queryByRole('link', { name: /create a pool/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /join a pool/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /join a pool/i })).not.toBeInTheDocument()
  })

  it('shows the app icon in the button', () => {
    stubGeolocation('fix')
    renderHero()

    const button = screen.getByRole('link', { name: /pool in/i })
    const icon = button.querySelector('img')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('src', '/favicon-192.png')
    expect(icon).toHaveAttribute('alt', '') // decorative: the label already says Pool In
  })

  it('takes the user to the Pool In page', async () => {
    stubGeolocation('fix')
    const u = userEvent.setup()
    renderHero()

    await u.click(screen.getByRole('link', { name: /pool in/i }))
    expect(screen.getByText('pool in page')).toBeInTheDocument()
  })
})
