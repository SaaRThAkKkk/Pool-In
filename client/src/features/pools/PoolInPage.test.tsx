import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { format } from 'date-fns'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PoolInPage } from './PoolInPage'

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

const emptyLuggage = { large: 0, medium: 0, cabin: 0, backpack: 0, oversized: 0 }
const matchingNone = { status: 'NOT_AVAILABLE', sections: ['CAR_OWNER', 'CAB'], matches: [] }
const ownerCreated = { outcome: 'POOL_CREATED', section: 'CAR_OWNER', pool: { id: 'p1' } }
const cabCreated = { outcome: 'REQUEST_CREATED', section: 'CAB', pool: { id: 'c1' }, matching: matchingNone }

type Handlers = Partial<Record<'places' | 'route' | 'pools', (url: URL) => Response>>

function stubApi(handlers: Handlers = {}) {
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(input, 'http://localhost')
    switch (url.pathname) {
      case '/api/maps/places':
        return (handlers.places ?? (() => ok({ places: [airport, indiranagar] })))(url)
      case '/api/maps/route':
        return (handlers.route ?? (() => ok({ route })))(url)
      case '/api/pools':
        return (handlers.pools ?? (() => ok(ownerCreated, 201)))(url)
      case '/api/pools/mine':
        return ok({ pools: [] })
    }
    throw new Error(`unexpected request ${input}`)
  })
  vi.stubGlobal('fetch', fetchMock)

  const calls = () => fetchMock.mock.calls as unknown as [string, RequestInit?][]
  return {
    fetchMock,
    posted: () => {
      const call = calls().find(([u]) => u === '/api/pools')
      return call ? JSON.parse(call[1]!.body as string) : undefined
    },
    submitted: () => calls().some(([u]) => u === '/api/pools'),
    routeCalls: () => calls().filter(([u]) => u.startsWith('/api/maps/route')).map(([u]) => new URL(u, 'http://localhost')),
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
      <MemoryRouter initialEntries={['/pool-in']}>
        <Routes>
          <Route path="/pool-in" element={<PoolInPage />} />
          <Route path="/pools" element={<p>my pools page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const inDays = (n: number) => format(new Date(Date.now() + n * 86_400_000), "yyyy-MM-dd'T'HH:mm")
type User = ReturnType<typeof userEvent.setup>

const startField = () => screen.getByRole('combobox', { name: /starting location/i })
const destField = () => screen.getByRole('combobox', { name: /^destination$/i })
const arrival = () => screen.getByLabelText(/reach the destination by/i)
const submitButton = () => document.querySelector('form button[type="submit"]') as HTMLButtonElement
const submit = (u: User) => u.click(submitButton())
const ownMode = (u: User) => u.click(screen.getByRole('radio', { name: /i own the vehicle/i }))
const cabMode = (u: User) => u.click(screen.getByRole('radio', { name: /pool a cab/i }))

async function ready() {
  await waitFor(() => expect(startField()).toHaveValue('Current location'))
}

async function pickDestination(u: User) {
  await u.type(destField(), 'kempe')
  await u.click(await screen.findByRole('option', { name: /kempegowda/i }))
}

async function fillTrip(u: User) {
  await pickDestination(u)
  fireEvent.change(arrival(), { target: { value: inDays(2) } })
}

async function fillOwner(u: User) {
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

describe('PoolInPage: the shared trip questions', () => {
  it('asks for the start (preset to the live location), destination, arrival time and luggage', async () => {
    stubApi()
    stubGeolocation()
    renderPage()
    await ready()

    expect(screen.getByRole('heading', { name: 'Pool In' })).toBeInTheDocument()
    expect(screen.getByText(/location confirmed/i)).toBeInTheDocument()
    expect(destField()).toBeInTheDocument()
    expect(arrival()).toHaveAttribute('type', 'datetime-local')
    expect(screen.getByRole('group', { name: /large suitcases/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/departure/i)).not.toBeInTheDocument()
  })

  it('shows neither the vehicle questions nor the people counter until a choice is made', async () => {
    stubApi()
    stubGeolocation()
    renderPage()
    await ready()

    expect(screen.getByRole('radio', { name: /i own the vehicle/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: /pool a cab/i })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByLabelText(/vehicle type/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/people travelling together/i)).not.toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Pool In')
  })

  it('previews the route once the destination is chosen', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await pickDestination(u)
    await waitFor(() => expect(screen.getByTestId('route-map')).toHaveTextContent(`end:${airport.label} path:2`))
    expect(screen.getByText(/35\.2 km · about 36 min/i)).toBeInTheDocument()
    expect(api.routeCalls()[0]!.searchParams.get('fromLat')).toBe('12.972')
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

  it('stops following the live location once the user types their own start', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.clear(startField())
    await u.type(startField(), 'Whitefield')
    expect(startField()).toHaveValue('Whitefield')
    expect(screen.queryByText(/location confirmed/i)).not.toBeInTheDocument()
  })
})

describe('PoolInPage: the two options change the form', () => {
  it('"I own the vehicle" asks for vehicle, seats and fare, and not for people', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await ownMode(u)

    expect(screen.getByRole('radio', { name: /i own the vehicle/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText(/vehicle type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^make/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^model/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/seats you can offer/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fare per passenger/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/negotiable/i)).not.toBeChecked()
    expect(screen.getByText(/not for running a taxi service/i)).toBeInTheDocument()
    expect(screen.queryByText(/people travelling together/i)).not.toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Create my pool')
  })

  it('"Pool a cab" asks how many people, and not for vehicle or fare', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await cabMode(u)

    expect(screen.getByText(/people travelling together/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /more people/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/vehicle type/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/fare per passenger/i)).not.toBeInTheDocument()
    expect(screen.getByText(/look for a pool that already suits your trip/i)).toBeInTheDocument()
    expect(submitButton()).toHaveTextContent('Find a pool')
  })

  it('swaps the panel when the choice changes, and keeps what was typed', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await ownMode(u)
    await u.type(screen.getByLabelText(/^make/i), 'Honda')
    await cabMode(u)
    expect(screen.queryByLabelText(/^make/i)).not.toBeInTheDocument()
    await ownMode(u)
    expect(screen.getByLabelText(/^make/i)).toHaveValue('Honda')
  })

  it('keeps the luggage and trip answers when the choice changes', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.click(screen.getByRole('button', { name: /more large suitcases/i }))
    await ownMode(u)
    await cabMode(u)
    expect(within(screen.getByRole('group', { name: /large suitcases/i })).getByRole('status')).toHaveTextContent('1')
  })

  it('asks the user to choose when they submit without choosing', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await submit(u)

    expect(await screen.findByText(/^choose how you want to pool$/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })
})

describe('PoolInPage: "I own the vehicle" -> car-owner section', () => {
  it('sends the whole trip, luggage and vehicle, and shows the result', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await u.click(screen.getByRole('button', { name: /more large suitcases/i }))
    await u.click(screen.getByRole('button', { name: /more backpacks/i }))
    await u.click(screen.getByRole('button', { name: /more backpacks/i }))
    await ownMode(u)
    await fillOwner(u)
    await u.click(screen.getByLabelText(/negotiable/i))
    await submit(u)

    expect(await screen.findByRole('heading', { name: /your pool is created/i })).toBeInTheDocument()
    expect(screen.getByText(/car owner section/i)).toBeInTheDocument()
    expect(screen.getByText(/can't search for or join pools yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view my pools/i })).toHaveAttribute('href', '/pools')

    expect(api.posted()).toEqual({
      mode: 'OWN_VEHICLE',
      origin: { label: 'Current location', coordinates: { lat: 12.972, lng: 77.595 } },
      destination: { label: airport.label, coordinates: { lat: 13.1986, lng: 77.7066 } },
      arriveBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      luggage: { ...emptyLuggage, large: 1, backpack: 2 },
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
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await submit(u)

    await screen.findByRole('heading', { name: /your pool is created/i })
    expect(api.posted().negotiable).toBe(false)
  })

  it('lets the user pool in again after a result', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await submit(u)
    await u.click(await screen.findByRole('button', { name: /pool in again/i }))

    expect(screen.getByRole('radiogroup', { name: /how do you want to pool/i })).toBeInTheDocument()
  })

  it('shows every missing owner field and sends nothing', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await ownMode(u)
    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await submit(u)

    expect(await screen.findByText(/enter your destination/i)).toBeInTheDocument()
    expect(screen.getByText(/choose when you need to arrive/i)).toBeInTheDocument()
    expect(screen.getByText(/choose a vehicle type/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle make/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the vehicle model/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the number of seats/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the fare/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('limits seats to what the chosen vehicle can carry', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await u.selectOptions(screen.getByLabelText(/vehicle type/i), 'HATCHBACK')
    expect(screen.getByText(/up to 4 passengers for this vehicle type/i)).toBeInTheDocument()
    await u.clear(screen.getByLabelText(/seats you can offer/i))
    await u.type(screen.getByLabelText(/seats you can offer/i), '5')
    await submit(u)

    expect(await screen.findByText(/a hatchback can offer at most 4 seats/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
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
    await ready()

    await fillTrip(u)
    await ownMode(u)
    await fillOwner(u)
    await u.clear(screen.getByLabelText(/fare per passenger/i))
    await u.type(screen.getByLabelText(/fare per passenger/i), value)
    await submit(u)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })
})

describe('PoolInPage: "Pool a cab" -> search, else cab section', () => {
  it('sends the trip, luggage and number of people (and no vehicle or fare)', async () => {
    const api = stubApi({ pools: () => ok(cabCreated, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await u.click(screen.getByRole('button', { name: /more cabin bags/i }))
    await cabMode(u)
    await u.click(screen.getByRole('button', { name: /more people/i }))
    await u.click(screen.getByRole('button', { name: /more people/i }))
    await submit(u)

    expect(await screen.findByRole('heading', { name: /your pool request is saved/i })).toBeInTheDocument()
    expect(api.posted()).toEqual({
      mode: 'POOL_CAB',
      origin: { label: 'Current location', coordinates: { lat: 12.972, lng: 77.595 } },
      destination: { label: airport.label, coordinates: { lat: 13.1986, lng: 77.7066 } },
      arriveBy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      luggage: { ...emptyLuggage, cabin: 1 },
      people: 3,
    })
  })

  it('does not ask for vehicle details to submit a cab request', async () => {
    const api = stubApi({ pools: () => ok(cabCreated, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await ownMode(u) // touch the owner fields and leave them empty ...
    await cabMode(u) // ... then switch: the empty owner fields must not block this submit
    await submit(u)

    await screen.findByRole('heading', { name: /your pool request is saved/i })
    expect(api.posted().mode).toBe('POOL_CAB')
    expect(api.posted().people).toBe(1)
  })

  it('is honest that matching is not available yet', async () => {
    stubApi({ pools: () => ok(cabCreated, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/pool matching isn't available yet/i)).toBeInTheDocument()
    expect(screen.getByText(/saved in the cab section/i)).toBeInTheDocument()
  })

  it('says no match was found when a search really ran', async () => {
    stubApi({ pools: () => ok({ ...cabCreated, matching: { ...matchingNone, status: 'SEARCHED' } }, 201) })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/didn't find a matching pool/i)).toBeInTheDocument()
  })

  it('shows the matches (and that nothing new was created) when a match exists', async () => {
    stubApi({
      pools: () =>
        ok({
          outcome: 'MATCHES_FOUND',
          matching: { status: 'SEARCHED', sections: ['CAR_OWNER', 'CAB'], matches: [{ id: 'a', section: 'CAR_OWNER' }, { id: 'b', section: 'CAB' }] },
        }),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByRole('heading', { name: /we found 2 matching pools/i })).toBeInTheDocument()
    expect(screen.getByText(/haven't created a new request/i)).toBeInTheDocument()
  })

  it('keeps the number of people between 1 and the maximum', async () => {
    stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await cabMode(u)
    const people = () => screen.getByText('1').closest('span')!.textContent
    await u.click(screen.getByRole('button', { name: /fewer people/i }))
    expect(people()).toBe('1')

    for (let i = 0; i < 10; i++) await u.click(screen.getByRole('button', { name: /more people/i }))
    expect(screen.getByText('6')).toBeInTheDocument()
  })
})

describe('PoolInPage: arrival time, places and errors', () => {
  it('rejects an arrival time that is too soon', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await pickDestination(u)
    fireEvent.change(arrival(), { target: { value: format(new Date(Date.now() + 60_000), "yyyy-MM-dd'T'HH:mm") } })
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/at least 10 minutes from now/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('requires a place from the list when search is working', async () => {
    const api = stubApi()
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await u.type(destField(), 'somewhere I made up')
    await screen.findAllByRole('option') // search answered, so it is working
    fireEvent.change(arrival(), { target: { value: inDays(2) } })
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/choose a place from the suggestions/i)).toBeInTheDocument()
    expect(api.submitted()).toBe(false)
  })

  it('accepts typed text when place search is down, saving it without coordinates', async () => {
    const api = stubApi({ places: () => fail(502, 'MAPS_UNAVAILABLE', 'down'), pools: () => ok(cabCreated, 201) })
    const u = userEvent.setup()
    renderPage()

    await u.type(startField(), 'Indiranagar')
    expect(await screen.findByText(/place search is unavailable right now/i)).toBeInTheDocument()
    await u.type(destField(), 'Airport')
    fireEvent.change(arrival(), { target: { value: inDays(2) } })
    await cabMode(u)
    await submit(u)

    await screen.findByRole('heading', { name: /your pool request is saved/i })
    expect(api.posted().origin).toEqual({ label: 'Indiranagar' })
    expect(api.posted().destination).toEqual({ label: 'Airport' })
  })

  it('keeps the form usable when the route cannot be calculated, and says why', async () => {
    stubApi({ route: () => fail(422, 'NO_ROUTE', 'No driving route was found between these two places.') })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await pickDestination(u)
    expect(await screen.findByText(/no driving route was found/i)).toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it('puts a server validation message on the matching field', async () => {
    stubApi({
      pools: () =>
        fail(400, 'VALIDATION_ERROR', 'Invalid input', [
          { path: 'destination.label', message: 'Destination must be different from the starting location' },
        ]),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/destination must be different/i)).toBeInTheDocument()
    expect(destField()).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a luggage problem reported by the server as a message above the button', async () => {
    stubApi({
      pools: () =>
        fail(400, 'VALIDATION_ERROR', 'Invalid input', [{ path: 'luggage.large', message: 'At most 10 of each' }]),
    })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/luggage: at most 10 of each/i)).toBeInTheDocument()
  })

  it('shows other server errors (duplicate, limits) as a message above the button', async () => {
    stubApi({ pools: () => fail(409, 'DUPLICATE_POOL', 'You already have a pool for this route and arrival time') })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/already have a pool for this route/i)).toBeInTheDocument()
  })

  it('shows a friendly message when the server is unreachable', async () => {
    stubApi({ pools: () => { throw new TypeError('Failed to fetch') } })
    stubGeolocation()
    const u = userEvent.setup()
    renderPage()
    await ready()

    await fillTrip(u)
    await cabMode(u)
    await submit(u)

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument()
  })
})
