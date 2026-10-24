import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from './DashboardPage'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const fail = (status: number) =>
  new Response(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } }), { status })

const user = (over: object = {}) => ({
  id: '1',
  name: 'Asha Verma',
  email: 'asha@example.com',
  phone: '+919876543210',
  gender: 'female',
  role: 'user',
  phoneVerified: false,
  verificationStatus: 'UNVERIFIED',
  createdAt: '2029-03-05T10:00:00.000Z',
  ...over,
})

const luggage = { large: 0, medium: 0, cabin: 1, backpack: 0, oversized: 0 }
const ownerPool = (id: string, dest: string) => ({
  id,
  section: 'CAR_OWNER',
  origin: { label: 'Indiranagar' },
  destination: { label: dest },
  arriveBy: '2030-01-15T04:30:00.000Z',
  luggage,
  status: 'OPEN',
  createdAt: '2029-12-01T00:00:00.000Z',
  vehicle: { category: 'SEDAN', make: 'Honda', model: 'City' },
  seats: { offered: 3, available: 3, taken: 0 },
  pricing: { amount: 250, currency: 'INR', basis: 'PER_PASSENGER', negotiable: false },
})
const cabPool = (id: string, dest: string) => ({
  id,
  section: 'CAB',
  origin: { label: 'Koramangala' },
  destination: { label: dest },
  arriveBy: '2030-02-01T08:00:00.000Z',
  luggage,
  status: 'OPEN',
  createdAt: '2029-12-02T00:00:00.000Z',
  people: 2,
})

