import { useState } from 'react'
import { PhoneCall, ShieldCheck } from 'lucide-react'
import { Reveal } from '../components/Reveal'
import { SafetyCard } from '../features/safety/SafetyCard'
import { SAFETY_ITEMS, STATUS_INFO, type SafetyStatus } from '../features/safety/safetyContent'

const STATUS_ORDER: SafetyStatus[] = ['LIVE', 'ROLLING_OUT', 'PLANNED']

export function SafetyPage() {
  // Only one card is held open by a tap at a time.
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <article className="mx-auto max-w-5xl space-y-10">
      <header className="mx-auto max-w-2xl text-center">
        <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-xl shadow-brand-500/30">
          <ShieldCheck aria-hidden className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-4xl font-extrabold tracking-tight">Safety on Pool-In</h1>
        <p className="mt-3 text-slate-600">
          Safety tools can reduce risk, but they can't remove it. Here is what we do, what is on the way, and what you can do
          yourself. Hover over a card, or tap it, for the details.
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

      <ul aria-label="Safety measures" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {SAFETY_ITEMS.map((item, i) => (
          <li key={item.id}>
            <Reveal delay={(i % 3) * 90} className="h-full">
              <SafetyCard
                item={item}
                open={openId === item.id}
                onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
                onClose={() => setOpenId(null)}
              />
            </Reveal>
          </li>
        ))}
      </ul>

      <section
        aria-label="Emergency"
        className="flex flex-col items-center justify-between gap-4 rounded-3xl border border-red-200 bg-red-50 p-6 text-center sm:flex-row sm:text-left"
      >
        <div>
          <h2 className="text-lg font-bold text-red-900">In an emergency, call 112 first</h2>
          <p className="mt-1 text-sm text-red-900/80">
            No safety feature, badge or match is a guarantee of personal safety. If you feel unsafe, leave the situation and
            contact emergency services.
          </p>
        </div>
        <a
          href="tel:112"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-red-600 px-6 py-3 font-semibold text-white shadow-lg shadow-red-500/30 transition duration-200 hover:-translate-y-0.5 hover:bg-red-700 active:scale-95"
        >
          <PhoneCall aria-hidden className="h-5 w-5" />
          Call 112
        </a>
      </section>
    </article>
  )
}
