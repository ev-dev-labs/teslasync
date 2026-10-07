import {
  BookOpenCheck,
  Database,
  FlaskConical,
  ShieldAlert,
  Split,
  SunMedium,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import type { CabinThermalSummary } from '../../lib/cabinThermal';

interface CabinThermalMethodologyProps {
  summary: CabinThermalSummary;
}

export function CabinThermalMethodology({
  summary,
}: CabinThermalMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'source',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t('cabinThermal.method.sourceTitle', 'Source contract'),
      body: t(
        'cabinThermal.method.sourceBody',
        'The existing climate-history endpoint returns a seven-day signal timeline by default. Forward-filled values are returned rows, not independent thermal experiments.',
      ),
    },
    {
      key: 'normalization',
      icon: <BookOpenCheck className="h-5 w-5" aria-hidden="true" />,
      title: t('cabinThermal.method.normalizationTitle', 'Row normalization'),
      body: t(
        'cabinThermal.method.normalizationBody',
        'Each raw row receives one outcome: a valid unique timestamp with both finite temperatures, or one ordered exclusion reason. Duplicate timestamps retain the first source row.',
      ),
    },
    {
      key: 'segmentation',
      icon: <Split className="h-5 w-5" aria-hidden="true" />,
      title: t('cabinThermal.method.segmentationTitle', 'Candidate segmentation'),
      body: t(
        'cabinThermal.method.segmentationBody',
        'Only contiguous, explicitly HVAC-off samples enter candidates. HVAC-active rows, unknown HVAC state, and gaps longer than the configured maximum end continuity; they do not become rejected candidates themselves.',
      ),
    },
    {
      key: 'fit',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t('cabinThermal.method.fitTitle', 'Newton cooling fit'),
      body: t(
        'cabinThermal.method.fitBody',
        'For a candidate that stays on one side of mean ambient, ordinary least squares fits ln|cabin − ambient| against elapsed minutes. A valid negative slope gives τ = −1 / slope.',
      ),
    },
    {
      key: 'gates',
      icon: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
      title: t('cabinThermal.method.gatesTitle', 'First-failure gates'),
      body: t(
        'cabinThermal.method.gatesBody',
        'Sample count, duration, initial gap, crossing, regression, relaxation direction, R², and τ validity run in order. Every candidate receives exactly one final disposition.',
      ),
    },
    {
      key: 'limits',
      icon: <SunMedium className="h-5 w-5" aria-hidden="true" />,
      title: t('cabinThermal.method.limitsTitle', 'Interpretation limits'),
      body: t(
        'cabinThermal.method.limitsBody',
        'Outside-probe temperature is only an ambient proxy. Sun, shade, wind, occupancy, sensor lag, and unobserved HVAC can change the slope; rejection is not a diagnosis of any one cause.',
      ),
    },
  ];

  return (
    <section data-testid="cabin-thermal-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.method.title', 'Methodology and limitations')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.method.subtitle',
            'The evidence hierarchy, model equation, ordered gates, and omitted physical inputs.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article key={item.key} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <div className="mb-2 flex items-center gap-2 text-[var(--text-muted)]">
                {item.icon}
                <Heading level="sub">{item.title}</Heading>
              </div>
              <Text as="p" variant="bodySm">{item.body}</Text>
            </article>
          ))}
        </div>
        <AlertBanner className="mt-4" variant="warning">
          <Text as="p" variant="caption">
            {t(
              'cabinThermal.method.notice',
              '{{rows}} returned rows and {{candidates}} candidate windows do not support τ unless at least one fit is accepted. Worked projections are descriptive scenarios, not forecasts.',
              {
                rows: summary.accounting.returnedRows,
                candidates: summary.accounting.candidateWindows,
              },
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
