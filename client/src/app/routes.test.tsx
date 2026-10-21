import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './routes'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const unauthorized = () =>
  new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }), {
    status: 401,
  })

const person = { id: '1', name: 'Asha Verma', email: 'a@x.com', phone: '+919876543210', phoneVerified: false }

// Fake backend: `session.user` decides what /auth/me returns; logout clears it.
function mockBackend(session: { user: typeof person | null }) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/health') return ok({ status: 'ok', db: 'connected' })
    if (url === '/api/auth/me') return session.user ? ok({ user: session.user }) : unauthorized()
    if (url === '/api/auth/logout') {
      session.user = null
      return ok({})
    }
    throw new Error(`unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('public routes', () => {
  it('renders the landing page', async () => {
    mockBackend({ user: null })
    renderAt('/')
    expect(screen.getByRole('heading', { name: /share the ride/i })).toBeInTheDocument()
    expect(await screen.findByText(/database connected/i)).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', () => {
    mockBackend({ user: null })
    renderAt('/does-not-exist')
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
  })
})

describe('navigation and protected routes', () => {
  it('shows Log in and Sign up to signed-out visitors', async () => {
    mockBackend({ user: null })
    renderAt('/')
    expect(await screen.findByRole('link', { name: /^log in$/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument()
  })

  it('sends a signed-out visitor from a protected page to the login page', async () => {
    mockBackend({ user: null })
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: /^log in$/i })).toBeInTheDocument()
  })

  it('shows the dashboard, the user name and Log out to a signed-in user', async () => {
    mockBackend({ user: person })
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: /welcome, asha verma/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument()
    expect(screen.getByText(/phone number is not verified/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /verify now/i })).toHaveAttribute('href', '/verify-phone')
    expect(screen.queryByRole('link', { name: /sign up/i })).not.toBeInTheDocument()
  })

  it('redirects a signed-in user away from the login page', async () => {
    mockBackend({ user: person })
    renderAt('/login')
    expect(await screen.findByRole('heading', { name: /welcome, asha verma/i })).toBeInTheDocument()
  })

  it('logs out: calls the API, returns home, and shows signed-out links', async () => {
    const session = { user: person as typeof person | null }
    const fetchMock = mockBackend(session)
    const u = userEvent.setup()
    renderAt('/dashboard')

    await u.click(await screen.findByRole('button', { name: /log out/i }))

    expect(await screen.findByRole('heading', { name: /share the ride/i })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /^log in$/i })).toBeInTheDocument()
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit?][]
    expect(calls.some(([url, init]) => url === '/api/auth/logout' && init?.method === 'POST')).toBe(true)
  })

  it('logs out from the home page too', async () => {
    mockBackend({ user: person })
    const u = userEvent.setup()
    renderAt('/')

    await u.click(await screen.findByRole('button', { name: /log out/i }))

    expect(await screen.findByRole('link', { name: /^log in$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /log out/i })).not.toBeInTheDocument()
  })
})
