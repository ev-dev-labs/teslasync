import { useCallback, useEffect, useRef, useState, type ComponentProps, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { FileWarning, X } from 'lucide-react'
import { Button, Modal } from '@/components/ui/runtime'
import { Text } from '@/components/ui/Typography'
import { captureAppDesignOrigin, type AppDesignOriginSnapshot } from '@/components/ui/appDesignOrigin'
import { reportFrontendError } from '@/lib/errorReporter'
import { AlertBanner } from './AlertBanner'
import type { DraftRestoreReviewContent } from './DraftRestoreReviewContent'
import {
  discardDraftEnvelope,
  getDrafts,
  subscribeDraftIndex,
  type DraftEntry,
} from '@/lib/draftIndex'
import { subscribe as subscribeBroadcast, TAB_ID } from '@/lib/broadcast'

/**
 * Draft restore prompt.
 *
 * Surfaces unsaved `useFormDraft` work after a tab close, browser crash,
 * PWA reload, or auth redirect. Mounted once globally in `Layout.tsx`,
 * the prompt:
 *
 *  1. Listens for `formDraft.acquired` / `formDraft.released` broadcasts
 *     from sibling tabs during a 1.5 s grace period after mount, building
 *     a set of draft keys that are being actively edited elsewhere right
 *     now.
 *  2. Reads {@link getDrafts} (which scans both the explicit registry AND
 *     unregistered envelopes) and filters out anything in the active set.
 *  3. If anything remains, renders a compact bottom-left card with a
 *     "Review" affordance that opens a modal listing every draft with
 *     individual "Resume" and "Discard" actions.
 *
 * One-shot per tab session: a sessionStorage flag suppresses re-prompting
 * during the same session even after the user navigates around the app.
 * A hard reload (new session) re-prompts; a fresh tab after a crash
 * re-prompts.
 */

const PROMPT_GRACE_MS = 1500

const SESSION_DISMISS_KEY = 'teslasync:draft-prompt-shown:v1'

function readDismissed(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1')
  } catch {
    /* private mode — best-effort, prompt will simply re-fire on next reload */
  }
}

interface DraftRestorePromptProps {
  /**
   * Test seam: shorten the grace period used to collect cross-tab
   * `formDraft.acquired` broadcasts before the prompt evaluates. Defaults
   * to {@link PROMPT_GRACE_MS}. Production callers should never set this.
   */
  gracePeriodMs?: number
  /**
   * Test seam: skip the sessionStorage one-shot guard. Production
   * callers should never set this.
   */
  skipSessionGuard?: boolean
}

function ReviewBody(props: ComponentProps<typeof DraftRestoreReviewContent>) {
  const { t } = useTranslation()
  const [Content, setContent] = useState<typeof DraftRestoreReviewContent | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadFailed(false)
    void import('./DraftRestoreReviewContent').then(module => {
      if (!cancelled) setContent(() => module.DraftRestoreReviewContent)
    }, error => {
      if (cancelled) return
      reportFrontendError(error, 'react')
      setLoadFailed(true)
    })
    return () => { cancelled = true }
  }, [attempt])

  return Content ? <Content {...props} /> : loadFailed ? (
    <AlertBanner variant="danger" role="alert">
      {t('errorBoundary.inlineTitle', 'Component failed to load')}
      <Button variant="secondary" onClick={() => setAttempt(value => value + 1)}>
        {t('error.retry', 'Retry')}
      </Button>
    </AlertBanner>
  ) : <Text role="status">{t('a11y.loading', 'Loading')}</Text>
}

