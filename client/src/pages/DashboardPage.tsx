import { Link } from 'react-router-dom'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { useMe } from '../features/auth/useMe'

export function DashboardPage() {
  const me = useMe()
  const user = me.data
  if (!user) return null // RequireAuth guarantees a user; this keeps types honest.

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Welcome, {user.name}</h1>

      {user.phoneVerified ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900"
        >
          <CheckCircle2 aria-hidden className="h-5 w-5" /> Your phone number is verified.
        </p>
      ) : (
        <div role="status" className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Your phone number is not verified.</p>
            <p className="mt-1">
              Some features, such as booking or joining a ride, may require a verified number.{' '}
              <Link to="/verify-phone" className="font-medium underline">
                Verify now
              </Link>
            </p>
          </div>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">Your rides</h2>
        <p className="mt-1 text-sm text-slate-600">Posting and finding rides is coming soon.</p>
      </section>
    </div>
  )
}
