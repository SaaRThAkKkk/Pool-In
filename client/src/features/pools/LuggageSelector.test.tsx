import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { LuggageSelector } from './LuggageSelector'
import { EMPTY_LUGGAGE, MAX_LUGGAGE_PER_TYPE, type Luggage } from './poolsApi'

let latest: Luggage = EMPTY_LUGGAGE

function Harness({ initial = EMPTY_LUGGAGE }: { initial?: Luggage }) {
  const [value, setValue] = useState(initial)
  return (
    <LuggageSelector
      value={value}
      onChange={(next) => {
        latest = next // remember the last value reported, for the assertions
        setValue(next)
      }}
    />
  )
}

describe('LuggageSelector', () => {
  it('lists every luggage category, starting at zero', () => {
    render(<Harness />)
    for (const name of [/large suitcases/i, /medium suitcases/i, /cabin bags/i, /backpacks/i, /oversized/i]) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('status')).toHaveLength(5)
    expect(screen.getByText(/travelling light/i)).toBeInTheDocument()
  })

  it('adds and removes items per category', async () => {
    const u = userEvent.setup()
    render(<Harness />)

    await u.click(screen.getByRole('button', { name: /more large suitcases/i }))
    await u.click(screen.getByRole('button', { name: /more large suitcases/i }))
    await u.click(screen.getByRole('button', { name: /more cabin bags/i }))
    expect(latest).toEqual({ large: 2, medium: 0, cabin: 1, backpack: 0, oversized: 0 })
    expect(screen.getByText(/3 items in total/i)).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: /fewer large suitcases/i }))
    expect(latest.large).toBe(1)
  })

  it('cannot go below zero or above the maximum', async () => {
    const u = userEvent.setup()
    render(<Harness initial={{ ...EMPTY_LUGGAGE, backpack: MAX_LUGGAGE_PER_TYPE }} />)

    expect(screen.getByRole('button', { name: /fewer large suitcases/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /more backpacks/i })).toBeDisabled()
    await u.click(screen.getByRole('button', { name: /fewer backpacks/i }))
    expect(latest.backpack).toBe(MAX_LUGGAGE_PER_TYPE - 1)
  })

  it('says luggage sizes are approximate', () => {
    render(<Harness />)
    expect(screen.getByText(/sizes are approximate/i)).toBeInTheDocument()
  })

  it('uses a singular "item" for one item', async () => {
    const u = userEvent.setup()
    render(<Harness />)
    await u.click(screen.getByRole('button', { name: /more oversized/i }))
    expect(screen.getByText(/1 item in total/i)).toBeInTheDocument()
  })
})
