import {
  BookOpenCheck,
  Clock3,
  Database,
  GitMerge,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';

interface PreconditioningMethodologyProps {
  summary: PreconditioningSummary;
}

export function PreconditioningMethodology({
  summary,
}: PreconditioningMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'sources',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t('preconditioningEffectiveness.method.sourcesTitle', 'Bounded source contract'),
      body: t(
        'preconditioningEffectiveness.method.sourcesBody',
        'Climate history defaults to seven days while drive history is capped at 1,000 rows. Results describe only their returned overlap, not lifetime behavior.',
      ),
    },
    {
      key: 'windows',
      icon: <Clock3 className="h-5 w-5" aria-hidden="true" />,
      title: t('preconditioningEffectiveness.method.windowsTitle', 'Ordered qualification gates'),
      body: t(
        'preconditioningEffectiveness.method.windowsBody',
        'Coverage, non-empty windows, sample count, observation span, final-sample freshness, target stability, initial gap, and HVAC certainty are separate gates.',
      ),
    },
    {
      key: 'groups',
      icon: <BookOpenCheck className="h-5 w-5" aria-hidden="true" />,
      title: t('preconditioningEffectiveness.method.groupsTitle', 'Strict observational groups'),
      body: t(
        'preconditioningEffectiveness.method.groupsBody',
        'Observed HVAC-active pre-drive means at least one active row. Explicitly HVAC-off control requires every window row to be known and off; unknown rows prevent control classification.',
      ),
    },
    {
      key: 'reuse',
      icon: <GitMerge className="h-5 w-5" aria-hidden="true" />,
      title: t('preconditioningEffectiveness.method.reuseTitle', 'Overlap and row reuse'),
      body: t(
        'preconditioningEffectiveness.method.reuseBody',
        'Each departure is evaluated independently. Overlapping pre-drive windows may reference the same climate row, so departure observations need not be row-independent.',
      ),
    },
    {
      key: 'comparison',
      icon: <Scale className="h-5 w-5" aria-hidden="true" />,
      title: t('preconditioningEffectiveness.method.comparisonTitle', 'Median comparison and support'),
      body: t(
        'preconditioningEffectiveness.method.comparisonBody',
        'Comparative medians publish only when both groups exist. Confidence multiplies group-balance and total-volume support and is not a significance test.',
      ),
    },
    {
      key: 'limits',
      icon: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
      title: t('preconditioningEffectiveness.method.limitsTitle', 'Interpretation guardrails'),
      body: t(
        'preconditioningEffectiveness.method.limitsBody',
        'Associations do not establish causation or energy savings. Weather, parking context, schedules, user intent, sensor cadence, and other unmeasured factors can differ between groups.',
      ),
    },
  ];

  return (
    <section data-testid="preconditioning-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t(
            'preconditioningEffectiveness.method.title',
            'Methodology and interpretation guardrails',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.method.subtitle',
            'Deterministic accounting supports an observational workspace, not a causal effectiveness estimate.',
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
              'preconditioningEffectiveness.method.notice',
              '{{climate}} climate rows, {{drives}} unique valid drives, and {{classified}} classified departures support only the disclosed observational summaries.',
              {
                climate: fmtInt(summary.climateRows.returnedRows),
                drives: fmtInt(summary.driveRows.uniqueValidDrives),
                classified: fmtInt(summary.joinedDepartures),
              },
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
