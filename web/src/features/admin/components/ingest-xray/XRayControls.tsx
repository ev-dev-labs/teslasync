/**
 * Ingest X-Ray — controls bar.
 *
 * Vehicle picker + window + bucket selectors. All three are constrained
 * to server-accepted values so we never round-trip a 400 over a typo.
 * The bucket dropdown auto-disables any bucket >= the current window, and
 * narrowing the window below the active bucket clamps the selection down to
 * the coarsest still-valid bucket — both guard the server-side
 * "bucket >= window" 400.
 */
import { useCallback, useMemo, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Select, type SelectOption } from '@/components/ui';
import type { Vehicle } from '@/api/types';
import type {
  IngestXRayBucket,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

interface XRayControlsProps {
  vehicles?: Vehicle[];
  vehicleId: number | null;
  windowSel: IngestXRayWindow;
  bucketSel: IngestXRayBucket;
  onVehicleChange: (id: number | null) => void;
  onWindowChange: (w: IngestXRayWindow) => void;
  onBucketChange: (b: IngestXRayBucket) => void;
}

const WINDOW_SECS: Record<IngestXRayWindow, number> = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
  '6h': 6 * 60 * 60,
  '24h': 24 * 60 * 60,
};

const BUCKET_SECS: Record<IngestXRayBucket, number> = {
  '30s': 30,
  '1m': 60,
  '5m': 5 * 60,
  '15m': 15 * 60,
  '1h': 60 * 60,
};

const ALL_WINDOWS: IngestXRayWindow[] = ['5m', '15m', '1h', '6h', '24h'];
const ALL_BUCKETS: IngestXRayBucket[] = ['30s', '1m', '5m', '15m', '1h'];
const EMPTY_VEHICLES: Vehicle[] = [];

/**
 * Coarsest bucket that is strictly smaller than `windowSel` — the widest
 * granularity the server accepts for that window. `30s` is smaller than every
 * window (the minimum is `5m`), so a valid bucket always exists and the
 * initial fallback is never reached in practice.
 */
export function largestValidBucket(windowSel: IngestXRayWindow): IngestXRayBucket {
  const windowSecs = WINDOW_SECS[windowSel];
  let best: IngestXRayBucket = ALL_BUCKETS[0];
  for (const b of ALL_BUCKETS) {
    if (BUCKET_SECS[b] < windowSecs) best = b;
  }
  return best;
}

export function XRayControls({
  vehicles,
  vehicleId,
  windowSel,
  bucketSel,
  onVehicleChange,
  onWindowChange,
  onBucketChange,
}: XRayControlsProps) {
  const { t } = useTranslation();
  const vehicleList = vehicles ?? EMPTY_VEHICLES;

  const vehicleOptions = useMemo<SelectOption[]>(
    () => [
      ...(vehicleId === null || vehicleList.length === 0
        ? [{
            value: '',
            label: t('admin.xray.controls.selectVehicle', 'Select vehicle…'),
          }]
        : []),
      ...vehicleList.map((v) => ({
        value: String(v.id),
        label:
          v.display_name ||
          v.vin ||
          t('admin.xray.controls.vehicleFallback', 'Vehicle {{id}}', { id: v.id }),
      })),
    ],
    [vehicleId, vehicleList, t],
  );

  const windowOptions = useMemo<SelectOption[]>(
    () => ALL_WINDOWS.map((w) => ({ value: w, label: t(`admin.xray.windowOption.${w}`, w) })),
    [t],
  );

  const bucketOptions = useMemo<SelectOption[]>(
    () =>
      ALL_BUCKETS.map((b) => ({
        value: b,
        label: t(`admin.xray.bucketOption.${b}`, b),
        disabled: BUCKET_SECS[b] >= WINDOW_SECS[windowSel],
      })),
    [windowSel, t],
  );

  const handleVehicleChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      onVehicleChange(value ? Number(value) : null);
    },
    [onVehicleChange],
  );

  const handleWindowChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const nextWindow = e.target.value as IngestXRayWindow;
      onWindowChange(nextWindow);
      // Narrowing the window can strand the active bucket at bucket >= window,
      // which is a hard server 400. Clamp it down to the coarsest bucket that
      // still fits so the very next poll stays inside the accepted range.
      if (BUCKET_SECS[bucketSel] >= WINDOW_SECS[nextWindow]) {
        onBucketChange(largestValidBucket(nextWindow));
      }
    },
    [bucketSel, onWindowChange, onBucketChange],
  );

  const handleBucketChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      onBucketChange(e.target.value as IngestXRayBucket);
    },
    [onBucketChange],
  );

  // Toolbar-friendly, mobile-first widths: the vehicle picker takes a full row
  // on phones while window + bucket share the next row; on `sm`+ they all sit
  // inline in the PageContainer actions slot.
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
      <div className="w-full sm:w-52">
        <Select
          value={vehicleId !== null ? String(vehicleId) : ''}
          onChange={handleVehicleChange}
          options={vehicleOptions}
          aria-label={t('admin.xray.controls.vehicleAria', 'Vehicle')}
        />
      </div>

      <div className="min-w-[7rem] flex-1 sm:w-32 sm:flex-none">
        <Select
          value={windowSel}
          onChange={handleWindowChange}
          options={windowOptions}
          aria-label={t('admin.xray.controls.windowAria', 'Window')}
        />
      </div>

      <div className="min-w-[7rem] flex-1 sm:w-32 sm:flex-none">
        <Select
          value={bucketSel}
          onChange={handleBucketChange}
          options={bucketOptions}
          aria-label={t('admin.xray.controls.bucketAria', 'Bucket')}
        />
      </div>
    </div>
  );
}
