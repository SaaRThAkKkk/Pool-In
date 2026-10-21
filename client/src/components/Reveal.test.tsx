import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Reveal } from './Reveal'

afterEach(() => vi.unstubAllGlobals())

describe('Reveal', () => {
  it('shows its content straight away when IntersectionObserver is unavailable', () => {
    render(<Reveal>hello</Reveal>)
    expect(screen.getByText('hello')).toHaveClass('animate-fade-up')
  })

  it('stays hidden until scrolled into view, then animates in once', () => {
    let callback: IntersectionObserverCallback = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb
        }
        observe() {}
        disconnect = disconnect
      },
    )

    render(<Reveal>hello</Reveal>)
    const wrapper = screen.getByText('hello')
    expect(wrapper).toHaveClass('opacity-0')

    act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(wrapper).toHaveClass('animate-fade-up')
    expect(wrapper).not.toHaveClass('opacity-0')
    expect(disconnect).toHaveBeenCalled()
  })
})
