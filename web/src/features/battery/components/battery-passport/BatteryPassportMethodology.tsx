import {
  CalendarClock,
  Database,
  FileWarning,
  Fingerprint,
  Gauge,
  Layers3,
  ListChecks,
  Scale,
  Server,
  ShieldQuestion,
  Sigma,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  Heading,
  PanelTitle,
  Text,
} from '@/components/ui';

export function BatteryPassportMethodology() {
  const { t } = useTranslation();
  const items = [
    {
      key: 'trend-cap',
      icon: <CalendarClock className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.trendCapTitle',
        '180-day trend maximum',
      ),
      body: t(
        'batteryPassport.method.trendCapBody',
        'The server returns at most 180 qualifying UTC daily points. Reaching the maximum means earlier qualifying history may be absent; it does not establish a continuous 180-day observation window.',
      ),
    },
    {
      key: 'daily-rule',
      icon: <Gauge className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.dailyRuleTitle',
        '20-point daily SoC rule',
      ),
      body: t(
        'batteryPassport.method.dailyRuleBody',
        'Server methodology requires a daily max-minus-min SoC swing of at least 20 percentage points and positive aggregated charged energy before deriving a daily capacity estimate.',
      ),
    },
    {
      key: 'median',
      icon: <Sigma className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.medianTitle',
        'Recent-eight median',
      ),
      body: t(
        'batteryPassport.method.medianBody',
        'The headline reported capacity is the median of up to the eight most recent qualifying daily capacity estimates, then used with the reference capacity for the reported SoH.',
      ),
    },
    {
      key: 'reference',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.referenceTitle',
        'Server nameplate fallback',
      ),
      body: t(
        'batteryPassport.method.referenceBody',
        'Server methodology selects a nameplate reference from a VIN code, then model name, then a 75 kWh fallback. The response reports the chosen value but not which branch supplied it.',
      ),
    },
    {
      key: 'utc',
      icon: <CalendarClock className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.utcTitle',
        'UTC trend calendar',
      ),
      body: t(
        'batteryPassport.method.utcBody',
        'degradation_trend.date is explicitly a UTC calendar date. The workspace does not relabel these dates as vehicle-local; issue instants may be displayed in vehicle time separately.',
      ),
    },
    {
      key: 'aggregate',
      icon: <Layers3 className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.aggregateTitle',
        'Aggregate-only evidence',
      ),
      body: t(
        'batteryPassport.method.aggregateBody',
        'Daily battery aggregates, charging rollups, and drive-temperature counts do not expose the underlying event sequence, sensor quality, losses, balancing, chemistry, or operating context.',
      ),
    },
    {
      key: 'ledger',
      icon: <Server className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.ledgerTitle',
        'Best-effort ledger write',
      ),
      body: t(
        'batteryPassport.method.ledgerBody',
        'After a successful certificate read, the server attempts to append a ledger snapshot. That write is best-effort: a write failure is logged and counted while the certificate response still succeeds.',
      ),
    },
    {
      key: 'hash',
      icon: <Fingerprint className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.hashTitle',
        'Current-day hash semantics',
      ),
      body: t(
        'batteryPassport.method.hashBody',
        'tsbp-v1 hashes seven ordered facts with fixed numeric precision. first_observed_at and issued_at enter as UTC days, so verification rebuilds the current certificate and compares today’s canonical digest with the supplied hash.',
      ),
    },
    {
      key: 'clock',
      icon: <ShieldQuestion className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.clockTitle',
        'Frozen diagnostic clock',
      ),
      body: t(
        'batteryPassport.method.clockBody',
        'The page captures one clock when mounted. Future-date classification and trend recency use that frozen instant so query refreshes cannot move points between categories during the same workspace session.',
      ),
    },
    {
      key: 'fit',
      icon: <Scale className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.fitTitle',
        'Gated linear description',
      ),
      body: t(
        'batteryPassport.method.fitBody',
        'The frontend withholds an annualized least-squares description until at least 12 valid unique points span at least 90 UTC days. A displayed line summarizes this returned window and is not a forecast.',
      ),
    },
    {
      key: 'recommendations',
      icon: <ListChecks className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.rulesTitle',
        'Rule-output directory',
      ),
      body: t(
        'batteryPassport.method.rulesBody',
        'Recommendation strings are deterministic outputs supplied by the server. The workspace preserves them as evidence and does not convert them into prescriptions or eligibility decisions.',
      ),
    },
    {
      key: 'limits',
      icon: <FileWarning className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'batteryPassport.method.limitsTitle',
        'Interpretation limits',
      ),
      body: t(
        'batteryPassport.method.limitsBody',
        'This certificate workspace does not establish regulatory compliance, calibrated battery health, causal damage, warranty eligibility, safety, remaining life, or validated degradation.',
      ),
    },
  ];

  return (
    <section data-testid="battery-passport-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FileWarning
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.method.title',
            'Methodology and interpretation limits',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.method.subtitle',
            'Server rules, frontend diagnostics, UTC semantics, persistence behavior, and explicit non-claims.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <article
              key={item.key}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-cyan-300">
                {item.icon}
                <Heading level="sub">{item.title}</Heading>
              </div>
              <Text as="p" variant="bodySm">
                {item.body}
              </Text>
            </article>
          ))}
        </div>
        <AlertBanner className="mt-4" variant="warning">
          <Text as="p" variant="caption">
            {t(
              'batteryPassport.method.notice',
              'Treat every value as a statement about this current server response and its documented aggregates. Verification checks digest agreement only; it does not validate upstream facts.',
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
