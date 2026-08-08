import {
  Binary,
  BookOpenCheck,
  Database,
  GitCompareArrows,
  RotateCw,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';

interface HvacCyclingMethodologyProps {
  summary: HvacCyclingSummary;
}

export function HvacCyclingMethodology({
  summary,
}: HvacCyclingMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'source',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t('hvacCycling.method.sourceTitle', 'Source contract'),
      body: t(
        'hvacCycling.method.sourceBody',
        'The existing climate endpoint returns a seven-day signal timeline by default. Forward-filled fields are timeline evidence, not independent state measurements.',
      ),
    },
    {
      key: 'rows',
      icon: <BookOpenCheck className="h-5 w-5" aria-hidden="true" />,
      title: t('hvacCycling.method.rowsTitle', 'Exact row normalization'),
      body: t(
        'hvacCycling.method.rowsBody',
        'Every returned row receives one outcome. Valid aliases are accepted, duplicate timestamps retain the first returned row, and runtime types are interpreted strictly.',
      ),
    },
    {
      key: 'intervals',
      icon: <GitCompareArrows className="h-5 w-5" aria-hidden="true" />,
      title: t('hvacCycling.method.intervalsTitle', 'Adjacent intervals'),
      body: t(
        'hvacCycling.method.intervalsBody',
        'A known row supports the step interval to the next timestamp only when the gap is positive and within the ceiling. Unknown rows block the following interval and cannot be skipped.',
      ),
    },
    {
      key: 'runs',
      icon: <Binary className="h-5 w-5" aria-hidden="true" />,
      title: t('hvacCycling.method.runsTitle', 'Runs and boundaries'),
      body: t(
        'hvacCycling.method.runsBody',
        'Contiguous same-state intervals merge into chronological run fragments. Dataset edges, long gaps, and unknown states censor boundaries; only state changes are observed boundaries.',
      ),
    },
    {
      key: 'cycles',
      icon: <RotateCw className="h-5 w-5" aria-hidden="true" />,
      title: t('hvacCycling.method.cyclesTitle', 'Qualified cycling'),
      body: t(
        'hvacCycling.method.cyclesBody',
        'An active run is a complete cycle only when an off-to-on transition bounds its left and an on-to-off transition bounds its right. Only these runs enter the short-cycle denominator.',
      ),
    },
    {
      key: 'limits',
      icon: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
      title: t('hvacCycling.method.limitsTitle', 'Interpretation limits'),
      body: t(
        'hvacCycling.method.limitsBody',
        'Signal conflicts resolve active when any strict input is active, but are disclosed. Results describe returned telemetry and do not establish wear, efficiency, fault, or causal impact.',
      ),
    },
  ];

  return (
    <section data-testid="hvac-cycling-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.method.title', 'Methodology and limitations')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'hvacCycling.method.subtitle',
            'Deterministic evidence handling from returned rows to qualified cycling conclusions.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.key}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
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
              'hvacCycling.method.notice',
              '{{rows}} returned rows, {{runs}} run fragments, and {{complete}} complete active runs support only the disclosed observational summaries; no maintenance diagnosis is inferred.',
              {
                rows: fmtInt(summary.rows.returnedRows),
                runs: fmtInt(summary.runs.length),
                complete: fmtInt(summary.completeOnRunCount),
              },
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
