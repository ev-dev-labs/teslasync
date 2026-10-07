import { Grid3X3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';
import type {
  DestinationTransitionResult,
  TransitionMatrixCell,
} from '../../lib/destinationTransitions';
import { destinationPercent } from './labels';
import { DestinationTransitionsSectionBody } from './DestinationTransitionsSectionBody';
import type { DestinationTransitionsQueryState } from './types';

interface TopTransitionMatrixProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function TopTransitionMatrix({
  model,
  state,
  locale,
}: TopTransitionMatrixProps) {
  const { t } = useTranslation();
  const rows = model.topMatrix;
  const destinations = rows.map((row) => ({
    key: row.fromKey,
    label: row.fromLabel,
  }));
  const cellLabel = (
    from: string,
    cell: TransitionMatrixCell,
  ): string =>
    cell.status === 'unsupported_origin'
      ? t(
          'destinationTransitions.matrix.cellUnsupportedAria',
          '{{from}} to {{to}}: {{count}} observed; origin is below the support gate',
          {
            from,
            to: cell.toLabel,
            count: cell.count,
          },
        )
      : t(
          'destinationTransitions.matrix.cellAria',
          '{{from}} to {{to}}: {{count}} observed, {{share}} of accepted outgoing transitions',
          {
            from,
            to: cell.toLabel,
            count: cell.count,
            share: destinationPercent(
              cell.observedConditionalShare,
              locale,
            ),
          },
        );

  return (
    <section data-testid="destination-transition-matrix">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Grid3X3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'destinationTransitions.matrix.title',
            'Top transition matrix',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'destinationTransitions.matrix.subtitle',
            'Counts among the most visited states; shares retain each origin’s full accepted denominator, and dashed cells mark origins below the three-transition support gate.',
          )}
        </Text>
        <DestinationTransitionsSectionBody model={model} state={state}>
          <div
            className="overflow-x-auto pb-2"
            role="table"
            aria-label={t(
              'destinationTransitions.matrix.aria',
              'Counts and observed outgoing shares in the top destination transition matrix',
            )}
          >
            <div className="flex min-w-max gap-2" role="row">
              <div className="w-36 shrink-0 p-2" role="columnheader">
                <Text variant="label">
                  {t(
                    'destinationTransitions.matrix.origin',
                    'Origin',
                  )}
                </Text>
              </div>
              {destinations.map((destination) => (
                <div
                  key={destination.key}
                  className="w-28 shrink-0 p-2 text-center"
                  role="columnheader"
                >
                  <Text variant="label">{destination.label}</Text>
                </div>
              ))}
            </div>
            <div className="space-y-2">
              {rows.map((row) => (
                <div
                  key={row.fromKey}
                  className="flex min-w-max gap-2"
                  role="row"
                >
                  <div
                    className="flex w-36 shrink-0 flex-col justify-center rounded-lg bg-[var(--surface-2)] p-2"
                    role="rowheader"
                  >
                    <Text variant="bodySm">{row.fromLabel}</Text>
                    <Text variant="caption">
                      {t(
                        'destinationTransitions.matrix.outgoing',
                        '{{count}} outgoing',
                        { count: row.outgoingTransitions },
                      )}
                    </Text>
                  </div>
                  {row.cells.map((cell) => (
                    <div
                      key={cell.toKey}
                      className={cn(
                        'flex w-28 shrink-0 flex-col justify-center rounded-lg border p-2 text-center',
                        cell.status === 'unsupported_origin'
                          ? 'border-dashed border-[var(--border-strong)] bg-[var(--surface-2)]'
                          : cell.status === 'observed'
                            ? 'border-neon-cyan/20 bg-neon-cyan/5'
                            : 'border-[var(--border-subtle)] bg-[var(--surface-1)]',
                      )}
                      role="cell"
                      aria-label={cellLabel(row.fromLabel, cell)}
                    >
                      <Text variant="bodySm" weight="semibold">
                        {fmtInt(cell.count)}
                      </Text>
                      <Text variant="caption">
                        {destinationPercent(
                          cell.observedConditionalShare,
                          locale,
                        )}
                      </Text>
                      {cell.status === 'unsupported_origin' ? (
                        <Text variant="caption">
                          {t(
                            'destinationTransitions.matrix.belowGate',
                            'Below gate',
                          )}
                        </Text>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </DestinationTransitionsSectionBody>
      </GlassPanel>
    </section>
  );
}
