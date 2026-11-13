import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preferredTheme, setTheme } from '../lib/theme'
import { RouteTransition } from './RouteTransition'
import { ThemeToggle } from './ThemeToggle'
import { TRANSITION_MS, stopFor } from './routeStops'

const systemPrefersDark = (dark: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: dark && query.includes('dark'), media: query }))

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})
afterEach(() => vi.unstubAllGlobals())

describe('dark mode', () => {
  it('follows the device setting until the person chooses, then remembers the choice', () => {
    systemPrefersDark(true)
    expect(preferredTheme()).toBe('dark')
    systemPrefersDark(false)
    expect(preferredTheme()).toBe('light')

    setTheme('dark')
    expect(preferredTheme()).toBe('dark') // the saved choice wins over the device
    expect(localStorage.getItem('pool-in-theme')).toBe('dark')
  })

  it('switches the whole page with one button, and says what the button will do', async () => {
    const u = userEvent.setup()
    render(<ThemeToggle />)

    const toDark = screen.getByRole('button', { name: /switch to dark mode/i })
    expect(toDark).toHaveAttribute('aria-pressed', 'false')
    await u.click(toDark)
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement.style.colorScheme).toBe('dark')

    const toLight = screen.getByRole('button', { name: /switch to light mode/i })
    expect(toLight).toHaveAttribute('aria-pressed', 'true')
    await u.click(toLight)
    expect(document.documentElement).not.toHaveClass('dark')
    expect(localStorage.getItem('pool-in-theme')).toBe('light')
  })
})

describe('the car that drives to each page', () => {
  function Nav() {
    const navigate = useNavigate()
    return (
      <>
        <button onClick={() => navigate('/safety')}>go safety</button>
        <button onClick={() => navigate('/chat/abc')}>go chat</button>
      </>
    )
  }
  const renderApp = () =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <RouteTransition />
        <Routes>
          <Route path="*" element={<Nav />} />
        </Routes>
      </MemoryRouter>,
    )

  it('gives every page its own stop', () => {
    const paths = ['/', '/how-it-works', '/safety', '/login', '/register', '/dashboard', '/pool-in', '/pools', '/chat', '/verify-phone']
    const labels = paths.map((p) => stopFor(p).label)
    expect(new Set(labels).size).toBe(paths.length)
    expect(new Set(paths.map((p) => stopFor(p).tone)).size).toBe(paths.length)
    expect(stopFor('/chat/123').label).toBe('Messages')
    expect(stopFor('/pools').label).toBe('My pools') // not confused with /pool-in
    expect(stopFor('/somewhere-else').label).toBe('On the way')
  })

  it('does not show on first load, shows for a moment after a page change, then goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderApp()
      expect(screen.queryByTestId('route-transition')).not.toBeInTheDocument()

      await u.click(screen.getByRole('button', { name: 'go safety' }))
      const strip = screen.getByTestId('route-transition')
      expect(strip).toHaveTextContent('Safety')
      expect(strip).toHaveAttribute('aria-hidden', 'true') // decoration only

      await u.click(screen.getByRole('button', { name: 'go chat' }))
      expect(screen.getByTestId('route-transition')).toHaveTextContent('Messages')

      await act(() => vi.advanceTimersByTimeAsync(TRANSITION_MS + 50))
      expect(screen.queryByTestId('route-transition')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
