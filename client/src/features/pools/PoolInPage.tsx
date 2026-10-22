import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { CircleCheck, Clock, Minus, Plus, Route as RouteIcon, Users } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '../../lib/api'
import { ME_KEY } from '../auth/useMe'
import { useLiveLocation } from '../location/useLiveLocation'
import { PlaceAutocomplete } from '../maps/PlaceAutocomplete'
import { RoutePreviewMap } from '../maps/RoutePreviewMap'
import { fetchRoute, formatDistance, formatDuration, type Place } from '../maps/mapsApi'
import { LuggageSelector } from './LuggageSelector'
import { ModeChoice } from './ModeChoice'
import {
  EMPTY_LUGGAGE,
  MAX_PEOPLE,
  MY_POOLS_KEY,
  VEHICLE_CATEGORIES,
  categoryInfo,
  poolIn,
  type Luggage,
  type PlaceInput,
  type PoolInPayload,
  type PoolInResult,
  type VehicleCategory,
} from './poolsApi'

const MIN_LEAD_MINUTES = 10
const MAX_FARE = 100_000
const CURRENT_LABEL = 'Current location'
const round = (n: number, digits: number) => Number(n.toFixed(digits))

// Numeric inputs give NaN when empty; accept that here and report it in superRefine, only for the chosen mode.
const numeric = z.union([z.number(), z.nan()]).optional()
const isNum = (n: number | undefined): n is number => typeof n === 'number' && !Number.isNaN(n)

const schema = z
  .object({
    mode: z.enum(['OWN_VEHICLE', 'POOL_CAB'], { error: 'Choose how you want to pool' }),
    startText: z.string().trim().min(3, 'Enter where you are starting from').max(200, 'Too long (200 characters max)'),
    endText: z.string().trim().min(3, 'Enter your destination').max(200, 'Too long (200 characters max)'),
    arriveBy: z
      .string()
      .min(1, 'Choose when you need to arrive')
      .refine(
        (v) => new Date(v).getTime() >= Date.now() + MIN_LEAD_MINUTES * 60_000,
        `Arrival time must be at least ${MIN_LEAD_MINUTES} minutes from now`,
      ),
    vehicleCategory: z.string().optional(),
    vehicleMake: z.string().trim().max(40, 'Too long (40 characters max)').optional(),
    vehicleModel: z.string().trim().max(40, 'Too long (40 characters max)').optional(),
    seats: numeric,
    fare: numeric,
    negotiable: z.boolean().optional(),
    people: numeric,
  })
  .superRefine((v, ctx) => {
    const issue = (path: keyof PoolForm, message: string) => ctx.addIssue({ code: 'custom', path: [path], message })

    if (v.mode === 'OWN_VEHICLE') {
      const category = categoryInfo(v.vehicleCategory ?? '')
      if (!category) issue('vehicleCategory', 'Choose a vehicle type')
      if ((v.vehicleMake ?? '').trim().length < 2) issue('vehicleMake', 'Enter the vehicle make')
      if ((v.vehicleModel ?? '').trim().length < 1) issue('vehicleModel', 'Enter the vehicle model')

      if (!isNum(v.seats)) issue('seats', 'Enter the number of seats')
      else if (!Number.isInteger(v.seats)) issue('seats', 'Seats must be a whole number')
      else if (v.seats < 1) issue('seats', 'Offer at least 1 seat')
      else if (category && v.seats > category.maxPassengers) {
        issue('seats', `A ${category.label} can offer at most ${category.maxPassengers} seats`)
      }

      if (!isNum(v.fare)) issue('fare', 'Enter the fare')
      else if (v.fare < 0) issue('fare', 'Fare cannot be negative')
      else if (v.fare > MAX_FARE) issue('fare', `Fare cannot exceed ₹${MAX_FARE.toLocaleString('en-IN')}`)
      else if (Math.abs(v.fare * 100 - Math.round(v.fare * 100)) > 1e-6) issue('fare', 'Fare can have at most 2 decimal places')
    }

    if (v.mode === 'POOL_CAB') {
      if (!isNum(v.people)) issue('people', 'Enter how many people are travelling')
      else if (!Number.isInteger(v.people)) issue('people', 'Whole numbers only')
      else if (v.people < 1) issue('people', 'At least 1 person')
      else if (v.people > MAX_PEOPLE) issue('people', `At most ${MAX_PEOPLE} people`)
    }
  })
