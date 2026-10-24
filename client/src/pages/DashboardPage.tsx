import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { BadgeCheck, CarFront, CarTaxiFront, Check, Mail, Phone, Plus, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react'
import type { PublicUser } from '../features/auth/authApi'
import { useMe } from '../features/auth/useMe'
import { PoolCard } from '../features/pools/PoolCard'
import { MY_POOLS_KEY, fetchMyPools, type Pool } from '../features/pools/poolsApi'

const RECENT_POOLS = 5

const GENDER_LABEL: Record<string, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
}

// +919876543210 -> +91 98765 43210
function formatPhone(phone: string) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone)
  return m ? `+91 ${m[1]} ${m[2]}` : phone
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function Row({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="break-words text-sm font-medium text-slate-800">{children}</dd>
      </div>
    </div>
  )
}

function ProfileCard({ user }: { user: PublicUser }) {
  return (
    <section aria-label="Your details" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg shadow-brand-500/5">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-indigo-600 text-2xl font-extrabold text-white shadow-lg shadow-brand-500/30"
        >
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold">{user.name}</h2>
          {user.phoneVerified ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
              <BadgeCheck aria-hidden className="h-3.5 w-3.5" /> Phone verified
            </span>
          ) : (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-amber-200">
              <ShieldAlert aria-hidden className="h-3.5 w-3.5" /> Phone not verified
            </span>
          )}
        </div>
      </div>

      <dl className="mt-5 space-y-4">
        <Row icon={Mail} label="Email">
          {user.email}
        </Row>
        <Row icon={Phone} label="Mobile number">
          {formatPhone(user.phone)}
        </Row>
        <Row icon={UserRound} label="Gender (self-declared)">
          {GENDER_LABEL[user.gender] ?? user.gender}
        </Row>
        {user.createdAt && (
          <Row icon={Check} label="Member since">
            {format(new Date(user.createdAt), 'MMMM yyyy')}
          </Row>
        )}
      </dl>
      <p className="mt-5 border-t border-slate-100 pt-3 text-xs text-slate-500">
        Identity (ID) verification isn't available yet. A badge only ever says what was actually checked.
      </p>
    </section>
  )
}

function VerificationCard({ user }: { user: PublicUser }) {
  if (user.phoneVerified) {
    return (
      <section
        aria-label="Phone verification"
        className="rounded-2xl border border-emerald-200 bg-linear-to-br from-emerald-50 to-white p-6"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-500/30">
          <ShieldCheck aria-hidden className="h-6 w-6" />
        </span>
        <h2 className="mt-4 text-lg font-bold text-emerald-900">Your phone number is verified</h2>
        <p className="mt-1 text-sm text-emerald-900/80">
          This shows you can receive messages on your number, and adds a badge to your profile. It does not verify your
          identity.
        </p>
      </section>
    )
  }

  const benefits = [
    'A "Phone verified" badge on your profile',
    'More trust from the people you pool with',
    'Booking or joining a ride may require a verified number',
  ]

  return (
    <section
      aria-label="Phone verification"
      className="relative overflow-hidden rounded-2xl bg-linear-to-br from-brand-700 via-brand-600 to-indigo-700 p-6 text-white shadow-xl shadow-brand-500/25"
    >
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
      <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
        <ShieldAlert aria-hidden className="h-6 w-6" />
      </span>
      <h2 className="relative mt-4 text-lg font-bold">Verify your phone number</h2>
      <p className="relative mt-1 text-sm text-white/85">
        Confirm your number to build credibility and get ready to book rides.
      </p>
      <ul className="relative mt-4 space-y-2 text-sm">
        {benefits.map((b) => (
          <li key={b} className="flex items-start gap-2">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            {b}
          </li>
        ))}
      </ul>
      <Link
        to="/verify-phone"
        className="relative mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 font-semibold text-brand-700 shadow-md transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]"
      >
        Verify my phone number
      </Link>
    </section>
  )
}

function Stat({ icon: Icon, label, value }: { icon: typeof Plus; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <Icon aria-hidden className="h-5 w-5" />
      </span>
      <div>
        <p className="text-2xl font-extrabold leading-none tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-slate-500">{label}</p>
      </div>
    </div>
  )
}

function PoolsSection({ pools }: { pools: ReturnType<typeof usePools> }) {
  return (
    <section aria-label="Your pools" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Your pools</h2>
        <Link to="/pool-in" className="btn-primary !py-2 text-sm">
          <Plus aria-hidden className="h-4 w-4" /> Pool In
        </Link>
      </div>

      {pools.isPending && <p role="status">Loading your pools…</p>}

      {pools.isError && (
        <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Could not load your pools.{' '}
          <button type="button" onClick={() => void pools.refetch()} className="font-medium underline">
            Try again
          </button>
        </p>
      )}

      {pools.data && pools.data.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 p-8 text-center">
          <p className="font-medium">You haven't pooled in yet.</p>
          <p className="mt-1 text-sm text-slate-600">Offer seats on a trip, or share a cab with others.</p>
          <Link to="/pool-in" className="btn-primary mt-4">
            Pool In
          </Link>
        </div>
      )}

      {pools.data && pools.data.length > 0 && <PoolList pools={pools.data} />}
    </section>
  )
}

function PoolList({ pools }: { pools: Pool[] }) {
  const owner = pools.filter((p) => p.section === 'CAR_OWNER').length
  const shown = pools.slice(0, RECENT_POOLS)

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Plus} label="Pools in total" value={pools.length} />
        <Stat icon={CarFront} label="As car owner" value={owner} />
        <Stat icon={CarTaxiFront} label="Cab requests" value={pools.length - owner} />
      </div>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        Pool matching isn't live yet: nobody can find or join these pools until it launches.
      </p>
      <ul className="space-y-4">
        {shown.map((pool) => (
          <PoolCard key={pool.id} pool={pool} />
        ))}
      </ul>
      <Link to="/pools" className="inline-block text-sm font-medium text-brand-700 underline underline-offset-2">
        {pools.length > shown.length ? `View all ${pools.length} pools` : 'View in My pools'}
      </Link>
    </>
  )
}

function usePools() {
  return useQuery({ queryKey: MY_POOLS_KEY, queryFn: fetchMyPools })
}

export function DashboardPage() {
  const me = useMe()
  const pools = usePools()
  const user = me.data
  if (!user) return null // RequireAuth guarantees a user; this keeps types honest.

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Welcome, {user.name}</h1>
        <p className="mt-1 text-slate-600">Your details, your trust profile and your pools, all in one place.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <ProfileCard user={user} />
          <VerificationCard user={user} />
        </div>
        <div className="lg:col-span-2">
          <PoolsSection pools={pools} />
        </div>
      </div>
    </div>
  )
}
