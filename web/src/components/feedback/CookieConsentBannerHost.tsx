import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useVersionInfo } from '@/api/hooks/useSettings'
import { Text } from '@/components/ui/Typography'
import { getConsent, subscribeConsent } from '@/lib/cookieConsent'
import { ErrorBoundary } from './ErrorBoundary'

const CookieConsentBanner = lazy(() => import('./CookieConsentBanner'))

export function CookieConsentBannerHost() {
  const { t } = useTranslation()
  const { data } = useVersionInfo()
  const [consent, setConsent] = useState(getConsent)

  useEffect(() => {
    setConsent(getConsent())
    return subscribeConsent(setConsent)
  }, [])

  if (!data?.require_cookie_consent || consent !== 'unknown') return null

  return (
    <ErrorBoundary name="Cookie consent" inline>
      <Suspense fallback={
        <Text as="p" variant="bodySm" role="status"
          className="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-3xl rounded-xl border border-[var(--glass-border)] bg-[var(--surface-1)] p-4">
          {t('consent.banner.loading', 'Loading privacy choices...')}
        </Text>
      }>
        <CookieConsentBanner />
      </Suspense>
    </ErrorBoundary>
  )
}