type PoolForm = z.input<typeof schema>

// Server validation paths -> form fields.
const SERVER_FIELD: Record<string, keyof PoolForm> = {
  mode: 'mode',
  'origin.label': 'startText',
  'destination.label': 'endText',
  arriveBy: 'arriveBy',
  'vehicle.category': 'vehicleCategory',
  'vehicle.make': 'vehicleMake',
  'vehicle.model': 'vehicleModel',
  seats: 'seats',
  askingPrice: 'fare',
  people: 'people',
}

const inputClass =
  'field-input mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm aria-[invalid=true]:border-red-500'

function Field(props: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  const { id, label, error, hint, children } = props
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
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

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold uppercase tracking-wide text-brand-700">{title}</legend>
      {hint && <p className="-mt-2 text-xs text-slate-500">{hint}</p>}
      {children}
    </fieldset>
  )
}

function OutcomePanel({ result, onAnother }: { result: PoolInResult; onAnother: () => void }) {
  let title: string
  let body: string
  if (result.outcome === 'POOL_CREATED') {
    title = 'Your pool is created'
    body =
      "It's saved in the Car owner section. Riders can't search for or join pools yet, so nobody will see it until matching launches."
  } else if (result.outcome === 'REQUEST_CREATED') {
    title = 'Your pool request is saved'
    body =
      result.matching.status === 'NOT_AVAILABLE'
        ? "Pool matching isn't available yet, so we haven't matched you with anyone. Your request is saved in the Cab section and will be matched once matching launches."
        : "We didn't find a matching pool, so we saved your request in the Cab section."
  } else {
    const n = result.matching.matches.length
    title = `We found ${n} matching pool${n === 1 ? '' : 's'}`
    body = "Viewing and joining matches is coming soon. We haven't created a new request, since a match exists."
  }

  return (
    <div role="status" className="animate-pop-in rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
      <CircleCheck aria-hidden className="h-10 w-10 text-emerald-600" />
      <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-emerald-900">{title}</h1>
      <p className="mt-2 text-sm text-emerald-900/80">{body}</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Link to="/pools" className="btn-primary">
          View my pools
        </Link>
        <button type="button" onClick={onAnother} className="text-sm font-medium text-emerald-900 underline">
          Pool in again
        </button>
      </div>
    </div>
  )
}

