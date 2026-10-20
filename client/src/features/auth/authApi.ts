import { api } from '../../lib/api'
import type { RegisterForm } from './registerSchema'

export interface PublicUser {
  id: string
  name: string
  email: string
  phone: string
  gender: string
  role: string
  verificationStatus: string
}

export function registerUser(input: RegisterForm) {
  return api<{ user: PublicUser }>('/auth/register', { method: 'POST', body: JSON.stringify(input) })
}
