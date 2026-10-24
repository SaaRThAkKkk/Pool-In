import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PATHS, STEPS } from '../features/howItWorks/howItWorksContent'
import { HowItWorksPage } from './HowItWorksPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <HowItWorksPage />
    </MemoryRouter>,
  )
}

const card = (id: string) => screen.getByTestId(`step-${id}`)
const cardButton = (id: string) => within(card(id)).getByRole('button')
const detailOf = (id: string) => card(id).querySelector('[data-open]') as HTMLElement

describe('HowItWorksPage: the journey', () => {
  it('has a heading and an introduction that points at the hover/tap cards', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: /how pool-in works/i })).toBeInTheDocument()
    expect(screen.getByText(/hover over a card, or tap it/i)).toBeInTheDocument()
  })

  it('shows every step as its own numbered square card, in order', () => {
    renderPage()
    const steps = screen.getByRole('list', { name: /^steps$/i })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(STEPS.length)
    expect(STEPS.length).toBe(9)

    STEPS.forEach((step, i) => {
      expect(card(step.id)).toHaveTextContent(step.title)
      expect(within(card(step.id)).getByText(step.summary)).toBeInTheDocument()
      expect(screen.getByTestId(`step-${step.id}-step`)).toHaveTextContent(String(i + 1))
    })
  })

  it('tells the story in the order a person lives it: sign up, verify, Pool In, trip, choose, match, agree, room, travel', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['account', 'verify', 'pool-in', 'trip', 'choose', 'match', 'agree', 'room', 'travel'])
  })

  it('keeps each step\'s detail available, tied to its button for screen readers', () => {
    renderPage()
    for (const step of STEPS) {
      expect(within(card(step.id)).getByText(step.details)).toBeInTheDocument()
      expect(cardButton(step.id)).toHaveAccessibleDescription(step.details)
    }
  })

  it('opens and closes a card with a tap, one at a time', async () => {
    const u = userEvent.setup()
    renderPage()

    expect(cardButton('trip')).toHaveAttribute('aria-expanded', 'false')
    await u.click(cardButton('trip'))
    expect(cardButton('trip')).toHaveAttribute('aria-expanded', 'true')
    expect(detailOf('trip')).toHaveAttribute('data-open', 'true')

    await u.click(cardButton('match'))
    expect(cardButton('match')).toHaveAttribute('aria-expanded', 'true')
    expect(cardButton('trip')).toHaveAttribute('aria-expanded', 'false')

    await u.click(cardButton('match'))
    expect(cardButton('match')).toHaveAttribute('aria-expanded', 'false')
  })

  it('works from the keyboard: Enter opens, Escape closes', async () => {
    const u = userEvent.setup()
    renderPage()

    cardButton('account').focus()
    await u.keyboard('{Enter}')
    expect(cardButton('account')).toHaveAttribute('aria-expanded', 'true')
    await u.keyboard('{Escape}')
    expect(cardButton('account')).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('HowItWorksPage: honesty about what exists', () => {
  const chip = (id: string) =>
    within(cardButton(id))
      .getByText(/(Live|Rolling out|Planned)$/)
      .textContent!.replace(/^Status:\s*/, '')

  it('marks what works today as Live, and what is not built yet as Planned', () => {
    renderPage()
    for (const id of ['account', 'pool-in', 'trip', 'choose']) expect(chip(id)).toBe('Live')
    expect(chip('verify')).toBe('Rolling out')
    for (const id of ['match', 'agree', 'room', 'travel']) expect(chip(id)).toBe('Planned')
  })

  it('says outright that matching is not live yet', () => {
    renderPage()
    expect(within(card('match')).getByText(/matching isn't live yet/i)).toBeInTheDocument()
    const today = screen.getByRole('region', { name: /where things stand today/i })
    expect(within(today).getByText(/nobody can find or join a pool yet/i)).toBeInTheDocument()
  })

  it('words unbuilt steps in the future tense, never as if they already work', () => {
    for (const id of ['match', 'agree', 'room', 'travel']) {
      expect(STEPS.find((s) => s.id === id)!.details).toMatch(/you'll be able to|we'll search|will get|will be/i)
    }
  })

  it('explains the status labels', () => {
    renderPage()
    const legend = screen.getByRole('list', { name: /what the labels mean/i })
    expect(within(legend).getByText(/works in the app today/i)).toBeInTheDocument()
    expect(within(legend).getByText(/coming, not built yet/i)).toBeInTheDocument()
  })

  it('does not claim Pool-In books or pays for cabs', () => {
    renderPage()
    expect(screen.getByText(/does not book, change or pay for third-party cabs/i)).toBeInTheDocument()
    expect(screen.getByText(/estimate until the group agrees/i)).toBeInTheDocument()
  })
})

describe('HowItWorksPage: the two ways to pool', () => {
  it('describes both options, what the user enters, and what happens', () => {
    renderPage()
    const ways = screen.getByRole('list', { name: /ways to pool/i })
    expect(PATHS.map((p) => p.title)).toEqual(['I own the vehicle', 'Pool a cab'])

    const owner = within(ways).getByRole('heading', { name: 'I own the vehicle' }).closest('li')!
    expect(within(owner).getByText(/vehicle type, make and model/i)).toBeInTheDocument()
    expect(within(owner).getByText(/a fare per passenger/i)).toBeInTheDocument()
    expect(within(owner).getByText(/saved in the car-owner section/i)).toBeInTheDocument()

    const cab = within(ways).getByRole('heading', { name: 'Pool a cab' }).closest('li')!
    expect(within(cab).getByText(/how many people are travelling/i)).toBeInTheDocument()
    expect(within(cab).getByText(/both sections/i)).toBeInTheDocument()
    expect(within(cab).getByText(/saved in the cab section/i)).toBeInTheDocument()
  })
})

describe('HowItWorksPage: calls to action', () => {
  it('links to the Pool In page and to the safety page', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /^pool in$/i })).toHaveAttribute('href', '/pool-in')
    expect(screen.getByRole('link', { name: /how we think about safety/i })).toHaveAttribute('href', '/safety')
  })
})
