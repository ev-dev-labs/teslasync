import { useTranslation } from 'react-i18next'
import { History, Trash2 } from 'lucide-react'

import { GlassPanel, IconBox, Button, PanelTitle, Text } from '@/components/ui'

interface RecentPagesPanelProps {
  /** Number of entries currently stored — drives the counter + disabled state. */
  count: number
  /** Open the clear-confirmation dialog (owned by the page). */
  onClear: () => void
}

/**
 * "Recently viewed pages" control. Presentational: the page owns the live
 * counter (via `subscribeRecentPages`) and the confirm dialog; this panel just
 * renders the current count and the clear affordance. When nothing is stored it
 * still renders (button disabled) with a helpful empty hint — never a blank card.
 */
export function RecentPagesPanel({ count, onClear }: RecentPagesPanelProps) {
  const { t } = useTranslation()

  // `count` is sourced from `getRecentPages().length` today, but a non-finite,
  // negative, or fractional value must never leak into the label
  // ("NaN entries stored") or wrongly enable the clear button. Clamp to a
  // non-negative integer at the display boundary.
  const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  const isEmpty = safeCount === 0

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="privacy-recent-section">
      <div className="flex items-start gap-3">
        <IconBox color="cyan">
          <History className="h-5 w-5" aria-hidden="true" />
        </IconBox>
        <div className="min-w-0 flex-1 space-y-1">
          <PanelTitle>{t('recentPages.clearTitle', 'Recently viewed pages')}</PanelTitle>
          <Text as="p" variant="caption" className="max-w-prose">
            {t(
              'recentPages.clearBody',
              'Wipe the list of pages used by the dashboard widget and the Recent section in the command palette.',
            )}
          </Text>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4">
        <div className="min-w-0">
          <Text
            as="p"
            variant="bodySm"
            className="tabular-nums"
            role="status"
            aria-live="polite"
            data-testid="privacy-recent-count"
          >
            {t('recentPages.storedCount', {
              count: safeCount,
              defaultValue: '{{count}} entries stored',
            })}
          </Text>
          {isEmpty && (
            <Text as="p" variant="caption" className="mt-1">
              {t('recentPages.empty', 'Pages you visit will appear here for quick access.')}
            </Text>
          )}
        </div>
        <Button
          variant="secondary"
          onClick={onClear}
          disabled={isEmpty}
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          data-testid="privacy-clear-recent-pages"
        >
          {t('recentPages.clearButton', 'Clear recent pages')}
        </Button>
      </div>
    </GlassPanel>
  )
}

export default RecentPagesPanel
