import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../lib/theme'

// Switches between the light and dark look. The choice is remembered on this device.
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="theme-toggle flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 transition-colors hover:bg-slate-100 sm:h-9 sm:w-9"
    >
      {/* Keyed so the new icon spins in each time the mode changes. */}
      <span key={theme} className="theme-toggle-icon flex">
        {dark ? <Sun aria-hidden className="h-5 w-5" /> : <Moon aria-hidden className="h-5 w-5" />}
      </span>
    </button>
  )
}
