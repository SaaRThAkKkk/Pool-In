import { useEffect, useRef, useState, type ReactNode } from 'react'

// Fades its children in the first time they scroll into view. Without IntersectionObserver
// (very old browsers, test environments) the content is simply shown.
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const [visible, setVisible] = useState(!canObserve)

  useEffect(() => {
    const el = ref.current
    if (!el || !canObserve) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [canObserve])

  return (
    <div
      ref={ref}
      className={`${visible ? 'animate-fade-up' : 'opacity-0'} ${className}`}
      style={visible ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  )
}
