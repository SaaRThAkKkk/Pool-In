import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RegisterPage } from './RegisterPage'

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/full name/i), 'Asha Verma')
  await user.type(screen.getByLabelText(/^email/i), 'asha@example.com')
  await user.type(screen.getByLabelText(/mobile number/i), '9876543210')
  await user.type(screen.getByLabelText(/^password/i), 'Passw0rdOK')
}

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

afterEach(() => vi.unstubAllGlobals())

describe('RegisterPage', () => {
  it('shows validation errors and does not call the API for invalid input', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/name must be at least 2 characters/i)).toBeInTheDocument()
    expect(screen.getByText(/valid email address/i)).toBeInTheDocument()
    expect(screen.getByText(/valid 10-digit indian mobile number/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 8 characters$/i, { selector: '[role=alert]' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('submits valid data and shows a success message', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { success: true, data: { user: { id: '1', name: 'Asha Verma' } } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()
    renderPage()

    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/welcome, asha verma/i)).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/auth/register')
    expect(JSON.parse(init.body as string)).toMatchObject({ email: 'asha@example.com', gender: 'prefer_not_to_say' })
  })

  it('shows a server "email already registered" error on the email field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(409, {
          success: false,
          error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'An account with this email already exists' },
        }),
      ),
    )
    const user = userEvent.setup()
    renderPage()

    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    await waitFor(() => expect(screen.getByText(/account with this email already exists/i)).toBeInTheDocument())
    expect(screen.getByLabelText(/^email/i)).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a friendly message when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const user = userEvent.setup()
    renderPage()

    await fillValid(user)
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument()
  })
})
