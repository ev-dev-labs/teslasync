import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import { KVList } from '@/components/data-display';
import { Text } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';

/**
 * Source-backed explanation only. This panel does not calculate or diagnose
 * a new condition. The response cannot establish direct motor measurements,
 * snapshot observation times for health, or full-range chart coverage.
 */
export function MethodologyPanel() {
  const { t } = useTranslation();
  const { formatTemperature } = useUnits();
  const projections = [
    {
      label: t('drivetrain.frontMotor', 'Front Motor'),
      value: t(
        'drivetrain.modernization.proxyFront',
        'The health endpoint projects the minimum battery-module temperature into the front motor temperature field.',
      ),
    },
    {
      label: t('drivetrain.rearMotor', 'Rear Motor'),
      value: t(
        'drivetrain.modernization.proxyRear',
        'The health endpoint projects the maximum battery-module temperature into the rear motor temperature field.',
      ),
    },
    {
      label: t('drivetrain.inverter', 'Inverter'),
      value: t(
        'drivetrain.modernization.proxyInverter',
        'The health endpoint adds a 7°C temperature difference to the maximum battery-module reading as an inverter proxy.',
      ),
    },
    {
      label: t('drivetrain.battery', 'Battery'),
      value: t(
        'drivetrain.modernization.proxyBattery',
        'The health endpoint averages the available minimum and maximum module readings, or uses the single available reading.',
      ),
    },
  ];
  return (
    <LayoutCard
      title={t('drivetrain.modernization.methodologyTitle', 'Health methodology and source limits')}
    >
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.healthMethodology',
          'Health temperatures are backend battery-module proxies, not direct motor measurements.',
        )}
      </Text>
      <KVList items={projections} />
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.backendPolicy',
          'The backend reports warning above {{warm}} and critical above {{critical}}, based on its maximum module/inverter proxy. These thresholds differ from the per-component gauge ratios.',
          {
            warm: formatTemperature(60),
            critical: formatTemperature(80),
          },
        )}
      </Text>
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.scorePolicy',
          'Status-to-score policy: good 95%, warning 60%, critical 25%. This is a rating, not a measured percentage.',
        )}
      </Text>
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.gaugePolicy',
          'Component gauges compare Celsius readings with their original ceilings: {{motor}} for front/rear motor, {{inverter}} for inverter and {{battery}} for battery. Warning begins at 65% and critical at 85% of the ceiling.',
          {
            motor: formatTemperature(150),
            inverter: formatTemperature(120),
            battery: formatTemperature(60),
          },
        )}
      </Text>
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.statorAliases',
          'Existing Stator, Rear-Left and Rear-Right series map to front motor, rear motor and inverter temperature respectively. These aliases do not identify additional motors.',
        )}
      </Text>
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.powerMethodology',
          'Peak-labelled power uses average drive power from up to 30 returned drives. Per-drive regen power is not supplied; gaps are unknown, not zero.',
        )}
      </Text>
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.historyScope',
          'Motor history uses the existing 200-snapshot request in source order. The date range filters returned drives, not motor history or vehicle drive statistics.',
        )}
      </Text>
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.averageCoverage',
          'Average power requires a power reading for every included drive. An incomplete set remains unknown rather than treating missing readings as zero.',
        )}
      </Text>
      <Text as="p" variant="bodySm">
        {t(
          'drivetrain.modernization.unknownPolicy',
          'Without temperature evidence, no active health assessment is presented. A returned status is still recorded as source data.',
        )}
      </Text>
    </LayoutCard>
  );
}
