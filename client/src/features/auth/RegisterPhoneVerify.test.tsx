import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RegisterPage } from './RegisterPage'

const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status })
const fail = (status: number, code: string, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status })

type Handler = (body: unknown) => Response
function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const handler = routes[url]
    if (!handler) throw new Error(`unexpected request ${url}`)
    return handler(init?.body ? JSON.parse(init.body as string) : undefined)
  })
  vi.stubGlobal('fetch', fetchMock)
  const bodyOf = (url: string) => {
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    const call = calls.find(([u]) => u === url)
    return call ? JSON.parse(call[1].body as string) : undefined
  }
  const called = (url: string) => (fetchMock.mock.calls as unknown as [string][]).some(([u]) => u === url)
  return { bodyOf, called }
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter>
        <RegisterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillRest(u: ReturnType<typeof userEvent.setup>) {
  await u.type(screen.getByLabelText(/full name/i), 'Asha Verma')
  await u.type(screen.getByLabelText(/^email/i), 'asha@example.com')
  await u.type(screen.getByLabelText(/^password/i), 'Passw0rdOK')
}

const sendResult = () =>
  ok({
    maskedPhone: '+91 ******3210',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
  })
const user = (phoneVerified: boolean) => ({ id: '1', name: 'Asha Verma', phoneVerified })

afterEach(() => vi.unstubAllGlobals())

describe('phone verification inside the register form', () => {
  it('keeps "Send code" disabled until the phone number is valid', async () => {
    mockApi({})
    const u = userEvent.setup()
    renderPage()

    const send = screen.getByRole('button', { name: /send code/i })
    expect(send).toBeDisabled()
    await u.type(screen.getByLabelText(/mobile number/i), '12345')
    expect(send).toBeDisabled()
    await u.clear(screen.getByLabelText(/mobile number/i))
    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    expect(send).toBeEnabled()
  })

  it('"verify later": registers without a proof and offers to verify afterwards', async () => {
    const api = mockApi({ '/api/auth/register': () => ok({ user: user(false) }, 201) })
    const u = userEvent.setup()
    renderPage()

    await fillRest(u)
    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    await u.click(screen.getByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/phone number is not verified yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /verify later/i })).toBeInTheDocument()
    expect(api.bodyOf('/api/auth/register')).not.toHaveProperty('phoneProof')
  })

  it('"verify now": verifies in place, locks the number, and registers with the proof', async () => {
    const api = mockApi({
      '/api/auth/phone/signup-otp/send': sendResult,
      '/api/auth/phone/signup-otp/verify': () =>
        ok({ phoneProof: 'proof-token', phone: '+919876543210', expiresInSeconds: 900 }),
      '/api/auth/register': () => ok({ user: user(true) }, 201),
    })
    const u = userEvent.setup()
    renderPage()

    await fillRest(u)
    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    await u.click(screen.getByRole('button', { name: /send code/i }))
    expect(api.bodyOf('/api/auth/phone/signup-otp/send')).toEqual({ phone: '+919876543210' })

    await u.type(await screen.findByLabelText(/code sent to/i), '123456')
    await u.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByText(/phone number verified/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/mobile number/i)).toHaveAttribute('readonly')
    expect(api.bodyOf('/api/auth/phone/signup-otp/verify')).toEqual({ phone: '+919876543210', code: '123456' })

    await u.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/your phone number is verified/i)).toBeInTheDocument()
    expect(api.bodyOf('/api/auth/register')).toMatchObject({ phoneProof: 'proof-token' })
  })

  it('pressing Enter in the code box verifies the code and does not submit the form', async () => {
    const api = mockApi({
      '/api/auth/phone/signup-otp/send': sendResult,
      '/api/auth/phone/signup-otp/verify': () =>
        ok({ phoneProof: 'proof-token', phone: '+919876543210', expiresInSeconds: 900 }),
    })
    const u = userEvent.setup()
    renderPage()

    await fillRest(u)
    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    await u.click(screen.getByRole('button', { name: /send code/i }))
    await u.type(await screen.findByLabelText(/code sent to/i), '123456{Enter}')

    expect(await screen.findByText(/phone number verified/i)).toBeInTheDocument()
    expect(api.called('/api/auth/register')).toBe(false)
  })

  it('shows remaining attempts for a wrong code', async () => {
    mockApi({
      '/api/auth/phone/signup-otp/send': sendResult,
      '/api/auth/phone/signup-otp/verify': () => fail(422, 'OTP_INVALID', 'Incorrect code', { attemptsRemaining: 4 }),
    })
    const u = userEvent.setup()
    renderPage()

    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    await u.click(screen.getByRole('button', { name: /send code/i }))
    await u.type(await screen.findByLabelText(/code sent to/i), '000000')
    await u.click(screen.getByRole('button', { name: /^verify$/i }))

    expect(await screen.findByText(/incorrect code\. 4 attempts left/i)).toBeInTheDocument()
  })

  it('tells the user when the number already has an account', async () => {
    mockApi({
      '/api/auth/phone/signup-otp/send': () =>
        fail(409, 'PHONE_ALREADY_REGISTERED', 'An account with this phone number already exists'),
    })
    const u = userEvent.setup()
    renderPage()

    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    await u.click(screen.getByRole('button', { name: /send code/i }))
    expect(await screen.findByText(/account with this phone number already exists/i)).toBeInTheDocument()
  })

  it('"Change number" unlocks the field and drops the proof', async () => {
    const api = mockApi({
      '/api/auth/phone/signup-otp/send': sendResult,
      '/api/auth/phone/signup-otp/verify': () =>
        ok({ phoneProof: 'proof-token', phone: '+919876543210', expiresInSeconds: 900 }),
      '/api/auth/register': () => ok({ user: user(false) }, 201),
    })
    const u = userEvent.setup()
    renderPage()

    await fillRest(u)
    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    await u.click(screen.getByRole('button', { name: /send code/i }))
    await u.type(await screen.findByLabelText(/code sent to/i), '123456')
    await u.click(screen.getByRole('button', { name: /^verify$/i }))
    await u.click(await screen.findByRole('button', { name: /change number/i }))

    expect(screen.getByLabelText(/mobile number/i)).not.toHaveAttribute('readonly')
    await u.click(screen.getByRole('button', { name: /create account/i }))
    await screen.findByText(/welcome/i)
    expect(api.bodyOf('/api/auth/register')).not.toHaveProperty('phoneProof')
  })

  it('drops a stale proof and explains when the server rejects it', async () => {
    mockApi({
      '/api/auth/phone/signup-otp/send': sendResult,
      '/api/auth/phone/signup-otp/verify': () =>
        ok({ phoneProof: 'proof-token', phone: '+919876543210', expiresInSeconds: 900 }),
      '/api/auth/register': () =>
        fail(400, 'INVALID_PHONE_PROOF', 'Your phone verification has expired or does not match this number. Verify the number again.'),
    })
    const u = userEvent.setup()
    renderPage()

    await fillRest(u)
    await u.type(screen.getByLabelText(/mobile number/i), '9876543210')
    await u.click(screen.getByRole('button', { name: /send code/i }))
    await u.type(await screen.findByLabelText(/code sent to/i), '123456')
    await u.click(screen.getByRole('button', { name: /^verify$/i }))
    await u.click(await screen.findByRole('button', { name: /create account/i }))

    expect(await screen.findByText(/verification has expired/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send code/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/mobile number/i)).not.toHaveAttribute('readonly')
  })
})
