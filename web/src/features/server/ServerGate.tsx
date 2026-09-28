import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { needsServerSetup } from '@/lib/serverConnection'

/**
 * Server gate.
 *
 * First-run redirect guard for the generic native shells (docs/apps.md):
 * a bundled UI with no picked server would fire every query at the
 * bundle origin, so it is sent to /connect instead. Mirrors the
 * non-blocking shape of <OnboardingGate> — renders nothing, redirects
 * via effect, and allow-lists the connect page itself so the gate can
 * never trap the user in a loop.
 */
export function ServerGate() {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.pathname === '/connect') return
    if (!needsServerSetup()) return
    navigate('/connect', { replace: true })
  }, [location.pathname, navigate])

  return null
}
