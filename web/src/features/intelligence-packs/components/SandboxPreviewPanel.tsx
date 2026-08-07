/**
 * Sandbox run preview: deterministically evaluates a pack's formulas
 * against the bundled synthetic sample dataset and renders the results
 * through allowlisted shared chart primitives only. Available for ANY
 * catalog entry (even unsigned/tampered demos, even before installing) —
 * this is safe by construction because the sandbox never touches real
 * vehicle data, never opens a network connection, and is bounded by hard
 * execution/row/output budgets (`lib/sandboxRunner.ts`).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Sparkline,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { MetricTile } from '@/components/data-display';
import { Badge, Caption, GlassPanel, Select, Text } from '@/components/ui';
import { EmptyState, InlineCallout } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';
import { useCatalog } from '../hooks/useCatalog';
import { useTrustDecision } from '../hooks/useTrustDecision';
import { useSandboxPreview } from '../hooks/useSandboxPreview';
import { resolveDashboardWidgetResults } from '../lib/sandboxRunner';
import type { FormulaRunResult } from '../lib/sandboxRunner';
import type { PackCapabilityId, PackVizKind } from '../lib/manifestTypes';

function seriesToChartData(series: number[]) {
  return series.map((value, i) => ({ i, value }));
}

function WidgetCard({ title, kind, result }: { title: string; kind: PackVizKind; result: FormulaRunResult | null }) {
  const { t } = useTranslation();
  if (!result) {
    return (
      <GlassPanel padding="sm" className="flex flex-col gap-1">
        <p className="text-xs font-medium text-[var(--text-primary)]">{title}</p>
        <p className="text-xs text-[var(--text-muted)]">{t('intelPacks.sandbox.formulaMissing', 'Referenced formula not found.')}</p>
      </GlassPanel>
    );
  }
  const data = seriesToChartData(result.series);

  return (
    <GlassPanel padding="sm" className="flex flex-col gap-2">
      <p className="text-xs font-medium text-[var(--text-primary)]">{title}</p>
      {data.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{t('intelPacks.sandbox.noData', 'No output rows.')}</p>
      ) : kind === 'line' ? (
        <ResponsiveContainer width="100%" height={120}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="i" hide />
            <YAxis width={36} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#22d3ee" dot={false} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : kind === 'area' ? (
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="i" hide />
            <YAxis width={36} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Area type="monotone" dataKey="value" stroke="#34d399" fill="#34d39933" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      ) : kind === 'bar' ? (
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
            <XAxis dataKey="i" hide />
            <YAxis width={36} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Bar dataKey="value" fill="#a78bfa" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : kind === 'sparkline' ? (
        <Sparkline data={result.series} ariaLabel={title} />
      ) : kind === 'radial-gauge' ? (
        // A pack formula has no declared ceiling, so the previous ring scaled
        // itself to the sample's own peak — which pinned it to a full circle
        // whenever the latest row happened to BE the peak, regardless of
        // magnitude. Nothing here can honestly fill a ring, so the reading is
        // shown as a number against the range the sample actually spanned.
        <MetricTile
          value={result.latest}
          unit={result.unit}
          label={t('intelPacks.sandbox.latest', 'Latest')}
          align="start"
          decimals={1}
          sublabel={t('intelPacks.sandbox.sampleRange', 'sample {{min}}–{{max}}{{unit}}', {
            min: fmtNumber(Math.min(...result.series), 1),
            max: fmtNumber(Math.max(...result.series), 1),
            unit: result.unit ? ` ${result.unit}` : '',
          })}
        />
      ) : (
        <div>
          <Text variant="metricValue">{result.latest != null ? fmtNumber(result.latest, 1) : '—'}</Text>
          <p className="text-xs text-[var(--text-muted)]">
            {t('intelPacks.sandbox.average', 'avg {{value}}{{unit}}', { value: result.average != null ? fmtNumber(result.average, 1) : '—', unit: result.unit ? ` ${result.unit}` : '' })}
          </p>
        </div>
      )}
      {result.budgetError && <Caption className="block text-amber-300">{result.budgetError}</Caption>}
      {result.deniedFieldRefs.length > 0 && (
        <Caption className="block text-rose-300">
          {t('intelPacks.sandbox.deniedFields', 'Fields evaluated as 0 (capability denied): {{fields}}', { fields: result.deniedFieldRefs.join(', ') })}
        </Caption>
      )}
    </GlassPanel>
  );
}

export function SandboxPreviewPanel() {
  const { t } = useTranslation();
  const { entries } = useCatalog();
  const [selectedPackId, setSelectedPackId] = useState<string>(entries[0]?.envelope.manifest.id ?? '');

  const selectedEntry = useMemo(() => entries.find((e) => e.envelope.manifest.id === selectedPackId) ?? null, [entries, selectedPackId]);
  const trustQuery = useTrustDecision(selectedEntry?.installedVersion != null ? selectedPackId : null);

  const grantedCapabilities = useMemo<ReadonlySet<PackCapabilityId>>(() => {
    if (!selectedEntry) return new Set();
    if (trustQuery.data) return new Set(trustQuery.data.approvedCapabilities);
    // Not installed: preview simulates the FULL requested-capability grant.
    // Safe because the sandbox only ever touches bundled synthetic sample
    // data, never real telemetry and never a network request.
    return new Set(selectedEntry.envelope.manifest.capabilities);
  }, [selectedEntry, trustQuery.data]);

  const run = useSandboxPreview(selectedEntry?.envelope.manifest ?? null, grantedCapabilities);

  if (entries.length === 0) {
    // no-action: preview entries are sourced from the same bundled catalog fixture as the Catalog tab, which always ships at least one demo entry.
    return <EmptyState icon={<FlaskConical className="h-10 w-10" />} message={t('intelPacks.sandbox.noEntries', 'No packs available to preview.')} />;
  }

  return (
    <div className="space-y-4">
      <InlineCallout variant="info" icon={<FlaskConical />}>
        {t(
          'intelPacks.sandbox.intro',
          'Runs entirely offline against bundled synthetic sample data with strict execution/row/output budgets. Safe to preview even unsigned or unverified packs.',
        )}
      </InlineCallout>

      <Select
        label={t('intelPacks.sandbox.selectPack', 'Pack to preview')}
        value={selectedPackId}
        onChange={(e) => setSelectedPackId(e.target.value)}
        options={entries.map((e) => ({ value: e.envelope.manifest.id, label: `${e.envelope.manifest.name} (v${e.envelope.manifest.version})` }))}
      />

      {selectedEntry && (
        <Badge variant={trustQuery.data ? 'success' : 'neutral'} size="sm">
          {trustQuery.data
            ? t('intelPacks.sandbox.usingInstalledGrant', 'Using installed capability grant')
            : t('intelPacks.sandbox.usingFullGrant', 'Preview mode: simulating full requested-capability grant (not installed)')}
        </Badge>
      )}

      {run == null || !selectedEntry ? (
        // no-action: the trigger surface is the pack Select control directly above this panel.
        <EmptyState message={t('intelPacks.sandbox.selectToPreview', 'Select a pack to run its sandbox preview.')} />
      ) : selectedEntry.envelope.manifest.dashboards.length === 0 ? (
        // no-action: whether a pack ships dashboard layouts is fixed by its manifest; there is nothing the user can trigger from this preview to add one.
        <EmptyState message={t('intelPacks.sandbox.noDashboards', 'This pack declares no dashboard layouts.')} />
      ) : (
        <div className="space-y-6">
          {selectedEntry.envelope.manifest.dashboards.map((dashboard) => (
            <div key={dashboard.id} className="space-y-2">
              <Text variant="bodySm" className="font-semibold">{dashboard.title}</Text>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {resolveDashboardWidgetResults(dashboard, run).map((w) => (
                  <WidgetCard key={w.widgetId} title={w.title} kind={w.kind as PackVizKind} result={w.result} />
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-[var(--text-muted)]">
            {t('intelPacks.sandbox.runStats', '{{rows}} sample rows · {{steps}} evaluation steps · {{ms}}ms{{truncated}}', {
              rows: run.rowsUsed,
              steps: run.totalStepsUsed,
              ms: run.durationMs,
              truncated: run.truncated ? t('intelPacks.sandbox.truncatedSuffix', ' · truncated by budget') : '',
            })}
          </p>
        </div>
      )}
    </div>
  );
}
