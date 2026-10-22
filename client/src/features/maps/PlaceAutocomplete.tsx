import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, LocateFixed, MapPin } from 'lucide-react'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { searchPlaces, type LatLng, type Place } from './mapsApi'

const MIN_CHARS = 2
const DEBOUNCE_MS = 300

interface Props {
  id: string
  label: string
  placeholder?: string
  /** Controlled text of the input. */
  text: string
  onTextChange: (text: string) => void
  /** The confirmed place, if the user has picked one. */
  selected: Place | null
  onSelect: (place: Place) => void
  /** Ranks suggestions near this point first (the user's location). */
  bias?: LatLng | null
  /** Offered as the first choice while the field is empty (e.g. "my current location"). */
  currentLocation?: Place | null
  error?: string
  hint?: string
  /** Called with true when place search fails, so the form can fall back to typed text. */
  onServiceStatus?: (down: boolean) => void
}

// Bold the part of the title the user has typed.
function highlight(text: string, query: string): ReactNode {
  const i = text.toLowerCase().indexOf(query.trim().toLowerCase())
  if (i < 0 || !query.trim()) return text
  const end = i + query.trim().length
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold text-slate-900">{text.slice(i, end)}</strong>
      {text.slice(end)}
    </>
  )
}

export function PlaceAutocomplete(props: Props) {
  const { id, label, placeholder, text, onTextChange, selected, onSelect, bias, currentLocation, error, hint, onServiceStatus } = props
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const typed = text.trim()
  const debounced = useDebouncedValue(typed, DEBOUNCE_MS)
  const confirmed = selected !== null && selected.label === text
  const searching = open && !confirmed && debounced.length >= MIN_CHARS && debounced === typed

  // Round the bias so small GPS movements reuse the same cached search.
  const biasKey = bias ? `${bias.lat.toFixed(1)},${bias.lng.toFixed(1)}` : ''
  const query = useQuery({
    queryKey: ['places', debounced.toLowerCase(), biasKey],
    queryFn: () => searchPlaces(debounced, bias),
    enabled: searching,
    staleTime: 5 * 60_000,
    retry: false,
  })

  useEffect(() => {
    if (query.isError) onServiceStatus?.(true)
    else if (query.isSuccess) onServiceStatus?.(false)
  }, [query.isError, query.isSuccess, onServiceStatus])

  const showCurrent =
    Boolean(currentLocation) && !confirmed && (typed === '' || 'current location'.startsWith(typed.toLowerCase()))
  const places = searching && query.data ? query.data : []
  const options: Place[] = [...(showCurrent && currentLocation ? [currentLocation] : []), ...places]

  const waiting = open && !confirmed && typed.length >= MIN_CHARS && (debounced !== typed || query.isFetching)
  const tooShort = open && !confirmed && typed.length > 0 && typed.length < MIN_CHARS
  const noResults = searching && query.isSuccess && !query.isFetching && places.length === 0
  const failed = searching && query.isError
  const popupVisible = open && (options.length > 0 || waiting || tooShort || noResults || failed)

  const choose = (place: Place) => {
    // Text first, selection last: a parent that clears the selection whenever the text changes
    // would otherwise wipe out the choice we are making right now.
    onTextChange(place.label)
    onSelect(place)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (options.length === 0) return
      e.preventDefault()
      setOpen(true)
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + options.length) % options.length)
    } else if (e.key === 'Enter' && open && active >= 0 && options[active]) {
      e.preventDefault() // choose the highlighted place instead of submitting the form
      choose(options[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const statusText = failed
    ? 'Place search is unavailable right now. You can type the place instead.'
    : waiting
      ? 'Searching…'
      : tooShort
        ? 'Keep typing to see places…'
        : noResults
          ? `No places found for “${typed}”.`
          : null

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div className="relative mt-1">
        <MapPin aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          role="combobox"
          aria-expanded={popupVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={popupVisible && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          autoComplete="off"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            onTextChange(e.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="field-input block w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm aria-[invalid=true]:border-red-500"
        />
        {confirmed && <CheckCircle2 aria-hidden className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" />}

        {popupVisible && (
          // Options use onMouseDown so the input keeps focus (and does not close the list) while clicking.
          <div className="absolute z-30 mt-1 w-full animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <ul id={listId} role="listbox" aria-label={`${label} suggestions`}>
              {options.map((place, i) => {
                const isCurrent = place === currentLocation
                return (
                  <li
                    key={place.id}
                    id={`${id}-opt-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      choose(place)
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${i === active ? 'bg-brand-50' : ''}`}
                  >
                    {isCurrent ? (
                      <LocateFixed aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                    ) : (
                      <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-slate-700">{isCurrent ? place.title : highlight(place.title, typed)}</span>
                      {place.subtitle && <span className="block truncate text-xs text-slate-500">{place.subtitle}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
            {statusText && (
              <p role="status" className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500 first:border-t-0">
                {statusText}
              </p>
            )}
          </div>
        )}
      </div>

      {confirmed && (
        <p className="mt-1 text-xs text-emerald-700">Location confirmed</p>
      )}
      {hint && !error && !confirmed && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
