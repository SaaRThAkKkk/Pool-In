import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Car } from 'lucide-react'
import { logoutUser } from '../features/auth/authApi'
import { ME_KEY, useMe } from '../features/auth/useMe'

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
        <NavLink to="/pools" end className="nav-link">
          My pools
        </NavLink>
        <NavLink to="/dashboard" className="nav-link">
          Dashboard
        </NavLink>
        <span className="hidden px-2 text-sm text-slate-500 sm:inline">{me.data.name}</span>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="btn-secondary !px-3 !py-1.5 text-sm disabled:opacity-60"
        >
          Log out
        </button>
      </>
    )
  }

  return (
    <>
      <NavLink to="/login" className="nav-link">
        Log in
      </NavLink>
      <Link to="/register" className="btn-primary ml-2 !px-4 !py-1.5 text-sm">
        Sign up
      </Link>
    </>
  )
}

export function Layout() {
  const location = useLocation()

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/75 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="group flex items-center gap-2 text-lg font-extrabold text-brand-700">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-md shadow-brand-500/30 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
              <Car aria-hidden className="h-5 w-5" />
            </span>
            Pool-In
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink to="/how-it-works" className="nav-link">
              How it works
            </NavLink>
            <NavLink to="/safety" className="nav-link">
              Safety
            </NavLink>
            <AuthLinks />
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {/* Keyed by path so each page fades in on navigation. */}
        <div key={location.pathname} className="animate-fade-up">
          <Outlet />
        </div>
      </main>
      <footer className="border-t border-slate-200/70 bg-white/70 py-4 text-center text-xs text-slate-500 backdrop-blur">
        Pool-In coordinates shared rides. Matching and verification badges are not a guarantee of safety.
      </footer>
    </div>
  )
}
