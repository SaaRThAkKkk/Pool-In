import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreatePoolPage } from './CreatePoolPage'
import { MyPoolsPage } from './MyPoolsPage'

// Leaflet needs a real layout engine; the map is checked in the browser. This stub shows what it was given.
vi.mock('../maps/RoutePreviewMap', () => ({
  RoutePreviewMap: ({ start, end, path }: { start: { label: string } | null; end: { label: string } | null; path: unknown[] | null }) => (
    <div data-testid="route-map">{`start:${start?.label ?? 'none'} end:${end?.label ?? 'none'} path:${path ? path.length : 0}`}</div>
  ),
}))

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
const fail = (status: number, code: string, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status })

const airport = { id: 'N9', title: 'Kempegowda International Airport', subtitle: 'Devanahalli, Bengaluru', label: 'Kempegowda International Airport, Devanahalli, Bengaluru', lat: 13.1986, lng: 77.7066 }
const indiranagar = { id: 'N1', title: 'Indiranagar', subtitle: 'Bengaluru, Karnataka', label: 'Indiranagar, Bengaluru, Karnataka', lat: 12.9784, lng: 77.6408 }
const route = { distanceMeters: 35214.6, durationSeconds: 2140.4, path: [[12.97, 77.64], [13.19, 77.7]] }

const createdRide = {
  id: 'r1',
  rideType: 'OWNER_VEHICLE',
  origin: { label: 'Current location' },
  destination: { label: airport.label },
  departureAt: null,
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: { offered: 3, available: 3, taken: 0 },
  pricing: { amount: 250, currency: 'INR', basis: 'PER_PASSENGER', negotiable: true },
  status: 'OPEN',
  createdAt: new Date().toISOString(),
}

type Handlers = Partial<Record<'places' | 'route' | 'create', (url: URL) => Response>>

