import { useTranslation } from 'react-i18next';
import { KVList } from '@/components/data-display';
import { PanelTitle, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { MonthlyTariffCostRange, MonthlyTariffDigest } from '@/types/monthlyTariff';
import { formatCurrencyMinor } from '../../formatters';

interface Props {
  digest: MonthlyTariffDigest;
  zone: string;
  currency?: string;
  site?: string;
  current?: string;
  alternative?: string;
}

export function MonthlyTariffReviewEvidence({ digest, zone, currency, site, current, alternative }: Props) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { unitPrefs, formatEnergy } = useUnits();
  const { comparison } = digest;
  const money = (minor: number) => formatCurrencyMinor(minor, currency, unitPrefs.locale);
  const interval = (range: MonthlyTariffCostRange) => range.lower_minor === range.upper_minor
    ? money(range.lower_minor)
    : t('ownership.tariff.monthly.range', '{{low}} to {{high}}', {
      low: money(range.lower_minor), high: money(range.upper_minor),
    });
  return <div className="space-y-2">
    <PanelTitle>{t('ownership.tariff.monthly.findings', 'Estimated savings at the same charging times')}</PanelTitle>
    <Text as="p" variant="caption">{t('ownership.tariff.monthly.window', '{{site}}: {{from}} up to {{through}} ({{zone}}). Expires {{expires}}.', {
      site, from: formatDateTime(digest.from, { tz: zone }), through: formatDateTime(digest.through, { tz: zone }),
      zone, expires: formatDateTime(digest.expires_at),
    })}</Text>
    <KVList layout="responsive" items={[
      { id: 'net', label: t('ownership.tariff.monthly.net', 'Estimated saving after switch fee'), value: interval(comparison.net_savings) },
      { id: 'current', label: t('ownership.tariff.monthly.currentCost', 'Current: {{name}}', { name: current }), value: interval(comparison.current) },
      { id: 'alternative', label: t('ownership.tariff.monthly.altCost', 'Alternative: {{name}}', { name: alternative }), value: interval(comparison.alternative) },
      { id: 'fixed', label: t('ownership.tariff.monthly.fixed', 'Fixed charges included (current / alternative)'),
        value: t('ownership.tariff.monthly.fixedAmounts', '{{current}} / {{alternative}} over {{days}} days', {
          current: money(comparison.current_fixed_minor), alternative: money(comparison.alternative_fixed_minor), days: comparison.days,
        }) },
      { id: 'fee', label: t('ownership.tariff.monthly.feeIncluded', 'Switch fee deducted'), value: money(comparison.switch_fee_minor) },
      { id: 'coverage', label: t('ownership.tariff.monthly.coverage', 'Coverage'),
        value: t('ownership.tariff.monthly.metered', 'All {{count}} observed sessions at this place: {{energy}} billed.', {
          count: comparison.sessions, energy: formatEnergy(comparison.energy_wh),
        }) },
    ]} />
    <Text as="p" variant="bodySm">{t('ownership.tariff.monthly.why', 'Why this? The alternative saved enough even at the least favorable rates during recorded sessions. Charging times and energy stay the same. The range reflects unknown energy split between rate bands. This is a charging-only estimate, not a whole-home bill or readiness forecast.')}</Text>
  </div>;
}
