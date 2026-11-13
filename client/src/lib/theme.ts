import { useCallback, useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'pool-in-theme'

// The saved choice if there is one; otherwise whatever the device is set to.
export function preferredTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage can be blocked (private mode); fall through to the device setting.
  }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Dark mode is a class on <html>; the colours themselves are swapped in index.css (html.dark).
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.style.colorScheme = theme
}

const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const current = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

export function setTheme(theme: Theme) {
  // Let the colours ease across for a moment instead of snapping (see html.theme-switching in index.css).
  const root = document.documentElement
  root.classList.add('theme-switching')
  setTimeout(() => root.classList.remove('theme-switching'), 400)
  applyTheme(theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Not saved: the choice still applies until the page is closed.
  }
  listeners.forEach((fn) => fn())
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme)
  const toggle = useCallback(() => setTheme(current() === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggle }
}
