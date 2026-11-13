import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, Menu, X } from 'lucide-react'
import { useServerEvent } from '../lib/socket'
import { RouteTransition } from './RouteTransition'
import { ThemeToggle } from './ThemeToggle'
import { CONVERSATIONS_KEY, INBOX_POLL_MS, fetchConversations } from '../features/chat/chatApi'
import { logoutUser } from '../features/auth/authApi'
import { ME_KEY, useMe } from '../features/auth/useMe'

// "Messages", with the number of unread messages. Refreshes when a message arrives, and every so often as a fallback.
function MessagesLink() {
  const queryClient = useQueryClient()
  const chats = useQuery({ queryKey: CONVERSATIONS_KEY, queryFn: fetchConversations, refetchInterval: INBOX_POLL_MS, retry: false })
  useServerEvent('chat:message', () => void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }))
  const unread = (chats.data ?? []).reduce((sum, c) => sum + c.unread, 0)

  return (
    <NavLink to="/chat" className="nav-link">
      Messages
      {unread > 0 && (
        <span aria-label={`${unread} unread`} className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  )
}

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
        <MessagesLink />
        <NavLink to="/dashboard" className="nav-link">
          Dashboard
        </NavLink>
        <span className="truncate px-3 py-1 text-sm text-slate-500 sm:px-2 sm:py-0">{me.data.name}</span>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="btn-secondary !px-3 !py-1.5 text-sm disabled:opacity-60 max-sm:mt-1 max-sm:!py-3"
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
      <Link to="/register" className="btn-primary !px-4 !py-1.5 text-sm max-sm:mt-1 max-sm:!py-3 sm:ml-2">
        Sign up
      </Link>
    </>
  )
}

export function Layout() {
  const location = useLocation()
  // On phones the links live in a drop-down menu; from `sm` up they sit in the header bar.
  // It remembers the page it was opened on, so navigating anywhere closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null)
  const menuOpen = openOn === location.pathname
  const setMenuOpen = (open: boolean) => setOpenOn(open ? location.pathname : null)

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Decoration only: soft colour drifting behind the page. */}
      <div aria-hidden className="aurora">
        <span />
        <span />
      </div>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/75 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="group mr-auto flex items-center gap-2 text-lg font-extrabold text-brand-700">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-brand-600 to-indigo-600 text-white shadow-md shadow-brand-500/30 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
              <Car aria-hidden className="h-5 w-5" />
            </span>
            Pool-In
          </Link>
          {/* On phones the dark-mode switch sits beside the menu button; on larger screens it follows the links. */}
          <div className="flex items-center gap-1 sm:order-last sm:ml-1">
            <ThemeToggle />
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={menuOpen}
              aria-controls="main-nav"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 sm:hidden"
            >
              {menuOpen ? <X aria-hidden className="h-6 w-6" /> : <Menu aria-hidden className="h-6 w-6" />}
            </button>
          </div>
          <nav
            id="main-nav"
            aria-label="Main"
            className={`${menuOpen ? 'flex' : 'hidden'} absolute inset-x-0 top-full flex-col items-stretch gap-1 border-b border-slate-200 bg-white/95 px-4 pb-4 pt-2 shadow-lg backdrop-blur-lg sm:static sm:flex sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-none`}
          >
            <NavLink to="/how-it-works" className="nav-link">
              How it works
            </NavLink>
            <NavLink to="/safety" className="nav-link">
              Safety
            </NavLink>
            <AuthLinks />
          </nav>
        </div>
        <RouteTransition />
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        {/* Keyed by path so each page fades in on navigation. */}
        <div key={location.pathname} className="animate-fade-up">
          <Outlet />
        </div>
      </main>
      <footer className="border-t border-slate-200/70 bg-white/70 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 text-center text-xs text-slate-500 backdrop-blur">
        Pool-In coordinates shared rides. Matching and verification badges are not a guarantee of safety.
      </footer>
    </div>
  )
}
