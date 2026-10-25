import { useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Badge, DataTable, Caption, Text, type Column, type MobileDataTablePresentation } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { DataStateNotice, EmptyState, SectionErrorBoundary, Skeleton, QueryError } from '@/components/feedback';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import type { SecretRotationStatus } from '@/types/admin-operator-confidence';
import type { useSecretRotationPage } from '../../../hooks/useSecretRotationPage';
import { SEVERITY_VARIANT, rowKey } from './helpers';

type Props = { controller: ReturnType<typeof useSecretRotationPage> };

export function SecretRotationDetails({ controller }: Props) {
  const { fmtNumber, locale, t, source, subsystemMissing, showError, isLoading, items, kindLabel, severityLabel, retry } = controller;
  const columns = useMemo<Column<SecretRotationStatus>[]>(
    () => [
      {
        key: 'kind',
        filterValue: (r) => r.kind ?? null,
        filterValueLabel: (_value, r) => kindLabel(r.kind),
        header: t('admin.secretRotation.colKind', 'Kind'),
        render: (r) => (
          <div className="flex flex-col">
            <Text weight="medium" color="primary">{kindLabel(r.kind)}</Text>
            {r.target_id && <Caption>{r.target_id}</Caption>}
          </div>
        ),
      },
      {
        key: 'rotated',
        filterValue: (r) => r.last_rotated ?? null,
        filterValueLabel: (_value, r) => formatDateTime(r.last_rotated),
        header: t('admin.secretRotation.colRotated', 'Last rotated'),
        render: (r) => (
          <div>
            <Text as="div" color="primary">{formatDateTime(r.last_rotated)}</Text>
            <Caption>{formatRelative(r.last_rotated, { locale })}</Caption>
          </div>
        ),
      },
      {
        key: 'age',
        filterValue: (r) => r.age_days ?? null,
        filterValueLabel: (_value, r) => r.age_days == null ? '—' : fmtNumber(r.age_days),
        header: t('admin.secretRotation.colAge', 'Age (days)'),
        align: 'right',
        render: (r) => <Text className="tabular-nums">{r.age_days == null ? '—' : fmtNumber(r.age_days)}</Text>,
      },
      {
        key: 'expiry',
        filterValue: (r) => r.expires_at || null,
        filterValueLabel: (_value, r) => r.expires_at ? formatDateTime(r.expires_at) : '—',
        header: t('admin.secretRotation.colExpiry', 'Expires'),
        render: (r) => {
          if (!r.expires_at) return <Text color="secondary">—</Text>;
          return (
            <div>
              <Text as="div" color="primary">{formatDateTime(r.expires_at)}</Text>
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
          <Text className="tabular-nums">
            {r.warn_days == null ? '—' : `${fmtNumber(r.warn_days)}d`} / {r.critical_days == null ? '—' : `${fmtNumber(r.critical_days)}d`}
          </Text>
        ),
      },
      {
        key: 'severity',
        filterValue: (r) => r.severity ?? null,
        filterValueLabel: (_value, r) => severityLabel[r.severity] ?? r.severity,
        header: t('admin.secretRotation.colSeverity', 'Severity'),
        align: 'right',
        render: (r) => (
          <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'neutral'}>
            {severityLabel[r.severity] ?? r.severity}
          </Badge>
        ),
      },
    ],
    [t, severityLabel, kindLabel, fmtNumber, locale],
  );
  const mobilePresentation = useMemo<MobileDataTablePresentation<SecretRotationStatus>>(
    () => ({
      roles: { kind: 'title', age: 'primary', severity: 'badge', rotated: 'meta', expiry: 'meta', thresholds: 'meta' },
      displayValue: (r, key) => {
        switch (key) {
          case 'kind': return controller.rowLabel(r);
          case 'rotated': return formatDateTime(r.last_rotated);
          case 'age': return r.age_days == null ? '—' : fmtNumber(r.age_days);
          case 'expiry': return formatDateTime(r.expires_at);
          case 'thresholds': return `${r.warn_days == null ? '—' : `${fmtNumber(r.warn_days)}d`} / ${r.critical_days == null ? '—' : `${fmtNumber(r.critical_days)}d`}`;
          case 'severity': return severityLabel[r.severity] ?? r.severity;
          default: return null;
        }
      },
    }),
    [controller.rowLabel, fmtNumber, severityLabel],
  );

  return (
<FadeIn delay={0.3}>
        <section aria-label={t('admin.secretRotation.tableTitle', 'Rotation status')}>
          <LayoutCard title={t('admin.secretRotation.tableTitle', 'Rotation status')}>
            <SectionErrorBoundary name="secret-rotation-table">
              {isLoading ? (
                <Skeleton height={280} />
              ) : showError ? (
                <QueryError error={source.fatalError} onRetry={retry} />
              ) : subsystemMissing ? (
                <DataStateNotice state="unsupported">
                  {t('admin.secretRotation.notConfigured', 'The rotation tracker is not configured on this deployment. Enable secret rotation tracking in config to populate this page.')}
                </DataStateNotice>
              ) : items.length === 0 ? (
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
                  mobileColumns={['kind', 'age', 'severity']}
                  mobilePresentation={mobilePresentation}
                  data={items}
                  enableValueFilters
                  keyExtractor={rowKey}
                  rowLabel={controller.rowLabel}
                  emptyMessage={t('admin.secretRotation.emptyTable', 'No tracked secrets')}
                  pagination
                />
              )}
            </SectionErrorBoundary>
          </LayoutCard>
        </section>
      </FadeIn>
  );
}
