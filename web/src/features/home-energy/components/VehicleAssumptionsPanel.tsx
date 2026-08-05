import { useTranslation } from 'react-i18next';
import { CarFront } from 'lucide-react';
import { GlassPanel, PanelTitle, Accordion, Slider, Toggle, Select, Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { updateVehicleAssumption } from '../hooks/useOrchestrationScenario';
import { DEFAULT_VEHICLE_ASSUMPTION, type VehicleAssumption } from '../lib/scenarioDefaults';
import type { VehicleInput } from '../lib/types';

interface VehicleAssumptionsPanelProps {
  vehicleInputs: VehicleInput[];
  assumptions: Record<string, VehicleAssumption>;
}

/** Per-vehicle editable assumptions: target SoC, usable capacity, charge power, departure deadline, priority. */
export function VehicleAssumptionsPanel({ vehicleInputs, assumptions }: VehicleAssumptionsPanelProps) {
  const { t } = useTranslation();
  const { formatPower, formatEnergy } = useUnits();

  const priorityOptions = [
    { value: 'low', label: t('homeEnergy.vehicle.priorityLow', 'Low') },
    { value: 'medium', label: t('homeEnergy.vehicle.priorityMedium', 'Medium') },
    { value: 'high', label: t('homeEnergy.vehicle.priorityHigh', 'High') },
  ];

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3">{t('homeEnergy.vehicle.title', 'Vehicle Assumptions')}</PanelTitle>
      {vehicleInputs.length === 0 ? (
        <EmptyState
          icon={<CarFront className="h-8 w-8" />}
          message={t('homeEnergy.vehicle.empty', 'No vehicles found on this account to orchestrate.')}
        />
      ) : (
        <div className="space-y-2">
          {vehicleInputs.map((v) => {
            const assumption = assumptions[v.id] ?? DEFAULT_VEHICLE_ASSUMPTION;
            return (
              <Accordion
                key={v.id}
                title={v.name}
                icon={<CarFront className="h-4 w-4" />}
                badge={
                  <Badge variant={assumption.priority === 'high' ? 'danger' : assumption.priority === 'low' ? 'neutral' : 'info'} size="sm">
                    {priorityOptions.find((p) => p.value === assumption.priority)?.label}
                  </Badge>
                }
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="text-sm text-[var(--text-muted)]">
                    {t('homeEnergy.vehicle.currentSoc', 'Current SoC (measured): {{pct}}%', { pct: Math.round(v.currentSocPct) })}
                  </div>
                  <Select
                    label={t('homeEnergy.vehicle.priority', 'Charging priority')}
                    value={assumption.priority}
                    options={priorityOptions}
                    onChange={(e) =>
                      updateVehicleAssumption(v.id, { priority: e.target.value as VehicleAssumption['priority'] })
                    }
                  />
                  <Slider
                    label={t('homeEnergy.vehicle.targetSoc', 'Target SoC by departure')}
                    min={0}
                    max={100}
                    step={1}
                    value={assumption.targetSocPct}
                    formatValue={(n) => `${n}%`}
                    onChange={(n) => updateVehicleAssumption(v.id, { targetSocPct: n })}
                  />
                  <Slider
                    label={t('homeEnergy.vehicle.capacity', 'Usable pack capacity')}
                    min={10_000}
                    max={150_000}
                    step={1_000}
                    value={assumption.usableCapacityWh}
                    formatValue={(n) => formatEnergy(n)}
                    onChange={(n) => updateVehicleAssumption(v.id, { usableCapacityWh: n })}
                  />
                  <Slider
                    label={t('homeEnergy.vehicle.maxPower', 'Max charge power')}
                    min={1_000}
                    max={22_000}
                    step={500}
                    value={assumption.maxChargePowerW}
                    formatValue={(n) => formatPower(n)}
                    onChange={(n) => updateVehicleAssumption(v.id, { maxChargePowerW: n })}
                  />
                  <div className="flex items-center gap-3">
                    <Toggle
                      label={t('homeEnergy.vehicle.hasDeadline', 'Has departure deadline')}
                      checked={assumption.hasDeadline}
                      onChange={(checked) => updateVehicleAssumption(v.id, { hasDeadline: checked })}
                    />
                  </div>
                  {assumption.hasDeadline && (
                    <Slider
                      label={t('homeEnergy.vehicle.departureHour', 'Departure hour (UTC)')}
                      min={0}
                      max={23}
                      step={1}
                      value={assumption.departureHour}
                      formatValue={(n) => t('homeEnergy.scenario.hourValue', '{{n}}:00', { n })}
                      onChange={(n) => updateVehicleAssumption(v.id, { departureHour: n })}
                    />
                  )}
                </div>
              </Accordion>
            );
          })}
        </div>
      )}
    </GlassPanel>
  );
}
