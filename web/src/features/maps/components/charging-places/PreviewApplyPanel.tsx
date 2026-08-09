import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calculator, Play, RefreshCw } from 'lucide-react';

import { GlassPanel, PanelTitle, Button, Input, ConfirmDialog, Badge } from '@/components/ui';
import { Skeleton, EmptyState, QueryError, InlineCallout } from '@/components/feedback';
import { MetricTile } from '@/components/data-display';
import { useSettings } from '@/hooks/useSettings';
import { useConfirm } from '@/hooks/useConfirm';
import { useUnits } from '@/hooks/useUnits';
import { formatCurrencyValue } from '@/lib/currencyFormat';
import { useGeofenceRatePreview, useApplyGeofenceRate } from '@/api/hooks/useLocations';
import { formatRatePerWh } from './helpers';
import type { GeofenceRate } from '@/api/types';

export interface PreviewApplyPanelProps {
  geofenceId: number;
  /** The rate row selected in the history table, or `null` before any pick. */
  rate: GeofenceRate | null;
}

function localToIso(local: string): string | undefined {
  if (!local) return undefined;
  const ms = Date.parse(local);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

/**
 * Explicit preview → apply flow for backfilling/repricing historical
 * sessions at this place's selected rate. Preview is read-only (fired
 * automatically once a rate is selected); Apply is the ONLY write path
 * that ever reprices already-existing sessions, is bounded to this
 * geofence + rate's interval, and never touches a session that already
 * carries a manual/Tesla-actual cost — see
 * `internal/database/geofence/repo_rates.go`'s `ApplyRate`.
 */
export function PreviewApplyPanel({ geofenceId, rate }: PreviewApplyPanelProps) {
  const { t } = useTranslation();
  const { locale } = useSettings();
  const { formatEnergy } = useUnits();
  const { confirm, dialogProps } = useConfirm();

  const [fromLocal, setFromLocal] = useState('');
  const [toLocal, setToLocal] = useState('');

  const range = useMemo(
    () => ({ from: localToIso(fromLocal), to: localToIso(toLocal) }),
    [fromLocal, toLocal],
  );

  const preview = useGeofenceRatePreview(geofenceId, rate?.id, range);
  const apply = useApplyGeofenceRate();

  useEffect(() => {
    setFromLocal('');
    setToLocal('');
    apply.reset();
  }, [apply.reset, rate?.id]);

  const handleApply = async () => {
    if (!rate || !preview.data || preview.data.matched_sessions === 0) return;
    const attributionOnly = preview.data.eligible_sessions === 0;
    const ok = await confirm({
      title: attributionOnly
        ? t('chargingPlaces.previewApply.confirmAttributionTitle', 'Assign matching sessions to this place?')
        : t('chargingPlaces.previewApply.confirmTitle', 'Apply this rate to matching sessions?'),
      message: attributionOnly
        ? t(
            'chargingPlaces.previewApply.confirmAttributionMessage',
            'Matching sessions will be linked to this place. Their protected costs will remain unchanged.',
          )
        : t(
            'chargingPlaces.previewApply.confirmMessage',
            'This backfills/reprices unpriced or previously geofence-derived sessions in scope. Manual, Tesla-reported, and existing costs with unknown provenance are never overwritten.',
          ),
      confirmLabel: attributionOnly
        ? t('chargingPlaces.previewApply.assignAction', 'Assign Sessions')
        : t('chargingPlaces.previewApply.applyAction', 'Apply'),
      variant: 'warning',
    });
    if (!ok) return;
    apply.mutate({ geofenceId, rateId: rate.id, from: range.from, to: range.to });
  };

  if (!rate) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-3 flex items-center gap-2">
          <Calculator className="h-4 w-4 text-violet-300" aria-hidden="true" />
          {t('chargingPlaces.previewApply.title', 'Preview & Apply')}
        </PanelTitle>
        <>
          {/* no-action: rate selection is provided directly above this panel in the same workspace. */}
          <EmptyState
            message={t(
              'chargingPlaces.previewApply.selectRate',
              'Select a rate from the history table above to preview its impact.',
            )}
          />
        </>
      </GlassPanel>
    );
  }

  const p = preview.data;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Calculator className="h-4 w-4 text-violet-300" aria-hidden="true" />
          {t('chargingPlaces.previewApply.title', 'Preview & Apply')}
          <Badge variant="neutral" size="sm">
            {formatRatePerWh(rate.rate_per_wh, rate.currency, locale)} / {t('chargingPlaces.kwh', 'kWh')}
          </Badge>
        </PanelTitle>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw className={preview.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />}
          onClick={() => void preview.refetch()}
          disabled={preview.isFetching}
        >
          {t('chargingPlaces.previewApply.refresh', 'Refresh preview')}
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          type="datetime-local"
          label={t('chargingPlaces.previewApply.from', 'Narrow from (optional)')}
          value={fromLocal}
          onChange={(e) => setFromLocal(e.target.value)}
        />
        <Input
          type="datetime-local"
          label={t('chargingPlaces.previewApply.to', 'Narrow to (optional)')}
          value={toLocal}
          onChange={(e) => setToLocal(e.target.value)}
        />
      </div>

      {preview.isError ? (
        <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
      ) : preview.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <MetricTile value={p?.matched_sessions ?? 0} label={t('chargingPlaces.previewApply.matched', 'Matched')} />
            <MetricTile
              value={p?.eligible_sessions ?? 0}
              label={t('chargingPlaces.previewApply.eligible', 'Eligible')}
              accentClass="text-emerald-300"
            />
            <MetricTile
              value={p?.protected_sessions ?? 0}
              label={t('chargingPlaces.previewApply.protected', 'Protected')}
              accentClass="text-amber-300"
            />
            <MetricTile
              value={p ? formatEnergy(p.total_energy_wh) : '—'}
              label={t('chargingPlaces.previewApply.energy', 'Energy')}
            />
            <MetricTile
              value={
                p ? formatCurrencyValue(p.estimated_cost_decimal, p.currency, locale, 2, { useGrouping: true }) : '—'
              }
              label={t('chargingPlaces.previewApply.estimatedCost', 'Estimated Cost')}
            />
          </div>
          {p?.matched_sessions === 0 && (
            <InlineCallout variant="warning" className="mt-3">
              {t(
                'chargingPlaces.previewApply.noMatches',
                'No sessions match this place and rate period. Check the zone location and radius, or broaden the optional date range. Sessions without coordinates can match an identical saved place name.',
              )}
            </InlineCallout>
          )}
          {p && p.matched_sessions > 0 && p.eligible_sessions === 0 && (
            <InlineCallout variant="info" className="mt-3">
              {t(
                'chargingPlaces.previewApply.attributionOnly',
                'All matched costs are protected. Apply can still assign unlinked sessions to this place without changing their cost.',
              )}
            </InlineCallout>
          )}
        </>
      )}

      {apply.data && (
        <InlineCallout variant="success" className="mt-3">
          {t(
            'chargingPlaces.previewApply.applied',
            'Processed {{matched}} matched sessions: {{priced}} priced, {{skipped}} protected or unchanged, {{cost}} total.',
            {
              matched: apply.data.matched_sessions,
              priced: apply.data.priced_sessions,
              skipped: apply.data.skipped_sessions,
              cost: formatCurrencyValue(apply.data.total_cost_decimal, apply.data.currency, locale, 2, {
                useGrouping: true,
              }),
            },
          )}
        </InlineCallout>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          variant="primary"
          icon={<Play className="h-4 w-4" aria-hidden="true" />}
          onClick={() => void handleApply()}
          loading={apply.isPending}
          disabled={!p || p.matched_sessions === 0}
        >
          {p && p.matched_sessions > 0 && p.eligible_sessions === 0
            ? t('chargingPlaces.previewApply.assignAction', 'Assign Sessions')
            : t('chargingPlaces.previewApply.applyAction', 'Apply')}
        </Button>
      </div>

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </GlassPanel>
  );
}
