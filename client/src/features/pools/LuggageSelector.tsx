import { Backpack, Briefcase, BriefcaseBusiness, Luggage as LuggageIcon, Minus, Package, Plus } from 'lucide-react'
import type { ComponentType } from 'react'
import { LUGGAGE_TYPES, MAX_LUGGAGE_PER_TYPE, type Luggage, type LuggageKey } from './poolsApi'

const ICONS: Record<LuggageKey, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  large: LuggageIcon,
  medium: BriefcaseBusiness,
  cabin: Briefcase,
  backpack: Backpack,
  oversized: Package,
}

interface Props {
  value: Luggage
  onChange: (next: Luggage) => void
}

// Counters per luggage category. Plus/minus buttons are much easier than typing on a phone.
export function LuggageSelector({ value, onChange }: Props) {
  const total = LUGGAGE_TYPES.reduce((sum, t) => sum + value[t.key], 0)
  const set = (key: LuggageKey, n: number) => onChange({ ...value, [key]: Math.min(MAX_LUGGAGE_PER_TYPE, Math.max(0, n)) })
  const stepper =
    'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition duration-150 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white'

  return (
    <div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {LUGGAGE_TYPES.map(({ key, label, hint }) => {
          const Icon = ICONS[key]
          const count = value[key]
          return (
            <li key={key} className="flex items-center gap-3 px-3 py-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ${count > 0 ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'}`}>
                <Icon aria-hidden className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-slate-500">{hint}</span>
              </span>
              <span role="group" aria-label={label} className="flex items-center gap-2">
                <button type="button" className={stepper} onClick={() => set(key, count - 1)} disabled={count <= 0} aria-label={`Fewer ${label.toLowerCase()}`}>
                  <Minus aria-hidden className="h-4 w-4" />
                </button>
                <output aria-label={`${label} count`} className="w-6 text-center text-sm font-semibold tabular-nums">
                  {count}
                </output>
                <button type="button" className={stepper} onClick={() => set(key, count + 1)} disabled={count >= MAX_LUGGAGE_PER_TYPE} aria-label={`More ${label.toLowerCase()}`}>
                  <Plus aria-hidden className="h-4 w-4" />
                </button>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        {total === 0 ? 'Travelling light? Leave everything at 0.' : `${total} item${total === 1 ? '' : 's'} in total.`} Luggage is used to
        find a vehicle with enough space. Sizes are approximate.
      </p>
    </div>
  )
}
