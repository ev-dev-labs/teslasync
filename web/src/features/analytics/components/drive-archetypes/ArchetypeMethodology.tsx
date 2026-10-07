import {
  BookOpenCheck,
  Database,
  FlaskConical,
  GitBranch,
  Scale,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type {
  ArchetypeDisplay,
  ArchetypeSectionProps,
} from './types';

interface ArchetypeMethodologyProps extends ArchetypeSectionProps {
  display: ArchetypeDisplay;
}

export function ArchetypeMethodology({
  summary,
  state,
  display,
}: ArchetypeMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'observation',
      icon: <BookOpenCheck className="h-5 w-5" aria-hidden="true" />,
      title: t('archetypes.method.observationTitle', 'Observational scope'),
      body: t(
        'archetypes.method.observationBody',
        'This is deterministic unsupervised clustering of recorded drives. It does not verify trip purpose, establish ground truth, explain causes, or predict future behavior.',
      ),
    },
    {
      key: 'source',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t('archetypes.method.sourceTitle', 'Bounded source and eligibility'),
      body: t(
        'archetypes.method.sourceBody',
        'At most {{limit}} newest rows are requested. Valid unique IDs, parseable starts, distance of at least {{distance}}, positive energy, and positive average speed are required.',
        {
          limit: fmtInt(summary.thresholds.historyLimit),
          distance: display.formatDistance(summary.thresholds.minDistanceM),
        },
      ),
    },
    {
      key: 'features',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t('archetypes.method.featuresTitle', 'Features and imputation'),
      body:
        summary.temperatureImputationSource === 'observed_median'
          ? t(
              'archetypes.method.featuresBody',
              'The standardized feature space uses log distance, average speed, circular hour in {{timeZone}} as sine and cosine, energy per distance, and outside temperature. Missing eligible temperature uses the eligible measured median and remains marked imputed.',
              { timeZone: summary.thresholds.timeZone },
            )
          : t(
              'archetypes.method.featuresDefaultBody',
              'The standardized feature space uses log distance, average speed, circular hour in {{timeZone}} as sine and cosine, energy per distance, and outside temperature. Because no eligible measured temperature exists, missing temperature uses the configured default and remains marked imputed.',
              { timeZone: summary.thresholds.timeZone },
            ),
    },
    {
      key: 'selection',
      icon: <GitBranch className="h-5 w-5" aria-hidden="true" />,
      title: t('archetypes.method.selectionTitle', 'Deterministic candidate selection'),
      body: t(
        'archetypes.method.selectionBody',
        'K-means++ evaluates feasible k from {{minK}} through {{maxK}} with four deterministic restarts. Candidates that do not realize every requested cluster are excluded; raw maximum mean silhouette is selected, with smaller k breaking exact ties.',
        {
          minK: summary.thresholds.minK,
          maxK: summary.thresholds.maxK,
        },
      ),
    },
    {
      key: 'labels',
      icon: <Scale className="h-5 w-5" aria-hidden="true" />,
      title: t('archetypes.method.labelsTitle', 'Heuristic label rules'),
      body: t(
        'archetypes.method.labelsBody',
        'Rules run in order: at least {{roadTrip}} is long-distance; at least {{highwayDistance}} and {{highwaySpeed}} is highway; at most {{shortHop}} is short-hop; at most {{cold}} is cold-weather; then 05:30–10:29 and 15:30–20:29 receive morning or evening pattern labels. These are not verified commutes.',
        {
          roadTrip: display.formatDistance(150_000),
          highwayDistance: display.formatDistance(30_000),
          highwaySpeed: display.formatSpeed(70 / 3.6),
          shortHop: display.formatDistance(6_000),
          cold: display.formatTemperature(3),
        },
      ),
    },
    {
      key: 'limits',
      icon: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
      title: t('archetypes.method.limitsTitle', 'Interpretation limits'),
      body: t(
        'archetypes.method.limitsBody',
        'Silhouette is descriptive separation and restart agreement is optimization stability; neither establishes correctness. Assignment margin is relative standardized-space separation, so low margin means boundary ambiguity rather than error probability.',
      ),
    },
  ];

  return (
    <section data-testid="drive-archetypes-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('archetypes.method.title', 'Methodology, heuristic labels, and interpretation limits')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'archetypes.method.subtitle',
            'A reproducible evidence model with explicit limits, not a trip-purpose classifier.',
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
        <ArchetypeSectionBody
          summary={summary}
          state={state}
          requirement="resolved"
          className="mt-4"
          skeletonHeight={64}
        >
          <AlertBanner variant="warning">
            {t(
              'archetypes.method.notice',
              '{{rows}} returned rows, {{eligible}} eligible drives, {{clusters}} distinct clusters, and {{collisions}} repeated-label collisions support only the disclosed observational summaries.',
              {
                rows: fmtInt(summary.source.returnedRows),
                eligible: fmtInt(summary.analyzedDrives),
                clusters: fmtInt(summary.k),
                collisions: fmtInt(summary.labelCollisionCount),
              },
            )}
          </AlertBanner>
        </ArchetypeSectionBody>
      </GlassPanel>
    </section>
  );
}
