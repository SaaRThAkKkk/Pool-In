import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from './routes'

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response(JSON.stringify({ success: true, data: { status: 'ok', db: 'connected' } }))),
)

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('routes', () => {
  it('renders the landing page', async () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: /share the ride/i })).toBeInTheDocument()
    expect(await screen.findByText(/database connected/i)).toBeInTheDocument()
  })

  it('renders a not-found page for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
  })
})
