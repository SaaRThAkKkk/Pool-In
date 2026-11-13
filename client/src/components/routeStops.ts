import {
  CarFront,
  Compass,
  Home,
  LayoutDashboard,
  LogIn,
  MapPinned,
  MessagesSquare,
  Navigation,
  ShieldCheck,
  Smartphone,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'

export interface Stop {
  label: string
  icon: LucideIcon
  /** The colour of this page's stop, so each arrival looks a little different. */
  tone: string
}

/** How long the car is on screen after a page change. Matches the animations in index.css (.route-transition). */
export const TRANSITION_MS = 1100

// Where the car is heading: every page has its own stop.
export function stopFor(pathname: string): Stop {
  if (pathname === '/') return { label: 'Home', icon: Home, tone: 'from-brand-600 to-indigo-600' }
  if (pathname.startsWith('/how-it-works')) return { label: 'How it works', icon: Compass, tone: 'from-violet-600 to-fuchsia-600' }
  if (pathname.startsWith('/safety')) return { label: 'Safety', icon: ShieldCheck, tone: 'from-emerald-600 to-teal-600' }
  if (pathname.startsWith('/login')) return { label: 'Log in', icon: LogIn, tone: 'from-sky-600 to-brand-600' }
  if (pathname.startsWith('/register')) return { label: 'Sign up', icon: UserPlus, tone: 'from-sky-600 to-indigo-600' }
  if (pathname.startsWith('/dashboard')) return { label: 'Dashboard', icon: LayoutDashboard, tone: 'from-indigo-600 to-violet-600' }
  if (pathname.startsWith('/pool-in')) return { label: 'Pool In', icon: MapPinned, tone: 'from-brand-600 to-cyan-600' }
  if (pathname.startsWith('/pools')) return { label: 'My pools', icon: CarFront, tone: 'from-amber-500 to-orange-600' }
  if (pathname.startsWith('/chat')) return { label: 'Messages', icon: MessagesSquare, tone: 'from-rose-500 to-pink-600' }
  if (pathname.startsWith('/verify-phone')) return { label: 'Verify phone', icon: Smartphone, tone: 'from-teal-600 to-emerald-600' }
  return { label: 'On the way', icon: Navigation, tone: 'from-slate-600 to-slate-800' }
}
