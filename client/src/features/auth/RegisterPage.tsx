import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../../lib/api'
import { ME_KEY } from './useMe'
import { registerUser, type PublicUser } from './authApi'
import { GENDER_OPTIONS, registerSchema, type RegisterForm } from './registerSchema'

const inputClass =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 aria-[invalid=true]:border-red-500'

function Field(props: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  const { id, label, error, hint, children } = props
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export function RegisterPage() {
  const queryClient = useQueryClient()
  const [created, setCreated] = useState<PublicUser | null>(null)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { gender: 'prefer_not_to_say' },
  })

  const mutation = useMutation({
    mutationFn: registerUser,
    onSuccess: (data) => {
      queryClient.setQueryData(ME_KEY, data.user)
      setCreated(data.user)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'EMAIL_ALREADY_REGISTERED') {
        setError('email', { message: err.message })
      } else if (err instanceof ApiError && err.code === 'PHONE_ALREADY_REGISTERED') {
        setError('phone', { message: err.message })
      }
    },
  })

  if (created) {
    return (
      <div role="status" className="mx-auto max-w-md rounded-lg border border-green-200 bg-green-50 p-6">
        <h1 className="text-2xl font-bold text-green-900">Welcome, {created.name}!</h1>
        <p className="mt-2 text-sm text-green-800">
          Your account has been created. Next, confirm your phone number so other riders know it's reachable.
        </p>
        <Link
          to="/verify-phone"
          className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          Verify phone number
        </Link>
        <Link to="/" className="mt-4 ml-4 inline-block text-brand-600 underline">
          Skip for now
        </Link>
      </div>
    )
  }

  const generalError =
    mutation.error instanceof ApiError &&
    !['EMAIL_ALREADY_REGISTERED', 'PHONE_ALREADY_REGISTERED'].includes(mutation.error.code)
      ? mutation.error.message
      : mutation.error && !(mutation.error instanceof ApiError)
        ? 'Could not reach the server. Please try again.'
        : null

  const describe = (id: keyof RegisterForm, hint?: boolean) =>
    errors[id] ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-2xl font-bold">Create your account</h1>
      <form noValidate onSubmit={handleSubmit((v) => mutation.mutate(v))} className="mt-4 space-y-4">
        <Field id="name" label="Full name" error={errors.name?.message}>
          <input
            id="name"
            autoComplete="name"
            className={inputClass}
            aria-invalid={!!errors.name}
            aria-describedby={describe('name')}
            {...register('name')}
          />
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            aria-invalid={!!errors.email}
            aria-describedby={describe('email')}
            {...register('email')}
          />
        </Field>
        <Field id="phone" label="Mobile number" error={errors.phone?.message} hint="10-digit Indian mobile number">
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            className={inputClass}
            aria-invalid={!!errors.phone}
            aria-describedby={describe('phone', true)}
            {...register('phone')}
          />
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password?.message}
          hint="At least 8 characters, with a letter and a number"
        >
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            className={inputClass}
            aria-invalid={!!errors.password}
            aria-describedby={describe('password', true)}
            {...register('password')}
          />
        </Field>
        <Field
          id="gender"
          label="Gender (optional)"
          error={errors.gender?.message}
          hint="Used only for women-only pool matching. This is self-declared, not verified."
        >
          <select
            id="gender"
            className={inputClass}
            aria-describedby={describe('gender', true)}
            {...register('gender')}
          >
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>

        {generalError && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {generalError}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {mutation.isPending ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-600 underline">
            Log in
          </Link>
        </p>
      </form>
    </div>
  )
}
