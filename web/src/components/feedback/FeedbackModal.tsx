import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { z } from 'zod'

import { Button, Input, Modal, Select, Textarea, Toggle } from '@/components/ui'
import { Caption, HelperText } from '@/components/ui'
import { useSubmitFeedback } from '@/api/hooks/useFeedback'
import { getRecentReportsForFeedback } from '@/lib/errorReporter'
import type { FeedbackCategory, FeedbackSubmitInput } from '@/api/types'

// In-app feedback and bug-report modal.
//
// Captures category + title + body, optionally attaches the most-recent
// frontend error reports (from the errorReporter ring buffer) and the
// last few console messages, and POSTs the result to /api/v1/feedback.
//
// Auto-collected (visible to the user before submit so nothing is
// shipped without consent):
//  - page_route   — useLocation().pathname
//  - user_agent   — navigator.userAgent
//  - app_version  — import.meta.env.VITE_APP_VERSION
//  - recent_errors — errorReporter ring buffer (toggleable, default ON)
//  - console_tail — last N console.* messages (toggleable, default OFF
//                   for privacy — operator console output may include
//                   tokens, route data, or vehicle telemetry samples)

export interface FeedbackModalProps {
  open: boolean
  onClose: () => void
}

const FEEDBACK_TITLE_MIN = 5
const FEEDBACK_TITLE_MAX = 120
const FEEDBACK_BODY_MIN = 20
const FEEDBACK_BODY_MAX = 4000
const CONSOLE_TAIL_MAX = 4000

const schema = z.object({
  category: z.enum(['bug', 'feature', 'other']),
  title: z.string().min(FEEDBACK_TITLE_MIN).max(FEEDBACK_TITLE_MAX),
  body: z.string().min(FEEDBACK_BODY_MIN).max(FEEDBACK_BODY_MAX),
  includeRecentErrors: z.boolean(),
  includeConsoleTail: z.boolean(),
})

type FeedbackFormValues = z.infer<typeof schema>

// In-memory console.* tail. Populated lazily (and only once) when the
// user actually opens the modal so unrelated startup paths pay
// nothing. The hook below installs the wrapper on first open and
// leaves it in place for the rest of the session — re-installing
// on every open would either duplicate writes or risk losing the
// pre-open buffer.
const consoleTailBuffer: string[] = []
const CONSOLE_TAIL_BUFFER_MAX = 50
let consoleTailInstalled = false

function installConsoleTail(): void {
  if (consoleTailInstalled) return
  consoleTailInstalled = true
  if (typeof window === 'undefined' || !window.console) return
  const methods: Array<'log' | 'info' | 'warn' | 'error'> = ['log', 'info', 'warn', 'error']
  for (const method of methods) {
    const original = window.console[method].bind(window.console)
    window.console[method] = (...args: unknown[]) => {
      try {
        const ts = new Date().toISOString()
        const line = `[${ts}] [${method}] ${args
          .map((a) => {
            if (a instanceof Error) return `${a.name}: ${a.message}`
            if (typeof a === 'string') return a
            try {
              return JSON.stringify(a)
            } catch {
              return String(a)
            }
          })
          .join(' ')}`
        consoleTailBuffer.push(line)
        if (consoleTailBuffer.length > CONSOLE_TAIL_BUFFER_MAX) {
          consoleTailBuffer.splice(0, consoleTailBuffer.length - CONSOLE_TAIL_BUFFER_MAX)
        }
      } catch {
        // Never break console.* itself.
      }
      original(...args)
    }
  }
}

function getConsoleTail(): string {
  // Render newest-last so the operator reading the issue sees the
  // failure context at the bottom.
  const joined = consoleTailBuffer.join('\n')
  if (joined.length <= CONSOLE_TAIL_MAX) return joined
  return joined.slice(joined.length - CONSOLE_TAIL_MAX)
}

