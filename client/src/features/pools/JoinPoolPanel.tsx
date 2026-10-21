import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { format } from 'date-fns'
import { z } from 'zod'
import type { GeoPosition } from '../location/useLiveLocation'

// Placeholder pool details. The real pool model (route, luggage, preferences, price) is built later;
// until then nothing here is sent or saved.
function makeSchema(needsStart: boolean) {
  return z.object({
    startText: needsStart
      ? z.string().trim().min(3, 'Enter where you are starting from').max(200)
      : z.string().trim().max(200).optional(),
    destination: z.string().trim().min(3, 'Enter where you are going').max(200),
    departAt: z
      .string()
      .min(1, 'Choose a departure date and time')
      .refine((v) => new Date(v).getTime() > Date.now(), 'Departure must be in the future'),
    seats: z.coerce.number().int('Whole numbers only').min(1, 'At least 1 seat').max(6, 'At most 6 seats'),
  })
}
type PoolForm = z.input<ReturnType<typeof makeSchema>>

const inputClass =
  'field-input mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm aria-[invalid=true]:border-red-500 read-only:bg-slate-100'

function Error({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600">
      {message}
    </p>
  ) : null
}

export function JoinPoolPanel({ position, onClose }: { position: GeoPosition | null; onClose: () => void }) {
  const [submitted, setSubmitted] = useState(false)
  const [minDeparture] = useState(() => format(new Date(), "yyyy-MM-dd'T'HH:mm"))
  const needsStart = !position

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PoolForm>({
    resolver: zodResolver(makeSchema(needsStart)),
    defaultValues: { seats: 1 },
  })

  if (submitted) {
    return (
      <div role="status" className="space-y-2 text-sm">
        <p className="font-medium">Pool matching isn't available yet.</p>
        <p className="text-slate-600">
          We're still building it. Your details were not sent or saved anywhere. Check back soon.
        </p>
        <button type="button" onClick={onClose} className="text-xs font-medium text-brand-700 underline">
          Close
        </button>
      </div>
    )
  }

  return (
    <form noValidate onSubmit={handleSubmit(() => setSubmitted(true))} className="space-y-3" aria-label="Join a pool">
      <div>
        <label htmlFor="pool-start" className="block text-sm font-medium">
          Start
        </label>
        {position ? (
          <input
            id="pool-start"
            readOnly
            className={inputClass}
            value={`Current location (${position.lat.toFixed(4)}, ${position.lng.toFixed(4)})`}
          />
        ) : (
          <input
            id="pool-start"
            className={inputClass}
            placeholder="Where are you starting from?"
            aria-invalid={!!errors.startText}
            aria-describedby={errors.startText ? 'pool-start-error' : undefined}
            {...register('startText')}
          />
        )}
        <Error id="pool-start-error" message={errors.startText?.message} />
      </div>

      <div>
        <label htmlFor="pool-destination" className="block text-sm font-medium">
          Destination
        </label>
        <input
          id="pool-destination"
          className={inputClass}
          placeholder="Where are you going?"
          aria-invalid={!!errors.destination}
          aria-describedby={errors.destination ? 'pool-destination-error' : undefined}
          {...register('destination')}
        />
        <Error id="pool-destination-error" message={errors.destination?.message} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label htmlFor="pool-departure" className="block text-sm font-medium">
            Departure
          </label>
          <input
            id="pool-departure"
            type="datetime-local"
            min={minDeparture}
            className={inputClass}
            aria-invalid={!!errors.departAt}
            aria-describedby={errors.departAt ? 'pool-departure-error' : undefined}
            {...register('departAt')}
          />
          <Error id="pool-departure-error" message={errors.departAt?.message} />
        </div>
        <div>
          <label htmlFor="pool-seats" className="block text-sm font-medium">
            Seats
          </label>
          <input
            id="pool-seats"
            type="number"
            min={1}
            max={6}
            className={inputClass}
            aria-invalid={!!errors.seats}
            aria-describedby={errors.seats ? 'pool-seats-error' : undefined}
            {...register('seats')}
          />
          <Error id="pool-seats-error" message={errors.seats?.message} />
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Luggage, preferences and price will be added when pools launch. Place search is also coming, so locations are
        plain text for now.
      </p>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary !py-2 text-sm">
          Find a pool
        </button>
        <button type="button" onClick={onClose} className="text-sm text-slate-600 underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
