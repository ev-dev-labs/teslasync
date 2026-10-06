import { useTranslation } from 'react-i18next';
import { Section } from '@/components/layout';
import { SectionErrorBoundary } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import type { DataStateSource } from '@/api/dataState';
import type {
  ChargingTelemetry, ClimateSnapshot, MotorSnapshot, SecurityEvent,
  TirePressureSnapshot, VehicleState,
} from '@/api/types';
import { MotorSection, ClimateSection, TirePressureSection, ChargingTelemetrySection } from '../vehicle-detail';
import { VehiclePanelGrid } from './VehiclePanelGrid';
import { VehicleSourcePanel } from './VehicleSourcePanel';
import { VehicleSecurityPanel } from './VehicleSecurityPanel';

export function VehicleDetailSystems({ state, motorQuery, climateQuery, securityQuery, tireQuery, chargingTelemetryQuery }: {
  state: VehicleState | undefined;
  motorQuery: DataStateSource<MotorSnapshot | null>;
  climateQuery: DataStateSource<ClimateSnapshot | null>;
  securityQuery: DataStateSource<SecurityEvent | null>;
  tireQuery: DataStateSource<TirePressureSnapshot | null>;
  chargingTelemetryQuery: DataStateSource<ChargingTelemetry | null>;
}) {
  const { t } = useTranslation();
  return (
    <FadeIn delay={0.10}>
      <Section id="vehicle-systems" title={t('vehicles.detail.systems', 'Vehicle systems')}>
        <VehiclePanelGrid label={t('vehicles.detail.systems', 'Vehicle systems')} items={[
          { id: 'vehicle-motor', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:motor" fallbackTitle={t('vehicles.detail.section.motorFailed', 'Motor section failed to load')}>
              <VehicleSourcePanel query={motorQuery} label={t('vehicles.detail.motor', 'Powertrain')}
                emptyMessage={t('vehicles.detail.noMotorData', 'No motor data available')}
                errorMessage={t('vehicles.detail.section.motorFailed', 'Motor section failed to load')}>
                <MotorSection motorData={motorQuery.data} />
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
          { id: 'vehicle-climate', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:climate" fallbackTitle={t('vehicles.detail.section.climateFailed', 'Climate section failed to load')}>
              <VehicleSourcePanel query={climateQuery} label={t('vehicles.detail.climate', 'Climate')}
                emptyMessage={t('vehicles.detail.noClimateData', 'No climate data available')}
                errorMessage={t('vehicles.detail.section.climateFailed', 'Climate section failed to load')}>
                <ClimateSection climateData={climateQuery.data} />
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
        ]} />
        <SectionErrorBoundary name="vehicle-detail:charging-telemetry" fallbackTitle={t('vehicles.detail.section.chargingTelemetryFailed', 'Charging telemetry failed to load')}>
          <VehicleSourcePanel query={chargingTelemetryQuery} label={t('vehicles.detail.chargingTelemetry', 'Charging telemetry')}
            emptyMessage={t('vehicles.detail.noChargingTelemetry', 'No charging telemetry available')}
            errorMessage={t('vehicles.detail.section.chargingTelemetryFailed', 'Charging telemetry failed to load')}>
            <ChargingTelemetrySection chargingTelemetry={chargingTelemetryQuery.data} />
          </VehicleSourcePanel>
        </SectionErrorBoundary>
        <VehiclePanelGrid label={t('vehicles.detail.systems', 'Vehicle systems')} items={[
          { id: 'vehicle-security', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:security" fallbackTitle={t('vehicles.detail.section.securityFailed', 'Security section failed to load')}>
              <VehicleSourcePanel query={securityQuery} label={t('vehicles.detail.security', 'Security')}
                emptyMessage={t('vehicles.detail.noSecurityData', 'No security data available')}
                errorMessage={t('vehicles.detail.section.securityFailed', 'Security section failed to load')}>
                <VehicleSecurityPanel securityData={securityQuery.data} state={state} />
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
          { id: 'vehicle-tires', size: 'half', content:
            <SectionErrorBoundary name="vehicle-detail:tire-pressure" fallbackTitle={t('vehicles.detail.section.tireFailed', 'Tire pressure section failed to load')}>
              <VehicleSourcePanel query={tireQuery} label={t('vehicles.detail.tirePressure', 'Tire pressure')}
                emptyMessage={t('vehicles.detail.noTireData', 'No tire pressure data available')}
                errorMessage={t('vehicles.detail.section.tireFailed', 'Tire pressure section failed to load')}>
                <TirePressureSection tireData={tireQuery.data} />
              </VehicleSourcePanel>
            </SectionErrorBoundary>
          },
        ]} />
      </Section>
    </FadeIn>
  );
}