const initialValues: FeedbackFormValues = {
  category: 'bug',
  title: '',
  body: '',
  includeRecentErrors: true,
  includeConsoleTail: false,
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const submit = useSubmitFeedback()
  const [values, setValues] = useState<FeedbackFormValues>(initialValues)
  const [touched, setTouched] = useState<Record<keyof FeedbackFormValues, boolean>>({
    category: false,
    title: false,
    body: false,
    includeRecentErrors: false,
    includeConsoleTail: false,
  })

  useEffect(() => {
    if (open) installConsoleTail()
  }, [open])

  // Clear the form on close so a stale draft doesn't leak between
  // submissions / different bug reports.
  //
  // We intentionally exclude `submit` from the dep array: TanStack
  // Query re-creates the mutation object on every internal state
  // change — including the very `reset()` call below — which would
  // re-fire this effect and create an infinite render loop while the
  // modal is closed. The reset only needs to run on the open→closed
  // transition, so depending on `open` alone is correct.
  useEffect(() => {
    if (!open) {
      setValues(initialValues)
      setTouched({
        category: false,
        title: false,
        body: false,
        includeRecentErrors: false,
        includeConsoleTail: false,
      })
      submit.reset()
    }
  }, [open])

  const validation = useMemo(() => schema.safeParse(values), [values])
  const errors = useMemo(() => {
    if (validation.success) return {} as Partial<Record<keyof FeedbackFormValues, string>>
    const out: Partial<Record<keyof FeedbackFormValues, string>> = {}
    for (const issue of validation.error.issues) {
      const path = issue.path[0]
      if (typeof path === 'string') {
        out[path as keyof FeedbackFormValues] = issue.message
      }
    }
    return out
  }, [validation])

  const categoryOptions = useMemo(
    () => [
      { value: 'bug', label: t('feedback.category.bug', 'Bug report') },
      { value: 'feature', label: t('feedback.category.feature', 'Feature request') },
      { value: 'other', label: t('feedback.category.other', 'Other / question') },
    ],
    [t],
  )

  const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? ''
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''

  const recentErrors = useMemo(() => {
    if (!open || !values.includeRecentErrors) return []
    return getRecentReportsForFeedback()
  }, [open, values.includeRecentErrors])

  const handleChange = <K extends keyof FeedbackFormValues>(key: K, value: FeedbackFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleBlur = (key: keyof FeedbackFormValues) => {
    setTouched((prev) => ({ ...prev, [key]: true }))
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setTouched({ category: true, title: true, body: true, includeRecentErrors: true, includeConsoleTail: true })
    if (!validation.success) return
    const payload: FeedbackSubmitInput = {
      category: values.category as FeedbackCategory,
      title: values.title.trim(),
      body: values.body.trim(),
      page_route: location.pathname,
      user_agent: userAgent,
      app_version: appVersion,
    }
    if (values.includeRecentErrors && recentErrors.length > 0) {
      payload.recent_errors = recentErrors
    }
    if (values.includeConsoleTail) {
      const tail = getConsoleTail()
      if (tail.length > 0) payload.console_tail = tail
    }
    try {
      await submit.mutateAsync(payload)
      onClose()
    } catch {
      // Toast is rendered by useSubmitFeedback's onError; surface inline
      // error in the form via submit.error below.
    }
  }

  const isSubmitting = submit.isPending
  const submitDisabled = isSubmitting || !validation.success

  return (
    <Modal open={open} onClose={onClose} title={t('feedback.title', 'Report a bug / Send feedback')} size="lg">
      <form onSubmit={onSubmit} className="space-y-4" data-testid="feedback-form">
        <Select
          label={t('feedback.form.category.label', 'What kind of feedback?')}
          value={values.category}
          onChange={(e) => handleChange('category', e.target.value as FeedbackCategory)}
          options={categoryOptions}
          aria-label={t('feedback.form.category.label', 'What kind of feedback?')}
        />

        <Input
          label={t('feedback.form.title.label', 'Title')}
          placeholder={t('feedback.form.title.placeholder', 'Short summary (e.g. "Battery widget shows NaN")')}
          value={values.title}
          onChange={(e) => handleChange('title', e.target.value)}
          onBlur={() => handleBlur('title')}
          error={touched.title ? errors.title : undefined}
          maxLength={FEEDBACK_TITLE_MAX}
          required
          aria-required
        />

        <Textarea
          label={t('feedback.form.body.label', 'Details')}
          placeholder={t('feedback.form.body.placeholder', 'What happened? What did you expect to happen? Steps to reproduce help a lot.')}
          value={values.body}
          onChange={(e) => handleChange('body', e.target.value)}
          onBlur={() => handleBlur('body')}
          error={touched.body ? errors.body : undefined}
          rows={6}
          maxLength={FEEDBACK_BODY_MAX}
          required
          aria-required
        />

        <div className="rounded-md border border-[var(--glass-border)] bg-[var(--surface-1)] p-3 space-y-3">
          <Caption>{t('feedback.context.title', 'Auto-attached context')}</Caption>
          <ul className="text-xs text-[var(--text-secondary)] space-y-1">
            <li>
              <strong>{t('feedback.context.page', 'Page')}:</strong>{' '}
              <code className="text-[var(--text-primary)]">{location.pathname}</code>
            </li>
            <li>
              <strong>{t('feedback.context.appVersion', 'App version')}:</strong>{' '}
              <code className="text-[var(--text-primary)]">{appVersion || t('feedback.context.unknown', 'unknown')}</code>
            </li>
            <li>
              <strong>{t('feedback.context.userAgent', 'Browser')}:</strong>{' '}
              <span className="break-all text-[var(--text-primary)]">{userAgent || t('feedback.context.unknown', 'unknown')}</span>
            </li>
          </ul>

          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <Toggle
                checked={values.includeRecentErrors}
                onChange={(v) => handleChange('includeRecentErrors', v)}
                label={t('feedback.form.includeErrors', 'Attach recent errors ({{count}})', { count: getRecentReportsForFeedback().length })}
              />
              <HelperText>
                {t('feedback.form.includeErrorsHint', 'Includes the most recent uncaught errors from this session. Helps reproduce the bug.')}
              </HelperText>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <Toggle
                checked={values.includeConsoleTail}
                onChange={(v) => handleChange('includeConsoleTail', v)}
                label={t('feedback.form.includeConsole', 'Attach recent console messages')}
              />
              <HelperText>
                {t('feedback.form.includeConsoleHint', 'Privacy: console output may include URLs and data you saw. Off by default.')}
              </HelperText>
            </div>
          </div>
        </div>

        {submit.isError && (
          <p role="alert" className="text-xs text-red-500" data-testid="feedback-submit-error">
            {t('feedback.submitError', 'Failed to submit feedback. Please try again.')}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="submit" disabled={submitDisabled} data-testid="feedback-submit">
            {isSubmitting ? t('feedback.form.submitting', 'Submitting…') : t('feedback.form.submit', 'Send feedback')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default FeedbackModal