function stubApi(handlers: Handlers = {}) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    switch (url.pathname) {
      case '/api/maps/places':
        return (handlers.places ?? (() => ok({ places: [airport, indiranagar] })))(url)
      case '/api/maps/route':
        return (handlers.route ?? (() => ok({ route })))(url)
      case '/api/rides':
        return (handlers.create ?? (() => ok({ ride: createdRide }, 201)))(url)
      case '/api/rides/mine':
        return ok({ rides: [createdRide] })
    }
    throw new Error(`unexpected request ${input}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit?][]
  return {
    fetchMock,
    posted: () => {
      const call = calls().find(([u]) => u === '/api/rides')
      return call ? JSON.parse(call[1]!.body as string) : undefined
    },
    routeCalls: () => calls().filter(([u]) => u.startsWith('/api/maps/route')).map(([u]) => new URL(u, 'http://localhost')),
    created: () => calls().some(([u]) => u === '/api/rides'),
  }
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

type User = ReturnType<typeof userEvent.setup>

const startField = () => screen.getByRole('combobox', { name: /starting location/i })
const destField = () => screen.getByRole('combobox', { name: /^destination$/i })

async function pickDestination(u: User) {
  await u.type(destField(), 'kempe')
  await u.click(await screen.findByRole('option', { name: /kempegowda/i }))
}

async function fillRest(u: User) {
  await u.selectOptions(screen.getByLabelText(/vehicle type/i), 'SEDAN')
  await u.type(screen.getByLabelText(/^make/i), 'Honda')
  await u.type(screen.getByLabelText(/^model/i), 'City')
  await u.clear(screen.getByLabelText(/seats you can offer/i))
  await u.type(screen.getByLabelText(/seats you can offer/i), '3')
  await u.type(screen.getByLabelText(/fare per passenger/i), '250')
}

const submit = (u: User) => u.click(screen.getByRole('button', { name: /create pool/i }))

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as unknown as { geolocation?: unknown }).geolocation
})

describe('CreatePoolPage: places and route', () => {
  it('starts from the live location, confirmed, with the start shown on the map', async () => {
    stubApi()
    stubGeolocation()
    renderPage()

    await waitFor(() => expect(startField()).toHaveValue('Current location'))
    expect(screen.getByText(/location confirmed/i)).toBeInTheDocument()
    expect(screen.getByTestId('route-map')).toHaveTextContent('start:Current location end:none path:0')
    expect(screen.getByText(/choose a start and a destination to preview your route/i)).toBeInTheDocument()
  })

  it('previews the route as soon as the destination is chosen', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)

    await waitFor(() => expect(screen.getByTestId('route-map')).toHaveTextContent(`end:${airport.label} path:2`))
    expect(screen.getByText(/35\.2 km · about 36 min/i)).toBeInTheDocument()
    expect(screen.getByText(/an estimate only/i)).toBeInTheDocument()

    // The start is the live location rounded to about 100 m.
    const call = api.routeCalls()[0]!
    expect(call.searchParams.get('fromLat')).toBe('12.972')
    expect(call.searchParams.get('fromLng')).toBe('77.595')
    expect(call.searchParams.get('toLat')).toBe('13.1986')
    expect(call.searchParams.get('toLng')).toBe('77.7066')
  })

  it('works without a live location: both ends are searched for', async () => {
    stubApi()
    const u = userEvent.setup()
    renderPage()

    await u.type(startField(), 'indi')
    await u.click(await screen.findByRole('option', { name: /indiranagar/i }))
    await pickDestination(u)

    await waitFor(() => expect(screen.getByTestId('route-map')).toHaveTextContent(/start:Indiranagar.*end:Kempegowda.*path:2/))
  })

  it('biases suggestions towards the user when their location is known', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await u.type(destField(), 'kempe')
    await screen.findByRole('option', { name: /kempegowda/i })

    const search = (api.fetchMock.mock.calls as unknown as [string][]).map(([x]) => new URL(x, 'http://localhost')).find((x) => x.pathname === '/api/maps/places')!
    expect(search.searchParams.get('lat')).toBe('12.972')
  })

  it('stops following the live location once the user types their own start', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await u.clear(startField())
    await u.type(startField(), 'Whitefield')

    expect(startField()).toHaveValue('Whitefield')
    expect(screen.queryByText(/location confirmed/i)).not.toBeInTheDocument()
    expect(screen.getByTestId('route-map')).toHaveTextContent('start:none')
  })

  it('removes the route again when the destination is edited', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))
    await pickDestination(u)
    await waitFor(() => expect(screen.getByTestId('route-map')).toHaveTextContent('path:2'))

    await u.type(destField(), 'x')

    expect(screen.getByTestId('route-map')).toHaveTextContent('end:none path:0')
    expect(screen.getByText(/choose a start and a destination/i)).toBeInTheDocument()
  })

  it('keeps the form usable when the route cannot be calculated, and says why', async () => {
    stubApi({ route: () => fail(422, 'NO_ROUTE', 'No driving route was found between these two places.') })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    expect(await screen.findByText(/no driving route was found/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create pool/i })).toBeEnabled()
  })

  it('shows a general message when the route service is down', async () => {
    stubApi({ route: () => fail(502, 'MAPS_UNAVAILABLE', 'down') })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    expect(await screen.findByText(/couldn't preview the route right now/i)).toBeInTheDocument()
  })

  it('requires a place from the list when search is working', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await u.type(destField(), 'somewhere I made up')
    await screen.findAllByRole('option') // search answered, so it is working
    await fillRest(u)
    await submit(u)

    expect(await screen.findByText(/choose a place from the suggestions/i)).toBeInTheDocument()
    expect(api.created()).toBe(false)
  })

  it('accepts typed text when place search is down, saving it without coordinates', async () => {
    const api = stubApi({ places: () => fail(502, 'MAPS_UNAVAILABLE', 'down') })
    const u = userEvent.setup()
    renderPage()

    await u.type(startField(), 'Indiranagar')
    expect(await screen.findByText(/place search is unavailable right now/i)).toBeInTheDocument()
    await u.type(destField(), 'Airport')
    await fillRest(u)
    await submit(u)

    await screen.findByRole('heading', { name: /my pools/i })
    expect(api.posted().origin).toEqual({ label: 'Indiranagar' })
    expect(api.posted().destination).toEqual({ label: 'Airport' })
  })
})

describe('CreatePoolPage: creating the pool', () => {
  it('saves both places with their coordinates, then shows My pools', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    await fillRest(u)
    await u.click(screen.getByLabelText(/negotiable/i))
    await submit(u)

    expect(await screen.findByRole('heading', { name: /my pools/i })).toBeInTheDocument()
    expect(screen.getByText(/your pool is created/i)).toBeInTheDocument()
    expect(api.posted()).toEqual({
      origin: { label: 'Current location', coordinates: { lat: 12.972, lng: 77.595 } },
      destination: { label: airport.label, coordinates: { lat: 13.1986, lng: 77.7066 } },
      vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
      seats: 3,
      askingPrice: 250,
      negotiable: true,
    })
  })

  it('sends a fixed fare when the negotiable box is left unticked', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    await fillRest(u)
    expect(screen.getByLabelText(/negotiable/i)).not.toBeChecked()
    await submit(u)

    await screen.findByRole('heading', { name: /my pools/i })
    expect(api.posted().negotiable).toBe(false)
  })

  it('shows every missing field and sends nothing', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await submit(u)

    expect(await screen.findByText(/enter your destination/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a vehicle type/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle make/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle model/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the number of seats/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the fare/i)).toBeInTheDocument()
    expect(api.created()).toBe(false)
  })

  it('limits seats to what the chosen vehicle can carry', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    expect(screen.getByText(/passengers you can take, not counting you/i)).toBeInTheDocument()
    await pickDestination(u)
    await fillRest(u)
    await u.selectOptions(screen.getByLabelText(/vehicle type/i), 'HATCHBACK')
    expect(screen.getByText(/up to 4 passengers for this vehicle type/i)).toBeInTheDocument()

    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await u.type(screen.getByLabelText(/seats you can offer/i), '5')
    await submit(u)

    expect(await screen.findByText(/a hatchback can offer at most 4 seats/i)).toBeInTheDocument()
    expect(api.created()).toBe(false)
  })

  it.each([
    ['a negative fare', '-5', /fare cannot be negative/i],
    ['a fare with three decimals', '10.123', /at most 2 decimal places/i],
    ['an absurdly large fare', '999999', /fare cannot exceed/i],
  ])('rejects %s', async (_label, value, message) => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    await fillRest(u)
    await u.clear(screen.getByLabelText(/fare per passenger/i))
    await u.type(screen.getByLabelText(/fare per passenger/i), value)
    await submit(u)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(api.created()).toBe(false)
  })

  it('does not ask for a departure date or time, and does not send one', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    expect(screen.queryByLabelText(/departure/i)).not.toBeInTheDocument()
    expect(document.querySelector('input[type="datetime-local"], input[type="date"]')).toBeNull()

    await pickDestination(u)
    await fillRest(u)
    await submit(u)

    await screen.findByRole('heading', { name: /my pools/i })
    expect(api.posted()).not.toHaveProperty('departureAt')
  })

  it('puts a server validation message on the matching field', async () => {
    stubApi({
      create: () =>
        fail(400, 'VALIDATION_ERROR', 'Invalid input', [
          { path: 'destination.label', message: 'Destination must be different from the starting location' },
        ]),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    await fillRest(u)
    await submit(u)

    expect(await screen.findByText(/destination must be different/i)).toBeInTheDocument()
    expect(destField()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('heading', { name: /create a pool/i })).toBeInTheDocument()
  })

  it('shows other server errors (duplicate, limits) as a message above the button', async () => {
    stubApi({ create: () => fail(409, 'DUPLICATE_RIDE', 'You already have a pool for this route at this time') })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    await fillRest(u)
    await submit(u)

    expect(await screen.findByText(/already have a pool for this route/i)).toBeInTheDocument()
  })

  it('shows a friendly message when the server is unreachable', async () => {
    const api = stubApi({ create: () => { throw new TypeError('Failed to fetch') } })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await waitFor(() => expect(startField()).toHaveValue('Current location'))

    await pickDestination(u)
    await fillRest(u)
    await submit(u)

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument()
    expect(api.created()).toBe(true)
  })

  it('reminds owners that Pool-In is for cost sharing', () => {
    stubApi()
    renderPage()
    expect(screen.getByText(/not for running a taxi service/i)).toBeInTheDocument()
  })
})
