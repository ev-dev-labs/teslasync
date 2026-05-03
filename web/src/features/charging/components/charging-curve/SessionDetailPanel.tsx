import { useTranslation } from 'react-i18next';
import type { ChargingSession } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber, fmtWithUnit } from '@/lib/numberFormat';
import { GlassPanel } from '@/components/ui';
import { getChargerLabel } from './helpers';

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
  currencySymbol: string;
}

export default function SessionDetailPanel({ session, currencySymbol }: SessionDetailPanelProps) {
  const { t } = useTranslation();

  return (
    <GlassPanel className="space-y-1 p-5">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
        {t('charging.curve.sessionDetails', 'Session Details')}
      </h3>
      <SessionDetailRow
        label={t('charging.curve.date', 'Date')}
        value={formatDateTime(session.start_ts)}
      />
      <SessionDetailRow
        label={t('charging.curve.chargerType', 'Charger Type')}
        value={getChargerLabel(session)}
      />
      <SessionDetailRow
        label={t('charging.curve.socRange', 'SOC Range')}
        value={`${session.start_battery_pct}% → ${session.end_battery_pct ?? '?'}%`}
      />
      <SessionDetailRow
        label={t('charging.curve.energyAdded', 'Energy Added')}
        value={fmtWithUnit(session.energy_added_kwh, 'kWh')}
      />
      <SessionDetailRow
        label={t('charging.curve.peakPower', 'Peak Power')}
        value={fmtWithUnit(session.charger_power_kw_max ?? 0, 'kW')}
      />
      {session.charger_power_kw_avg != null && (
        <SessionDetailRow
          label={t('charging.curve.avgPower', 'Avg Power')}
          value={fmtWithUnit(session.charger_power_kw_avg, 'kW')}
        />
      )}
      <SessionDetailRow
        label={t('charging.curve.duration', 'Duration')}
        value={fmtWithUnit(session.duration_min, 'min')}
      />
      {session.cost != null && (
        <SessionDetailRow
          label={t('charging.curve.cost', 'Cost')}
          value={`${currencySymbol}${fmtNumber(session.cost)}`}
        />
      )}
      {session.charger_location && (
        <SessionDetailRow
          label={t('charging.curve.location', 'Location')}
          value={session.charger_location}
        />
      )}
    </GlassPanel>
  );
}
