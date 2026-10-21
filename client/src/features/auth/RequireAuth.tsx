import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useMe } from './useMe'

// Route guard for signed-in pages. This only improves the experience; the server still authorises every request.
export function RequireAuth() {
  const me = useMe()
  const location = useLocation()

  if (me.isPending) return <p role="status">Loading…</p>
  if (me.isError) return <p role="alert">Could not load your account. Please refresh.</p>
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}
