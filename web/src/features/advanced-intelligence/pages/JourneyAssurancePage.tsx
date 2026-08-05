import { type FormEvent, useState } from 'react';
import { Route, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunJourneyAssurance } from '@/api/hooks/useAdvancedIntelligence';
import { StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Input, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { SI } from '@/lib/unitConversion';
import type { JourneyAssuranceRequest } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput } from '../components';

type JourneyForm = Omit<JourneyAssuranceRequest, 'vehicle_id' | 'confirmed' | 'departure_at'> & {
  departure_at: string;
};

function defaultDeparture(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 16);
}

export default function JourneyAssurancePage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useRunJourneyAssurance();
  const [form, setForm] = useState<JourneyForm>({
    route_distance_m: 250000,
    departure_at: defaultDeparture(),
    reserve_target_pct: 15,
    outside_temp_c: null,
    average_speed_mps: null,
    auxiliary_load_w: null,
  });
  usePageTitle(t('advancedIntelligence.journey.title', 'Journey Assurance'));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    mutation.mutate({
      ...form,
      vehicle_id: vehicleId,
      departure_at: new Date(form.departure_at).toISOString(),
      confirmed: true,
    });
  };
  const result = mutation.data;

  return (
    <PageContainer
      title={t('advancedIntelligence.journey.title', 'Journey Assurance')}
      subtitle={t(
        'advancedIntelligence.journey.subtitle',
        'Assess departure readiness and arrival reserve from supported vehicle evidence.',
      )}
      actions={<VehicleSelect withIcon />}
    >
      <AlertBanner
        variant="info"
        title={t('advancedIntelligence.journey.notice.title', 'Planning estimate')}
      >
        {t(
          'advancedIntelligence.journey.notice.body',
          'This assessment does not reserve chargers, navigate, precondition, or command the vehicle.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.journey.form.title', 'Journey scenario')}
          description={t(
            'advancedIntelligence.journey.form.subtitle',
            'Optional weather, speed, and auxiliary load sharpen the estimate when known.',
          )}
        >
          <form className="space-y-5" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.distance', 'Route distance (canonical SI)')}
                value={form.route_distance_m}
                onChange={(value) => setForm((current) => ({ ...current, route_distance_m: value ?? 0 }))}
                siUnit={SI.distance}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDistance(form.route_distance_m),
                })}
                min={100}
                max={5000000}
                required
              />
              <Input
                type="datetime-local"
                label={t('advancedIntelligence.journey.form.departure', 'Departure')}
                value={form.departure_at}
                required
                onChange={(event) => setForm((current) => ({ ...current, departure_at: event.target.value }))}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.journey.form.reserve', 'Reserve target (%)')}
                value={form.reserve_target_pct}
                min={0}
                max={80}
                step={1}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, reserve_target_pct: Number(event.target.value),
                }))}
              />
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.temperature', 'Outside temperature (canonical SI, optional)')}
                value={form.outside_temp_c}
                onChange={(value) => setForm((current) => ({ ...current, outside_temp_c: value }))}
                siUnit={SI.temperature}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatTemperature(form.outside_temp_c),
                })}
                min={-80}
                max={80}
                step={0.1}
              />
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.speed', 'Average speed (canonical SI, optional)')}
                value={form.average_speed_mps}
                onChange={(value) => setForm((current) => ({ ...current, average_speed_mps: value }))}
                siUnit={SI.speed}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatSpeed(form.average_speed_mps),
                })}
                min={0.1}
                max={70}
                step={0.1}
              />
              <SiNumberInput
                label={t('advancedIntelligence.journey.form.auxiliary', 'Auxiliary load (canonical SI, optional)')}
                value={form.auxiliary_load_w}
                onChange={(value) => setForm((current) => ({ ...current, auxiliary_load_w: value }))}
                siUnit={SI.power}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatPower(form.auxiliary_load_w),
                })}
                min={0}
                max={50000}
              />
            </div>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={vehicleId == null || mutation.isPending}
              icon={<Route className="h-4 w-4" aria-hidden="true" />}
            >
              {t('advancedIntelligence.journey.form.run', 'Run confirmed readiness assessment')}
            </Button>
          </form>
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.journey.summary.title', 'Readiness and arrival range')}
          empty={!result}
          emptyMessage={t(
            'advancedIntelligence.journey.summary.empty',
            'Submit a journey scenario to calculate readiness.',
          )}
        >
          <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={4}>
            <StatCard
              label={t('advancedIntelligence.journey.readiness', 'Readiness score')}
              value={result?.readiness_score_pct != null
                ? `${fmtNumber(result.readiness_score_pct, 1)}%` : null}
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
              label={t('advancedIntelligence.journey.arrivalLow', 'Arrival SoC low')}
              value={result?.arrival_soc_low_pct != null
                ? `${fmtNumber(result.arrival_soc_low_pct, 1)}%` : null}
            />
            <StatCard
              label={t('advancedIntelligence.journey.arrivalHigh', 'Arrival SoC high')}
              value={result?.arrival_soc_high_pct != null
                ? `${fmtNumber(result.arrival_soc_high_pct, 1)}%` : null}
            />
            <StatCard
              label={t('advancedIntelligence.journey.energy', 'Energy required')}
              value={units.formatEnergy(result?.energy_required_wh)}
            />
          </Grid>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <InsightPanel
          title={t('advancedIntelligence.journey.factors.title', 'Readiness factors')}
          empty={!result || result.factors.length === 0}
          emptyMessage={t('advancedIntelligence.journey.factors.empty', 'No supported readiness factors are available.')}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {(result?.factors ?? []).map((factor) => (
              <article key={factor.factor} className="rounded-lg border border-white/[0.07] p-4">
                <div className="flex items-center justify-between gap-3">
                  <Text as="h3" variant="label">{factor.factor}</Text>
                  <Badge variant={factor.status === 'supported' ? 'success' : 'warning'}>{factor.status}</Badge>
                </div>
                <Text as="p" variant="bodySm" className="mt-2">{factor.explanation}</Text>
                <Text as="p" variant="metricValue" className="mt-3">
                  {factor.score_pct != null ? `${fmtNumber(factor.score_pct, 1)}%` : '—'}
                </Text>
              </article>
            ))}
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <EvidencePanel
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.journey.unsupported.traffic', 'Live traffic and charger availability'),
            t('advancedIntelligence.journey.unsupported.commands', 'Navigation, charging, or climate commands'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