export function DraftRestorePrompt({
  gracePeriodMs = PROMPT_GRACE_MS,
  skipSessionGuard = false,
}: DraftRestorePromptProps = {}) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [drafts, setDrafts] = useState<DraftEntry[]>([])
  const [showPrompt, setShowPrompt] = useState(false)
  const [reviewOrigin, setReviewOrigin] = useState<AppDesignOriginSnapshot>()
  const reviewOpen = reviewOrigin !== undefined
  const evaluatedRef = useRef(false)

  // Mount-time evaluation: collect cross-tab `acquired` broadcasts during
  // the grace period, then surface anything left over once.
  useEffect(() => {
    if (evaluatedRef.current) return
    evaluatedRef.current = true
    if (!skipSessionGuard && readDismissed()) return

    const activeKeys = new Set<string>()
    const unsubBus = subscribeBroadcast((msg) => {
      if (msg.type === 'formDraft.acquired') {
        if (msg.tabId === TAB_ID) return
        activeKeys.add(msg.draftKey)
      } else if (msg.type === 'formDraft.released' || msg.type === 'formDraft.committed') {
        const key = 'draftKey' in msg ? msg.draftKey : null
        if (key) activeKeys.delete(key)
      }
    })

    const timer = window.setTimeout(() => {
      const all = getDrafts()
      const surfaced = all.filter((d) => !activeKeys.has(d.storageKey))
      if (surfaced.length > 0) {
        setDrafts(surfaced)
        setShowPrompt(true)
      }
      unsubBus()
    }, gracePeriodMs)

    return () => {
      window.clearTimeout(timer)
      unsubBus()
    }
  }, [gracePeriodMs, skipSessionGuard])

  // Keep the modal in sync with the index — if the user discards in a
  // sibling tab while the modal is open, the row should disappear here too.
  useEffect(() => {
    if (!reviewOpen) return
    const handler = () => {
      setDrafts((prev) => {
        if (prev.length === 0) return prev
        const fresh = getDrafts()
        const freshByKey = new Map(fresh.map((d) => [d.storageKey, d]))
        const next = prev
          .map((d) => freshByKey.get(d.storageKey))
          .filter((d): d is DraftEntry => Boolean(d))
        if (next.length === 0) {
          setReviewOrigin(undefined)
          setShowPrompt(false)
        }
        return next
      })
    }
    return subscribeDraftIndex(handler)
  }, [reviewOpen])

  const handleDismiss = useCallback(() => {
    writeDismissed()
    setShowPrompt(false)
    setReviewOrigin(undefined)
  }, [])

  const handleReview = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    setReviewOrigin(captureAppDesignOrigin(event.currentTarget))
  }, [])

  const handleResume = useCallback(
    (entry: DraftEntry) => {
      writeDismissed()
      setReviewOrigin(undefined)
      setShowPrompt(false)
      // React Router doesn't accept arbitrary external URLs, but since
      // every recovery route is an in-app pathname (resolved at register
      // time from `window.location.pathname`), `navigate` is safe.
      try {
        navigate(entry.route)
      } catch {
        // Defensive: if the route isn't a valid in-app path, fall back
        // to a hard navigation so the user still gets there.
        try { window.location.assign(entry.route) } catch { /* swallow */ }
      }
    },
    [navigate],
  )

  const handleDiscard = useCallback((entry: DraftEntry) => {
    discardDraftEnvelope(entry.storageKey)
    setDrafts((prev) => {
      const next = prev.filter((d) => d.storageKey !== entry.storageKey)
      if (next.length === 0) {
        setReviewOrigin(undefined)
        setShowPrompt(false)
      }
      return next
    })
  }, [])

  const count = drafts.length

  if (!showPrompt && !reviewOpen) return null

  return (
    <>
      {showPrompt && !reviewOpen && (
        <div
          role="status"
          aria-live="polite"
          data-testid="draft-restore-prompt"
          className="fixed bottom-4 left-4 z-[90] max-w-sm rounded-lg border border-amber-300/30 bg-[var(--surface-1)] p-3 shadow-xl forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-amber-300/15 p-1.5 shrink-0">
              <FileWarning className="h-4 w-4 text-amber-300" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {t('draft.recovery.promptTitle', 'Unsaved drafts restored')}
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {t('draft.recovery.promptBody', {
                  count,
                  defaultValue_one: 'You have {{count}} unsaved draft from a previous session.',
                  defaultValue_other: 'You have {{count}} unsaved drafts from a previous session.',
                  defaultValue: 'You have {{count}} unsaved drafts from a previous session.',
                })}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleReview}
                  data-testid="draft-restore-prompt-review"
                >
                  {t('draft.recovery.review', 'Review')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDismiss}
                  data-testid="draft-restore-prompt-dismiss"
                >
                  {t('draft.recovery.dismiss', 'Dismiss')}
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={t('draft.recovery.close', 'Close')}
              className="shrink-0 rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <Modal
        open={reviewOpen}
        onClose={handleDismiss}
        title={t('draft.recovery.modalTitle', 'Restore unsaved drafts')}
        size="md"
        data-testid="draft-restore-modal"
        originSnapshot={reviewOrigin}
      >
        <ReviewBody drafts={drafts} handleResume={handleResume} handleDiscard={handleDiscard} handleDismiss={handleDismiss} />
      </Modal>
    </>
  )
}

/** Test-only helper: clear the per-session one-shot guard. */
export function __resetDraftRestorePromptForTests(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(SESSION_DISMISS_KEY)
  } catch {
    /* ignore */
  }
}
