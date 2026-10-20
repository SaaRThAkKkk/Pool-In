export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">This screen is built in the authentication step.</p>
    </div>
  )
}
