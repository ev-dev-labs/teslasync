/**
 * Schema Drift admin observability surface.
 *
 * Renders the current schema fingerprint vs the recorded seed
 * fingerprint, with deltas for table/column/index counts. The seed
 * is captured at boot and persisted in `schema_fingerprint`; drift
 * surfaces when a migration ran without a corresponding seed
 * regeneration, or when raw DDL bypassed migrations.
 *
 * Backed by GET /api/v1/admin/observability/schema-drift
 * (internal/handler/v1/admin_observability_handler.go).
 *
 * Modern-UI: full-width responsive bento — a KPI band, a fingerprint
 * comparison hero beside a per-object drift breakdown, and a
 * drift-state-driven guidance band. Every section owns its own
 * loading / empty / error state.
 */
import { useTranslation } from 'react-i18next';
import {
  Fingerprint, AlertTriangle, ShieldCheck, RefreshCw, Database,
  Columns3, KeyRound, GitCompare, Clock, ListChecks,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Button, CopyButton,
  SectionTitle, PanelTitle, Text, Caption, Label, MetricValue, Code,
} from '@/components/ui';
import { SeverityBadge } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import {
  EmptyState, AlertBanner, QueryError, Skeleton, SectionErrorBoundary,
} from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';
import { formatDateTime, formatRelativeTime } from '@/lib/dateFormat';
import { useSchemaDrift } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import type { SchemaDrift, SchemaFingerprint } from '@/types/admin-operator-confidence';

/* ─── Helpers ─────────────────────────────────────────────── */

function formatDelta(delta: number | null | undefined): string {
  const d = delta ?? 0;
  if (d === 0) return '0';
  return d > 0 ? `+${fmtInt(d)}` : fmtInt(d);
}

/** Per-count comparisons treat a zero delta as a match. */
function tone(delta: number | null | undefined): 'success' | 'warn' {
  return (delta ?? 0) === 0 ? 'success' : 'warn';
}

/* ─── Shared section state ────────────────────────────────── */

interface SectionState {
  drift: SchemaDrift | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/* ─── Page ────────────────────────────────────────────────── */

export default function SchemaDriftPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.schemaDrift.pageTitle', 'Schema Drift'));

  const query = useSchemaDrift();
  const { data, isLoading, error, isFetching } = query;

  const drift = data?.drift ?? null;
  const isDrifted = data ? (data.is_different ?? drift?.has_drift ?? false) : false;
  const subsystemMissing = isApiError(error) && error.status === 503;
  // 503 is an expected "not configured" state, surfaced via the banner —
  // don't also render it as a per-section error.
  const sectionError = subsystemMissing ? null : error;

  const state: SectionState = {
    drift,
    isLoading,
    error: sectionError,
    onRetry: () => query.refetch(),
  };

  const actions = (
    <Button
      variant="ghost"
      onClick={() => query.refetch()}
      aria-label={t('common.refresh', 'Refresh')}
      title={t('common.refresh', 'Refresh')}
    >
      <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} aria-hidden="true" />
    </Button>
  );

  return (
    <PageContainer
      title={t('admin.schemaDrift.pageTitle', 'Schema Drift')}
      subtitle={t(
        'admin.schemaDrift.subtitle',
        'Current database schema fingerprint compared against the recorded seed. Drift indicates a migration ran without a seed refresh, or raw DDL bypassed the migration system.',
      )}
      actions={actions}
      query={query}
    >
      {subsystemMissing && (
        <AlertBanner
          variant="warning"
          title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}
        >
          {t(
            'admin.schemaDrift.notConfigured',
            'The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page.',
          )}
        </AlertBanner>
      )}

      {/* 1 — KPI band: status + count deltas */}
      <FadeIn>
        <KpiBand state={state} isDrifted={isDrifted} />
      </FadeIn>

      {/* 2 — Fingerprint comparison hero beside the per-object breakdown */}
      <FadeIn delay={0.1}>
        <SectionErrorBoundary name="schema-drift-fingerprints">
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
            <div className="xl:col-span-2">
              <FingerprintPanel state={state} />
            </div>
            <div className="xl:col-span-1">
              <BreakdownPanel state={state} />
            </div>
          </section>
        </SectionErrorBoundary>
      </FadeIn>

      {/* 3 — Interpretation band */}
      <FadeIn delay={0.2}>
        <GuidancePanel state={state} isDrifted={isDrifted} />
      </FadeIn>
    </PageContainer>
  );
}

