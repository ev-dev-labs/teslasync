import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Badge, Text, Caption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import type { WarrantyOutlook } from '@/api/hooks/useServiceIntelligence';

import { PanelState } from './PanelState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';
import { formatDayKey } from '@/lib/dateFormat';

export interface WarrantyPanelProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  outlook: WarrantyOutlook | null;
  onRetry: () => void;
}

function statusVariant(status: string): 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'active':
      return 'success';
    case 'expiring_soon':
      return 'warning';
    default:
      return 'danger';
  }
}

function statusLabel(status: string, t: (k: string, d: string) => string): string {
  switch (status) {
    case 'active':
      return t('serviceIntelligence.warranty.active', 'Active');
    case 'expiring_soon':
      return t('serviceIntelligence.warranty.expiringSoon', 'Expiring soon');
    default:
      return t('serviceIntelligence.warranty.expired', 'Expired');
  }
}

export function WarrantyPanel({ selected, loading, error, outlook, onRetry }: WarrantyPanelProps) {
  const { fmtInt } = useNumberFormatting();
  const { formatDistance } = useUnits();
  const { opts } = useDateFormat();
  const { t } = useTranslation();

  return (
    <LayoutCard title={t('serviceIntelligence.warranty.title', 'Warranty countdown')}
      actions={<ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}>
      <PanelState
        selected={selected}
        loading={loading}
        error={error}
        empty={outlook == null || outlook.coverages.length === 0}
        icon={<ShieldCheck className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.warranty.selectMessage',
          'Choose a vehicle to count down its warranty coverage.',
        )}
        emptyTitle={t('serviceIntelligence.warranty.emptyTitle', 'No warranty outlook')}
        emptyMessage={t(
          'serviceIntelligence.warranty.empty',
          'Coverage countdown is not available for this vehicle yet.',
        )}
        onRetry={onRetry}
      >
        <div className="space-y-3">
          {(outlook?.coverages ?? []).map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Text variant="bodySm" className="font-medium">{c.name}</Text>
                <Caption className="block tabular-nums">
                  {t('serviceIntelligence.warranty.detail', 'ends {{date}} · {{days}} days left', {
                    date: formatDayKey(c.expires_at ?? '', opts),
                    days: fmtInt(Math.max(c.days_remaining, 0)),
                  })}
                  {c.km_remaining != null && (
                    <>
                      {' · '}
                      {t('ownership.warranty.card.distanceHint', '{{remaining}} remaining', {
                        remaining: formatDistance(Math.max(c.km_remaining, 0) * 1000),
                      })}
                    </>
                  )}
                </Caption>
              </div>
              <Badge variant={statusVariant(c.status)} size="sm">
                {statusLabel(c.status, t)}
              </Badge>
            </div>
          ))}
          {outlook?.assumption && (
            <Caption className="block">{outlook.assumption}</Caption>
          )}
        </div>
      </PanelState>
    </LayoutCard>
  );
}
