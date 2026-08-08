import { BookOpen, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

import { DriveDnaMethodologyCards } from './DriveDnaMethodologyCards';
import type { DriveDnaSectionState } from './types';

interface DriveDnaMethodologyProps {
  state: DriveDnaSectionState;
  historyLimit: number;
  historyReturned: number;
  capReached: boolean;
}

export function DriveDnaMethodology({
  state,
  historyLimit,
  historyReturned,
  capReached,
}: DriveDnaMethodologyProps) {
  const { t } = useTranslation();
  const listStatus = state.list.isLoading
    ? t('driveDna.method.listLoading', 'Selector history loading')
    : state.list.error
      ? t('driveDna.method.listError', 'Selector history unavailable')
      : state.list.isResolved
        ? t('driveDna.method.listReady', 'Selector history resolved')
        : t('driveDna.method.listPending', 'Selector history pending');
  const telemetryStatus = state.telemetry.isLoading
    ? t('driveDna.method.telemetryLoading', 'Drive telemetry loading')
    : state.telemetry.error
      ? t('driveDna.method.telemetryError', 'Drive telemetry unavailable')
      : state.telemetry.isResolved
        ? t('driveDna.method.telemetryReady', 'Drive telemetry resolved')
        : t('driveDna.method.telemetryPending', 'Drive telemetry pending');
  const historyScope = state.list.isLoading
    ? t(
        'driveDna.method.capLoading',
        'The selector is requesting up to {{limit}} recent drives.',
        { limit: fmtInt(historyLimit) },
      )
    : state.list.error
      ? t(
          'driveDna.method.capError',
          'Selector history is unavailable; no returned-history coverage claim is made.',
        )
      : capReached
        ? t(
            'driveDna.method.capReached',
            'The selector returned the newest {{limit}} drives and reached its cap; older drives may not be selectable.',
            { limit: fmtInt(historyLimit) },
          )
        : state.list.isResolved
          ? t(
              'driveDna.method.capScope',
              'The selector requests up to {{limit}} recent drives; {{returned}} were returned for the current vehicle.',
              {
                limit: fmtInt(historyLimit),
                returned: fmtInt(historyReturned),
              },
            )
          : t(
              'driveDna.method.capPending',
              'Selector-history availability has not resolved, so coverage is not yet known.',
            );

  return (
    <section
      aria-label={t(
        'driveDna.method.sectionAria',
        'Drive DNA coverage and methodology',
      )}
      data-testid="drive-dna-methodology"
    >
      <GlassPanel className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('driveDna.method.title', 'Coverage & methodology')}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'driveDna.method.subtitle',
                'Scope, signal semantics, and limits for interpreting this deterministic artwork.',
              )}
            </Text>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={
                state.list.error
                  ? 'danger'
                  : state.list.isLoading
                    ? 'neutral'
                    : capReached
                      ? 'warning'
                      : 'info'
              }
            >
              {listStatus}
            </Badge>
            <Badge
              variant={
                state.telemetry.error
                  ? 'danger'
                  : state.telemetry.isLoading
                    ? 'neutral'
                    : state.telemetry.isResolved
                      ? 'success'
                      : 'neutral'
              }
            >
              {telemetryStatus}
            </Badge>
          </div>
        </div>

        <AlertBanner
          className="mt-4"
          variant={capReached ? 'warning' : 'info'}
          icon={<Database className="h-4 w-4" aria-hidden="true" />}
        >
          <Text as="p" variant="caption">
            {historyScope}
          </Text>
        </AlertBanner>
        <DriveDnaMethodologyCards />
        <DriveDnaMethodologyCards />
      </GlassPanel>
    </section>
  );
}