/* ─── 1. KPI band ─────────────────────────────────────────── */

function KpiBand({ state, isDrifted }: { state: SectionState; isDrifted: boolean }) {
  const { t } = useTranslation();
  const { drift, isLoading } = state;
  return (
    <section
      aria-label={t('admin.schemaDrift.kpis', 'Schema drift summary')}
      className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4"
    >
      <StatusTile isDrifted={isDrifted} isLoading={isLoading} hasData={!!drift} />
      <DeltaTile
        label={t('admin.schemaDrift.tableDelta', 'Tables Δ')}
        icon={<Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
        delta={drift?.table_count_delta}
        current={drift?.current.table_count}
        expected={drift?.expected.table_count}
        isLoading={isLoading}
        hasData={!!drift}
      />
      <DeltaTile
        label={t('admin.schemaDrift.columnDelta', 'Columns Δ')}
        icon={<Columns3 className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
        delta={drift?.column_count_delta}
        current={drift?.current.column_count}
        expected={drift?.expected.column_count}
        isLoading={isLoading}
        hasData={!!drift}
      />
      <DeltaTile
        label={t('admin.schemaDrift.indexDelta', 'Indexes Δ')}
        icon={<KeyRound className="h-4 w-4 text-amber-300" aria-hidden="true" />}
        delta={drift?.index_count_delta}
        current={drift?.current.index_count}
        expected={drift?.expected.index_count}
        isLoading={isLoading}
        hasData={!!drift}
      />
    </section>
  );
}

function StatusTile({
  isDrifted, isLoading, hasData,
}: { isDrifted: boolean; isLoading: boolean; hasData: boolean }) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="flex flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <Label>{t('admin.schemaDrift.statusLabel', 'Status')}</Label>
        {hasData && !isLoading && (
          isDrifted
            ? <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
            : <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
        )}
      </div>
      {isLoading ? (
        <Skeleton height={26} width="70%" />
      ) : !hasData ? (
        <MetricValue className="text-[var(--text-muted)]">—</MetricValue>
      ) : (
        <SeverityBadge severity={isDrifted ? 'warn' : 'success'} size="md" className="self-start">
          {isDrifted
            ? t('admin.schemaDrift.statusDrifted', 'Drift detected')
            : t('admin.schemaDrift.statusClean', 'No drift')}
        </SeverityBadge>
      )}
      <Caption className="mt-2 block">
        {t('admin.schemaDrift.statusHint', 'Current schema vs recorded seed')}
      </Caption>
    </GlassPanel>
  );
}

interface DeltaTileProps {
  label: string;
  icon: React.ReactNode;
  delta: number | null | undefined;
  current: number | null | undefined;
  expected: number | null | undefined;
  isLoading: boolean;
  hasData: boolean;
}

function DeltaTile({ label, icon, delta, current, expected, isLoading, hasData }: DeltaTileProps) {
  const { t } = useTranslation();
  const matched = (delta ?? 0) === 0;
  return (
    <GlassPanel className="flex flex-col p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Label>{label}</Label>
        {icon}
      </div>
      {isLoading ? (
        <Skeleton height={26} width="60%" className="mt-1" />
      ) : !hasData ? (
        <MetricValue className="text-[var(--text-muted)]">—</MetricValue>
      ) : (
        <>
          <MetricValue>{formatDelta(delta)}</MetricValue>
          <Caption className="mt-1 block truncate">
            {t('admin.schemaDrift.deltaSub', '{{current}} current · {{expected}} expected', {
              current: fmtInt(current ?? 0),
              expected: fmtInt(expected ?? 0),
            })}
          </Caption>
          <SeverityBadge severity={tone(delta)} size="sm" className="mt-2 self-start">
            {matched
              ? t('admin.schemaDrift.match', 'Match')
              : t('admin.schemaDrift.drift', 'Drift')}
          </SeverityBadge>
        </>
      )}
    </GlassPanel>
  );
}

/* ─── 2a. Fingerprint comparison ──────────────────────────── */

