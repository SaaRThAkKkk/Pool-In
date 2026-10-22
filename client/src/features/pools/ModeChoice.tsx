import { CarFront, CarTaxiFront, Check } from 'lucide-react'
import type { ComponentType } from 'react'
import type { PoolMode } from './poolsApi'

interface Option {
  value: PoolMode
  title: string
  text: string
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

const OPTIONS: Option[] = [
  { value: 'OWN_VEHICLE', title: 'I own the vehicle', text: 'Offer seats on your trip and share the cost.', icon: CarFront },
  { value: 'POOL_CAB', title: 'Pool a cab', text: 'Find people to share a cab with.', icon: CarTaxiFront },
]

interface Props {
  value: PoolMode | null
  onChange: (mode: PoolMode) => void
  error?: string
}

// Two big radio cards. Selecting one changes the rest of the form below.
export function ModeChoice({ value, onChange, error }: Props) {
  return (
    <div>
      <div role="radiogroup" aria-label="How do you want to pool?" aria-invalid={!!error} className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map(({ value: v, title, text, icon: Icon }) => {
          const selected = value === v
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(v)}
              className={`group relative cursor-pointer rounded-2xl border-2 p-4 text-left transition duration-300 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] ${
                selected
                  ? 'border-brand-600 bg-brand-50 shadow-lg shadow-brand-500/15'
                  : value !== null
                    ? 'border-slate-200 bg-white/70 opacity-80 hover:opacity-100'
                    : 'border-slate-200 bg-white hover:border-brand-500/60'
              }`}
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-xl transition duration-300 group-hover:scale-110 group-hover:-rotate-3 ${
                  selected ? 'scale-110 bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-md shadow-brand-500/30' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Icon aria-hidden className="h-6 w-6" />
              </span>
              <span className="mt-3 block font-semibold">{title}</span>
              <span className="mt-0.5 block text-sm text-slate-600">{text}</span>
              <span
                aria-hidden
                className={`absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white transition duration-300 ${
                  selected ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
                }`}
              >
                <Check className="h-4 w-4" />
              </span>
            </button>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
