import type { OperationalTone } from '@/components/data-display';

type Translate = (key: string, fallback: string) => string;

export function briefSourceStatus(
  t: Translate, { enabled = true, hasData, loading, retained, failed }: {
    enabled?: boolean; hasData: boolean; loading: boolean; retained: boolean; failed: boolean;
  },
): { statusLabel: string; statusTone: OperationalTone } {
  if (!enabled) return { statusLabel: t('admin.diagnostics.brief.selectVehicle', 'No vehicle selected'), statusTone: 'neutral' };
  if (retained) return { statusLabel: t('admin.diagnostics.brief.retained', 'Retained measurements'), statusTone: 'warning' };
  if (loading) return { statusLabel: t('admin.diagnostics.brief.loading', 'Loading measurements'), statusTone: 'neutral' };
  if (failed) return { statusLabel: t('admin.diagnostics.brief.failed', 'Read failed'), statusTone: 'danger' };
  if (hasData) return { statusLabel: t('admin.diagnostics.brief.loaded', 'Source loaded'), statusTone: 'neutral' };
  return { statusLabel: t('admin.diagnostics.brief.missing', 'No measurements supplied'), statusTone: 'neutral' };
}