function FingerprintPanel({ state }: { state: SectionState }) {
  const { t } = useTranslation();
  const { drift, isLoading, error, onRetry } = state;
  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <SectionTitle className="mb-1 flex items-center gap-2">
        <Fingerprint className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.schemaDrift.fingerprintTitle', 'Schema fingerprints')}
      </SectionTitle>
      <Caption className="mb-4 block">
        {t('admin.schemaDrift.fingerprintSub', 'SHA-256 of the live schema versus the captured seed')}
      </Caption>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton height={150} />
          <Skeleton height={150} />
        </div>
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !drift ? (
        <EmptyState
          /* no-action: the seed fingerprint is captured by an API restart, an ops action not exposed in the UI */
          icon={<Fingerprint className="h-8 w-8" />}
          title={t('admin.schemaDrift.emptyTitle', 'No fingerprint available')}
          message={t(
            'admin.schemaDrift.emptyMessage',
            'The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.',
          )}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FingerprintCard
            title={t('admin.schemaDrift.fingerprintCurrent', 'Current')}
            fp={drift.current}
          />
          <FingerprintCard
            title={t('admin.schemaDrift.fingerprintExpected', 'Expected (seed)')}
            fp={drift.expected}
            generatedAt={drift.expected_generated_at ?? null}
          />
        </div>
      )}
    </GlassPanel>
  );
}

interface FingerprintCardProps {
  title: string;
  fp: SchemaFingerprint;
  generatedAt?: string | null;
}

function FingerprintCard({ title, fp, generatedAt }: FingerprintCardProps) {
  const { t } = useTranslation();
  const sha = fp?.sha256 ?? '';
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <PanelTitle>{title}</PanelTitle>
        <CopyButton
          text={sha}
          iconOnly
          disabled={!sha}
          ariaLabel={t('admin.schemaDrift.copyHash', 'Copy fingerprint hash')}
        />
      </div>
      <Code className="mb-3 block break-all">{sha || '—'}</Code>
      <div className="grid grid-cols-3 gap-2">
        <FingerprintStat label={t('admin.schemaDrift.tables', 'Tables')} value={fp?.table_count} />
        <FingerprintStat label={t('admin.schemaDrift.columns', 'Columns')} value={fp?.column_count} />
        <FingerprintStat label={t('admin.schemaDrift.indexes', 'Indexes')} value={fp?.index_count} />
      </div>
      {generatedAt && (
        <Caption className="mt-3 block">
          {t('admin.schemaDrift.generatedAt', 'Captured {{when}}', {
            when: formatDateTime(generatedAt),
          })}
        </Caption>
      )}
    </div>
  );
}

function FingerprintStat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <div className="rounded-md bg-[var(--surface-2)] px-2 py-2 text-center">
      <Text as="div" size="lg" weight="bold" color="primary" className="tabular-nums">
        {value != null ? fmtInt(value) : '—'}
      </Text>
      <Caption className="mt-0.5 block">{label}</Caption>
    </div>
  );
}

/* ─── 2b. Per-object drift breakdown ──────────────────────── */

