import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { OrderedStepList } from '@/components/data-display';

export function MethodologyPanel() {
  const { t } = useTranslation();
  const steps = [
    t(
      'benchmarks.method.clip',
      'TeslaSync derives session-level aggregates locally and clips every vehicle to documented bounds.',
    ),
    t(
      'benchmarks.method.cohort',
      'Only coarse model-family and five-year model-year buckets define similarity; precise location is excluded.',
    ),
    t(
      'benchmarks.method.noise',
      'Crypto-secure Laplace noise is applied to fixed histograms before means, ranges and percentiles are calculated.',
    ),
    t(
      'benchmarks.method.stable',
      'A release ID is reused until the completed source period or cohort membership version changes.',
    ),
  ];
  return (
    <LayoutCard title={t('benchmarks.method.title', 'Methodology & limits')}>
      <OrderedStepList
        aria-label={t('benchmarks.method.title', 'Methodology & limits')}
        steps={steps.map((step, index) => ({ id: String(index), title: step }))}
      />
      <InlineCallout variant="warning" icon={<ShieldAlert />} className="mt-4">
        {t(
          'benchmarks.method.limit',
          'Differential privacy protects aggregate contributions. It does not make a tiny local fleet representative, comparable, or suitable for causal conclusions.',
        )}
      </InlineCallout>
    </LayoutCard>
  );
}
