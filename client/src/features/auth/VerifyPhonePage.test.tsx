import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VerifyPhonePage } from './VerifyPhonePage'

const user = { id: '1', name: 'Asha', email: 'a@x.com', phone: '+919876543210', phoneVerified: false }
const ok = (data: unknown) => new Response(JSON.stringify({ success: true, data }))
const fail = (status: number, code: string, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status })

function mockApi(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (url: string) => {
    const handler = routes[url]
    if (!handler) throw new Error(`unexpected request ${url}`)
    return handler()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter>
        <VerifyPhonePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const sendResult = () =>
  ok({
    maskedPhone: '+91 ******3210',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  })

afterEach(() => vi.unstubAllGlobals())

describe('VerifyPhonePage', () => {
  it('asks signed-out visitors to sign in', async () => {
    mockApi({ '/api/auth/me': () => fail(401, 'UNAUTHORIZED', 'Authentication required') })
    renderPage()
    expect(await screen.findByText(/need to be signed in/i)).toBeInTheDocument()
  })

  it('shows the verified state without offering to send a code', async () => {
    mockApi({ '/api/auth/me': () => ok({ user: { ...user, phoneVerified: true } }) })
    renderPage()
    expect(await screen.findByRole('heading', { name: /phone verified/i })).toBeInTheDocument()
    expect(screen.getByText(/does not verify your identity/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send code/i })).not.toBeInTheDocument()
  })

  it('sends a code, then verifies it', async () => {
    const u = userEvent.setup()
    const fetchMock = mockApi({
      '/api/auth/me': () => ok({ user }),
      '/api/auth/phone/send-otp': sendResult,
      '/api/auth/phone/verify-otp': () => ok({ user: { ...user, phoneVerified: true } }),
    })
    renderPage()

    await u.click(await screen.findByRole('button', { name: /send code/i }))
    expect(await screen.findByText('+91 ******3210')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend code in/i })).toBeDisabled()

    const verifyBtn = screen.getByRole('button', { name: /^verify$/i })
    expect(verifyBtn).toBeDisabled()
    await u.type(screen.getByLabelText(/enter the code/i), '12ab3456')
    expect(screen.getByLabelText(/enter the code/i)).toHaveValue('123456')
    await u.click(verifyBtn)

    expect(await screen.findByRole('heading', { name: /phone verified/i })).toBeInTheDocument()
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const verifyCall = calls.find(([url]) => url === '/api/auth/phone/verify-otp')!
    expect(JSON.parse(verifyCall[1].body as string)).toEqual({ code: '123456' })
  })

  it('shows remaining attempts after a wrong code', async () => {
    const u = userEvent.setup()
    mockApi({
      '/api/auth/me': () => ok({ user }),
      '/api/auth/phone/send-otp': sendResult,
      '/api/auth/phone/verify-otp': () => fail(422, 'OTP_INVALID', 'Incorrect code', { attemptsRemaining: 4 }),
    })
    renderPage()

    await u.click(await screen.findByRole('button', { name: /send code/i }))
    await u.type(await screen.findByLabelText(/enter the code/i), '000000')
    await u.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByText(/incorrect code\. 4 attempts left/i)).toBeInTheDocument()
  })

  it('returns to "send code" when the code is locked after too many attempts', async () => {
    const u = userEvent.setup()
    mockApi({
      '/api/auth/me': () => ok({ user }),
      '/api/auth/phone/send-otp': sendResult,
      '/api/auth/phone/verify-otp': () => fail(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Request a new code.'),
    })
    renderPage()

    await u.click(await screen.findByRole('button', { name: /send code/i }))
    await u.type(await screen.findByLabelText(/enter the code/i), '000000')
    await u.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByRole('button', { name: /send code/i })).toBeInTheDocument()
  })

  it('reports a delivery failure from the server', async () => {
    const u = userEvent.setup()
    mockApi({
      '/api/auth/me': () => ok({ user }),
      '/api/auth/phone/send-otp': () => fail(502, 'SMS_DELIVERY_FAILED', 'We could not send the code. Please try again shortly.'),
    })
    renderPage()

    await u.click(await screen.findByRole('button', { name: /send code/i }))
    expect(await screen.findByText(/could not send the code/i)).toBeInTheDocument()
  })
})