function BreakdownPanel({ state }: { state: SectionState }) {
  const { t } = useTranslation();
  const { drift, isLoading, error, onRetry } = state;
  return (
    <GlassPanel className="h-full p-4 sm:p-5">
      <SectionTitle className="mb-1 flex items-center gap-2">
        <GitCompare className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.schemaDrift.breakdownTitle', 'Drift breakdown')}
      </SectionTitle>
      <Caption className="mb-4 block">
        {t('admin.schemaDrift.breakdownSub', 'Per-object comparison of current vs seed')}
      </Caption>
      {isLoading ? (
        <Skeleton height={150} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : !drift ? (
        <EmptyState
          /* no-action: no fingerprint recorded yet; captured on API restart */
          icon={<GitCompare className="h-8 w-8" />}
          message={t('admin.schemaDrift.breakdownEmpty', 'No comparison available yet.')}
        />
      ) : (
        <>
          <ul className="space-y-3">
            <CategoryRow
              label={t('admin.schemaDrift.tables', 'Tables')}
              current={drift.current.table_count}
              expected={drift.expected.table_count}
              delta={drift.table_count_delta}
            />
            <CategoryRow
              label={t('admin.schemaDrift.columns', 'Columns')}
              current={drift.current.column_count}
              expected={drift.expected.column_count}
              delta={drift.column_count_delta}
            />
            <CategoryRow
              label={t('admin.schemaDrift.indexes', 'Indexes')}
              current={drift.current.index_count}
              expected={drift.expected.index_count}
              delta={drift.index_count_delta}
            />
          </ul>
          {drift.expected_generated_at && (
            <Caption className="mt-4 flex items-center gap-1.5 border-t border-[var(--border-subtle)] pt-3">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {t('admin.schemaDrift.seedCaptured', 'Seed captured {{when}}', {
                when: formatRelativeTime(drift.expected_generated_at),
              })}
            </Caption>
          )}
        </>
      )}
    </GlassPanel>
  );
}

interface CategoryRowProps {
  label: string;
  current: number | null | undefined;
  expected: number | null | undefined;
  delta: number | null | undefined;
}

function CategoryRow({ label, current, expected, delta }: CategoryRowProps) {
  const { t } = useTranslation();
  const matched = (delta ?? 0) === 0;
  return (
    <li className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Text as="div" variant="body" className="truncate">{label}</Text>
        <Caption className="tabular-nums">
          {t('admin.schemaDrift.currentExpected', '{{current}} → {{expected}}', {
            current: fmtInt(current ?? 0),
            expected: fmtInt(expected ?? 0),
          })}
        </Caption>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Text as="span" size="sm" weight="semibold" color="primary" className="tabular-nums">
          {formatDelta(delta)}
        </Text>
        <SeverityBadge severity={tone(delta)} size="sm">
          {matched
            ? t('admin.schemaDrift.match', 'Match')
            : t('admin.schemaDrift.drift', 'Drift')}
        </SeverityBadge>
      </div>
    </li>
  );
}

/* ─── 3. Interpretation band ──────────────────────────────── */

function GuidancePanel({ state, isDrifted }: { state: SectionState; isDrifted: boolean }) {
  const { t } = useTranslation();
  const { drift, isLoading, error } = state;
  return (
    <GlassPanel className="p-4 sm:p-5">
      <SectionTitle className="mb-3 flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('admin.schemaDrift.guidanceTitle', 'What this means')}
      </SectionTitle>
      {isLoading ? (
        <Skeleton height={72} />
      ) : error ? (
        <QueryError error={error} onRetry={state.onRetry} />
      ) : !drift ? (
        <EmptyState
          /* no-action: guidance requires a computed fingerprint (captured on API restart) */
          icon={<Fingerprint className="h-8 w-8" />}
          message={t(
            'admin.schemaDrift.guidanceEmpty',
            'Restart the API to capture a seed fingerprint, then drift interpretation appears here.',
          )}
        />
      ) : isDrifted ? (
        <DriftedGuidance drift={drift} />
      ) : (
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
          <div className="min-w-0 max-w-3xl">
            <Text as="p" variant="body">
              {t(
                'admin.schemaDrift.cleanBody',
                'The live schema matches the recorded seed fingerprint. Migrations and the seed are in sync — no action required.',
              )}
            </Text>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

function DriftedGuidance({ drift }: { drift: SchemaDrift }) {
  const { t } = useTranslation();
  const changes: string[] = [];
  if ((drift.table_count_delta ?? 0) !== 0) {
    changes.push(t('admin.schemaDrift.changeTables', 'Tables {{delta}}', { delta: formatDelta(drift.table_count_delta) }));
  }
  if ((drift.column_count_delta ?? 0) !== 0) {
    changes.push(t('admin.schemaDrift.changeColumns', 'Columns {{delta}}', { delta: formatDelta(drift.column_count_delta) }));
  }
  if ((drift.index_count_delta ?? 0) !== 0) {
    changes.push(t('admin.schemaDrift.changeIndexes', 'Indexes {{delta}}', { delta: formatDelta(drift.index_count_delta) }));
  }
  return (
    <div className="flex items-start gap-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
      <div className="min-w-0 max-w-3xl space-y-3">
        <Text as="p" variant="body">
          {changes.length > 0
            ? t('admin.schemaDrift.driftedBodyCounts', 'The live schema differs from the seed: {{changes}}.', {
                changes: changes.join(' · '),
              })
            : t('admin.schemaDrift.driftedBodyHash', 'The live schema fingerprint differs from the seed even though object counts match — inspect column definitions or index expressions.')}
        </Text>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <Text as="span" variant="bodySm">
              {t('admin.schemaDrift.remediateSeed', 'Confirm migrations are applied, then restart the API to regenerate the seed fingerprint.')}
            </Text>
          </li>
          <li>
            <Text as="span" variant="bodySm">
              {t('admin.schemaDrift.remediateDdl', 'If migrations are already current, investigate raw DDL that bypassed the migration system.')}
            </Text>
          </li>
        </ul>
      </div>
    </div>
  );
}
