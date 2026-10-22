import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Route as RouteIcon } from 'lucide-react'
import { z } from 'zod'
import { ApiError } from '../../lib/api'
import { ME_KEY } from '../auth/useMe'
import { useLiveLocation } from '../location/useLiveLocation'
import { PlaceAutocomplete } from '../maps/PlaceAutocomplete'
import { RoutePreviewMap } from '../maps/RoutePreviewMap'
import { fetchRoute, formatDistance, formatDuration, type Place } from '../maps/mapsApi'
import {
  MY_POOLS_KEY,
  VEHICLE_CATEGORIES,
  categoryInfo,
  createPool,
  type CreatePoolPayload,
  type PlaceInput,
  type VehicleCategory,
} from './poolsApi'

const MAX_FARE = 100_000

const schema = z
  .object({
    startText: z.string().trim().min(3, 'Enter where you are starting from').max(200, 'Too long (200 characters max)'),
    endText: z.string().trim().min(3, 'Enter your destination').max(200, 'Too long (200 characters max)'),
    vehicleCategory: z.string().refine((v) => !!categoryInfo(v), 'Choose a vehicle type'),
    vehicleMake: z.string().trim().min(2, 'Enter the vehicle make').max(40, 'Too long (40 characters max)'),
    vehicleModel: z.string().trim().min(1, 'Enter the vehicle model').max(40, 'Too long (40 characters max)'),
    seats: z.number({ error: 'Enter the number of seats' }).int('Seats must be a whole number').min(1, 'Offer at least 1 seat'),
    fare: z
      .number({ error: 'Enter the fare' })
      .min(0, 'Fare cannot be negative')
      .max(MAX_FARE, `Fare cannot exceed ₹${MAX_FARE.toLocaleString('en-IN')}`)
      .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Fare can have at most 2 decimal places'),
    negotiable: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const max = categoryInfo(v.vehicleCategory)?.maxPassengers
    if (max !== undefined && v.seats > max) {
      ctx.addIssue({
        code: 'custom',
        path: ['seats'],
        message: `A ${categoryInfo(v.vehicleCategory)!.label} can offer at most ${max} seats`,
      })
    }
  })
type PoolForm = z.input<typeof schema>

// Server validation paths -> form fields.
const SERVER_FIELD: Record<string, keyof PoolForm> = {
  'origin.label': 'startText',
  'destination.label': 'endText',
  'vehicle.category': 'vehicleCategory',
  'vehicle.make': 'vehicleMake',
  'vehicle.model': 'vehicleModel',
  seats: 'seats',
  askingPrice: 'fare',
}

const CURRENT_LABEL = 'Current location'
const round = (n: number, digits: number) => Number(n.toFixed(digits))

const inputClass =
  'field-input mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm aria-[invalid=true]:border-red-500 read-only:bg-slate-100'

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="text-sm font-semibold uppercase tracking-wide text-brand-700">{title}</legend>
      {children}
    </fieldset>
  )
}

export function CreatePoolPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { position } = useLiveLocation()

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
  const startPlace = startChoice === 'auto' ? currentPlace : startChoice

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors },
  } = useForm<PoolForm>({
    resolver: zodResolver(schema),
    defaultValues: { startText: '', endText: '', seats: 1, negotiable: false },
  })

  useEffect(() => {
    if (startChoice === 'auto' && currentPlace) setValue('startText', CURRENT_LABEL, { shouldValidate: false })
  }, [startChoice, currentPlace, setValue])

  const category = useWatch({ control, name: 'vehicleCategory' })
  const maxSeats = category ? categoryInfo(category)?.maxPassengers : undefined
  const [formError, setFormError] = useState<string | null>(null)

  // Route preview once both ends are confirmed places.
  const route = useQuery({
    queryKey: ['route', startPlace?.lat, startPlace?.lng, endPlace?.lat, endPlace?.lng],
    queryFn: () => fetchRoute(startPlace!, endPlace!),
    enabled: Boolean(startPlace && endPlace),
    retry: false,
    staleTime: 10 * 60_000,
  })

  const mutation = useMutation({
    mutationFn: createPool,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_POOLS_KEY })
      navigate('/pools', { state: { created: true } })
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
    // If search is down, typed text is accepted so the owner is not blocked.
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

    const payload: CreatePoolPayload = {
      origin: placeInput(startPlace, v.startText),
      destination: placeInput(endPlace, v.endText),
      vehicle: { category: v.vehicleCategory as VehicleCategory, make: v.vehicleMake.trim(), model: v.vehicleModel.trim() },
      seats: v.seats,
      askingPrice: v.fare,
      negotiable: v.negotiable,
    }
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
        : "Couldn't preview the route right now. You can still create the pool."
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

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-brand-500/10 sm:p-8 lg:order-1">
        <h1 className="text-3xl font-extrabold tracking-tight">Create a pool</h1>
        <p className="mt-1 text-sm text-slate-600">
          Offer seats on a trip you're already making, and share the cost with riders heading your way.
        </p>

        <form noValidate onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-8" aria-label="Create a pool">
          <Section title="Route">
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
          </Section>

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

          {formError && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </p>
          )}

          <div className="flex items-center gap-4">
            <button type="submit" disabled={mutation.isPending} className="btn-primary">
              {mutation.isPending ? 'Creating pool…' : 'Create pool'}
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
