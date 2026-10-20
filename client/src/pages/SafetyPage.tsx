export function SafetyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-3xl font-bold">Safety information</h1>
      <p className="text-slate-700">
        Safety tools reduce risk but cannot guarantee it. Use your judgement, share your trip with someone you trust,
        and leave any situation that feels unsafe.
      </p>
      <ul className="list-disc space-y-2 pl-6 text-slate-700">
        <li>Verification badges show only what was actually checked, nothing more.</li>
        <li>Women-only pools are enforced by the server, but matching is never a guarantee of personal safety.</li>
        <li>Live location is off by default, shared only with your Pool Room, and you can stop at any time.</li>
        <li>You can report or block another user from any ride or Pool Room.</li>
        <li>In an emergency, contact local emergency services first (India: 112).</li>
      </ul>
    </article>
  )
}
