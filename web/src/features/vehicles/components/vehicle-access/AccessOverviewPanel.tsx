import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart } from 'lucide-react';

import { GlassPanel, Badge, Button, Icon, PanelTitle, Subhead, Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';
import type { DataState } from '@/api/dataState';
import { typography } from '@/lib/tokens';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/** One invitation-status slice with a resolved display color for its bar. */
export interface AccessStatusSlice {
  status: string;
  count: number;
  color: string;
}

/** One driver-role slice for the role chip row. */
export interface AccessRoleSlice {
  role: string;
  count: number;
}

interface AccessOverviewPanelProps {
  statusBreakdown: AccessStatusSlice[];
  roleBreakdown: AccessRoleSlice[];
  totalInvitations: number;
  totalDrivers: number;
  driversState: DataState<unknown>;
  invitationsState: DataState<unknown>;
}

function titleCase(value: string): string {
  if (!value) return '—';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Context panel beside the drivers table. Visualises the composition of access
 * — invitation status distribution and driver-role mix — from the same hook
 * data, filling the bento's third column on wide screens.
 */
export function AccessOverviewPanel({
  statusBreakdown,
  roleBreakdown,
  totalInvitations,
  totalDrivers,
  driversState,
  invitationsState,
}: AccessOverviewPanelProps) {
  const { fmtInt, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const statusLabels: Record<string, string> = {
    "pending": t("vehicleAccess.status.pending", "pending"),
    "accepted": t("vehicleAccess.status.accepted", "accepted"),
    "revoked": t("vehicleAccess.status.revoked", "revoked"),
    "expired": t("vehicleAccess.status.expired", "expired"),
  };
  const roleLabels: Record<string, string> = {

  };


  // Null-safe views of the breakdown arrays — the contract types them as
  // required, but a mid-flight hook (or a future caller) could hand us
  // `undefined`; guarding here keeps `.length` / `.map` from throwing.
  const statuses = useMemo(() => statusBreakdown ?? [], [statusBreakdown]);
  const roles = useMemo(() => roleBreakdown ?? [], [roleBreakdown]);

  const invitations = totalInvitations ?? 0;
  const drivers = totalDrivers ?? 0;
  const isEmpty = driversState.status === 'ok' && invitationsState.status === 'ok'
    && driversState.hasData && invitationsState.hasData
    && invitations === 0 && drivers === 0;

  const sourcePlaceholder = (state: DataState<unknown>, label: string) => {
    if (state.fatalError) {
      return <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} resourceName={label} />;
    }
    if (state.isRefreshBlocked) {
      return (
        <div role="status" className="space-y-2">
          <Text color="secondary">{t('dataSources.status.paused', 'Refresh paused')}</Text>
          {state.retry && (
            <Button variant="ghost" size="sm" className="min-h-11 md:min-h-9" onClick={state.retry}>
              {t('common.retry', 'Retry')}
            </Button>
          )}
        </div>
      );
    }
    return (
      <div aria-busy="true">
        <VisuallyHidden liveRegion>{t('common.loading', "Loading...")}</VisuallyHidden>
        <Skeleton height={100} />
      </div>
    );
  };

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Icon icon={PieChart} size="md" className={typography.color.muted} aria-hidden />
        {t('vehicleAccess.overview.title', 'Access overview')}
      </PanelTitle>

      {isEmpty ? (
        <EmptyState /* no-action: transient empty state — surfaces when no drivers or invitations exist yet */
          icon={<Icon icon={PieChart} size="xl" className={typography.color.muted} aria-hidden />}
          message={t('vehicleAccess.overview.empty', 'No access data to summarize yet.')}
        />
      ) : (
        <div className="space-y-5">
          <section aria-label={t('vehicleAccess.overview.invitationStatus', 'Invitation status')}>
            <Subhead className="mb-2">
              {t('vehicleAccess.overview.invitationStatus', 'Invitation status')}
            </Subhead>
            <StaleRefreshWarning state={invitationsState} label={t('vehicleAccess.invitations.title', 'Share invitations')} />
            {!invitationsState.hasData ? sourcePlaceholder(invitationsState, t('vehicleAccess.invitations.resource', 'Invitations')) : statuses.length === 0 ? (
              <Caption>{t('vehicleAccess.overview.noInvitations', 'No invitations yet')}</Caption>
            ) : (
              <div className="space-y-3">
                {statuses.map((slice) => {
                  const count = slice.count ?? 0;
                  const pct = invitations > 0 ? (count / invitations) * 100 : 0;
                  return (
                    <MetricBar
                      key={slice.status}
                      label={statusLabels[slice.status] ?? titleCase(slice.status)}
                      value={count}
                      max={invitations || count || 1}
                      color={slice.color}
                      fill="solid"
                      sublabel={`${fmtInt(count)} · ${fmtPercent(pct)}`}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section aria-label={t('vehicleAccess.overview.driverRoles', 'Driver roles')}>
            <Subhead className="mb-2">
              {t('vehicleAccess.overview.driverRoles', 'Driver roles')}
            </Subhead>
            <StaleRefreshWarning state={driversState} label={t('vehicleAccess.drivers.title', 'Drivers')} />
            {!driversState.hasData ? sourcePlaceholder(driversState, t('vehicleAccess.drivers.resource', 'Drivers')) : roles.length === 0 ? (
              <Caption>{t('vehicleAccess.overview.noDrivers', 'No drivers yet')}</Caption>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {roles.map((slice) => (
                  <li key={slice.role}>
                    <Badge variant="neutral">
                      {roleLabels[slice.role] ?? titleCase(slice.role)}
                      <Text color="muted" className="ml-1">{fmtInt(slice.count ?? 0)}</Text>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </GlassPanel>
  );
}
