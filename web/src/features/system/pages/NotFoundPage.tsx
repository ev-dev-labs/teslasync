import { useCallback, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Compass, Home, Search } from 'lucide-react'

import { PageLayout } from '@/components/layout'
import { Button, BUTTON_BASE, GlassPanel, SectionTitle, Text, Caption } from '@/components/ui'
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
 * - Logs the unmatched path in development (helps spot 404 storms in dev)
 * - Suggests the closest matching routes via Levenshtein distance
 * - Offers escape hatches: back, dashboard, command palette
 */
export default function NotFoundPage() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  usePageTitle(t('notFound.title', 'Page not found'))

  useEffect(() => {
    // Preserve the development diagnostic without exposing URLs in production.
    if (import.meta.env.DEV) {
      console.warn('[404]', location.pathname + location.search)
    }
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
    <PageLayout title={t('notFound.title', 'Page not found')}>
      <GlassPanel className="mx-auto min-w-0 w-full max-w-2xl p-4 text-center sm:p-6">
        <Compass
          className="mx-auto mb-4 h-12 w-12 text-[var(--text-muted)]"
          aria-hidden="true"
        />
        <SectionTitle>
          {t('notFound.heading', "We couldn't find that page")}
        </SectionTitle>
        <Text as="p" variant="body" className="mt-2 break-all">
          {t('notFound.body', {
            defaultValue: "{{path}} doesn't match any route.",
            path: location.pathname,
          })}
        </Text>

        {suggestions.length > 0 && (
          <nav
            className="mt-6"
            aria-label={t('notFound.suggestionsLabel', 'Suggested pages')}
          >
            <Caption as="p" className="mb-2">
              {t('notFound.didYouMean', 'Did you mean:')}
            </Caption>
            <ul className="flex min-w-0 flex-col items-center gap-2">
              {suggestions.map((s) => (
                <li key={s.path} className="min-w-0 max-w-full">
                  <Link
                    to={s.path}
                    className={`${BUTTON_BASE} min-h-11 max-w-full flex-wrap px-3 py-2 text-[var(--text-primary)] hover:underline forced-colors:text-[LinkText]`}
                  >
                    {t(s.i18nKey, s.label)}
                    <Caption as="span" className="max-w-full break-all">
                      {s.path}
                    </Caption>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="ghost"
            wrapLabel
            className="min-h-11 w-full sm:w-auto"
            onClick={handleGoBack}
            icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            {t('notFound.goBack', 'Go back')}
          </Button>
          <Button
            variant="primary"
            wrapLabel
            className="min-h-11 w-full sm:w-auto"
            onClick={handleGoHome}
            icon={<Home className="h-4 w-4" aria-hidden="true" />}
          >
            {t('notFound.goHome', 'Go to dashboard')}
          </Button>
          <Button
            variant="ghost"
            wrapLabel
            className="min-h-11 w-full sm:w-auto"
            onClick={openCommandPalette}
            icon={<Search className="h-4 w-4" aria-hidden="true" />}
          >
            {t('notFound.openSearch', 'Open command palette')}
          </Button>
        </div>
      </GlassPanel>
    </PageLayout>
  )
}
