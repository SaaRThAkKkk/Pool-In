import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ModeChoice } from './ModeChoice'

describe('ModeChoice', () => {
  it('offers exactly the two ways to pool, neither chosen at first', () => {
    render(<ModeChoice value={null} onChange={() => {}} />)

    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.textContent)).toEqual([
      expect.stringContaining('I own the vehicle'),
      expect.stringContaining('Pool a cab'),
    ])
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(screen.getByRole('radiogroup', { name: /how do you want to pool/i })).toBeInTheDocument()
  })

  it('reports the choice, and marks only the chosen card', async () => {
    const onChange = vi.fn()
    const u = userEvent.setup()
    const { rerender } = render(<ModeChoice value={null} onChange={onChange} />)

    await u.click(screen.getByRole('radio', { name: /pool a cab/i }))
    expect(onChange).toHaveBeenCalledWith('POOL_CAB')

    rerender(<ModeChoice value="POOL_CAB" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: /pool a cab/i })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /i own the vehicle/i })).toHaveAttribute('aria-checked', 'false')

    await u.click(screen.getByRole('radio', { name: /i own the vehicle/i }))
    expect(onChange).toHaveBeenLastCalledWith('OWN_VEHICLE')
  })

  it('shows an error message when one is given', () => {
    render(<ModeChoice value={null} onChange={() => {}} error="Choose how you want to pool" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Choose how you want to pool')
  })
})
