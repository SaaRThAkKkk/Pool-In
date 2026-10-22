import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlaceAutocomplete } from './PlaceAutocomplete'
import type { LatLng, Place } from './mapsApi'

const indiranagar: Place = { id: 'N1', title: 'Indiranagar', subtitle: 'Bengaluru, Karnataka', label: 'Indiranagar, Bengaluru, Karnataka', lat: 12.9784, lng: 77.6408 }
const indiraNagarLko: Place = { id: 'N2', title: 'Indira Nagar', subtitle: 'Lucknow, Uttar Pradesh', label: 'Indira Nagar, Lucknow, Uttar Pradesh', lat: 26.88, lng: 80.99 }
const here: Place = { id: 'current', title: 'My current location', subtitle: 'Use your device location', label: 'Current location', lat: 12.972, lng: 77.595 }

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const fail = (status: number) => new Response(JSON.stringify({ success: false, error: { code: 'MAPS_UNAVAILABLE', message: 'down' } }), { status })

function stubSearch(respond: (url: URL) => Response = () => ok({ places: [indiranagar, indiraNagarLko] })) {
  const fetchMock = vi.fn(async (url: string) => respond(new URL(url, 'http://localhost')))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const searchUrls = (fetchMock: ReturnType<typeof stubSearch>) => (fetchMock.mock.calls as unknown as [string][]).map(([u]) => new URL(u, 'http://localhost'))

function Harness(props: { bias?: LatLng | null; currentLocation?: Place | null; onSelect?: (p: Place) => void; onServiceStatus?: (down: boolean) => void; initial?: string }) {
  const [text, setText] = useState(props.initial ?? '')
  const [selected, setSelected] = useState<Place | null>(null)
  return (
    <PlaceAutocomplete
      id="dest"
      label="Destination"
      text={text}
      onTextChange={(t) => {
        setText(t)
        if (selected && t !== selected.label) setSelected(null)
      }}
      selected={selected}
      onSelect={(p) => {
        setSelected(p)
        props.onSelect?.(p)
      }}      bias={props.bias}
      currentLocation={props.currentLocation}
      onServiceStatus={props.onServiceStatus}
    />
  )
}

function renderHarness(props: Parameters<typeof Harness>[0] = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness {...props} />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('PlaceAutocomplete', () => {
  it('does not search until two characters are typed', async () => {
    const fetchMock = stubSearch()
    const u = userEvent.setup()
    renderHarness()

    await u.type(screen.getByRole('combobox', { name: /destination/i }), 'i')
    expect(await screen.findByText(/keep typing/i)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 450))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('suggests matching places, with the typed letters in bold and the area underneath', async () => {
    stubSearch()
    const u = userEvent.setup()
    renderHarness()

    await u.type(screen.getByRole('combobox'), 'indi')
    const options = await screen.findAllByRole('option')

    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Indiranagar')
    expect(options[0]).toHaveTextContent('Bengaluru, Karnataka')
    expect(options[0]!.querySelector('strong')).toHaveTextContent('Indi')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')
  })

  it('waits for a pause in typing and sends one request, near the user', async () => {
    const fetchMock = stubSearch()
    const u = userEvent.setup()
    renderHarness({ bias: { lat: 12.972, lng: 77.595 } })

    await u.type(screen.getByRole('combobox'), 'indira')
    await screen.findAllByRole('option')

    const urls = searchUrls(fetchMock)
    expect(urls).toHaveLength(1)
    expect(urls[0]!.pathname).toBe('/api/maps/places')
    expect(urls[0]!.searchParams.get('q')).toBe('indira')
    expect(urls[0]!.searchParams.get('lat')).toBe('12.972')
    expect(urls[0]!.searchParams.get('lng')).toBe('77.595')
  })

  it('selects a place with the mouse and confirms it', async () => {
    stubSearch()
    const onSelect = vi.fn()
    const u = userEvent.setup()
    renderHarness({ onSelect })

    await u.type(screen.getByRole('combobox'), 'indi')
    await u.click(await screen.findByRole('option', { name: /indiranagar/i }))

    expect(onSelect).toHaveBeenCalledWith(indiranagar)
    expect(screen.getByRole('combobox')).toHaveValue('Indiranagar, Bengaluru, Karnataka')
    expect(screen.getByText(/location confirmed/i)).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('works from the keyboard: arrows to move, Enter to choose, Escape to close', async () => {
    stubSearch()
    const onSelect = vi.fn()
    const u = userEvent.setup()
    renderHarness({ onSelect })

    await u.type(screen.getByRole('combobox'), 'indi')
    await screen.findAllByRole('option')

    await u.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    await u.keyboard('{ArrowUp}{Enter}')
    expect(onSelect).toHaveBeenCalledWith(indiranagar)

    await u.clear(screen.getByRole('combobox'))
    await u.type(screen.getByRole('combobox'), 'indi')
    await screen.findAllByRole('option')
    await u.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('drops the confirmation when the text is edited after choosing', async () => {
    stubSearch()
    const u = userEvent.setup()
    renderHarness()

    await u.type(screen.getByRole('combobox'), 'indi')
    await u.click(await screen.findByRole('option', { name: /indiranagar/i }))
    expect(screen.getByText(/location confirmed/i)).toBeInTheDocument()

    await u.type(screen.getByRole('combobox'), 'x')
    expect(screen.queryByText(/location confirmed/i)).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    stubSearch(() => ok({ places: [] }))
    const u = userEvent.setup()
    renderHarness()

    await u.type(screen.getByRole('combobox'), 'zzzz')
    expect(await screen.findByText(/no places found for “zzzz”/i)).toBeInTheDocument()
  })

  it('reports a search outage so the form can fall back to typed text, and recovers', async () => {
    let down = true
    stubSearch(() => (down ? fail(502) : ok({ places: [indiranagar] })))
    const onServiceStatus = vi.fn()
    const u = userEvent.setup()
    renderHarness({ onServiceStatus })

    await u.type(screen.getByRole('combobox'), 'indi')
    expect(await screen.findByText(/place search is unavailable right now/i)).toBeInTheDocument()
    expect(onServiceStatus).toHaveBeenLastCalledWith(true)

    down = false
    await u.type(screen.getByRole('combobox'), 'r')
    expect(await screen.findByRole('option', { name: /indiranagar/i })).toBeInTheDocument()
    await waitFor(() => expect(onServiceStatus).toHaveBeenLastCalledWith(false))
  })

  it('offers "my current location" first when the field is empty, and selects it', async () => {
    const fetchMock = stubSearch()
    const onSelect = vi.fn()
    const u = userEvent.setup()
    renderHarness({ currentLocation: here, onSelect })

    await u.click(screen.getByRole('combobox'))
    const option = await screen.findByRole('option', { name: /my current location/i })
    await u.click(option)

    expect(onSelect).toHaveBeenCalledWith(here)
    expect(screen.getByRole('combobox')).toHaveValue('Current location')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not offer the current location once something else is typed', async () => {
    stubSearch()
    const u = userEvent.setup()
    renderHarness({ currentLocation: here })

    await u.type(screen.getByRole('combobox'), 'indi')
    await screen.findByRole('option', { name: /indiranagar/i })
    expect(screen.queryByRole('option', { name: /my current location/i })).not.toBeInTheDocument()
  })
})