export function PoolInPage() {
  const queryClient = useQueryClient()
  const { position } = useLiveLocation()
  const [minArrival] = useState(() => format(new Date(Date.now() + MIN_LEAD_MINUTES * 60_000), "yyyy-MM-dd'T'HH:mm"))

  // The live location, rounded to ~100 m so GPS jitter does not keep changing the start (or refetching the route).
  const curLat = position ? round(position.lat, 3) : null
  const curLng = position ? round(position.lng, 3) : null
  const currentPlace = useMemo<Place | null>(
    () =>
      curLat !== null && curLng !== null
        ? { id: 'current', title: 'My current location', subtitle: 'Use your device location', label: CURRENT_LABEL, lat: curLat, lng: curLng }
        : null,
    [curLat, curLng],
  )

  // 'auto' = start from the live location as soon as it is known, until the user types something else.
  const [startChoice, setStartChoice] = useState<Place | 'auto' | null>('auto')
  const [endPlace, setEndPlace] = useState<Place | null>(null)
  const [placesDown, setPlacesDown] = useState(false)
  const [luggage, setLuggage] = useState<Luggage>(EMPTY_LUGGAGE)
  const [formError, setFormError] = useState<string | null>(null)
  const [result, setResult] = useState<PoolInResult | null>(null)
  const startPlace = startChoice === 'auto' ? currentPlace : startChoice

  const {
    register,
    handleSubmit,
    setError,
    clearErrors,
    setValue,
    control,
    formState: { errors },
  } = useForm<PoolForm>({
    resolver: zodResolver(schema),
    defaultValues: { startText: '', endText: '', seats: 1, people: 1, negotiable: false },
  })

  useEffect(() => {
    if (startChoice === 'auto' && currentPlace) setValue('startText', CURRENT_LABEL, { shouldValidate: false })
  }, [startChoice, currentPlace, setValue])

  const mode = useWatch({ control, name: 'mode' }) ?? null
  const category = useWatch({ control, name: 'vehicleCategory' })
  const people = useWatch({ control, name: 'people' })
  const maxSeats = category ? categoryInfo(category)?.maxPassengers : undefined

  // Route preview once both ends are confirmed places.
  const route = useQuery({
    queryKey: ['route', startPlace?.lat, startPlace?.lng, endPlace?.lat, endPlace?.lng],
    queryFn: () => fetchRoute(startPlace!, endPlace!),
    enabled: Boolean(startPlace && endPlace),
    retry: false,
    staleTime: 10 * 60_000,
  })

  const mutation = useMutation({
    mutationFn: poolIn,
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: MY_POOLS_KEY })
      setResult(data)
    },
    onError: (err) => {
      if (!(err instanceof ApiError)) {
        setFormError('Could not reach the server. Please try again.')
        return
      }
      if (err.status === 401) {
        // Session ended while filling the form: the route guard will send them to log in.
        queryClient.setQueryData(ME_KEY, null)
        return
      }
      const details = err.code === 'VALIDATION_ERROR' && Array.isArray(err.details) ? err.details : []
      let mapped = false
      for (const d of details as { path: string; message: string }[]) {
        const field = SERVER_FIELD[d.path]
        if (field) {
          setError(field, { message: d.message })
          mapped = true
        } else if (d.path.startsWith('luggage')) {
          setFormError(`Luggage: ${d.message}`)
          mapped = true
        }
      }
      if (!mapped) setFormError(err.message)
    },
  })

  const placeInput = (place: Place | null, text: string): PlaceInput =>
    place ? { label: place.label, coordinates: { lat: place.lat, lng: place.lng } } : { label: text.trim() }

  const onSubmit = (v: z.output<typeof schema>) => {
    setFormError(null)
    // With search working, both ends must be real places (they carry the coordinates matching needs).
    // If search is down, typed text is accepted so the user is not blocked.
    let blocked = false
    if (!startPlace && !placesDown) {
      setError('startText', { message: 'Choose a place from the suggestions' })
      blocked = true
    }
    if (!endPlace && !placesDown) {
      setError('endText', { message: 'Choose a place from the suggestions' })
      blocked = true
    }
    if (blocked) return

    const trip = {
      origin: placeInput(startPlace, v.startText),
      destination: placeInput(endPlace, v.endText),
      arriveBy: new Date(v.arriveBy).toISOString(),
      luggage,
    }
    const payload: PoolInPayload =
      v.mode === 'OWN_VEHICLE'
        ? {
            mode: 'OWN_VEHICLE',
            ...trip,
            vehicle: {
              category: v.vehicleCategory as VehicleCategory,
              make: (v.vehicleMake ?? '').trim(),
              model: (v.vehicleModel ?? '').trim(),
            },
            seats: v.seats as number,
            askingPrice: v.fare as number,
            negotiable: v.negotiable ?? false,
          }
        : { mode: 'POOL_CAB', ...trip, people: v.people as number }
    mutation.mutate(payload)
  }

  const describe = (id: keyof PoolForm, hint?: boolean) => (errors[id] ? `${id}-error` : hint ? `${id}-hint` : undefined)

  let routeNote: ReactNode
  if (!startPlace || !endPlace) {
    routeNote = placesDown
      ? 'Place search is unavailable, so there is no route preview. Your typed locations will still be saved.'
      : 'Choose a start and a destination to preview your route.'
  } else if (route.isFetching) {
    routeNote = 'Calculating route…'
  } else if (route.isError) {
    routeNote =
      route.error instanceof ApiError && route.error.code === 'NO_ROUTE'
        ? route.error.message
        : "Couldn't preview the route right now. You can still continue."
  } else if (route.data) {
    routeNote = (
      <>
        <span className="font-semibold text-slate-900">
          {formatDistance(route.data.distanceMeters)} · about {formatDuration(route.data.durationSeconds)}
        </span>{' '}
        by road. An estimate only: real distance and time depend on traffic and the route taken.
      </>
    )
  }

  const startAgain = () => {
    setResult(null)
    setFormError(null)
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl">
        <OutcomePanel result={result} onAnother={startAgain} />
      </div>
    )
  }

  const submitLabel =
    mode === 'OWN_VEHICLE' ? 'Create my pool' : mode === 'POOL_CAB' ? 'Find a pool' : 'Pool In'

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-brand-500/10 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight">Pool In</h1>
        <p className="mt-1 text-sm text-slate-600">Tell us about your trip, then choose how you want to pool.</p>

        <form noValidate onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-8" aria-label="Pool In">
          <Section title="Your trip">
            <Controller
              name="startText"
              control={control}
              render={({ field }) => (
                <PlaceAutocomplete
                  id="startText"
                  label="Starting location"
                  placeholder="Search for a place in India"
                  text={field.value ?? ''}
                  onTextChange={(t) => {
                    field.onChange(t)
                    if (!startPlace || t !== startPlace.label) setStartChoice(null)
                  }}
                  selected={startPlace}
                  onSelect={setStartChoice}
                  bias={currentPlace}
                  currentLocation={currentPlace}
                  error={errors.startText?.message}
                  onServiceStatus={setPlacesDown}
                />
              )}
            />
            <Controller
              name="endText"
              control={control}
              render={({ field }) => (
                <PlaceAutocomplete
                  id="endText"
                  label="Destination"
                  placeholder="Search for a place in India"
                  text={field.value ?? ''}
                  onTextChange={(t) => {
                    field.onChange(t)
                    if (endPlace && t !== endPlace.label) setEndPlace(null)
                  }}
                  selected={endPlace}
                  onSelect={setEndPlace}
                  bias={currentPlace}
                  error={errors.endText?.message}
                  onServiceStatus={setPlacesDown}
                />
              )}
            />
            <Field id="arriveBy" label="Reach the destination by" error={errors.arriveBy?.message} hint="The latest time you need to arrive.">
              <div className="relative">
                <Clock aria-hidden className="pointer-events-none absolute left-3 top-1/2 mt-0.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="arriveBy"
                  type="datetime-local"
                  min={minArrival}
                  className={`${inputClass} pl-9`}
                  aria-invalid={!!errors.arriveBy}
                  aria-describedby={describe('arriveBy', true)}
                  {...register('arriveBy')}
                />
              </div>
            </Field>
          </Section>

          <Section title="Luggage" hint="What you'll be travelling with.">
            <LuggageSelector value={luggage} onChange={setLuggage} />
          </Section>

          <Section title="How do you want to pool?">
            <ModeChoice
              value={mode}
              error={errors.mode?.message}
              onChange={(m) => {
                setValue('mode', m, { shouldValidate: false })
                clearErrors(['mode', 'vehicleCategory', 'vehicleMake', 'vehicleModel', 'seats', 'fare', 'people'])
              }}
            />
          </Section>

          {/* Keyed by mode so the panel animates in each time the choice changes. */}
          {mode === 'OWN_VEHICLE' && (
            <div key="own" className="animate-fade-up space-y-8">
              <Section title="Your vehicle">
                <Field id="vehicleCategory" label="Vehicle type" error={errors.vehicleCategory?.message}>
                  <select
                    id="vehicleCategory"
                    className={inputClass}
                    aria-invalid={!!errors.vehicleCategory}
                    aria-describedby={describe('vehicleCategory')}
                    defaultValue=""
                    {...register('vehicleCategory')}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {VEHICLE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="vehicleMake" label="Make" error={errors.vehicleMake?.message}>
                    <input
                      id="vehicleMake"
                      className={inputClass}
                      placeholder="e.g. Honda"
                      aria-invalid={!!errors.vehicleMake}
                      aria-describedby={describe('vehicleMake')}
                      {...register('vehicleMake')}
                    />
                  </Field>
                  <Field id="vehicleModel" label="Model" error={errors.vehicleModel?.message}>
                    <input
                      id="vehicleModel"
                      className={inputClass}
                      placeholder="e.g. City"
                      aria-invalid={!!errors.vehicleModel}
                      aria-describedby={describe('vehicleModel')}
                      {...register('vehicleModel')}
                    />
                  </Field>
                </div>
              </Section>

              <Section title="Seats and fare">
                <Field
                  id="seats"
                  label="Seats you can offer"
                  error={errors.seats?.message}
                  hint={
                    maxSeats
                      ? `Up to ${maxSeats} passengers for this vehicle type, not counting you.`
                      : 'Passengers you can take, not counting you.'
                  }
                >
                  <input
                    id="seats"
                    type="number"
                    min={1}
                    max={maxSeats ?? 8}
                    className={inputClass}
                    aria-invalid={!!errors.seats}
                    aria-describedby={describe('seats', true)}
                    {...register('seats', { valueAsNumber: true })}
                  />
                </Field>
                <Field
                  id="fare"
                  label="Fare per passenger (₹)"
                  error={errors.fare?.message}
                  hint="The amount you're asking each rider to contribute towards the trip."
                >
                  <input
                    id="fare"
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    className={inputClass}
                    aria-invalid={!!errors.fare}
                    aria-describedby={describe('fare', true)}
                    {...register('fare', { valueAsNumber: true })}
                  />
                </Field>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm transition-colors hover:bg-slate-100">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" {...register('negotiable')} />
                  <span>
                    <span className="font-medium">Fare is negotiable</span>
                    <span className="block text-xs text-slate-500">Riders can propose a different amount and you can accept, decline or counter.</span>
                  </span>
                </label>
                <p className="text-xs text-slate-500">
                  Pool-In is for sharing journey costs, not for running a taxi service. Make sure your trip and your vehicle
                  comply with local transport rules.
                </p>
              </Section>
            </div>
          )}

          {mode === 'POOL_CAB' && (
            <div key="cab" className="animate-fade-up space-y-4">
              <Section title="Who's travelling">
                <div>
                  <span id="people-label" className="block text-sm font-medium">
                    People travelling together
                  </span>
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      type="button"
                      aria-label="Fewer people"
                      onClick={() => setValue('people', Math.max(1, (isNum(people) ? people : 1) - 1))}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white transition hover:border-brand-500 hover:bg-brand-50 active:scale-90"
                    >
                      <Minus aria-hidden className="h-4 w-4" />
                    </button>
                    <span className="flex min-w-[5rem] items-center justify-center gap-2 text-lg font-semibold tabular-nums">
                      <Users aria-hidden className="h-5 w-5 text-brand-600" />
                      <output aria-labelledby="people-label">{isNum(people) ? people : 1}</output>
                    </span>
                    <button
                      type="button"
                      aria-label="More people"
                      onClick={() => setValue('people', Math.min(MAX_PEOPLE, (isNum(people) ? people : 1) + 1))}
                      className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white transition hover:border-brand-500 hover:bg-brand-50 active:scale-90"
                    >
                      <Plus aria-hidden className="h-4 w-4" />
                    </button>
                  </div>
                  {errors.people && (
                    <p role="alert" className="mt-1 text-xs text-red-600">
                      {errors.people.message}
                    </p>
                  )}
                </div>
                <p className="rounded-lg bg-brand-50 p-3 text-xs text-slate-600">
                  We'll look for a pool that already suits your trip. If there isn't one, we'll save your request so others can
                  match with it.
                </p>
              </Section>
            </div>
          )}

          {formError && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="flex items-center gap-4">
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? 'Working…' : submitLabel}
            </button>
            <Link to="/" className="text-sm text-slate-600 underline">
              Cancel
            </Link>
          </div>
        </form>
      </div>

      {/* Route preview: on phones it sits above the form, on desktop it stays in view beside it. */}
      <aside aria-label="Route preview" className="order-first lg:sticky lg:top-24 lg:order-2 lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-white/60 bg-slate-200 shadow-xl shadow-brand-500/10">
          <div className="isolate h-72 lg:h-[28rem]">
            <RoutePreviewMap start={startPlace} end={endPlace} path={route.data?.path ?? null} />
          </div>
          <p role="status" className="flex items-start gap-2 bg-white px-4 py-3 text-sm text-slate-600">
            <RouteIcon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>{routeNote}</span>
          </p>
        </div>
      </aside>
    </div>
  )
}
