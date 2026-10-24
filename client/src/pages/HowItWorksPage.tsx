import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Compass, ShieldCheck } from 'lucide-react'
import { Reveal } from '../components/Reveal'
import { RevealCard } from '../components/RevealCard'
import { PATHS, STEPS } from '../features/howItWorks/howItWorksContent'
import { STATUS_INFO, type SafetyStatus } from '../features/safety/safetyContent'

const STATUS_ORDER: SafetyStatus[] = ['LIVE', 'ROLLING_OUT', 'PLANNED']

export function HowItWorksPage() {
  // Only one card is held open by a tap at a time.
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <article className="mx-auto max-w-5xl space-y-12">
      <header className="mx-auto max-w-2xl text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-xl shadow-brand-500/30">
          <Compass aria-hidden className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight">How Pool-In works</h1>
        <p className="mt-3 text-slate-600">
          Pool-In connects people travelling the same way so they can share a ride and split the cost. Here is the journey from
          signing up to arriving, and how you find your pool along the way. Hover over a card, or tap it, for the details.
        </p>

        <ul aria-label="What the labels mean" className="mt-5 flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-slate-600">
          {STATUS_ORDER.map((s) => (
            <li key={s} className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-1 font-semibold ring-1 ${STATUS_INFO[s].chip}`}>{STATUS_INFO[s].label}</span>
              {STATUS_INFO[s].meaning}
            </li>
          ))}
        </ul>
      </header>

      <section aria-labelledby="journey-heading" className="space-y-5">
        <h2 id="journey-heading" className="text-2xl font-bold">
          Your journey, step by step
        </h2>
        <ol aria-label="Steps" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.id}>
              <Reveal delay={(i % 3) * 90} className="h-full">
                <RevealCard
                  testId={`step-${step.id}`}
                  step={i + 1}
                  title={step.title}
                  summary={step.summary}
                  details={step.details}
                  icon={step.icon}
                  chip={{ label: STATUS_INFO[step.status].label, className: STATUS_INFO[step.status].chip }}
                  open={openId === step.id}
                  onToggle={() => setOpenId((cur) => (cur === step.id ? null : step.id))}
                  onClose={() => setOpenId(null)}
                />
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="paths-heading" className="space-y-5">
        <div>
          <h2 id="paths-heading" className="text-2xl font-bold">
            Two ways to pool
          </h2>
          <p className="mt-1 text-slate-600">You choose one on the Pool In page. The form then asks only what that choice needs.</p>
        </div>
        <ul aria-label="Ways to pool" className="grid gap-5 md:grid-cols-2">
          {PATHS.map((path, i) => {
            const Icon = path.icon
            return (
              <li key={path.id}>
                <Reveal delay={i * 120} className="h-full">
                  <div className="card-hover h-full rounded-3xl border border-slate-200 bg-white p-6">
                    <div className="flex items-center gap-4">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-lg shadow-brand-500/30">
                        <Icon aria-hidden className="h-7 w-7" />
                      </span>
                      <div>
                        <h3 className="text-xl font-bold">{path.title}</h3>
                        <p className="text-sm text-slate-600">{path.tagline}</p>
                      </div>
                    </div>
                    <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-brand-700">You tell us</h4>
                    <ul className="mt-2 space-y-2 text-sm text-slate-700">
                      {path.youTell.map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          {line}
                        </li>
                      ))}
                    </ul>
                    <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-brand-700">What happens</h4>
                    <p className="mt-2 text-sm text-slate-700">{path.whatHappens}</p>
                  </div>
                </Reveal>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-label="Where things stand today" className="rounded-3xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-bold text-amber-950">Where things stand today</h2>
        <p className="mt-1 text-sm text-amber-950/85">
          You can already create an account, verify your phone, and Pool In to save a pool or a cab request. Searching for,
          joining and negotiating pools is still being built, so nobody can find or join a pool yet.
        </p>
      </section>

      <section
        aria-label="Get started"
        className="flex flex-col items-center justify-between gap-5 rounded-3xl bg-linear-to-br from-brand-700 via-brand-600 to-indigo-700 p-8 text-white shadow-xl shadow-brand-500/25 sm:flex-row"
      >
        <div className="text-center sm:text-left">
          <h2 className="text-2xl font-extrabold">Ready to pool in?</h2>
          <p className="mt-1 max-w-md text-sm text-white/85">
            Pool-In coordinates shared journeys. It does not book, change or pay for third-party cabs, and any fare shown is an
            estimate until the group agrees.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            to="/pool-in"
            className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 font-bold text-brand-700 shadow-lg transition duration-200 hover:-translate-y-0.5 hover:shadow-xl active:scale-95"
          >
            Pool In
            <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
          <Link to="/safety" className="inline-flex items-center gap-2 text-sm font-medium text-white underline underline-offset-4">
            <ShieldCheck aria-hidden className="h-4 w-4" />
            How we think about safety
          </Link>
        </div>
      </section>
    </article>
  )
}
