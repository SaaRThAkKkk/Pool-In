import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { z } from 'zod'
import { ApiError } from '../../lib/api'
import { ME_KEY } from '../auth/useMe'
import { useLiveLocation } from '../location/useLiveLocation'
import {
  MY_POOLS_KEY,
  VEHICLE_CATEGORIES,
  categoryInfo,
  createPool,
  type CreatePoolPayload,
  type VehicleCategory,
} from './poolsApi'

const MIN_LEAD_MINUTES = 10
const MAX_FARE = 100_000

function makeSchema(needsStart: boolean) {
  return z
    .object({
      startText: needsStart
        ? z.string().trim().min(3, 'Enter where you are starting from').max(200, 'Too long (200 characters max)')
        : z.string().trim().max(200).optional(),
      endText: z.string().trim().min(3, 'Enter your destination').max(200, 'Too long (200 characters max)'),
      departAt: z
        .string()
        .min(1, 'Choose a departure date and time')
        .refine(
          (v) => new Date(v).getTime() >= Date.now() + MIN_LEAD_MINUTES * 60_000,
          `Departure must be at least ${MIN_LEAD_MINUTES} minutes from now`,
        ),
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
}
type PoolForm = z.input<ReturnType<typeof makeSchema>>

// Server validation paths -> form fields.
const SERVER_FIELD: Record<string, keyof PoolForm> = {
  'origin.label': 'startText',
  'destination.label': 'endText',
  departureAt: 'departAt',
  'vehicle.category': 'vehicleCategory',
  'vehicle.make': 'vehicleMake',
  'vehicle.model': 'vehicleModel',
  seats: 'seats',
  askingPrice: 'fare',
}

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
  const [wantsCurrent, setWantsCurrent] = useState(true)
  const [minDeparture] = useState(() => format(new Date(Date.now() + MIN_LEAD_MINUTES * 60_000), "yyyy-MM-dd'T'HH:mm"))

  const usingCurrent = Boolean(position) && wantsCurrent
  const {
    register,
    handleSubmit,
    setError,
    control,
    formState: { errors },
  } = useForm<PoolForm>({
    resolver: zodResolver(makeSchema(!usingCurrent)),
    defaultValues: { seats: 1, negotiable: false },
  })

  const category = useWatch({ control, name: 'vehicleCategory' })
  const maxSeats = category ? categoryInfo(category)?.maxPassengers : undefined
  const [formError, setFormError] = useState<string | null>(null)

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
        if (field && !(field === 'startText' && usingCurrent)) {
          setError(field, { message: d.message })
          mapped = true
        }
      }
      if (!mapped) setFormError(err.message)
    },
  })

  const onSubmit = (v: z.output<ReturnType<typeof makeSchema>>) => {
    setFormError(null)
    const payload: CreatePoolPayload = {
      origin: usingCurrent
        ? { label: 'Current location', coordinates: { lat: position!.lat, lng: position!.lng } }
        : { label: (v.startText ?? '').trim() },
      destination: { label: v.endText.trim() },
      departureAt: new Date(v.departAt).toISOString(),
      vehicle: { category: v.vehicleCategory as VehicleCategory, make: v.vehicleMake.trim(), model: v.vehicleModel.trim() },
      seats: v.seats,
      askingPrice: v.fare,
      negotiable: v.negotiable,
    }
    mutation.mutate(payload)
  }

  const describe = (id: keyof PoolForm, hint?: boolean) => (errors[id] ? `${id}-error` : hint ? `${id}-hint` : undefined)

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-2xl border border-slate-200 bg-white/95 p-6 shadow-xl shadow-brand-500/10 sm:p-8">
        <h1 className="text-3xl font-extrabold tracking-tight">Create a pool</h1>
        <p className="mt-1 text-sm text-slate-600">
          Offer seats on a trip you're already making, and share the cost with riders heading your way.
        </p>

        <form noValidate onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-8" aria-label="Create a pool">
          <Section title="Route">
            <Field
              id="startText"
              label="Starting location"
              error={errors.startText?.message}
              hint={usingCurrent ? undefined : 'Place search is coming soon, so type the area or address for now.'}
            >
              {usingCurrent ? (
                <>
                  <input
                    key="start-current"
                    id="startText"
                    readOnly
                    className={inputClass}
                    value={`Current location (${position!.lat.toFixed(4)}, ${position!.lng.toFixed(4)})`}
                  />
                  <button type="button" onClick={() => setWantsCurrent(false)} className="mt-1 text-xs text-brand-700 underline">
                    Start somewhere else
                  </button>
                </>
              ) : (
                <>
                  <input
                    key="start-typed"
                    id="startText"
                    className={inputClass}
                    placeholder="Where are you starting from?"
                    aria-invalid={!!errors.startText}
                    aria-describedby={describe('startText', true)}
                    {...register('startText')}
                  />
                  {position && (
                    <button type="button" onClick={() => setWantsCurrent(true)} className="mt-1 text-xs text-brand-700 underline">
                      Use my current location
                    </button>
                  )}
                </>
              )}
            </Field>
            <Field id="endText" label="Destination" error={errors.endText?.message}>
              <input
                id="endText"
                className={inputClass}
                placeholder="Where are you going?"
                aria-invalid={!!errors.endText}
                aria-describedby={describe('endText')}
                {...register('endText')}
              />
            </Field>
            <Field id="departAt" label="Departure" error={errors.departAt?.message}>
              <input
                id="departAt"
                type="datetime-local"
                min={minDeparture}
                className={inputClass}
                aria-invalid={!!errors.departAt}
                aria-describedby={describe('departAt')}
                {...register('departAt')}
              />
            </Field>
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
    </div>
  )
}
