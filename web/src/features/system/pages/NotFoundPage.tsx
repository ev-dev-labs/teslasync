import { useCallback, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Compass, Home, Search } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { Button, GlassPanel } from '@/components/ui'
import { usePageTitle } from '@/hooks/usePageTitle'
import { ROUTE_REGISTRY } from '@/lib/routeRegistry'
import { closestRoutes } from '@/lib/closestRoute'

/**
 * Catch-all 404 page.
 *
 * Wired to two `<Route path="*">` entries in App.tsx (one inside the Layout
 * Outlet, one outside) so that any unmatched URL renders this component
 * instead of an empty Outlet.
 *
 * Behavior:
 * - Logs the unmatched path via console.warn (helps spot 404 storms in dev)
 * - Suggests the closest matching routes via Levenshtein distance
 * - Offers escape hatches: back, dashboard, command palette
 */
export default function NotFoundPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  usePageTitle(t('notFound.title', 'Page not found'))

  useEffect(() => {
    console.warn('[404]', location.pathname + location.search)
  }, [location.pathname, location.search])

  const suggestions = useMemo(
    () => closestRoutes(location.pathname, ROUTE_REGISTRY, 5),
    [location.pathname],
  )

  const handleGoBack = useCallback(() => {
    // A direct hit or refresh on a bad URL leaves this 404 as the only entry
    // in the session history, so history.back() would be a no-op and trap the
    // user on the error page. Fall back to the dashboard when there is nowhere
    // to go back to.
    if (window.history.length > 1) {
      window.history.back()
    } else {
      navigate('/')
    }
  }, [navigate])

  const handleGoHome = useCallback(() => navigate('/'), [navigate])

  const openCommandPalette = useCallback(() => {
    window.dispatchEvent(new Event('toggle-command-palette'))
  }, [])

  return (
    <PageContainer title={t('notFound.title', 'Page not found')}>
      <GlassPanel className="mx-auto max-w-2xl px-6 py-12 text-center">
        <Compass
          className="mx-auto mb-4 h-12 w-12 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <h2 className="text-2xl font-semibold text-[var(--text-primary)]">
          {t('notFound.heading', "We couldn't find that page")}
        </h2>
        <p className="mt-2 break-all text-[var(--text-secondary)]">
          {t('notFound.body', {
            defaultValue: "{{path}} doesn't match any route.",
            path: location.pathname,
          })}
        </p>

        {suggestions.length > 0 && (
          <nav
            className="mt-6"
            aria-label={t('notFound.suggestionsLabel', 'Suggested pages')}
          >
            <p className="mb-2 text-sm text-[var(--text-muted)]">
              {t('notFound.didYouMean', 'Did you mean:')}
            </p>
            <ul className="flex flex-col items-center gap-2">
              {suggestions.map((s) => (
                <li key={s.path}>
                  <Link
                    to={s.path}
                    className="rounded px-1 text-cyan-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                  >
                    {t(s.i18nKey, s.label)}
                    <span className="ml-2 text-xs text-[var(--text-muted)]">
                      {s.path}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="ghost"
            onClick={handleGoBack}
            icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            {t('notFound.goBack', 'Go back')}
          </Button>
          <Button
            variant="primary"
            onClick={handleGoHome}
            icon={<Home className="h-4 w-4" aria-hidden="true" />}
          >
            {t('notFound.goHome', 'Go to dashboard')}
          </Button>
          <Button
            variant="ghost"
            onClick={openCommandPalette}
            icon={<Search className="h-4 w-4" aria-hidden="true" />}
          >
            {t('notFound.openSearch', 'Open command palette')}
          </Button>
        </div>
      </GlassPanel>
    </PageContainer>
  )
}
