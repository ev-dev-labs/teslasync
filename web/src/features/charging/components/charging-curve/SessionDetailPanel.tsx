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
    <div className="flex items-center justify-between border-b border-white/5 py-2 text-sm">
      <span className="text-white/60">{label}</span>
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
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white/70">
        {t('charging.curve.sessionDetails', 'Session Details')}
      </h3>
      <SessionDetailRow
        label={t('charging.curve.date', 'Date')}
        value={formatDateTime(session.start_date)}
      />
      <SessionDetailRow
        label={t('charging.curve.chargerType', 'Charger Type')}
        value={getChargerLabel(session)}
      />
      <SessionDetailRow
        label={t('charging.curve.socRange', 'SOC Range')}
        value={`${session.start_battery_level}% → ${session.end_battery_level ?? '?'}%`}
      />
      <SessionDetailRow
        label={t('charging.curve.energyAdded', 'Energy Added')}
        value={fmtWithUnit(session.charge_energy_added, 'kWh')}
      />
      {session.charge_energy_used != null && (
        <SessionDetailRow
          label={t('charging.curve.energyUsed', 'Energy Used')}
          value={fmtWithUnit(session.charge_energy_used, 'kWh')}
        />
      )}
      <SessionDetailRow
        label={t('charging.curve.peakPower', 'Peak Power')}
        value={fmtWithUnit(session.charger_power ?? 0, 'kW')}
      />
      <SessionDetailRow
        label={t('charging.curve.duration', 'Duration')}
        value={fmtWithUnit(session.duration_min, 'min')}
      />
      {session.charger_voltage != null && (
        <SessionDetailRow
          label={t('charging.curve.voltage', 'Voltage')}
          value={fmtWithUnit(session.charger_voltage, 'V')}
        />
      )}
      {session.charger_actual_current != null && (
        <SessionDetailRow
          label={t('charging.curve.current', 'Current')}
          value={fmtWithUnit(session.charger_actual_current, 'A')}
        />
      )}
      {session.charger_phases != null && (
        <SessionDetailRow
          label={t('charging.curve.phases', 'Phases')}
          value={String(session.charger_phases)}
        />
      )}
      {session.cost != null && (
        <SessionDetailRow
          label={t('charging.curve.cost', 'Cost')}
          value={`${currencySymbol}${fmtNumber(session.cost)}`}
        />
      )}
      {session.location_name && (
        <SessionDetailRow
          label={t('charging.curve.location', 'Location')}
          value={session.location_name}
        />
      )}
      {session.conn_charge_cable && (
        <SessionDetailRow
          label={t('charging.curve.cable', 'Cable')}
          value={session.conn_charge_cable}
        />
      )}
    </GlassPanel>
  );
}
