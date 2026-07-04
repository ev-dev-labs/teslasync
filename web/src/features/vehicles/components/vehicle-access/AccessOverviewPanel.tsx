import { useTranslation } from 'react-i18next';
import { PieChart } from 'lucide-react';

import { GlassPanel, Badge, PanelTitle, Subhead, Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { fmtPercent } from '@/lib/numberFormat';

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
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
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
  isLoading,
  isError,
  error,
  onRetry,
}: AccessOverviewPanelProps) {
  const { t } = useTranslation();
  const isEmpty = totalInvitations === 0 && totalDrivers === 0;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <PieChart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicleAccess.overview.title', 'Access Overview')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={220} />
      ) : isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isEmpty ? (
        <EmptyState /* no-action: transient empty state — surfaces when no drivers or invitations exist yet */
          icon={<PieChart className="h-8 w-8" />}
          message={t('vehicleAccess.overview.empty', 'No access data to summarize yet.')}
        />
      ) : (
        <div className="space-y-5">
          <div>
            <Subhead className="mb-2">
              {t('vehicleAccess.overview.invitationStatus', 'Invitation Status')}
            </Subhead>
            {statusBreakdown.length === 0 ? (
              <Caption>{t('vehicleAccess.overview.noInvitations', 'No invitations yet')}</Caption>
            ) : (
              <div className="space-y-3">
                {statusBreakdown.map((slice) => {
                  const pct = totalInvitations > 0 ? (slice.count / totalInvitations) * 100 : 0;
                  return (
                    <MetricBar
                      key={slice.status}
                      label={t(`vehicleAccess.status.${slice.status}`, titleCase(slice.status))}
                      value={slice.count}
                      max={totalInvitations || slice.count || 1}
                      color={slice.color}
                      sublabel={`${slice.count} · ${fmtPercent(pct, 0)}`}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Subhead className="mb-2">
              {t('vehicleAccess.overview.driverRoles', 'Driver Roles')}
            </Subhead>
            {roleBreakdown.length === 0 ? (
              <Caption>{t('vehicleAccess.overview.noDrivers', 'No drivers yet')}</Caption>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {roleBreakdown.map((slice) => (
                  <li key={slice.role}>
                    <Badge variant="neutral">
                      {t(`vehicleAccess.role.${slice.role}`, titleCase(slice.role))}
                      <Text color="muted" className="ml-1">{slice.count}</Text>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
