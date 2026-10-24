import { useId, type KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface RevealCardProps {
  testId: string
  title: string
  summary: string
  details: string
  icon: LucideIcon
  /** Small coloured label in the top-right corner (e.g. a status). */
  chip: { label: string; className: string }
  /** When given, the card is a numbered step. */
  step?: number
  /** Opened by a tap or Enter (hover and keyboard focus reveal it too). */
  open: boolean
  onToggle: () => void
  onClose: () => void
}

// A square card. The front shows the idea; hovering, focusing or tapping slides the full detail up over it.
export function RevealCard({ testId, title, summary, details, icon: Icon, chip, step, open, onToggle, onClose }: RevealCardProps) {
  const detailId = useId()

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      data-testid={testId}
      className="group relative isolate min-h-[18rem] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-md transition duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-brand-500/20 has-[:focus-visible]:-translate-y-1 has-[:focus-visible]:shadow-2xl sm:aspect-square"
    >
      {/* Front of the card. It is the real control: tap, Enter or Space toggle the detail. */}
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={detailId}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        className="absolute inset-0 z-0 flex cursor-pointer flex-col p-6 text-left focus-visible:outline-offset-[-4px]"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="relative">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-lg shadow-brand-500/30 transition duration-300 group-hover:scale-110 group-hover:-rotate-6">
              <Icon aria-hidden className="h-7 w-7" />
            </span>
            {step !== undefined && (
              <span
                data-testid={`${testId}-step`}
                className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white ring-2 ring-white"
              >
                <span className="sr-only">Step </span>
                {step}
              </span>
            )}
          </span>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${chip.className}`}>
            <span className="sr-only">Status: </span>
            {chip.label}
          </span>
        </span>
        <span className="mt-6 block text-xl font-bold leading-snug text-slate-900">{title}</span>
        <span className="mt-2 block text-sm text-slate-600">{summary}</span>
        <span aria-hidden className="mt-auto pt-4 text-xs font-medium text-brand-700 transition-opacity duration-300 group-hover:opacity-0">
          Hover or tap to read more
        </span>
      </button>

      {/* The detail. It ignores the pointer so a tap anywhere on the card still reaches the button. */}
      <div
        data-open={open}
        className="pointer-events-none absolute inset-0 z-10 flex translate-y-full flex-col justify-center gap-3 bg-linear-to-br from-brand-700 via-brand-600 to-indigo-700 p-6 text-white transition-transform duration-500 ease-out group-hover:translate-y-0 group-has-[:focus-visible]:translate-y-0 data-[open=true]:translate-y-0"
      >
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
            <Icon aria-hidden className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold leading-snug">{title}</span>
        </span>
        {/* The button is described by this sentence alone (not the repeated title and status). */}
        <span id={detailId} className="block text-sm leading-relaxed text-white/90">
          {details}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-white/70">{chip.label}</span>
      </div>
    </div>
  )
}
