import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { AlertBanner } from './AlertBanner'
import { Button } from '@/components/ui'
import { useEditLease } from '@/hooks/useEditLease'

/**
 * Phase-46 / Prompt 66 — In-place "another tab is editing this" warning.
 *
 * Wraps {@link useEditLease} for a `resourceKey` and renders an
 * {@link AlertBanner} only when this tab does NOT currently own the
 * edit lease AND a peer tab has been observed claiming it.
 *
 * The banner exposes two affordances per the design:
 *
 *   - **Take over editing** — calls `claim()` on the lease, which
 *     bumps `claimedAt` and broadcasts a fresh `lease.granted`. The
 *     previous owner's banner appears in lockstep.
 *   - **Switch to other tab** — informational only. Browsers do not
 *     expose a programmatic "focus another tab of the same origin"
 *     API; the affordance exists so the user knows their other-tab
 *     editing session is still safe.
 *
 * Auto-disappears when the owning tab releases the lease (closes the
 * form, navigates away, or its `beforeunload` fires).
 */
export interface EditConflictBannerProps {
  /**
   * Stable identifier for the resource being edited. Two tabs with the
   * same `resourceKey` race to own the edit lease; different keys are
   * independent. Convention is `<feature>/<scope>/<id>` — e.g.
   * `settings/anonymous/general`, `automation/42`, `alert-rules/list`.
   */
  resourceKey: string
  /**
   * Optional human-readable noun used in the banner copy. Falls back
   * to a generic "this resource" string when omitted.
   */
  resourceLabel?: string
}

export function EditConflictBanner({
  resourceKey,
  resourceLabel,
}: EditConflictBannerProps) {
  const { t } = useTranslation()
  const { isOwner, otherTab, claim } = useEditLease(resourceKey)

  // No banner when this tab is the owner OR when no peer has announced
  // ownership yet — a fresh page load with no peer is not a conflict.
  if (isOwner || otherTab === null) return null

  const title = t(
    'editConflict.banner.title',
    'Another browser tab is editing this',
  )
  const body = resourceLabel
    ? t(
        'editConflict.banner.bodyWithLabel',
        '{{resource}} is open in another tab of this browser. Saving here will overwrite changes made there.',
        { resource: resourceLabel },
      )
    : t(
        'editConflict.banner.body',
        'This resource is open in another tab of this browser. Saving here will overwrite changes made there.',
      )

  return (
    <div
      data-testid="edit-conflict-banner"
      data-resource-key={resourceKey}
      data-other-tab-id={otherTab.tabId}
      role="status"
      aria-live="polite"
    >
      <AlertBanner
        variant="warning"
        title={title}
        icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
      >
        <span>{body}</span>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={claim}
            data-testid="edit-conflict-take-over"
          >
            {t('editConflict.banner.takeOver', 'Take over editing')}
          </Button>
          <span
            data-testid="edit-conflict-switch-hint"
            className="text-xs text-[var(--text-muted)]"
          >
            {t(
              'editConflict.banner.switchHint',
              'Or switch to your other tab to keep editing there.',
            )}
          </span>
        </div>
      </AlertBanner>
    </div>
  )
}

export default EditConflictBanner
