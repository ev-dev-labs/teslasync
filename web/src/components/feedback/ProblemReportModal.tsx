import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'

import { Button, Input, Modal, Textarea, Toggle } from '@/components/ui'
import { Caption, HelperText, Text } from '@/components/ui'
import { CopyButton } from '@/components/ui'
import { useSubmitProblemReport, useSupportBundle } from '@/api/hooks/useSupport'
import {
  ATTACHMENT_POLICY,
  PROBLEM_REPORT_LIMITS,
  previewProblemReport,
  validateProblemReport,
  type ProblemReportInput,
} from '@/lib/problemReport'
import { normalizeRouteTemplate } from '@/lib/routeTemplate'

/**
 * Report a problem from the current page (HELP-09).
 *
 * Differs from `<FeedbackModal>` in three ways that matter:
 *
 *  - The transmitted page is the route TEMPLATE (`/drives/:id`), not the raw
 *    pathname, so record ids and share tokens never leave the browser.
 *  - Diagnostics are the redacted support bundle projection, attached only on
 *    explicit consent, and the exact JSON is shown before sending.
 *  - The attachment policy is closed: no console tail, no files, no
 *    screenshots, no e-mail address — at any consent level.
 */
export interface ProblemReportModalProps {
  open: boolean
  onClose: () => void
}

export function ProblemReportModal({ open, onClose }: ProblemReportModalProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const { bundle } = useSupportBundle()
  const submit = useSubmitProblemReport()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // Reset on close so a second report never inherits the first one's consent
  // decision — consent must be given per submission, not once per session.
  useEffect(() => {
    if (open) return
    setTitle('')
    setDescription('')
    setIncludeDiagnostics(false)
    setShowPreview(false)
  }, [open])

  const routeTemplate = useMemo(
    () => normalizeRouteTemplate(location.pathname),
    [location.pathname],
  )

  const input: ProblemReportInput = useMemo(
    () => ({
      title,
      description,
      pathname: location.pathname,
      includeDiagnostics,
      bundle,
      appVersion: bundle.app.version,
      browserSummary: `${bundle.browser.family} ${bundle.browser.major_version}`.trim(),
    }),
    [title, description, location.pathname, includeDiagnostics, bundle],
  )

  const validation = useMemo(() => validateProblemReport(input), [input])
  const preview = useMemo(
    () => (showPreview ? previewProblemReport(input) : ''),
    [showPreview, input],
  )

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!validation.valid || submit.isPending) return
    try {
      await submit.mutateAsync(input)
      onClose()
    } catch {
      // Toast is raised by the mutation; the inline error below covers the
      // case where the toast host is not mounted.
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('problemReport.title', 'Report a problem')}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4" data-testid="problem-report-form">
        <Text as="p" variant="bodySm">
          {t(
            'problemReport.intro',
            'Describe what happened in your own words. We attach a redacted technical summary only if you allow it.',
          )}
        </Text>

        <Input
          label={t('problemReport.form.title', 'What went wrong?')}
          placeholder={t(
            'problemReport.form.titlePlaceholder',
            'Short summary (e.g. "Charging costs show as blank")',
          )}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={PROBLEM_REPORT_LIMITS.titleMax}
          required
          aria-required
        />

        <Textarea
          label={t('problemReport.form.description', 'What were you doing, and what did you expect?')}
          placeholder={t(
            'problemReport.form.descriptionPlaceholder',
            'Steps you took, what you saw, and what you expected to see instead.',
          )}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={6}
          maxLength={PROBLEM_REPORT_LIMITS.descriptionMax}
          required
          aria-required
        />
        {validation.errors.includes('description_too_short') && description.length > 0 && (
          <HelperText>
            {t('problemReport.form.descriptionTooShort', 'Please add at least {{count}} characters.', {
              count: PROBLEM_REPORT_LIMITS.descriptionMin,
            })}
          </HelperText>
        )}

        <div className="space-y-3 rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] p-3">
          <Caption>{t('problemReport.context.title', 'What is sent with your report')}</Caption>
          <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
            <li data-testid="problem-report-route">
              <strong>{t('problemReport.context.page', 'Page')}:</strong>{' '}
              <code className="text-[var(--text-primary)]">{routeTemplate}</code>{' '}
              <span className="text-[var(--text-muted)]">
                {t('problemReport.context.pageNote', '(record ids are replaced with :id)')}
              </span>
            </li>
            <li>
              <strong>{t('problemReport.context.appVersion', 'App version')}:</strong>{' '}
              <code className="text-[var(--text-primary)]">{bundle.app.version}</code>
            </li>
            <li>
              <strong>{t('problemReport.context.browser', 'Browser')}:</strong>{' '}
              <code className="text-[var(--text-primary)]">
                {`${bundle.browser.family} ${bundle.browser.major_version}`.trim()}
              </code>
            </li>
          </ul>

          <Toggle
            checked={includeDiagnostics}
            onChange={setIncludeDiagnostics}
            label={t(
              'problemReport.form.includeDiagnostics',
              'Attach a redacted technical summary ({{count}} recent errors)',
              { count: bundle.errors.length },
            )}
          />
          <HelperText>
            {t(
              'problemReport.form.includeDiagnosticsHint',
              'Versions, browser capability, service health, error messages and trace IDs. Never VINs, locations, tokens, e-mail addresses or raw logs.',
            )}
          </HelperText>

          <ul className="space-y-0.5 text-2xs text-[var(--text-muted)]" data-testid="attachment-policy">
            <li>
              {t('problemReport.policy.consoleTail', 'Console output')}: {ATTACHMENT_POLICY.consoleTail}
            </li>
            <li>
              {t('problemReport.policy.files', 'File attachments')}: {ATTACHMENT_POLICY.files}
            </li>
            <li>
              {t('problemReport.policy.screenshots', 'Screenshots')}: {ATTACHMENT_POLICY.screenshots}
            </li>
            <li>
              {t('problemReport.policy.userEmail', 'E-mail address')}: {ATTACHMENT_POLICY.userEmail}
            </li>
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowPreview((value) => !value)}
              data-testid="problem-report-preview-toggle"
            >
              {showPreview
                ? t('problemReport.form.hidePreview', 'Hide exactly what is sent')
                : t('problemReport.form.showPreview', 'Show exactly what is sent')}
            </Button>
            {showPreview && <CopyButton text={preview} />}
          </div>

          {showPreview && (
            <pre
              data-testid="problem-report-preview"
              className="max-h-64 overflow-auto rounded-md bg-[var(--surface-2)] p-2 text-2xs text-[var(--text-secondary)]"
            >
              {preview}
            </pre>
          )}
        </div>

        {submit.isError && (
          <Text as="p" variant="error" role="alert" data-testid="problem-report-error">
            {t('problemReport.submitError', 'Could not send the report. Please try again.')}
          </Text>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submit.isPending}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            disabled={!validation.valid || submit.isPending}
            data-testid="problem-report-submit"
          >
            {submit.isPending
              ? t('problemReport.form.submitting', 'Sending…')
              : t('problemReport.form.submit', 'Send report')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default ProblemReportModal
