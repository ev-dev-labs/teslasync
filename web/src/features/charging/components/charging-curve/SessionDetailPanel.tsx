import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtWithUnit } from '@/lib/numberFormat';
import { GlassPanel } from '@/components/ui';
import { useFormatting } from '@/hooks/useFormatting';
import { getChargerLabel } from './helpers';
import { durationMinutes } from './helpers';

function SessionDetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--border-subtle)] py-2 text-sm">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="font-medium text-white">{value}</span>
    </div>
  );
}

interface SessionDetailPanelProps {
  session: ChargingSession;
}

export default function SessionDetailPanel({ session }: SessionDetailPanelProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatting();

  return (
    <GlassPanel className="space-y-1 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {t('charging.curve.sessionDetails', 'Session Details')}
      </h3>
      <SessionDetailRow
        label={t('charging.curve.date', 'Date')}
        value={formatDateTime(session.started_at)}
      />
      <SessionDetailRow
        label={t('charging.curve.chargerType', 'Charger Type')}
        value={getChargerLabel(session)}
      />
      <SessionDetailRow
        label={t('charging.curve.socRange', 'SOC Range')}
        value={`${session.start_soc_pct}% → ${session.end_soc_pct ?? '?'}%`}
      />
      <SessionDetailRow
        label={t('charging.curve.energyAdded', 'Energy Added')}
        value={fmtWithUnit(session.total_energy_added_wh / 1000, 'kWh')}
      />
      <SessionDetailRow
        label={t('charging.curve.peakPower', 'Peak Power')}
        value={fmtWithUnit((session.peak_power_w ?? 0) / 1000, 'kW')}
      />
      {session.avg_power_w != null && (
        <SessionDetailRow
          label={t('charging.curve.avgPower', 'Avg Power')}
          value={fmtWithUnit(session.avg_power_w / 1000, 'kW')}
        />
      )}
      <SessionDetailRow
        label={t('charging.curve.duration', 'Duration')}
        value={fmtWithUnit(durationMinutes(session.started_at, session.ended_at), 'min')}
      />
      {session.cost_decimal != null && (
        <SessionDetailRow
          label={t('charging.curve.cost_decimal', 'Cost')}
          value={formatCurrency(session.cost_decimal)}
        />
      )}
      {session.start_place && (
        <SessionDetailRow
          label={t('charging.curve.location', 'Location')}
          value={session.start_place}
        />
      )}
    </GlassPanel>
  );
}
