import { useState, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { ApiError } from '../../lib/api'
import { sendSignupOtp, verifySignupOtp, type SendOtpResult } from './authApi'
import { CODE_LENGTH, otpErrorText, useCountdown } from './otpHelpers'
import { normalizeIndianPhone } from './registerSchema'

export interface PhoneProof {
  phone: string // normalised +91XXXXXXXXXX the proof was issued for
  token: string
}

interface Props {
  /** Current text in the phone field. */
  phone: string
  /** Set once the number has been verified; null otherwise. */
  proof: PhoneProof | null
  onVerified: (proof: PhoneProof) => void
  /** User wants to change a verified number. */
  onReset: () => void
}

// Lives inside the register form, so every button is type="button" and Enter never submits the form.
export function SignupPhoneVerify({ phone, proof, onVerified, onReset }: Props) {
  const normalized = normalizeIndianPhone(phone)
  const [sent, setSent] = useState<{ phone: string; result: SendOtpResult } | null>(null)
  const [code, setCode] = useState('')
  // A code sent to a number the user has since edited is no longer relevant.
  const activeSent = sent && sent.phone === normalized ? sent : null
  const secondsLeft = useCountdown(activeSent?.result.resendAvailableAt)

  const send = useMutation({
    mutationFn: sendSignupOtp,
    onSuccess: (result, phoneSent) => {
      setSent({ phone: phoneSent, result })
      setCode('')
    },
    onError: (err, phoneSent) => {
      if (err instanceof ApiError && err.code === 'OTP_RESEND_TOO_SOON') {
        const wait = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds ?? 60
        setSent({
          phone: phoneSent,
          result: {
            maskedPhone: `+91 ******${phoneSent.slice(-4)}`,
            expiresAt: '',
            resendAvailableAt: new Date(Date.now() + wait * 1000).toISOString(),
          },
        })
      }
    },
  })

  const verify = useMutation({
    mutationFn: (v: { phone: string; code: string }) => verifySignupOtp(v.phone, v.code),
    onSuccess: (data) => onVerified({ phone: data.phone, token: data.phoneProof }),
    onError: (err) => {
      if (err instanceof ApiError && ['OTP_ATTEMPTS_EXCEEDED', 'OTP_EXPIRED_OR_MISSING'].includes(err.code)) {
        setSent(null)
        setCode('')
      }
    },
  })

  const sendError = otpErrorText(send.error)
  const verifyError = otpErrorText(verify.error)
  const submitCode = () => {
    if (normalized && code.length === CODE_LENGTH) verify.mutate({ phone: normalized, code })
  }
  const onCodeKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitCode()
    }
  }

  if (proof && proof.phone === normalized) {
    return (
      <div role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 aria-hidden className="h-4 w-4" /> Phone number verified
        </p>
        <button type="button" onClick={onReset} className="mt-1 text-xs text-green-800 underline">
          Change number
        </button>
      </div>
    )
  }

  return (
    <fieldset className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <legend className="px-1 text-sm font-medium">Verify your phone number</legend>
      <p className="text-xs text-slate-600">
        Verify it now with a code by SMS, or skip this and verify later from your account. Some features may
        require a verified number.
      </p>

      {!activeSent ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => normalized && send.mutate(normalized)}
            disabled={!normalized || send.isPending}
            className="rounded-md border border-brand-600 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {send.isPending ? 'Sending…' : 'Send code'}
          </button>
          {!normalized && <span className="ml-2 text-xs text-slate-500">Enter a valid number above first.</span>}
          {sendError && (
            <p role="alert" className="mt-2 text-sm text-red-600">
              {sendError}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <label htmlFor="signup-otp" className="block text-sm">
            Code sent to <strong>{activeSent.result.maskedPhone}</strong>
          </label>
          <div className="flex gap-2">
            <input
              id="signup-otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={onCodeKeyDown}
              aria-invalid={!!verifyError}
              aria-describedby={verifyError ? 'signup-otp-error' : undefined}
              className="w-40 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-center tracking-[0.4em] aria-[invalid=true]:border-red-500"
            />
            <button
              type="button"
              onClick={submitCode}
              disabled={verify.isPending || code.length !== CODE_LENGTH}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {verify.isPending ? 'Verifying…' : 'Verify'}
            </button>
          </div>
          {verifyError && (
            <p id="signup-otp-error" role="alert" className="text-sm text-red-600">
              {verifyError}
            </p>
          )}
          <button
            type="button"
            onClick={() => normalized && send.mutate(normalized)}
            disabled={secondsLeft > 0 || send.isPending}
            className="text-xs text-brand-600 underline disabled:text-slate-400 disabled:no-underline"
          >
            {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : 'Resend code'}
          </button>
          {sendError && (
            <p role="alert" className="text-sm text-red-600">
              {sendError}
            </p>
          )}
        </div>
      )}
    </fieldset>
  )
}
