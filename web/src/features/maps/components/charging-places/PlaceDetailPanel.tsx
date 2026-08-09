import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ArchiveRestore, CheckCircle2 } from 'lucide-react';

import { Modal, Button, Tabs, Badge, Text, EditableText, Label } from '@/components/ui';
import {
  useGeofenceRates,
  useDeleteGeofenceRate,
  useArchiveGeofence,
  useUnarchiveGeofence,
  useMarkGeofenceReviewed,
  useGeofenceChargingSummary,
  useRenameGeofence,
} from '@/api/hooks/useLocations';
import { RateHistoryPanel } from './RateHistoryPanel';
import { RateForm } from './RateForm';
import { PreviewApplyPanel } from './PreviewApplyPanel';
import { ChargingSummaryPanel } from './ChargingSummaryPanel';
import { ChargingActivityList } from './ChargingActivityList';
import { isRateActiveAt, isRateOpen } from './helpers';
import type { Geofence, GeofenceRate } from '@/api/types';

export interface PlaceDetailPanelProps {
  /** The place being configured, or `null` when the panel is closed. */
  place: Geofence | null;
  onClose: () => void;
}

type DetailTab = 'pricing' | 'activity';

/**
 * The Charging Place detail workspace — opened from either the "Needs
 * Setup" queue or the main places table. Combines rate history, the
 * add-a-rate form, the explicit preview/apply backfill flow, and
 * read-only charging activity/summary views for ONE geofence, plus the
 * archive/unarchive/mark-reviewed lifecycle actions.
 */
export function PlaceDetailPanel({ place, onClose }: PlaceDetailPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DetailTab>('pricing');
  const [selectedRate, setSelectedRate] = useState<GeofenceRate | null>(null);

  const ratesQuery = useGeofenceRates(place?.id);
  const summaryQuery = useGeofenceChargingSummary(place?.id);
  const deleteRate = useDeleteGeofenceRate();
  const archive = useArchiveGeofence();
  const unarchive = useUnarchiveGeofence();
  const markReviewed = useMarkGeofenceReviewed();
  const rename = useRenameGeofence();

  // Reset per-place UI state whenever a different place opens, and default
  // to the rate active now. A future open-ended schedule is only a fallback
  // preview selection; it is not treated as the current rate.
  useEffect(() => {
    setTab('pricing');
    setSelectedRate(null);
  }, [place?.id]);

  useEffect(() => {
    const rates = ratesQuery.data ?? [];
    if (selectedRate != null && rates.some((rate) => rate.id === selectedRate.id)) {
      return;
    }
    const preferred = rates.find((rate) => isRateActiveAt(rate)) ??
      rates.find(isRateOpen) ??
      null;
    setSelectedRate(preferred);
  }, [ratesQuery.data, selectedRate]);

  if (!place) return null;

  const currentRate = (ratesQuery.data ?? []).find((rate) => isRateActiveAt(rate)) ?? null;

  const handleMarkReviewed = () => {
    markReviewed.mutate(place.id);
  };

  return (
    <Modal
      open={place != null}
      onClose={onClose}
      size="lg"
      title={place.name || t('chargingPlaces.unnamed', 'Unnamed place')}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {place.needs_review && (
          <>
            <Badge variant="warning" size="sm">
              {t('chargingPlaces.detail.needsReviewBadge', 'Needs review')}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
              onClick={handleMarkReviewed}
              loading={markReviewed.isPending}
            >
              {t('chargingPlaces.detail.markReviewed', 'Mark reviewed')}
            </Button>
          </>
        )}
        {place.archived_at ? (
          <Button
            size="sm"
            variant="secondary"
            icon={<ArchiveRestore className="h-4 w-4" aria-hidden="true" />}
            onClick={() => unarchive.mutate(place.id)}
            loading={unarchive.isPending}
          >
            {t('chargingPlaces.detail.unarchive', 'Restore')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            icon={<Archive className="h-4 w-4" aria-hidden="true" />}
            onClick={() => archive.mutate(place.id, { onSuccess: onClose })}
            loading={archive.isPending}
          >
            {t('chargingPlaces.detail.archive', 'Archive')}
          </Button>
        )}
      </div>

      <div className="mb-4">
        <Label>{t('chargingPlaces.detail.placeName', 'Place name')}</Label>
        <EditableText
          value={place.name}
          variant="heading"
          maxLength={120}
          ariaLabel={t('chargingPlaces.detail.rename', 'Rename {{name}}', { name: place.name })}
          validate={(next) =>
            next.length > 120
              ? t('geofences.error.nameTooLong', 'Max 120 characters')
              : null
          }
          onSave={async (name) => {
            await rename.mutateAsync({ geofenceId: place.id, name });
          }}
        />
      </div>

      <Tabs
        className="mb-4"
        tabs={[
          { key: 'pricing', label: t('chargingPlaces.detail.pricingTab', 'Rates & Pricing') },
          { key: 'activity', label: t('chargingPlaces.detail.activityTab', 'Charging Activity') },
        ]}
        activeTab={tab}
        onChange={(k) => setTab(k as DetailTab)}
        ariaLabel={t('chargingPlaces.detail.tabsLabel', 'Charging place detail sections')}
      />

      {tab === 'pricing' ? (
        <div className="flex flex-col gap-4">
          <Text size="sm" color="muted">
            {t(
              'chargingPlaces.detail.pricingIntro',
              'Rate changes never rewrite protected actual costs. The rate active today estimates older unpriced sessions automatically; use preview and apply when you have exact historical rates.',
            )}
          </Text>
          <RateForm geofenceId={place.id} currentRate={currentRate} />
          <RateHistoryPanel
            rates={ratesQuery.data}
            isLoading={ratesQuery.isLoading}
            error={ratesQuery.error}
            onRetry={() => void ratesQuery.refetch()}
            selectedRateId={selectedRate?.id}
            onSelectRate={setSelectedRate}
            onDelete={(r) => deleteRate.mutate({ geofenceId: place.id, rateId: r.id })}
            deletePending={deleteRate.isPending}
          />
          <PreviewApplyPanel geofenceId={place.id} rate={selectedRate} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <ChargingSummaryPanel
            summary={summaryQuery.data}
            isLoading={summaryQuery.isLoading}
            error={summaryQuery.error}
            onRetry={() => void summaryQuery.refetch()}
          />
          <ChargingActivityList geofenceId={place.id} />
        </div>
      )}
    </Modal>
  );
}
