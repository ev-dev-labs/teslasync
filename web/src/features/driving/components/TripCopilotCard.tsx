import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption, Button, Input, Badge, ErrorText } from '@/components/ui';
import { Skeleton, EmptyState, DataSourceNotice } from '@/components/feedback';
import { useTripConfidence } from '@/api/hooks/useDriving';
import type { TripConfidence, TripConfidenceRequest } from '@/types/driving';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { typography } from '@/lib/tokens';

interface TripCopilotCardProps {
  currentSoc: number;
  minArrivalSoc: number;
}

function verdictBadge(verdict: string, t: (k: string, d: string) => string): { label: string; variant: 'success' | 'warning' | 'danger' } {
  switch (verdict) {
    case 'comfortable':
      return { label: t('tripPlanner.copilot.comfortable', 'You will make it'), variant: 'success' };
    case 'tight':
      return { label: t('tripPlanner.copilot.tight', 'Tight — drive gently'), variant: 'warning' };
    default:
      return { label: t('tripPlanner.copilot.chargeNow', 'Charge first'), variant: 'danger' };
  }
}

/**
 * Trip Copilot: manual arrival scenario using the planner form's SOC and
 * arrival floor. Omitted capacity and efficiency use server defaults.
 */
export function TripCopilotCard({ currentSoc, minArrivalSoc }: TripCopilotCardProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const [remainingKm, setRemainingKm] = useState('');
  const [submittedScenario, setSubmittedScenario] = useState<TripConfidenceRequest | null>(null);
  const [completedCheck, setCompletedCheck] = useState<{
    result: TripConfidence;
    scenario: TripConfidenceRequest;
  } | null>(null);
  const check = useTripConfidence();
  const result = completedCheck?.result ?? check.data ?? null;
  const scenario = completedCheck?.scenario ?? check.variables;
  const checking = check.isPending && !check.isPaused;

  const km = Number(remainingKm);
  const canCheck = Number.isFinite(km) && km > 0 && !check.isPending;
  const inputsChanged = scenario != null && (
    scenario.current_soc !== currentSoc ||
    scenario.min_arrival_soc !== minArrivalSoc ||
    scenario.remaining_km !== km
  );

  function submit(request: TripConfidenceRequest) {
    if (check.isPending) return;
    setSubmittedScenario(request);
    check.mutate(request, {
      onSuccess: (response) => setCompletedCheck({ result: response, scenario: request }),
    });
  }

  function handleCheck() {
    if (!canCheck) return;
    submit({ current_soc: currentSoc, remaining_km: km, min_arrival_soc: minArrivalSoc });
  }

  const retryScenario = submittedScenario ?? check.variables;
  const retry = retryScenario && !check.isPending ? () => submit(retryScenario) : undefined;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Gauge className={`h-4 w-4 ${typography.color.secondary}`} aria-hidden="true" />
          {t('tripPlanner.copilot.title', 'Trip Copilot')}
        </PanelTitle>
        {result && (
          <Badge variant={verdictBadge(result.verdict, t).variant} size="sm">
            {verdictBadge(result.verdict, t).label}
          </Badge>
        )}
      </div>

      <div className="mb-3 space-y-1">
        <Text as="p" variant="bodySm">
          {t('tripPlanner.copilot.manualScenario', 'Manual scenario: starting SOC {{soc}}% and minimum arrival SOC {{floor}}% come from the planner form, not live telemetry.', {
            soc: fmtNumber(currentSoc),
            floor: fmtNumber(minArrivalSoc),
          })}
        </Text>
        <Caption as="p">
          {t('tripPlanner.copilot.defaultAssumptions', 'Server default assumptions: 75 kWh battery capacity, 160 Wh/km consumption, and 1.0 efficiency factor.')}
        </Caption>
        <Caption as="p">
          {t('tripPlanner.copilot.unknownObservations', 'Vehicle observations are unknown for this check: live SOC, actual battery capacity, recent efficiency, and route conditions are not supplied. This is an estimate, not a live arrival guarantee.')}
        </Caption>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 basis-full md:basis-40 flex-1">
          <Input
            className="min-h-11 md:min-h-10"
            label={t('tripPlanner.copilot.remainingKm', 'Remaining (km)')}
            type="number"
            min={1}
            value={remainingKm}
            onChange={(e) => setRemainingKm(e.target.value)}
          />
        </div>
        <Button
          wrapLabel
          className="min-h-11 min-w-11 w-full md:min-h-10 md:min-w-0 md:w-auto"
          onClick={handleCheck}
          disabled={!canCheck}
          loading={checking}
        >
          {t('tripPlanner.copilot.check', 'Will I make it?')}
        </Button>
      </div>

      <div className="mt-3">
        {checking && (
          <div role="status" aria-live="polite">
            <Caption as="p">
              {t('tripPlanner.copilot.title', 'Trip Copilot')}: {result
                ? t('dataSources.status.refreshing', 'Refreshing')
                : t('dataSources.status.loading', 'Loading')}
            </Caption>
            {!result && <Skeleton height={64} />}
          </div>
        )}
        {(check.isError || check.isPaused) && (
          <DataSourceNotice
            sources={[{
              id: 'trip-confidence',
              label: t('tripPlanner.copilot.title', 'Trip Copilot'),
              query: {
                data: result ?? undefined,
                error: check.error,
                isError: check.isError,
                fetchStatus: check.isPaused ? 'paused' : checking ? 'fetching' : 'idle',
                refetch: retry,
              },
            }]}
          />
        )}
        {check.isError && (
          <ErrorText>{check.error instanceof Error && check.error.message
            ? check.error.message
            : t('tripPlanner.copilot.error', 'Confidence check failed')}</ErrorText>
        )}
        {!result && !check.isPending && !check.isPaused && !check.isError ? (
          <EmptyState /* no-action: informational empty — no CTA */
            icon={<Gauge className="h-8 w-8" />}
            message={t('tripPlanner.copilot.scenarioEmpty', 'Enter remaining distance to estimate arrival for this manual scenario.')}
          />
        ) : result ? (
          <div className="space-y-1.5">
            {scenario && (
              <Caption as="p">
                {t('tripPlanner.copilot.checkedScenario', 'Checked scenario: starting SOC {{soc}}%, minimum arrival SOC {{floor}}%, remaining distance {{distance}} km.', {
                  soc: fmtNumber(scenario.current_soc),
                  floor: fmtNumber(scenario.min_arrival_soc ?? 0),
                  distance: fmtNumber(scenario.remaining_km),
                })}
              </Caption>
            )}
            {inputsChanged && (
              <Text as="p" variant="bodySm" role="status">
                {t('tripPlanner.copilot.inputsChanged', 'Inputs have changed. This result applies only to the checked scenario; check again for the current inputs.')}
              </Text>
            )}
            <Text as="p" variant="bodySm">{result.explanation}</Text>
            <Caption className="block tabular-nums">
              {t('tripPlanner.copilot.detail', 'Arrival ~{{soc}}% · {{margin}} kWh margin', {
                soc: fmtNumber(result.arrival_soc),
                margin: fmtNumber(result.margin_kwh),
              })}
            </Caption>
          </div>
        ) : null}
      </div>
    </GlassPanel>
  );
}
