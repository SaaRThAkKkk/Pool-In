import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Car } from 'lucide-react'
import { logoutUser } from '../features/auth/authApi'
import { ME_KEY, useMe } from '../features/auth/useMe'

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-2 text-sm font-medium ${isActive ? 'text-brand-700' : 'text-slate-600 hover:text-slate-900'}`

function AuthLinks() {
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const location = useLocation()
  const clearOnHome = useRef(false)

  const logout = useMutation({
    mutationFn: logoutUser,
    // Whether or not the request succeeds, stop showing the user as signed in on this page.
    onSettled: () => {
      if (location.pathname === '/') {
        queryClient.setQueryData(ME_KEY, null)
      } else {
        clearOnHome.current = true
        navigate('/', { replace: true })
      }
    },
  })

  // Clear the user only once we have actually arrived on the home page. Clearing it while still on a
  // protected page would make that page redirect to /login before the navigation to / takes effect.
  useEffect(() => {
    if (clearOnHome.current && location.pathname === '/') {
      clearOnHome.current = false
      queryClient.setQueryData(ME_KEY, null)
    }
  }, [location.pathname, queryClient])

  if (me.isPending) return null // avoid flashing the wrong links while we find out

  if (me.data) {
    return (
      <>
        <NavLink to="/dashboard" className={navClass}>
          Dashboard
        </NavLink>
        <span className="hidden px-2 text-sm text-slate-500 sm:inline">{me.data.name}</span>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
        >
          Log out
        </button>
      </>
    )
  }

  return (
    <>
      <NavLink to="/login" className={navClass}>
        Log in
      </NavLink>
      <Link
        to="/register"
        className="ml-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Sign up
      </Link>
    </>
  )
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-bold text-brand-700">
            <Car aria-hidden className="h-6 w-6" /> Pool-In
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/how-it-works" className={navClass}>
              How it works
            </NavLink>
            <NavLink to="/safety" className={navClass}>
              Safety
            </NavLink>
            <AuthLinks />
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        Pool-In coordinates shared rides. Matching and verification badges are not a guarantee of safety.
      </footer>
    </div>
  )
}
