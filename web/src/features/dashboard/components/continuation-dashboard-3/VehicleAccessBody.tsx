import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { Badge, Caption, Subhead } from '@/components/ui';
import { SourceContent } from '@/components/layout';
import { Skeleton } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import { WidgetDetailCard, type DetailEntry } from '../../widgets/shared';
import { sourcePresentation } from './sourcePresentation';

interface VehicleAccessBodyProps {
  mobileEnabled: boolean | null;
  driverEntries: DetailEntry[];
  invitationEntries: DetailEntry[];
  compact: boolean;
  driverState: DataState<unknown>;
  invitationState: DataState<unknown>;
  mobileState: DataState<unknown>;
}

export function VehicleAccessBody({
  mobileEnabled, driverEntries, invitationEntries, compact,
  driverState, invitationState, mobileState,
}: VehicleAccessBodyProps) {
  const { t } = useTranslation('dashboard');
  const mobileStatus = (
    <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0 min-h-[44px]">
      <Caption>{t('widget.vehicleAccessMobile', 'Mobile access')}</Caption>
      <Badge variant={mobileEnabled === true ? 'success' : mobileEnabled === false ? 'danger' : 'neutral'}>
        {mobileEnabled === true
          ? t('widget.vehicleAccessEnabled', 'Enabled')
          : mobileEnabled === false
            ? t('widget.vehicleAccessDisabled', 'Disabled')
            : t('widget.vehicleAccessUnknown', 'Unknown')}
      </Badge>
    </div>
  );
  return (
    <div className="flex min-w-0 flex-col gap-3 h-full">
      <SourceContent
        state={sourcePresentation(mobileState, mobileEnabled != null)}
        label={t('widget.vehicleAccessMobile', 'Mobile access')}
        emptyMessage={t('widget.vehicleAccessMobileUnknown', 'Mobile access unknown')}
        errorMessage={t('widget.vehicleAccessMobileError', 'Unable to load mobile access')}
        error={mobileState.fatalError}
        errorRecovery={{ onRetry: mobileState.retry ?? undefined }}
        loadingContent={<>{mobileStatus}<Skeleton className="h-8" /></>}
        emptyContent={mobileStatus}
      >{mobileStatus}</SourceContent>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Subhead className="mb-1">{t('widget.vehicleAccessAuthorized', 'Authorized drivers')}</Subhead>
        <SourceContent
          state={sourcePresentation(driverState, driverEntries.length > 0)}
          label={t('widget.vehicleAccessAuthorized', 'Authorized drivers')}
          emptyMessage={t('widget.vehicleAccessNoDrivers', 'No authorized drivers')}
          errorMessage={t('widget.vehicleAccessDriversError', 'Unable to load authorized drivers')}
          error={driverState.fatalError}
          errorRecovery={{ onRetry: driverState.retry ?? undefined }}
          loadingContent={<Skeleton className="h-16" />}
        >
          <WidgetDetailCard
            entries={driverEntries}
            compact={compact}
            emptyMessage={t('widget.vehicleAccessNoDrivers', 'No authorized drivers')}
            emptyIcon={<Users className="h-5 w-5" />}
          />
        </SourceContent>
      </div>

      <div className="min-w-0 shrink-0 border-t border-[var(--border-subtle)] pt-2">
        <Subhead className="mb-1">{t('widget.vehicleAccessPending', 'Pending invitations')}</Subhead>
        <SourceContent
          state={sourcePresentation(invitationState, invitationEntries.length > 0)}
          label={t('widget.vehicleAccessPending', 'Pending invitations')}
          emptyMessage={t('widget.vehicleAccessNoInvitations', 'No pending invitations')}
          errorMessage={t('widget.vehicleAccessInvitationsError', 'Unable to load pending invitations')}
          error={invitationState.fatalError}
          errorRecovery={{ onRetry: invitationState.retry ?? undefined }}
          loadingContent={<Skeleton className="h-16" />}
        >
          <WidgetDetailCard
            entries={invitationEntries}
            compact={compact}
            emptyMessage={t('widget.vehicleAccessNoInvitations', 'No pending invitations')}
          />
        </SourceContent>
      </div>
    </div>
  );
}
