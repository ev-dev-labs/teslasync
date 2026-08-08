import { Milestone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationBits,
  destinationEvidenceBandLabel,
  destinationIndex,
  destinationPercent,
} from './labels';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface LeadingSuccessorsDirectoryProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function LeadingSuccessorsDirectory({
  model,
  state,
  locale,
}: LeadingSuccessorsDirectoryProps) {
  const { t } = useTranslation();
  const origins = model.states
    .filter((origin) => origin.outgoingTransitions > 0)
    .sort(
      (left, right) =>
        right.outgoingTransitions - left.outgoingTransitions
        || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
    );

  return (
    <section data-testid="destination-leading-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Milestone className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'destinationTransitions.directory.title',
            'Historical leading successors by origin',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'destinationTransitions.directory.subtitle',
            'Observed leaders and distribution shape are shown with separate volume, recurrence, and support evidence.',
          )}
        </Text>
        <DestinationTransitionsSectionBody
          model={model}
          state={state}
          requirement="origins"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {origins.map((origin) => (
              <article
                key={origin.key}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <Heading level="sub">{origin.label}</Heading>
                    <Text as="p" variant="caption">
                      {origin.leadingSuccessorLabel
                        ? t(
                            'destinationTransitions.directory.leader',
                            'Historical leader: {{destination}}',
                            {
                              destination:
                                origin.leadingSuccessorLabel,
                            },
                          )
                        : t(
                            'destinationTransitions.directory.noLeader',
                            'No observed outgoing leader',
                          )}
                    </Text>
                  </div>
                  <Badge
                    variant={
                      origin.support.supported ? 'success' : 'warning'
                    }
                  >
                    {destinationEvidenceBandLabel(t, origin.support.band)}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    {
                      label: t(
                        'destinationTransitions.directory.outgoing',
                        'Outgoing observations',
                      ),
                      value: fmtInt(origin.outgoingTransitions),
                    },
                    {
                      label: t(
                        'destinationTransitions.directory.leadingShare',
                        'Leading observed share',
                      ),
                      value: destinationPercent(
                        origin.leadingSuccessorObservedShare,
                        locale,
                      ),
                    },
                    {
                      label: t(
                        'destinationTransitions.directory.successors',
                        'Distinct successors',
                      ),
                      value: fmtInt(
                        origin.distinctObservedSuccessors,
                      ),
                    },
                    {
                      label: t(
                        'destinationTransitions.directory.concentration',
                        'Concentration index',
                      ),
                      value: destinationIndex(
                        origin.transitionConcentrationIndex,
                        locale,
                      ),
                    },
                    {
                      label: t(
                        'destinationTransitions.directory.entropy',
                        'Entropy bits',
                      ),
                      value: destinationBits(origin.entropyBits, locale),
                    },
                    {
                      label: t(
                        'destinationTransitions.directory.recurrence',
                        'Repeat observations',
                      ),
                      value: fmtInt(origin.support.recurrenceCount),
                    },
                    {
                      label: t(
                        'destinationTransitions.directory.activeDays',
                        'Outgoing active days',
                      ),
                      value: fmtInt(origin.outgoingActiveLocalDays),
                    },
                    {
                      label: t(
                        'destinationTransitions.directory.supportIndex',
                        'Support index',
                      ),
                      value: destinationIndex(origin.support.index, locale),
                    },
                  ].map((metric) => (
                    <div
                      key={metric.label}
                      className="rounded-lg bg-[var(--surface-1)] p-2"
                    >
                      <Text as="p" variant="caption">
                        {metric.label}
                      </Text>
                      <Text as="p" variant="bodySm" weight="semibold">
                        {metric.value}
                      </Text>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </DestinationTransitionsSectionBody>
      </GlassPanel>
    </section>
  );
}
