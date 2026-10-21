import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError } from '../../lib/api'
import { loginUser } from './authApi'
import { ME_KEY, useMe } from './useMe'

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email'),
  password: z.string().min(1, 'Enter your password'),
})
type LoginForm = z.infer<typeof loginSchema>

const inputClass =
  'field-input mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 aria-[invalid=true]:border-red-500'

// Only same-site paths set by our own redirect are honoured, so this cannot become an open redirect.
function safeRedirect(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard'
}

export function LoginPage() {
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const target = safeRedirect((location.state as { from?: unknown } | null)?.from)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) })

  const mutation = useMutation({
    mutationFn: loginUser,
    onSuccess: (data) => {
      queryClient.setQueryData(ME_KEY, data.user)
      navigate(target, { replace: true })
    },
  })

  if (me.data) return <Navigate to={target} replace />

  const error = mutation.error
  const message = !error
    ? null
    : error instanceof ApiError
      ? error.message
      : 'Could not reach the server. Please try again.'

  return (
    <div className="mx-auto max-w-md animate-pop-in rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-brand-500/10">
      <h1 className="text-2xl font-bold">Log in</h1>
      <form noValidate onSubmit={handleSubmit((v) => mutation.mutate(v))} className="mt-4 space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            className={inputClass}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'email-error' : undefined}
            {...register('email')}
          />
          {errors.email && (
            <p id="email-error" role="alert" className="mt-1 text-sm text-red-600">
              {errors.email.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            className={inputClass}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'password-error' : undefined}
            {...register('password')}
          />
          {errors.password && (
            <p id="password-error" role="alert" className="mt-1 text-sm text-red-600">
              {errors.password.message}
            </p>
          )}
        </div>

        {message && (
          <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="btn-primary w-full"
        >
          {mutation.isPending ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-center text-sm text-slate-600">
          New here?{' '}
          <Link to="/register" className="text-brand-600 underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  )
}
