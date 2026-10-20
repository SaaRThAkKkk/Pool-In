const steps = [
  'Create an account and choose how you want to pool: an existing cab, a private vehicle, or a group of passengers.',
  'Enter your route, time, passengers and luggage. Hard requirements such as budget or women-only pools exclude results; other preferences only affect ranking.',
  'Review matches with clear reasons, then send a join request or a price offer.',
  'The other party accepts, rejects or counters. Nothing is confirmed until everyone explicitly agrees.',
  'A private Pool Room opens for chat, pickup and drop-off planning, and optional live location sharing.',
  'After the trip, leave a rating or report an issue.',
]

export function HowItWorksPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <h1 className="text-3xl font-bold">How Pool-In works</h1>
      <ol className="mt-6 list-decimal space-y-3 pl-6 text-slate-700">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="mt-6 rounded-md bg-amber-50 p-4 text-sm text-amber-900">
        Pool-In coordinates shared journeys. It does not book, change or pay for third-party cabs, and fares shown are
        estimates until the group agrees.
      </p>
    </article>
  )
}
