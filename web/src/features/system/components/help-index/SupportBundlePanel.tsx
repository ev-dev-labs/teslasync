import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ShieldCheck } from 'lucide-react'

import { Button, CopyButton, GlassPanel, PanelTitle, Text } from '@/components/ui'
import { useSupportBundle } from '@/api/hooks/useSupport'
import { ProblemReportModal } from '@/components/feedback/ProblemReportModal'

/**
 * Support bundle + problem report entry point (HELP-08, HELP-09).
 *
 * The bundle is shown in full before it is copied or downloaded. That is the
 * point: a user asked to send diagnostics to a stranger deserves to read
 * exactly what they are sending, and a reviewer auditing our privacy claims
 * can verify them from the UI rather than from this comment.
 *
 * The "what is never included" list is rendered as prominently as the bundle
 * itself, because the question people actually have is not "what is in it" but
 * "is my VIN in it".
 */
const NEVER_INCLUDED: ReadonlyArray<{ key: string; fallback: string }> = [
  { key: 'supportBundle.never.vin', fallback: 'Vehicle identification numbers' },
  { key: 'supportBundle.never.location', fallback: 'Locations or coordinates' },
  { key: 'supportBundle.never.tokens', fallback: 'Tokens, keys and credentials' },
  { key: 'supportBundle.never.email', fallback: 'E-mail addresses and account names' },
  { key: 'supportBundle.never.logs', fallback: 'Raw console or server logs' },
]

export function SupportBundlePanel() {
  const { t } = useTranslation()
  const { bundle, json, isLoading, download } = useSupportBundle()
  const [reportOpen, setReportOpen] = useState(false)

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="support-bundle-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PanelTitle>{t('supportBundle.title', 'Support bundle')}</PanelTitle>
          <Text as="p" variant="bodySm" className="mt-1 max-w-2xl">
            {t(
              'supportBundle.subtitle',
              'A redacted technical summary of this browser session. Copy or download it to attach to a support conversation.',
            )}
          </Text>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <CopyButton
            text={json}
            variant="secondary"
            label={t('supportBundle.copy', 'Copy bundle')}
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={download}
            disabled={isLoading}
            data-testid="support-bundle-download"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t('supportBundle.download', 'Download')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => setReportOpen(true)}
            data-testid="open-problem-report"
          >
            {t('supportBundle.reportProblem', 'Report a problem')}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-500/5 p-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
        <div className="min-w-0">
          <Text as="p" size="sm" weight="medium" color="primary">
            {t('supportBundle.neverTitle', 'Never included')}
          </Text>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5" data-testid="support-bundle-never">
            {NEVER_INCLUDED.map((item) => (
              <li key={item.key}>
                <Text as="span" variant="bodySm" color="muted">
                  {t(item.key, item.fallback)}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryCell
          label={t('supportBundle.field.version', 'App version')}
          value={bundle.app.version}
        />
        <SummaryCell
          label={t('supportBundle.field.browser', 'Browser')}
          value={`${bundle.browser.family} ${bundle.browser.major_version}`.trim()}
        />
        <SummaryCell
          label={t('supportBundle.field.health', 'Health')}
          value={bundle.health.overall}
        />
        <SummaryCell
          label={t('supportBundle.field.errors', 'Recent errors')}
          value={String(bundle.errors.length)}
        />
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
          {t('supportBundle.showJson', 'Show the exact bundle contents')}
        </summary>
        <pre
          data-testid="support-bundle-json"
          className="mt-2 max-h-80 overflow-auto rounded-md bg-[var(--surface-2)] p-2 text-2xs text-[var(--text-secondary)]"
        >
          {json}
        </pre>
      </details>

      {/* Mounted only while open. The modal owns mutation + toast hooks, and
          mounting it eagerly would make the whole Help page depend on a
          ToastProvider it does not otherwise need — and would pay for those
          hooks on every render of a panel the user has not opened. */}
      {reportOpen && <ProblemReportModal open onClose={() => setReportOpen(false)} />}
    </GlassPanel>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] p-2.5">
      <Text as="p" variant="caption">
        {label}
      </Text>
      <Text as="p" size="sm" weight="medium" color="primary" className="truncate">
        {value || '—'}
      </Text>
    </div>
  )
}
