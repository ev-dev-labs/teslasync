/**
 * UpdateAvailableCallout — in-page callout shown above the chip bar
 * when /system/update-check reports update_available.
 *
 * This is distinct from the global <NewVersionBanner> which sits in
 * the app shell and notifies users a NEW frontend bundle has shipped
 * (asks them to reload). The callout here surfaces a server-side
 * UPGRADE — a new release of the chart/binary itself — and points
 * the operator at the GitHub release notes so they can review what's
 * new before upgrading their deployment.
 */

import { Sparkles, ExternalLink } from 'lucide-react'
import { GlassPanel } from '@/components/ui'
import { useDateFormat } from '@/hooks/useDateFormat'

interface UpdateAvailableCalloutProps {
  current: string | undefined
  latest: string | undefined
  checkedAt?: string
}

export function UpdateAvailableCallout({ current, latest, checkedAt }: UpdateAvailableCalloutProps) {
  const { formatDateTime } = useDateFormat()
  return (
    <GlassPanel
      className="overflow-hidden border border-cyan-400/20 bg-cyan-500/[0.06]"
      role="status"
      aria-live="polite"
      data-testid="update-available-callout"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="shrink-0 text-cyan-300">
          <Sparkles className="h-5 w-5" aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            Update available{latest ? ` — v${latest}` : ''}
          </p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {current ? `You're running v${current}. ` : ''}Review the release notes before upgrading your deployment.
            {checkedAt && (
              <span className="text-[var(--text-muted)]"> · Last checked {formatDateTime(checkedAt)}</span>
            )}
          </p>
        </div>
        <div className="shrink-0">
          <a
            href="https://github.com/ev-dev-labs/teslasync/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-500/20 min-h-[36px]"
          >
            View notes
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </GlassPanel>
  )
}
