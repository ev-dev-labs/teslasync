import { BookOpenCheck, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';
import { GlassPanel } from '@/components/ui';

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
    <GlassPanel className="p-5 md:p-6">
      <div className="mb-4 flex items-center gap-2">
        <BookOpenCheck className="h-5 w-5 text-cyan-300" aria-hidden />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('benchmarks.method.title', 'Methodology & limits')}
        </h2>
      </div>
      <ol className="space-y-2 text-sm text-[var(--text-secondary)]">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <span className="text-cyan-300">{index + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <InlineCallout variant="warning" icon={<ShieldAlert />} className="mt-4">
        {t(
          'benchmarks.method.limit',
          'Differential privacy protects aggregate contributions. It does not make a tiny local fleet representative, comparable, or suitable for causal conclusions.',
        )}
      </InlineCallout>
    </GlassPanel>
  );
}

