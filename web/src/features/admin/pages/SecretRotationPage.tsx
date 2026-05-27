/**
 * Secret Rotation Page — Phase-45 admin observability surface.
 *
 * Per-(kind, target) rotation tracker. Surfaces the age of every
 * tracked secret (Tesla refresh token, MQTT mTLS cert, DB password,
 * session JWK, Authentik client secret, app signing key) with a
 * severity tier computed against per-kind warn/critical thresholds
 * on the server.
 *
 * Backed by GET /api/v1/admin/observability/secret-rotation
 * (internal/handler/v1/admin_observability_handler.go).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, AlertTriangle } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, DataTable, type Column } from '@/components/ui';
import { PanelTitle, Caption } from '@/components/ui/Typography';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, AlertBanner, SectionErrorBoundary } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { useSecretRotation } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type {
  SecretRotationSeverity,
  SecretRotationStatus,
} from '@/types/admin-operator-confidence';

const SEVERITY_VARIANT: Record<SecretRotationSeverity, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  warn: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

const SEVERITY_LABEL: Record<SecretRotationSeverity, string> = {
  ok: 'OK',
  warn: 'Rotate soon',
  critical: 'Overdue',
  unknown: '—',
};

export default function SecretRotationPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.secretRotation.pageTitle', 'Secret Rotation'));

  const query = useSecretRotation();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;
  const items = query.data?.items ?? [];

  const counts = useMemo(() => {
    let ok = 0;
    let warn = 0;
    let critical = 0;
    for (const it of items) {
      if (it.severity === 'ok') ok += 1;
      else if (it.severity === 'warn') warn += 1;
      else if (it.severity === 'critical') critical += 1;
    }
    return { ok, warn, critical, total: items.length };
  }, [items]);

  const columns = useMemo<Column<SecretRotationStatus>[]>(
    () => [
      {
        key: 'kind',
        header: t('admin.secretRotation.colKind', 'Kind'),
        render: (r) => (
          <div className="flex flex-col">
            <span className="font-medium text-[var(--text-primary)]">{formatKind(r.kind)}</span>
            {r.target_id && <Caption>{r.target_id}</Caption>}
          </div>
        ),
      },
      {
        key: 'rotated',
        header: t('admin.secretRotation.colRotated', 'Last rotated'),
        render: (r) => (
          <div>
            <div className="text-[var(--text-primary)]">{formatDateTime(r.last_rotated)}</div>
            <Caption>{formatRelative(r.last_rotated)}</Caption>
          </div>
        ),
      },
      {
        key: 'age',
        header: t('admin.secretRotation.colAge', 'Age (days)'),
        align: 'right',
        render: (r) => <span className="tabular-nums">{fmtNumber(r.age_days)}</span>,
      },
      {
        key: 'expiry',
        header: t('admin.secretRotation.colExpiry', 'Expires'),
        render: (r) => {
          if (!r.expires_at) return <span className="text-[var(--text-secondary)]">—</span>;
          return (
            <div>
              <div className="text-[var(--text-primary)]">{formatDateTime(r.expires_at)}</div>
              <Caption>
                {r.days_to_expiry !== null && r.days_to_expiry !== undefined
                  ? t('admin.secretRotation.daysToExpiry', '{{days}}d remaining', { days: r.days_to_expiry })
                  : ''}
              </Caption>
            </div>
          );
        },
      },
      {
        key: 'thresholds',
        header: t('admin.secretRotation.colThresholds', 'Warn / critical'),
        align: 'right',
        render: (r) => (
          <span className="tabular-nums">
            {fmtNumber(r.warn_days)}d / {fmtNumber(r.critical_days)}d
          </span>
        ),
      },
      {
        key: 'severity',
        header: t('admin.secretRotation.colSeverity', 'Severity'),
        align: 'right',
        render: (r) => (
          <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}>
            {SEVERITY_LABEL[r.severity] ?? r.severity}
          </Badge>
        ),
      },
    ],
    [t],
  );

  return (
    <PageContainer
      title={t('admin.secretRotation.pageTitle', 'Secret Rotation')}
      subtitle={t(
        'admin.secretRotation.subtitle',
        'Status of every tracked credential. Severity reflects per-kind warn/critical thresholds; rotate anything in the critical tier as soon as possible.',
      )}
      query={query}
    >
      <FadeIn>
        <div className="space-y-6">
          {subsystemMissing && (
            <AlertBanner variant="warning" title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.secretRotation.notConfigured',
                'The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.',
              )}
            </AlertBanner>
          )}

          {counts.critical > 0 && (
            <AlertBanner variant="danger" title={t('admin.secretRotation.criticalTitle', 'Overdue rotations')}>
              {t(
                'admin.secretRotation.criticalMessage',
                '{{count}} secrets are past their critical rotation threshold. These should be rotated immediately to reduce blast radius.',
                { count: counts.critical },
              )}
            </AlertBanner>
          )}

          {items.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label={t('admin.secretRotation.totalLabel', 'Tracked secrets')}
                value={fmtNumber(counts.total)}
                icon={<ShieldCheck className="h-5 w-5" />}
              />
              <StatCard
                label={t('admin.secretRotation.okLabel', 'OK')}
                value={fmtNumber(counts.ok)}
              />
              <StatCard
                label={t('admin.secretRotation.warnLabel', 'Warn')}
                value={fmtNumber(counts.warn)}
              />
              <StatCard
                label={t('admin.secretRotation.criticalLabel', 'Critical')}
                value={fmtNumber(counts.critical)}
                icon={counts.critical > 0 ? <AlertTriangle className="h-5 w-5 text-rose-300" /> : null}
              />
            </div>
          )}

          <GlassPanel className="p-6">
            <PanelTitle className="mb-4">{t('admin.secretRotation.tableTitle', 'Rotation status')}</PanelTitle>
            <SectionErrorBoundary name="secret-rotation-table">
              {items.length === 0 && !query.isLoading && !subsystemMissing ? (
                // no-action: rotation events are recorded automatically by the rotation tracker; no user action seeds them
                <EmptyState
                  icon={<ShieldCheck className="h-8 w-8" />}
                  title={t('admin.secretRotation.emptyTitle', 'No tracked secrets')}
                  message={t(
                    'admin.secretRotation.emptyMessage',
                    'No rotation events have been recorded yet. The tracker captures observations on every credential rotation.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="admin:secret-rotation"
                  columns={columns}
                  data={items}
                  keyExtractor={(r) => `${r.kind}:${r.target_id ?? ''}`}
                  emptyMessage={t('admin.secretRotation.emptyTable', 'No tracked secrets')}
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </div>
      </FadeIn>
    </PageContainer>
  );
}

// Map raw kind enum to a friendly label. Falls back to the raw value
// so newly-added kinds still render before this map is updated.
const KIND_LABELS: Record<string, string> = {
  tesla_refresh_token: 'Tesla refresh token',
  mqtt_mtls_cert: 'MQTT mTLS certificate',
  database_password: 'Database password',
  session_jwk: 'Session JWK',
  app_signing_key: 'App signing key',
  authentik_secret: 'Authentik client secret',
};

function formatKind(raw: string): string {
  return KIND_LABELS[raw] ?? raw;
}
