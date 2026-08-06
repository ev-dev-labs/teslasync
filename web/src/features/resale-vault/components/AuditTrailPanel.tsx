/**
 * Audit trail panel — a chronological, read-only view of this browser's
 * local vault activity log (key lifecycle + report sign/export/import/
 * verify events). Purely local bookkeeping, never embedded in a signed
 * report and never transmitted anywhere.
 *
 * Loads its own data on mount (via `listAuditEvents`) rather than taking
 * the log as a prop, so it can be dropped into the page independently and
 * refreshed on demand after actions taken in sibling panels.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Badge, Button } from '@/components/ui';
import { PanelTitle, HelperText } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { History, RefreshCw } from 'lucide-react';
import { listAuditEvents } from '../lib/auditTrail';
import type { AuditAction, AuditEntry } from '../lib/types';

const ACTION_BADGE_VARIANT: Record<AuditAction, 'info' | 'success' | 'warning' | 'danger'> = {
  key_generated: 'success',
  key_rotated: 'info',
  key_revoked: 'danger',
  report_signed: 'success',
  report_exported: 'info',
  report_imported: 'info',
  report_verified: 'warning',
};

const ACTION_LABELS: Record<AuditAction, [string, string]> = {
  key_generated: ['resaleVault.audit.action.keyGenerated', 'Key generated'],
  key_rotated: ['resaleVault.audit.action.keyRotated', 'Key rotated'],
  key_revoked: ['resaleVault.audit.action.keyRevoked', 'Key revoked'],
  report_signed: ['resaleVault.audit.action.reportSigned', 'Report signed'],
  report_exported: ['resaleVault.audit.action.reportExported', 'Report exported'],
  report_imported: ['resaleVault.audit.action.reportImported', 'Report imported'],
  report_verified: ['resaleVault.audit.action.reportVerified', 'Report verified'],
};

export interface AuditTrailPanelProps {
  /** Bumping this number (e.g. after a sibling panel signs/imports a report) triggers a reload. */
  refreshToken?: number;
}

export function AuditTrailPanel({ refreshToken }: AuditTrailPanelProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const rows = await listAuditEvents();
      setEntries(rows);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <div className="flex items-center justify-between">
        <PanelTitle>{t('resaleVault.audit.title', 'Audit Trail')}</PanelTitle>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void load()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
            {t('resaleVault.audit.refresh', 'Refresh')}
          </Button>
          <History className="h-4 w-4 text-[var(--text-muted)]" aria-hidden />
        </div>
      </div>

      <HelperText>
        {t(
          'resaleVault.audit.subtitle',
          'A local, chronological record of key and report activity in this browser. Never embedded in a signed report or sent anywhere.',
        )}
      </HelperText>

      {isLoading ? (
        <HelperText>{t('resaleVault.audit.loading', 'Loading audit log…')}</HelperText>
      ) : entries.length === 0 ? (
        // no-action: the Refresh button in this panel's own header re-runs load(); real resolution is generating a key or signing a report in another tab.
        <EmptyState
          title={t('resaleVault.audit.emptyTitle', 'No activity yet')}
          message={t('resaleVault.audit.emptyDescription', 'Generate a key or sign a report to start the local audit trail.')}
        />
      ) : (
        <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
          {entries.map((entry) => {
            const [key, fallback] = ACTION_LABELS[entry.action] ?? [entry.action, entry.action];
            return (
              <li key={entry.id} className="rounded-lg border border-white/[0.06] p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={ACTION_BADGE_VARIANT[entry.action] ?? 'info'}>{t(key, fallback)}</Badge>
                  <span className="font-mono text-[var(--text-muted)]">{entry.ts}</span>
                </div>
                <p className="mt-1 text-[var(--text-secondary)]">{entry.detail}</p>
              </li>
            );
          })}
        </ul>
      )}
    </GlassPanel>
  );
}
