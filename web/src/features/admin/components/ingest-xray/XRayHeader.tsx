/**
 * Ingest X-Ray — header strip.
 *
 * Three StatCards summarising what the current X-Ray window contains:
 *   - Total samples ingested in the window
 *   - Distinct signal fields seen
 *   - Window length the operator selected (echoed back so the strip
 *     reads like a self-explanatory summary)
 */
import { useTranslation } from 'react-i18next';
import { Activity, Layers, Clock } from 'lucide-react';

import { StatCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { fmtInt } from '@/lib/numberFormat';
import type {
  IngestXRayResponse,
  IngestXRayWindow,
} from '@/types/admin-diagnostics';

interface XRayHeaderProps {
  data: IngestXRayResponse | undefined;
  loading: boolean;
  windowSel: IngestXRayWindow;
}

const WINDOW_LABEL: Record<IngestXRayWindow, string> = {
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '24h': '24 hours',
};

export function XRayHeader({ data, loading, windowSel }: XRayHeaderProps) {
  const { t } = useTranslation();
  return (
    <Grid cols={{ default: 1, sm: 3 }} gap={4}>
      <StatCard
        label={t('admin.xray.stats.samples', 'Total samples')}
        value={loading ? '—' : fmtInt(data?.total_samples ?? 0)}
        icon={<Activity className="h-5 w-5" />}
        sublabel={t('admin.xray.stats.samplesSub', 'within selected window')}
      />
      <StatCard
        label={t('admin.xray.stats.fields', 'Distinct fields')}
        value={loading ? '—' : fmtInt(data?.unique_fields ?? 0)}
        icon={<Layers className="h-5 w-5" />}
        sublabel={t('admin.xray.stats.fieldsSub', 'unique signal names')}
      />
      <StatCard
        label={t('admin.xray.stats.window', 'Window')}
        value={t(`admin.xray.windowLabel.${windowSel}`, WINDOW_LABEL[windowSel])}
        icon={<Clock className="h-5 w-5" />}
        sublabel={t('admin.xray.stats.windowSub', 'observation horizon')}
      />
    </Grid>
  );
}
