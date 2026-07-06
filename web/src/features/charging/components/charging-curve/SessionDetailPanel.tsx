import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtWithUnit } from '@/lib/numberFormat';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { useFormatting } from '@/hooks/useFormatting';
import { getChargerLabel, durationMinutes } from './helpers';

interface SessionDetailPanelProps {
  session: ChargingSession;
}

/**
 * Render a state-of-charge percentage, guarding against a missing reading.
 * A `null`/non-finite SOC is shown as the universal "—" placeholder rather
 * than a misleading "0%" (0 is a valid charge level, not "unknown").
 */
function fmtSoc(pct: number | null | undefined): string {
  return typeof pct === 'number' && Number.isFinite(pct) ? `${pct}%` : '—';
}

export default function SessionDetailPanel({ session }: SessionDetailPanelProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();
  const headingId = useId();

  const items = useMemo<{ label: string; value: ReactNode }[]>(() => {
    const rows: { label: string; value: ReactNode }[] = [
      { label: t('charging.curve.date', 'Date'), value: formatDateTime(session.started_at) },
      { label: t('charging.curve.col.charger', 'Charger Type'), value: getChargerLabel(session) },
      {
        label: t('charging.curve.socRange', 'SOC Range'),
        value: `${fmtSoc(session.start_soc_pct)} → ${fmtSoc(session.end_soc_pct)}`,
      },
      {
        label: t('charging.curve.energyAdded', 'Energy Added'),
        value: fmtWithUnit((session.total_energy_added_wh ?? 0) / 1000, 'kWh'),
      },
      {
        label: t('charging.curve.peakPower', 'Peak Power'),
        value: fmtWithUnit((session.peak_power_w ?? 0) / 1000, 'kW'),
      },
    ];
    if (session.avg_power_w != null) {
      rows.push({
        label: t('charging.curve.avgPower', 'Avg Power'),
        value: fmtWithUnit(session.avg_power_w / 1000, 'kW'),
      });
    }
    rows.push({
      label: t('charging.curve.duration', 'Duration'),
      value: session.ended_at
        ? fmtWithUnit(durationMinutes(session.started_at, session.ended_at), 'min')
        : '—',
    });
    if (session.cost_decimal != null) {
      rows.push({
        label: t('charging.curve.cost', 'Cost'),
        value: formatCurrency(session.cost_decimal),
      });
    }
    if (session.start_place) {
      rows.push({ label: t('charging.curve.location', 'Location'), value: session.start_place });
    }
    return rows;
  }, [t, session, formatCurrency]);

  return (
    <GlassPanel className="p-4 sm:p-5" role="region" aria-labelledby={headingId}>
      <PanelTitle id={headingId} className="mb-3">
        {t('charging.curve.sessionDetails', 'Session Details')}
      </PanelTitle>
      <KVList items={items} />
    </GlassPanel>
  );
}
