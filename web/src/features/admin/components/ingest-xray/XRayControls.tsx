/**
 * Ingest X-Ray — controls bar.
 *
 * Vehicle picker + window + bucket selectors. All three are constrained
 * to server-accepted values so we never round-trip a 400 over a typo.
 * The bucket dropdown auto-disables any bucket >= the current window to
 * avoid the server-side "bucket >= window" 400.
 */
import { useTranslation } from 'react-i18next';

import { Select, type SelectOption } from '@/components/ui';
import type { Vehicle } from '@/api/types';
import type {
  IngestXRayBucket,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

interface XRayControlsProps {
  vehicles: Vehicle[];
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

  const vehicleOptions: SelectOption[] = [
    { value: '', label: t('admin.xray.controls.selectVehicle', 'Select vehicle…') },
    ...vehicles.map((v) => ({
      value: String(v.id),
      label:
        v.display_name ||
        v.vin ||
        t('admin.xray.controls.vehicleFallback', 'Vehicle {{id}}', { id: v.id }),
    })),
  ];

  const windowOptions: SelectOption[] = ALL_WINDOWS.map((w) => ({
    value: w,
    label: t(`admin.xray.windowOption.${w}`, w),
  }));

  const bucketOptions: SelectOption[] = ALL_BUCKETS.map((b) => {
    const tooBig = BUCKET_SECS[b] >= WINDOW_SECS[windowSel];
    return {
      value: b,
      label: t(`admin.xray.bucketOption.${b}`, b),
      disabled: tooBig,
    };
  });

  // Toolbar-friendly, mobile-first widths: the vehicle picker takes a full row
  // on phones while window + bucket share the next row; on `sm`+ they all sit
  // inline in the PageContainer actions slot.
  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
      <div className="w-full sm:w-52">
        <Select
          value={vehicleId !== null ? String(vehicleId) : ''}
          onChange={(e) => {
            const v = e.target.value;
            onVehicleChange(v ? Number(v) : null);
          }}
          options={vehicleOptions}
          aria-label={t('admin.xray.controls.vehicleAria', 'Vehicle')}
        />
      </div>

      <div className="min-w-[7rem] flex-1 sm:w-32 sm:flex-none">
        <Select
          value={windowSel}
          onChange={(e) => onWindowChange(e.target.value as IngestXRayWindow)}
          options={windowOptions}
          aria-label={t('admin.xray.controls.windowAria', 'Window')}
        />
      </div>

      <div className="min-w-[7rem] flex-1 sm:w-32 sm:flex-none">
        <Select
          value={bucketSel}
          onChange={(e) => onBucketChange(e.target.value as IngestXRayBucket)}
          options={bucketOptions}
          aria-label={t('admin.xray.controls.bucketAria', 'Bucket')}
        />
      </div>
    </div>
  );
}
