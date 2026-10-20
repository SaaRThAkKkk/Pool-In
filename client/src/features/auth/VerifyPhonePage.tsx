import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { sendPhoneOtp, verifyPhoneOtp, type SendOtpResult } from './authApi'
import { ME_KEY, useMe } from './useMe'

const CODE_LENGTH = 6

function useCountdown(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [until])
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000)) : 0
}

function errorText(err: unknown): string | null {
  if (!err) return null
  if (err instanceof ApiError) {
    const remaining = (err.details as { attemptsRemaining?: number } | undefined)?.attemptsRemaining
    return remaining !== undefined ? `${err.message}. ${remaining} attempt${remaining === 1 ? '' : 's'} left.` : err.message
  }
  return 'Could not reach the server. Please try again.'
}

export function VerifyPhonePage() {
  const queryClient = useQueryClient()
  const me = useMe()
  const [sent, setSent] = useState<SendOtpResult | null>(null)
  const [code, setCode] = useState('')
  const secondsLeft = useCountdown(sent?.resendAvailableAt)

  const send = useMutation({
    mutationFn: sendPhoneOtp,
    onSuccess: (result) => {
      setSent(result)
      setCode('')
    },
    onError: (err) => {
      // Cooldown still running from an earlier send: show the input and the real remaining wait.
      if (err instanceof ApiError && err.code === 'OTP_RESEND_TOO_SOON') {
        const wait = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60
        setSent((prev) => ({
          maskedPhone: prev?.maskedPhone ?? me.data?.phone ?? '',
          expiresAt: prev?.expiresAt ?? '',
          resendAvailableAt: new Date(Date.now() + wait * 1000).toISOString(),
        }))
      }
    },
  })

  const verify = useMutation({
    mutationFn: verifyPhoneOtp,
    onSuccess: (data) => queryClient.setQueryData(ME_KEY, data.user),
    onError: (err) => {
      if (err instanceof ApiError && ['OTP_ATTEMPTS_EXCEEDED', 'OTP_EXPIRED_OR_MISSING'].includes(err.code)) {
        setSent(null)
        setCode('')
      }
    },
  })

  if (me.isPending) return <p role="status">Loading…</p>
  if (me.isError) return <p role="alert">Could not load your account. Please refresh.</p>

  if (!me.data) {
    return (
      <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6">
        <h1 className="text-2xl font-bold">Verify your phone</h1>
        <p className="mt-2 text-sm text-slate-600">You need to be signed in to verify your phone number.</p>
        <Link to="/register" className="mt-4 inline-block text-brand-600 underline">
          Create an account
        </Link>
      </div>
    )
  }

  if (me.data.phoneVerified) {
    return (
      <div role="status" className="mx-auto max-w-md rounded-lg border border-green-200 bg-green-50 p-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-green-900">
          <CheckCircle2 aria-hidden className="h-6 w-6" /> Phone verified
        </h1>
        <p className="mt-2 text-sm text-green-800">
          We confirmed you can receive messages on {me.data.phone}. This does not verify your identity.
        </p>
        <Link to="/" className="mt-4 inline-block text-brand-600 underline">
          Go to home
        </Link>
      </div>
    )
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    verify.mutate(code)
  }
  const sendError = errorText(send.error)
  const verifyError = errorText(verify.error)

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-2xl font-bold">Verify your phone</h1>
      <p className="mt-2 text-sm text-slate-600">
        We'll text a {CODE_LENGTH}-digit code to <strong>{sent?.maskedPhone || me.data.phone}</strong> to confirm the
        number is yours.
      </p>

      {!sent ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={send.isPending}
            className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {send.isPending ? 'Sending…' : 'Send code'}
          </button>
          {sendError && (
            <p role="alert" className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {sendError}
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="otp" className="block text-sm font-medium">
              Enter the code
            </label>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              pattern={`\\d{${CODE_LENGTH}}`}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-invalid={!!verifyError}
              aria-describedby={verifyError ? 'otp-error' : undefined}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-center text-xl tracking-[0.5em] aria-[invalid=true]:border-red-500"
            />
            {verifyError && (
              <p id="otp-error" role="alert" className="mt-1 text-sm text-red-600">
                {verifyError}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={verify.isPending || code.length !== CODE_LENGTH}
            className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {verify.isPending ? 'Verifying…' : 'Verify'}
          </button>
          <div className="text-center text-sm">
            <button
              type="button"
              onClick={() => send.mutate()}
              disabled={secondsLeft > 0 || send.isPending}
              className="text-brand-600 underline disabled:text-slate-400 disabled:no-underline"
            >
              {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
            </button>
            {sendError && (
              <p role="alert" className="mt-2 text-red-600">
                {sendError}
              </p>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
