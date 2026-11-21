import { useTranslation } from 'react-i18next';
import type { PersonalScope } from '@/api/hooks/usePersonalIdentity';
import { Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { MeterBoundary, ReconciliationReport } from '@/types/ownership';
import { formatCurrencyMinor } from '../formatters';
import { OwnershipPanel } from './OwnershipPanel';
import { InvoiceReviewControls } from './InvoiceReviewControls';

export function InvoiceVarianceCard({ report, fresh, scope }: {
  report: ReconciliationReport; fresh: boolean; scope: PersonalScope | null;
}) {
  const { t } = useTranslation();
  const { formatEnergy, unitPrefs } = useUnits();
  const { formatDateTime } = useDateFormat();
  const review = report.variance_review;
  if (!review) return null;
  const money = (minor: number) => formatCurrencyMinor(minor, report.invoice.currency, unitPrefs.locale);
  const lines = new Map((report.lines ?? []).map(({ line }) => [line.id, line]));
  const findings = review.findings ?? [];
  const unit = (boundary: MeterBoundary) => boundary === 'station'
    ? t('ownership.reconcile.review.station', 'Station or wall meter')
    : t('ownership.reconcile.review.battery', 'Vehicle battery');
  const status = review.state === 'off'
    ? t('ownership.reconcile.review.off', 'Off. No sessions are compared for this statement.')
    : review.state === 'handled'
      ? t('ownership.reconcile.review.handled', 'This statement is already handled. No new review is suggested.')
      : review.state === 'no_material_difference'
        ? t('ownership.reconcile.review.quiet', 'No material difference was found in the components that could be compared.')
        : t('ownership.reconcile.review.insufficient', 'No comparison is supported by the evidence entered. Missing readings, fee breakdowns and rates are not assumed to be zero.');
  return (
    <OwnershipPanel title={t('ownership.reconcile.review.title', 'Private statement check')}>
      {review.state !== 'off' && <Text as="p" variant="caption">
        {t('ownership.reconcile.review.coverage', '{{matched}} session matches and {{comparable}} comparable lines of {{total}} statement lines. An entered site and a unique completed session within two minutes are required for meter and rate comparisons.', {
          matched: review.matched_lines, comparable: review.comparable_lines, total: report.invoice.line_count,
        })}
      </Text>}
      {!fresh && (
        <Text as="p" variant="caption" role="status">
          {t('ownership.reconcile.review.stale', 'Showing the last comparison. Refresh before relying on it.')}
        </Text>
      )}
      {review.state !== 'review' ? <Text as="p" variant="bodySm" role="status">{status}</Text> : (
        <>
          <Text as="h3" variant="label">{t('ownership.reconcile.review.material', 'Check the unexplained difference')}</Text>
          <Text as="p" variant="bodySm">
            {t('ownership.reconcile.review.limitations', 'Differences are billed minus comparable. This is not a finding of overbilling. Check the original meter, rate and fee records; taxes and idle fees are listed separately, not ruled valid or invalid.')}
          </Text>
          {review.unexplained_statement_minor != null && (
            <Text as="p" variant="bodySm">{t('ownership.reconcile.review.statementGap', 'Fully entered statement: {{billed}} total vs {{lines}} in lines (difference {{delta}}).', {
              billed: money(report.invoice.billed_total_minor), lines: money(report.billed_total_minor), delta: money(review.unexplained_statement_minor),
            })}</Text>
          )}
          <ul className="space-y-4">
            {findings.map(({ line_id, session_id, session_started_at, assessment: gap }) => {
              const line = lines.get(line_id);
              const evidence = line?.variance_evidence;
              const meter = evidence?.meter;
              return (
                <li key={line_id} className="min-w-0 space-y-1 break-words border-t border-[var(--border-default)] pt-3">
                  <Text as="h4" variant="label">{line?.line_ref || t('ownership.reconcile.line.unnamed', 'Unnamed line')}</Text>
                  {session_id != null && session_started_at && <Text as="p" variant="caption">
                    {t('ownership.reconcile.review.session', 'Matched session #{{id}} at {{start}}', { id: session_id, start: formatDateTime(session_started_at) })}
                  </Text>}
                  {line && meter && evidence?.billed_boundary && gap.expected_energy_lower_wh != null && gap.expected_energy_upper_wh != null && <Text as="p" variant="bodySm">
                    {t('ownership.reconcile.review.meterBasis', 'Entered {{observedBoundary}} reading: {{observed}}. Billed at {{billedBoundary}}: {{billed}}; comparable range {{lower}} to {{upper}}.', {
                      observedBoundary: unit(meter.observed_boundary), observed: formatEnergy(meter.observed_energy_wh),
                      billedBoundary: unit(evidence.billed_boundary), billed: formatEnergy(line.billed_energy_wh),
                      lower: formatEnergy(gap.expected_energy_lower_wh), upper: formatEnergy(gap.expected_energy_upper_wh),
                    })}
                  </Text>}
                  {gap.unexplained_energy_wh != null && <Text as="p" variant="bodySm">
                    {t('ownership.reconcile.review.energyGap', 'Energy outside the comparable range: {{delta}}.', { delta: formatEnergy(gap.unexplained_energy_wh) })}
                  </Text>}
                  {line && gap.unexplained_rate_minor != null && gap.expected_energy_minor != null && <Text as="p" variant="bodySm">
                    {t('ownership.reconcile.review.rateGap', 'Energy charge: {{billed}} billed vs {{expected}} at the entered flat rate (difference {{delta}}).', {
                      billed: money(line.billed_energy_minor), expected: money(gap.expected_energy_minor), delta: money(gap.unexplained_rate_minor),
                    })}
                  </Text>}
                  {line && evidence?.other_fees_minor != null && gap.components_total_minor != null && <Text as="p" variant="bodySm">
                    {t('ownership.reconcile.review.componentBasis', 'Entered components: energy {{energy}}, idle or occupancy {{idle}}, tax {{tax}}, other fees {{fees}}. Sum {{sum}}; billed line total {{billed}}.', {
                      energy: money(line.billed_energy_minor), idle: money(line.billed_idle_minor), tax: money(line.billed_tax_minor),
                      fees: money(evidence.other_fees_minor), sum: money(gap.components_total_minor), billed: money(line.billed_total_minor),
                    })}
                  </Text>}
                  {gap.unexplained_total_minor != null && <Text as="p" variant="bodySm">
                    {t('ownership.reconcile.review.lineGap', 'Difference not covered by the entered line components: {{delta}}.', { delta: money(gap.unexplained_total_minor) })}
                  </Text>}
                </li>
              );
            })}
          </ul>
          {fresh && (
            <a href="#invoice-line-audit" className="inline-flex min-h-11 items-center underline">
              {t('ownership.reconcile.review.checkLines', 'Review the statement lines')}
            </a>
          )}
        </>
      )}
      <InvoiceReviewControls key={report.invoice.id} invoice={report.invoice} scope={scope} fresh={fresh} />
    </OwnershipPanel>
  );
}
