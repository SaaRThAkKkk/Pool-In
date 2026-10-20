import { api, ApiError } from '../../lib/api'
import type { RegisterForm } from './registerSchema'

export interface PublicUser {
  id: string
  name: string
  email: string
  phone: string
  gender: string
  role: string
  phoneVerified: boolean
  verificationStatus: string
}

export interface SendOtpResult {
  maskedPhone: string
  expiresAt: string
  resendAvailableAt: string
}

export function registerUser(input: RegisterForm) {
  return api<{ user: PublicUser }>('/auth/register', { method: 'POST', body: JSON.stringify(input) })
}

// Resolves to null when not signed in, so callers can distinguish "logged out" from a real error.
export async function fetchMe(): Promise<PublicUser | null> {
  try {
    return (await api<{ user: PublicUser }>('/auth/me')).user
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null
    throw err
  }
}

export function sendPhoneOtp() {
  return api<SendOtpResult>('/auth/phone/send-otp', { method: 'POST' })
}

export function verifyPhoneOtp(code: string) {
  return api<{ user: PublicUser }>('/auth/phone/verify-otp', { method: 'POST', body: JSON.stringify({ code }) })
}
