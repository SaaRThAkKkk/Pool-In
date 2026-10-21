import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../../app/routes'

const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const fail = (status: number, code: string, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status })
const person = { id: '1', name: 'Asha Verma', email: 'a@x.com', phone: '+919876543210', phoneVerified: true }

function mockBackend(loginResponse: () => Response) {
  let signedIn = false
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/auth/me') {
      return signedIn ? ok({ user: person }) : fail(401, 'UNAUTHORIZED', 'Authentication required')
    }
    if (url === '/api/auth/login') {
      const res = loginResponse()
      if (res.ok) signedIn = true
      return res
    }
    if (url === '/api/health') return ok({ status: 'ok', db: 'connected' })
    throw new Error(`unexpected request ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderAt(entry: string | { pathname: string; state?: unknown }) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillAndSubmit(u: ReturnType<typeof userEvent.setup>) {
  await u.type(await screen.findByLabelText(/^email/i), 'a@x.com')
  await u.type(screen.getByLabelText(/^password/i), 'Passw0rdOK')
  await u.click(screen.getByRole('button', { name: /^log in$/i }))
}

afterEach(() => vi.unstubAllGlobals())

describe('LoginPage', () => {
  it('requires both fields and does not call the API when empty', async () => {
    const fetchMock = mockBackend(() => ok({ user: person }))
    const u = userEvent.setup()
    renderAt('/login')

    await u.click(await screen.findByRole('button', { name: /^log in$/i }))
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument()
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument()
    expect((fetchMock.mock.calls as unknown as [string][]).some(([url]) => url === '/api/auth/login')).toBe(false)
  })

  it('logs in and lands on the dashboard', async () => {
    mockBackend(() => ok({ user: person }))
    const u = userEvent.setup()
    renderAt('/login')

    await fillAndSubmit(u)
    expect(await screen.findByRole('heading', { name: /welcome, asha verma/i })).toBeInTheDocument()
  })

  it('returns to the page the user originally asked for', async () => {
    mockBackend(() => ok({ user: person }))
    const u = userEvent.setup()
    renderAt({ pathname: '/login', state: { from: '/verify-phone' } })

    await fillAndSubmit(u)
    expect(await screen.findByRole('heading', { name: /phone verified/i })).toBeInTheDocument()
  })

  it('ignores an external redirect target', async () => {
    mockBackend(() => ok({ user: person }))
    const u = userEvent.setup()
    renderAt({ pathname: '/login', state: { from: '//evil.example/steal' } })

    await fillAndSubmit(u)
    expect(await screen.findByRole('heading', { name: /welcome, asha verma/i })).toBeInTheDocument()
  })

  it('shows the server message for wrong credentials', async () => {
    mockBackend(() => fail(401, 'INVALID_CREDENTIALS', 'Incorrect email or password'))
    const u = userEvent.setup()
    renderAt('/login')

    await fillAndSubmit(u)
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^log in$/i })).toBeInTheDocument()
  })

  it('tells the user when the account is temporarily locked', async () => {
    mockBackend(() =>
      fail(429, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed attempts. Try again in a few minutes.', {
        retryAfterSeconds: 600,
      }),
    )
    const u = userEvent.setup()
    renderAt('/login')

    await fillAndSubmit(u)
    expect(await screen.findByText(/too many failed attempts/i)).toBeInTheDocument()
  })

  it('shows a friendly message when the server is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/me') return fail(401, 'UNAUTHORIZED', 'Authentication required')
        throw new TypeError('Failed to fetch')
      }),
    )
    const u = userEvent.setup()
    renderAt('/login')

    await fillAndSubmit(u)
    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument()
  })
})
