import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HomeHero } from './HomeHero'

// Leaflet needs a real layout engine; the map itself is verified in the browser, not in jsdom.
vi.mock('./LiveMap', () => ({
  LiveMap: ({ position }: { position: { lat: number } | null }) => (
    <div data-testid="map">{position ? `map at ${position.lat}` : 'map default'}</div>
  ),
}))

const person = { id: '1', name: 'Asha', email: 'a@x.com', phone: '+919876543210', phoneVerified: false }
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const unauthorized = () =>
  new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }), {
    status: 401,
  })

function stubSession(signedIn: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return signedIn ? ok({ user: person }) : unauthorized()
      throw new Error(`unexpected request ${url}`)
    }),
  )
}

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

function LoginProbe() {
  const location = useLocation()
  return <p>login page, from: {String((location.state as { from?: string } | null)?.from)}</p>
}

function renderHero() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<HomeHero />} />
          <Route path="/login" element={<LoginProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('HomeHero', () => {
  it('puts the live map behind the hero and centres it on the user', async () => {
    stubSession(false)
    stubGeolocation('fix')
    renderHero()

    expect(await screen.findByText('map at 12.9716')).toBeInTheDocument()
    expect(screen.getByText(/using your current location/i)).toBeInTheDocument()
    expect(screen.getByText(/stays in your browser/i)).toBeInTheDocument()
  })

  it('explains how to recover when location is blocked, and the map still renders', async () => {
    stubSession(false)
    stubGeolocation('denied')
    renderHero()

    expect(await screen.findByText(/location access is blocked/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByText('map default')).toBeInTheDocument()
  })

  it('works when the browser has no geolocation at all', async () => {
    stubSession(false)
    renderHero()
    expect(await screen.findByText(/doesn't support location/i)).toBeInTheDocument()
  })

  it('sends a signed-out visitor to log in, and remembers to come back', async () => {
    stubSession(false)
    stubGeolocation('fix')
    const u = userEvent.setup()
    renderHero()

    await u.click(await screen.findByRole('link', { name: /join a pool/i }))
    expect(await screen.findByText(/login page, from: \//i)).toBeInTheDocument()
  })

  it.each([
    ['signed-out', false],
    ['signed-in', true],
  ])('links %s visitors to the create page (the route guard handles login)', async (_label, signedIn) => {
    stubSession(signedIn)
    stubGeolocation('fix')
    renderHero()

    expect(await screen.findByRole('link', { name: /create a pool/i })).toHaveAttribute('href', '/pools/new')
  })

  it('opens the pool form for a signed-in user, starting at their current location', async () => {
    stubSession(true)
    stubGeolocation('fix')
    const u = userEvent.setup()
    renderHero()

    await u.click(await screen.findByRole('button', { name: /join a pool/i }))
    expect(screen.getByRole('form', { name: /join a pool/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^start$/i)).toHaveValue('Current location (12.9716, 77.5946)')
  })
})
