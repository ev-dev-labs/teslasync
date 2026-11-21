import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { AlertBanner } from './AlertBanner'

const RECOMMENDED_BROWSERS_FALLBACK =
  'Use Chrome ≥ 110, Edge ≥ 110, Firefox ≥ 109, or Safari ≥ 16.'

interface BrowserCompatWarningProps {
  title: string
  missing: readonly string[]
  onDismiss: () => void
}

export default function BrowserCompatWarning({ title, missing, onDismiss }: BrowserCompatWarningProps) {
  const { t } = useTranslation()
  const featureList = missing.join(', ')
  const body = t(
    'compat.banner.body',
    'TeslaSync needs {{features}} to work correctly. {{recommendation}}',
    { features: featureList, recommendation: RECOMMENDED_BROWSERS_FALLBACK },
  )

  return (
    <div
      data-testid="browser-compat-banner"
      data-missing={featureList}
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[55] px-4 py-2"
    >
      <AlertBanner
        variant="warning"
        title={title}
        icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
        onClose={onDismiss}
      >
        <span data-testid="browser-compat-banner-body">{body}</span>
      </AlertBanner>
    </div>
  )
}