function stub(opts: { me?: object; pools?: () => Response | Promise<Response> } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/auth/me') return ok({ user: opts.me ?? user() })
      if (url === '/api/pools/mine') return (opts.pools ?? (() => ok({ pools: [] })))()
      throw new Error(`unexpected request ${url}`)
    }),
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/verify-phone" element={<p>verify phone page</p>} />
          <Route path="/pool-in" element={<p>pool in page</p>} />
          <Route path="/pools" element={<p>my pools page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('DashboardPage: your details', () => {
  it('greets the user and shows their details', async () => {
    stub()
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: /welcome, asha verma/i })).toBeInTheDocument()
    const details = screen.getByRole('region', { name: /your details/i })
    expect(within(details).getByText('asha@example.com')).toBeInTheDocument()
    expect(within(details).getByText('+91 98765 43210')).toBeInTheDocument()
    expect(within(details).getByText('Female')).toBeInTheDocument()
    expect(within(details).getByText('March 2029')).toBeInTheDocument()
    expect(within(details).getByText('AV')).toBeInTheDocument()
  })

  it('says gender is self-declared and that identity verification is not available', async () => {
    stub()
    renderPage()
    const details = await screen.findByRole('region', { name: /your details/i })
    expect(within(details).getByText(/gender \(self-declared\)/i)).toBeInTheDocument()
    expect(within(details).getByText(/identity \(id\) verification isn't available yet/i)).toBeInTheDocument()
  })

  it.each([
    ['prefer_not_to_say', 'Prefer not to say'],
    ['male', 'Male'],
    ['other', 'Other'],
  ])('shows gender %s as "%s"', async (gender, label) => {
    stub({ me: user({ gender }) })
    renderPage()
    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('copes with a phone number in an unexpected format and a missing join date', async () => {
    stub({ me: user({ phone: '12345', createdAt: undefined }) })
    renderPage()
    const details = await screen.findByRole('region', { name: /your details/i })
    expect(within(details).getByText('12345')).toBeInTheDocument()
    expect(within(details).queryByText(/member since/i)).not.toBeInTheDocument()
  })

  it('uses a single initial for a one-word name', async () => {
    stub({ me: user({ name: 'asha' }) })
    renderPage()
    expect(await screen.findByText('A')).toBeInTheDocument()
  })
})

describe('DashboardPage: phone verification and credibility', () => {
  it('shows an unverified user a warning badge and a prominent way to verify', async () => {
    stub()
    renderPage()

    const details = await screen.findByRole('region', { name: /your details/i })
    expect(within(details).getByText(/phone not verified/i)).toBeInTheDocument()

    const card = screen.getByRole('region', { name: /phone verification/i })
    expect(within(card).getByRole('heading', { name: /verify your phone number/i })).toBeInTheDocument()
    expect(within(card).getByText(/build credibility and get ready to book rides/i)).toBeInTheDocument()
    expect(within(card).getByText(/phone verified" badge on your profile/i)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /verify my phone number/i })).toHaveAttribute('href', '/verify-phone')
  })

  it('does not claim booking is required today, only that it may be', async () => {
    stub()
    renderPage()
    const card = await screen.findByRole('region', { name: /phone verification/i })
    expect(within(card).getByText(/may require a verified number/i)).toBeInTheDocument()
    expect(within(card).queryByText(/you must|is required|required to book/i)).not.toBeInTheDocument()
  })

  it('takes the user to the verification page', async () => {
    stub()
    const u = userEvent.setup()
    renderPage()
    await u.click(await screen.findByRole('link', { name: /verify my phone number/i }))
    expect(screen.getByText('verify phone page')).toBeInTheDocument()
  })

  it('shows a verified user a badge and a confirmation, and no verify button', async () => {
    stub({ me: user({ phoneVerified: true }) })
    renderPage()

    const details = await screen.findByRole('region', { name: /your details/i })
    expect(within(details).getByText(/^phone verified$/i)).toBeInTheDocument()
    expect(within(details).queryByText(/not verified/i)).not.toBeInTheDocument()

    const card = screen.getByRole('region', { name: /phone verification/i })
    expect(within(card).getByRole('heading', { name: /your phone number is verified/i })).toBeInTheDocument()
    expect(within(card).getByText(/does not verify your identity/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /verify my phone number/i })).not.toBeInTheDocument()
  })
})

describe('DashboardPage: your pools', () => {
  it('shows a loading state, then the pools from both sections with counts', async () => {
    stub({
      // Slow on purpose so the loading state is on screen long enough to see.
      pools: async () => {
        await new Promise((r) => setTimeout(r, 150))
        return ok({ pools: [ownerPool('a', 'Airport'), cabPool('b', 'Railway Station'), ownerPool('c', 'Whitefield')] })
      },
    })
    renderPage()

    const section = await screen.findByRole('region', { name: /your pools/i })
    expect(within(section).getByText(/loading your pools/i)).toBeInTheDocument()
    expect(await within(section).findByText('Airport')).toBeInTheDocument()
    expect(within(section).getByText('Railway Station')).toBeInTheDocument()
    expect(within(section).getByText('Whitefield')).toBeInTheDocument()

    const stat = (label: string) => within(section).getByText(label).previousElementSibling!.textContent
    expect(stat('Pools in total')).toBe('3')
    expect(stat('As car owner')).toBe('2')
    expect(stat('Cab requests')).toBe('1')
    expect(within(section).getAllByText('Car owner')).toHaveLength(2)
    expect(within(section).getAllByText('Cab')).toHaveLength(1)
    expect(within(section).getByText(/matching isn't live yet/i)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: /view in my pools/i })).toHaveAttribute('href', '/pools')
  })

  it('shows only the most recent few, and links to all of them', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ownerPool(`p${i}`, `Place ${i}`))
    stub({ pools: () => ok({ pools: many }) })
    renderPage()

    const section = await screen.findByRole('region', { name: /your pools/i })
    expect(await within(section).findByText('Place 0')).toBeInTheDocument()
    expect(within(section).getByText('Place 4')).toBeInTheDocument()
    expect(within(section).queryByText('Place 5')).not.toBeInTheDocument()
    expect(within(section).getByRole('link', { name: /view all 8 pools/i })).toHaveAttribute('href', '/pools')
    expect(within(section).getByText('Pools in total').previousElementSibling!.textContent).toBe('8')
  })

  it('invites the user to pool in when they have none', async () => {
    stub()
    const u = userEvent.setup()
    renderPage()

    const section = await screen.findByRole('region', { name: /your pools/i })
    expect(await within(section).findByText(/haven't pooled in yet/i)).toBeInTheDocument()
    const links = within(section).getAllByRole('link', { name: /pool in/i })
    expect(links.every((l) => l.getAttribute('href') === '/pool-in')).toBe(true)
    await u.click(links[0]!)
    expect(screen.getByText('pool in page')).toBeInTheDocument()
  })

  it('still shows the profile when pools fail to load, with a working retry', async () => {
    const pools = vi
      .fn()
      .mockImplementationOnce(() => fail(500))
      .mockImplementationOnce(() => ok({ pools: [ownerPool('a', 'Airport')] }))
    stub({ pools })
    const u = userEvent.setup()
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: /welcome, asha verma/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /your details/i })).toBeInTheDocument()
    expect(await screen.findByText(/could not load your pools/i)).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Airport')).toBeInTheDocument()
  })
})
