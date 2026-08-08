import {
  Binary,
  BookOpenCheck,
  Clock3,
  Database,
  ShieldAlert,
  TimerReset,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';

interface ComfortConsistencyMethodologyProps {
  summary: ComfortConsistencySummary;
}

export function ComfortConsistencyMethodology({
  summary,
}: ComfortConsistencyMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'source',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t('comfortConsistency.method.sourceTitle', 'Source contract'),
      body: t(
        'comfortConsistency.method.sourceBody',
        'The climate endpoint returns a seven-day signal timeline by default. Forward-filled values are timeline state, not independent sensor measurements.',
      ),
    },
    {
      key: 'rows',
      icon: <BookOpenCheck className="h-5 w-5" aria-hidden="true" />,
      title: t('comfortConsistency.method.rowsTitle', 'Ordered row gates'),
      body: t(
        'comfortConsistency.method.rowsBody',
        'Every returned row receives one outcome. Duplicate timestamps retain the first row; only active rows with cabin temperature and a front-row target are analyzed.',
      ),
    },
    {
      key: 'intervals',
      icon: <Clock3 className="h-5 w-5" aria-hidden="true" />,
      title: t('comfortConsistency.method.intervalsTitle', 'Step intervals'),
      body: t(
        'comfortConsistency.method.intervalsBody',
        'A qualified active row supports the interval to the next timestamp only when the gap is positive and within the ceiling. Local-hour results split that duration at hour boundaries.',
      ),
    },
    {
      key: 'windows',
      icon: <TimerReset className="h-5 w-5" aria-hidden="true" />,
      title: t('comfortConsistency.method.windowsTitle', 'Stabilization windows'),
      body: t(
        'comfortConsistency.method.windowsBody',
        'Active fragments split at inactivity, missing evidence, long gaps, and target shifts. Eligible elapsed time begins at the first observed outside-band sample, not necessarily HVAC activation.',
      ),
    },
    {
      key: 'score',
      icon: <Binary className="h-5 w-5" aria-hidden="true" />,
      title: t('comfortConsistency.method.scoreTitle', 'Descriptive score'),
      body: t(
        'comfortConsistency.method.scoreBody',
        'Band adherence, deviation, setpoint agreement, and stabilization form a raw index. Sample and window support shrink it toward neutral when evidence is sparse.',
      ),
    },
    {
      key: 'limits',
      icon: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
      title: t('comfortConsistency.method.limitsTitle', 'Interpretation limits'),
      body: t(
        'comfortConsistency.method.limitsBody',
        'Results describe returned telemetry. They do not measure occupant preference, airflow, humidity, sensor calibration, energy efficiency, or HVAC health.',
      ),
    },
  ];

  return (
    <section data-testid="comfort-consistency-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.method.title', 'Methodology and limitations')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'comfortConsistency.method.subtitle',
            'Deterministic evidence handling from endpoint rows to qualified observational summaries.',
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
              'comfortConsistency.method.notice',
              '{{rows}} returned rows, {{samples}} active samples, and {{windows}} outside-band fragments support only the disclosed observational summaries.',
              {
                rows: fmtInt(summary.rows.returnedRows),
                samples: fmtInt(summary.analyzedSamples),
                windows: fmtInt(summary.stabilizationWindows.length),
              },
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
