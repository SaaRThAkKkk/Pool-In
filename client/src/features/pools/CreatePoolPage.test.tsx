import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatePoolPage } from './CreatePoolPage'
import { MyPoolsPage } from './MyPoolsPage'

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
const fail = (status: number, code: string, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status })

const createdRide = {
  id: 'r1',
  rideType: 'OWNER_VEHICLE',
  origin: { label: 'Current location' },
  destination: { label: 'Airport' },
  departureAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: { offered: 3, available: 3, taken: 0 },
  pricing: { amount: 250, currency: 'INR', basis: 'PER_PASSENGER', negotiable: true },
  status: 'OPEN',
  createdAt: new Date().toISOString(),
}

function stubFetch(createResponse: () => Response = () => ok({ ride: createdRide }, 201)) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/rides') return createResponse()
    if (url === '/api/rides/mine') return ok({ rides: [createdRide] })
    throw new Error(`unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  const posted = () => {
    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => u === '/api/rides')
    return call ? JSON.parse(call[1].body as string) : undefined
  }
  return { fetchMock, posted }
}

function stubGeolocation() {
  const watchPosition = vi.fn((success: PositionCallback) => {
    success({ coords: { latitude: 12.9716, longitude: 77.5946, accuracy: 25 }, timestamp: 1 } as GeolocationPosition)
    return 1
  })
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch: vi.fn() }, configurable: true })
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/pools/new']}>
        <Routes>
          <Route path="/pools/new" element={<CreatePoolPage />} />
          <Route path="/pools" element={<MyPoolsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const inDays = (n: number) => format(new Date(Date.now() + n * 86_400_000), "yyyy-MM-dd'T'HH:mm")

async function fillValid(u: ReturnType<typeof userEvent.setup>, opts: { start?: string } = {}) {
  if (opts.start) await u.type(screen.getByLabelText(/starting location/i), opts.start)
  await u.type(screen.getByLabelText(/^destination/i), 'Airport')
  fireEvent.change(screen.getByLabelText(/^departure/i), { target: { value: inDays(2) } })
  await u.selectOptions(screen.getByLabelText(/vehicle type/i), 'SEDAN')
  await u.type(screen.getByLabelText(/^make/i), 'Honda')
  await u.type(screen.getByLabelText(/^model/i), 'City')
  await u.clear(screen.getByLabelText(/seats you can offer/i))
  await u.type(screen.getByLabelText(/seats you can offer/i), '3')
  await u.type(screen.getByLabelText(/fare per passenger/i), '250')
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('CreatePoolPage', () => {
  it('starts from the current location by default', () => {
    stubFetch()
    stubGeolocation()
    renderPage()

    const start = screen.getByLabelText(/starting location/i)
    expect(start).toHaveValue('Current location (12.9716, 77.5946)')
    expect(start).toHaveAttribute('readonly')
  })

  it('creates a pool with the live location as the start, then shows it in My pools', async () => {
    const { posted } = stubFetch()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await fillValid(u)
    await u.click(screen.getByLabelText(/negotiable/i))
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByRole('heading', { name: /my pools/i })).toBeInTheDocument()
    expect(screen.getByText(/your pool is created/i)).toBeInTheDocument()
    expect(await screen.findByText(/honda city/i)).toBeInTheDocument()

    expect(posted()).toEqual({
      origin: { label: 'Current location', coordinates: { lat: 12.9716, lng: 77.5946 } },
      destination: { label: 'Airport' },
      departureAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
      seats: 3,
      askingPrice: 250,
      negotiable: true,
    })
  })

  it('sends a fixed fare when the negotiable box is left unticked', async () => {
    const { posted } = stubFetch()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await fillValid(u)
    expect(screen.getByLabelText(/negotiable/i)).not.toBeChecked()
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    await screen.findByRole('heading', { name: /my pools/i })
    expect(posted().negotiable).toBe(false)
  })

  it('needs a typed start when there is no location, and sends no coordinates', async () => {
    const { posted } = stubFetch()
    const u = userEvent.setup()
    renderPage()

    expect(screen.getByLabelText(/starting location/i)).not.toHaveAttribute('readonly')
    await fillValid(u)
    await u.click(screen.getByRole('button', { name: /create pool/i }))
    expect(await screen.findByText(/enter where you are starting from/i)).toBeInTheDocument()

    await u.type(screen.getByLabelText(/starting location/i), 'Indiranagar')
    await u.click(screen.getByRole('button', { name: /create pool/i }))
    await screen.findByRole('heading', { name: /my pools/i })
    expect(posted().origin).toEqual({ label: 'Indiranagar' })
  })

  it('lets the user switch between their current location and a typed start', async () => {
    stubFetch()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await u.click(screen.getByRole('button', { name: /start somewhere else/i }))
    expect(screen.getByLabelText(/starting location/i)).not.toHaveAttribute('readonly')
    expect(screen.getByLabelText(/starting location/i)).toHaveValue('')

    await u.click(screen.getByRole('button', { name: /use my current location/i }))
    expect(screen.getByLabelText(/starting location/i)).toHaveAttribute('readonly')
  })

  it('shows every missing field and sends nothing', async () => {
    const { fetchMock } = stubFetch()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByText(/enter your destination/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a departure date and time/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a vehicle type/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle make/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle model/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the number of seats/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the fare/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits seats to what the chosen vehicle can carry', async () => {
    const { fetchMock } = stubFetch()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    expect(screen.getByText(/passengers you can take, not counting you/i)).toBeInTheDocument()
    await fillValid(u)
    await u.selectOptions(screen.getByLabelText(/vehicle type/i), 'HATCHBACK')
    expect(screen.getByText(/up to 4 passengers for this vehicle type/i)).toBeInTheDocument()

    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await u.type(screen.getByLabelText(/seats you can offer/i), '5')
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByText(/a hatchback can offer at most 4 seats/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a negative fare', '-5', /fare cannot be negative/i],
    ['a fare with three decimals', '10.123', /at most 2 decimal places/i],
    ['an absurdly large fare', '999999', /fare cannot exceed/i],
  ])('rejects %s', async (_label, value, message) => {
    const { fetchMock } = stubFetch()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await fillValid(u)
    await u.clear(screen.getByLabelText(/fare per passenger/i))
    await u.type(screen.getByLabelText(/fare per passenger/i), value)
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a departure that is too soon', async () => {
    const { fetchMock } = stubFetch()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await fillValid(u)
    fireEvent.change(screen.getByLabelText(/^departure/i), { target: { value: format(new Date(Date.now() + 60_000), "yyyy-MM-dd'T'HH:mm") } })
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByText(/at least 10 minutes from now/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('puts a server validation message on the matching field', async () => {
    stubFetch(() =>
      fail(400, 'VALIDATION_ERROR', 'Invalid input', [
        { path: 'destination.label', message: 'Destination must be different from the starting location' },
      ]),
    )
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await fillValid(u)
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByText(/destination must be different/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^destination/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('heading', { name: /create a pool/i })).toBeInTheDocument()
  })

  it('shows other server errors (duplicate, limits) as a message above the button', async () => {
    stubFetch(() => fail(409, 'DUPLICATE_RIDE', 'You already have a pool for this route at this time'))
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await fillValid(u)
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByText(/already have a pool for this route/i)).toBeInTheDocument()
  })

  it('shows a friendly message when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()

    await fillValid(u)
    await u.click(screen.getByRole('button', { name: /create pool/i }))

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument()
  })

  it('reminds owners that Pool-In is for cost sharing', () => {
    stubFetch()
    renderPage()
    expect(screen.getByText(/not for running a taxi service/i)).toBeInTheDocument()
  })
})
