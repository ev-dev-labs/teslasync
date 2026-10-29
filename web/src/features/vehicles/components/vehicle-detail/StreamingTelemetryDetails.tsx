import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { Caption } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { VehicleState } from '@/api/types';

export function StreamingTelemetryDetails({ state }: { state: VehicleState }) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const { formatEnergy } = useUnits();
  const finite = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value);

  return (
    <div className="mt-4 space-y-3">
      <KVList wrap items={[
        {
          id: 'accessory-rail',
          label: t('telemetry.accessoryRail', 'Accessory rail'),
          value: state.accessory_rail == null ? '—' : state.accessory_rail
            ? t('common.on', 'On') : t('common.off', 'Off'),
        },
        {
          id: 'power-transfer',
          label: t('telemetry.powerTransferStatus', 'Power transfer status'),
          value: state.power_transfer_status ?? '—',
        },
        {
          id: 'aeb-state',
          label: t('telemetry.aebOperatingState', 'AEB operating state'),
          value: state.automatic_emergency_braking_state ?? '—',
        },
        {
          id: 'lifetime-dc-energy',
          label: t('telemetry.lifetimeDcChargeEnergy', 'Lifetime DC charge energy'),
          value: finite(state.lifetime_dc_charge_energy_wh)
            ? formatEnergy(state.lifetime_dc_charge_energy_wh) : '—',
        },
        {
          id: 'rolling-resistance',
          label: t('telemetry.rollingResistanceCoefficient', 'Rolling resistance coefficient'),
          value: finite(state.rolling_resistance_coefficient)
            ? fmtNumber(state.rolling_resistance_coefficient, 5) : '—',
        },
        {
          id: 'semi-mass',
          label: t('telemetry.semiVehicleMass', 'Semi vehicle mass'),
          value: finite(state.semi_vehicle_mass_kg)
            ? `${fmtNumber(state.semi_vehicle_mass_kg)} kg` : '—',
        },
      ]} />
      <Caption>
        {t('telemetry.streamingAvailability', 'Availability depends on vehicle and firmware. Lifetime energy is the vehicle counter, not tracked session totals.')}
      </Caption>
    </div>
  );
}
