import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SAFETY_ITEMS } from '../features/safety/safetyContent'
import { SafetyPage } from './SafetyPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <SafetyPage />
    </MemoryRouter>,
  )
}

const card = (id: string) => screen.getByTestId(`safety-card-${id}`)
const cardButton = (id: string) => within(card(id)).getByRole('button')
const detailOf = (id: string) => card(id).querySelector('[data-open]') as HTMLElement

describe('SafetyPage', () => {
  it('has a heading and an honest introduction', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: /safety on pool-in/i })).toBeInTheDocument()
    expect(screen.getByText(/can't remove it/i)).toBeInTheDocument()
    expect(screen.getByText(/hover over a card, or tap it/i)).toBeInTheDocument()
  })

  it('shows every safety point as its own card, not as a bullet list of text', () => {
    renderPage()
    const grid = screen.getByRole('list', { name: /safety measures/i })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(SAFETY_ITEMS.length)
    expect(SAFETY_ITEMS.length).toBeGreaterThanOrEqual(8)
    for (const item of SAFETY_ITEMS) {
      expect(within(card(item.id)).getByText(item.title, { selector: 'span.text-xl' })).toBeInTheDocument()
      expect(within(card(item.id)).getByText(item.summary)).toBeInTheDocument()
    }
  })

  it('keeps each card\'s detailed text available, and tied to its button for screen readers', () => {
    renderPage()
    for (const item of SAFETY_ITEMS) {
      expect(within(card(item.id)).getByText(item.details)).toBeInTheDocument()
      expect(cardButton(item.id)).toHaveAccessibleDescription(item.details)
    }
  })

  it('starts with every card closed, and a tap opens and closes it', async () => {
    const u = userEvent.setup()
    renderPage()
    const id = 'women-only'

    expect(cardButton(id)).toHaveAttribute('aria-expanded', 'false')
    expect(detailOf(id)).toHaveAttribute('data-open', 'false')

    await u.click(cardButton(id))
    expect(cardButton(id)).toHaveAttribute('aria-expanded', 'true')
    expect(detailOf(id)).toHaveAttribute('data-open', 'true')

    await u.click(cardButton(id))
    expect(cardButton(id)).toHaveAttribute('aria-expanded', 'false')
  })

  it('holds only one card open at a time', async () => {
    const u = userEvent.setup()
    renderPage()

    await u.click(cardButton('badges'))
    await u.click(cardButton('emergency'))

    expect(cardButton('emergency')).toHaveAttribute('aria-expanded', 'true')
    expect(cardButton('badges')).toHaveAttribute('aria-expanded', 'false')
  })

  it('works from the keyboard: Tab to a card, Enter to open, Escape to close', async () => {
    const u = userEvent.setup()
    renderPage()

    cardButton('phone-verification').focus()
    await u.keyboard('{Enter}')
    expect(cardButton('phone-verification')).toHaveAttribute('aria-expanded', 'true')

    await u.keyboard('{Escape}')
    expect(cardButton('phone-verification')).toHaveAttribute('aria-expanded', 'false')
  })

  it('is honest about what exists: women-only pools and report/block are planned, the emergency number is live', () => {
    renderPage()
    // The status chip is on the front of the card (inside its button).
    // (It carries a screen-reader-only "Status: " prefix.)
    const chip = (id: string) =>
      within(cardButton(id))
        .getByText(/(Live|Rolling out|Planned)$/)
        .textContent!.replace(/^Status:\s*/, '')
    expect(chip('women-only')).toBe('Planned')
    expect(chip('report-block')).toBe('Planned')
    expect(chip('live-sharing')).toBe('Planned')
    expect(chip('trusted-contact')).toBe('Planned')
    expect(chip('emergency')).toBe('Live')
    expect(chip('your-location')).toBe('Live')
    expect(chip('phone-verification')).toBe('Rolling out')
  })

  it('explains the status labels', () => {
    renderPage()
    const legend = screen.getByRole('list', { name: /what the labels mean/i })
    expect(within(legend).getByText(/works in the app today/i)).toBeInTheDocument()
    expect(within(legend).getByText(/built, still being switched on/i)).toBeInTheDocument()
    expect(within(legend).getByText(/coming, not built yet/i)).toBeInTheDocument()
  })

  it('says verification and matching are not guarantees, and never promises a feature that does not exist', () => {
    renderPage()
    expect(screen.getByText(/no safety feature, badge or match is a guarantee/i)).toBeInTheDocument()
    expect(within(card('badges')).getByText(/never means someone has been vetted or is safe/i)).toBeInTheDocument()
    expect(within(card('women-only')).getByText(/never a guarantee of personal safety/i)).toBeInTheDocument()
    // Anything not built yet must be worded in the future tense.
    for (const id of ['women-only', 'live-sharing', 'report-block', 'trusted-contact']) {
      expect(SAFETY_ITEMS.find((i) => i.id === id)!.details).toMatch(/you'll be able to|will (always )?be|will review|will be/i)
    }
  })

  it('has a one-tap emergency call link to 112', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /call 112/i })).toHaveAttribute('href', 'tel:112')
  })
})
