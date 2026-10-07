import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PieChart } from 'lucide-react';

import { GlassPanel, Badge, PanelTitle, Subhead, Caption, Text } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { VisuallyHidden } from '@/components/a11y';
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

  // Null-safe views of the breakdown arrays — the contract types them as
  // required, but a mid-flight hook (or a future caller) could hand us
  // `undefined`; guarding here keeps `.length` / `.map` from throwing.
  const statuses = useMemo(() => statusBreakdown ?? [], [statusBreakdown]);
  const roles = useMemo(() => roleBreakdown ?? [], [roleBreakdown]);

  const invitations = totalInvitations ?? 0;
  const drivers = totalDrivers ?? 0;
  const isEmpty = invitations === 0 && drivers === 0;

  // An `isError` flag with no error object would make <QueryError> render
  // nothing (it early-returns on a falsy error), leaving a blank panel body.
  // Only branch to the error UI when there is an actual error to describe so
  // the panel falls through to a placeholder and is never blank.
  const showError = isError && error != null;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <PieChart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicleAccess.overview.title', 'Access Overview')}
      </PanelTitle>

      {isLoading ? (
        <div aria-busy="true">
          <VisuallyHidden liveRegion>{t('common.loading', 'Loading…')}</VisuallyHidden>
          <Skeleton height={220} />
        </div>
      ) : showError ? (
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
            {statuses.length === 0 ? (
              <Caption>{t('vehicleAccess.overview.noInvitations', 'No invitations yet')}</Caption>
            ) : (
              <div className="space-y-3">
                {statuses.map((slice) => {
                  const count = slice.count ?? 0;
                  const pct = invitations > 0 ? (count / invitations) * 100 : 0;
                  return (
                    <MetricBar
                      key={slice.status}
                      label={t(`vehicleAccess.status.${slice.status}`, titleCase(slice.status))}
                      value={count}
                      max={invitations || count || 1}
                      color={slice.color}
                      sublabel={`${count} · ${fmtPercent(pct, 0)}`}
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
            {roles.length === 0 ? (
              <Caption>{t('vehicleAccess.overview.noDrivers', 'No drivers yet')}</Caption>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {roles.map((slice) => (
                  <li key={slice.role}>
                    <Badge variant="neutral">
                      {t(`vehicleAccess.role.${slice.role}`, titleCase(slice.role))}
                      <Text color="muted" className="ml-1">{slice.count ?? 0}</Text>
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
