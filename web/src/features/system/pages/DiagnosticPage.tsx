// DiagnosticPage
//
// Operator-facing self-test cockpit. A single button posts to
// `POST /system/diagnostic` and renders the structured report as a
// full-width bento: a hero result band (overall status + pass/warn/fail
// distribution), a KPI summary strip, and a responsive grid of per-check
// cards. The report can be copied to the clipboard or downloaded as a
// .txt file for support escalation.
//
// We intentionally do NOT auto-run on mount. The endpoint fans out
// concurrent probes against every shared dependency and is rate-limited
// (20/min/IP) on the backend; surprise auto-runs would burn budget for
// users who navigated here by mistake.

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Gauge,
  ListChecks,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Timer,
  XCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  Badge,
  Button,
  CopyButton,
  GlassPanel,
  Heading,
  Text,
  Caption,
  MetricLabel,
  SectionTitle,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { AlertBanner, EmptyState, Spinner } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { useOptionalToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import {
  formatDiagnosticReportText,
  useRunDiagnostic,
} from '@/api/hooks/useSystemDiagnostic';
import type {
  DiagnosticCheck,
  DiagnosticCheckStatus,
  DiagnosticOverallStatus,
  DiagnosticReport,
} from '@/api/types';
import { cn } from '@/lib/cn';

// ── helpers ─────────────────────────────────────────────────────────

type StatusTone = 'success' | 'warning' | 'danger';

/** Aggregate derived from the report's checks — computed once in the
 *  page and shared by the hero band + KPI strip (DRY, null-safe). */
interface DiagnosticSummary {
  total: number;
  ok: number;
  warn: number;
  fail: number;
  totalMs: number;
  slowest: DiagnosticCheck | null;
}

function checkTone(status: DiagnosticCheckStatus): StatusTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warn':
      return 'warning';
    case 'fail':
    default:
      return 'danger';
  }
}

function overallTone(status: DiagnosticOverallStatus): {
  tone: StatusTone;
  Icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'ok':
      return { tone: 'success', Icon: CheckCircle2 };
    case 'degraded':
      return { tone: 'warning', Icon: AlertTriangle };
    case 'down':
    default:
      return { tone: 'danger', Icon: ShieldAlert };
  }
}

/** Rounded chip background+text for a status tone. */
function toneChip(tone: StatusTone): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500/10 text-emerald-300';
    case 'warning':
      return 'bg-amber-500/10 text-amber-300';
    case 'danger':
    default:
      return 'bg-rose-500/10 text-rose-300';
  }
}

/** Solid segment fill for the distribution bar + legend dots. */
function toneFill(tone: StatusTone): string {
  switch (tone) {
    case 'success':
      return 'bg-emerald-500';
    case 'warning':
      return 'bg-amber-500';
    case 'danger':
    default:
      return 'bg-rose-500';
  }
}

function statusIcon(status: DiagnosticCheckStatus) {
  switch (status) {
    case 'ok':
      return <CheckCircle2 className="h-5 w-5" aria-hidden />;
    case 'warn':
      return <AlertTriangle className="h-5 w-5" aria-hidden />;
    case 'fail':
    default:
      return <XCircle className="h-5 w-5" aria-hidden />;
  }
}

/** Compact human duration for probe timings (sub-second in ms, else s). */
function formatMs(ms: number): string {
  const v = Number.isFinite(ms) ? ms : 0;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}s`;
  return `${Math.round(v)}ms`;
}

function downloadFilename(reportTs: string, template: string): string {
  // Replace `{{ts}}` with a filesystem-safe slug. Use the report's
  // generated_at when present so re-running and saving twice never
  // collides. Falls back to "now" if the report had a bad timestamp.
  const d = new Date(reportTs);
  const stamp = (Number.isNaN(d.getTime()) ? new Date() : d)
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
  return template.replace('{{ts}}', stamp);
}

function summarize(report: DiagnosticReport | undefined): DiagnosticSummary {
  const checks = report?.checks ?? [];
  const slowest = checks.reduce<DiagnosticCheck | null>(
    (m, c) => (!m || (c.duration_ms ?? 0) > (m.duration_ms ?? 0) ? c : m),
    null,
  );
  return {
    total: checks.length,
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
    totalMs: checks.reduce((s, c) => s + (c.duration_ms ?? 0), 0),
    slowest,
  };
}

// ── components ──────────────────────────────────────────────────────

function CheckCard({ check }: { check: DiagnosticCheck }) {
  const { t } = useTranslation();
  const tone = checkTone(check.status);
  return (
    <GlassPanel
      className="h-full p-4 sm:p-5"
      data-testid={`diagnostic-check-${check.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              toneChip(tone),
            )}
          >
            {statusIcon(check.status)}
          </span>
          <div className="min-w-0">
            <Heading level="panel" className="mb-1 break-words">
              {check.name}
            </Heading>
            <Caption className="block break-words">{check.id}</Caption>
            <Text variant="bodySm" as="p" className="mt-2 break-words">
              {check.detail}
            </Text>
            {check.remediation ? (
              <div className="mt-3 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <MetricLabel className="mb-1 block">
                  {t('diagnostic.remediationLabel', 'Remediation')}
                </MetricLabel>
                <Text variant="bodySm" as="p" className="break-words">
                  {check.remediation}
                </Text>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge variant={tone}>
            {t(`diagnostic.status.${check.status}`, check.status.toUpperCase())}
          </Badge>
          <Caption className="tabular-nums">
            {t('diagnostic.duration', { ms: check.duration_ms })}
          </Caption>
        </div>
      </div>
    </GlassPanel>
  );
}

function OverallHero({
  report,
  summary,
  actions,
}: {
  report: DiagnosticReport;
  summary: DiagnosticSummary;
  actions: ReactNode;
}) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { tone, Icon } = overallTone(report.overall_status);

  const segments: { key: StatusTone; count: number; label: string }[] = [
    { key: 'success', count: summary.ok, label: t('diagnostic.summary.passing', 'Passing') },
    { key: 'warning', count: summary.warn, label: t('diagnostic.summary.warnings', 'Warnings') },
    { key: 'danger', count: summary.fail, label: t('diagnostic.summary.failures', 'Failures') },
  ];
  const barAria = `${summary.ok} ${t('diagnostic.summary.passing', 'Passing')}, ${summary.warn} ${t('diagnostic.summary.warnings', 'Warnings')}, ${summary.fail} ${t('diagnostic.summary.failures', 'Failures')}`;

  return (
    <section aria-label={t('diagnostic.overallSection', 'Overall result')}>
      <GlassPanel className="p-4 sm:p-5" data-testid="diagnostic-overall">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <span
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-full',
                toneChip(tone),
              )}
            >
              <Icon className="h-7 w-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <Heading level="section">
                {t(`diagnostic.overall.${report.overall_status}`, report.overall_status)}
              </Heading>
              <Caption className="block">
                {t('diagnostic.lastRun', { when: formatDateTime(report.generated_at) })}
              </Caption>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={tone} size="lg">
              {t('diagnostic.checkCount', { count: summary.total })}
            </Badge>
            {actions}
          </div>
        </div>

        <div className="mt-4">
          <div
            className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.04]"
            role="img"
            aria-label={barAria}
          >
            {segments.map((s) => {
              const pct = summary.total > 0 ? (s.count / summary.total) * 100 : 0;
              if (pct <= 0) return null;
              return (
                <div
                  key={s.key}
                  className={cn('h-full', toneFill(s.key))}
                  style={{ width: `${pct}%` }}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className={cn('inline-block h-2.5 w-2.5 rounded-full', toneFill(s.key))} />
                <Text variant="bodySm" as="span">
                  {s.label}
                </Text>
                <Text
                  as="span"
                  size="xs"
                  weight="semibold"
                  color="primary"
                  className="tabular-nums"
                >
                  {s.count}
                </Text>
              </div>
            ))}
          </div>
        </div>
      </GlassPanel>
    </section>
  );
}

function StatusSummary({ summary }: { summary: DiagnosticSummary }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('diagnostic.summary.title', 'Diagnostic summary')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6"
    >
      <MetricCard
        label={t('diagnostic.summary.total', 'Total checks')}
        value={summary.total}
        icon={<ListChecks className="h-5 w-5" aria-hidden />}
        color="cyan"
      />
      <MetricCard
        label={t('diagnostic.summary.passing', 'Passing')}
        value={summary.ok}
        icon={<ShieldCheck className="h-5 w-5" aria-hidden />}
        color="green"
      />
      <MetricCard
        label={t('diagnostic.summary.warnings', 'Warnings')}
        value={summary.warn}
        icon={<AlertTriangle className="h-5 w-5" aria-hidden />}
        color="amber"
      />
      <MetricCard
        label={t('diagnostic.summary.failures', 'Failures')}
        value={summary.fail}
        icon={<XCircle className="h-5 w-5" aria-hidden />}
        color="red"
      />
      <MetricCard
        label={t('diagnostic.summary.totalTime', 'Total time')}
        value={formatMs(summary.totalMs)}
        icon={<Timer className="h-5 w-5" aria-hidden />}
        color="blue"
      />
      <MetricCard
        label={t('diagnostic.summary.slowest', 'Slowest check')}
        value={summary.slowest ? formatMs(summary.slowest.duration_ms ?? 0) : '—'}
        subtitle={summary.slowest?.name}
        icon={<Gauge className="h-5 w-5" aria-hidden />}
        color="purple"
      />
    </section>
  );
}

// ── page ────────────────────────────────────────────────────────────

export default function DiagnosticPage() {
  const { t } = useTranslation();
  usePageTitle(t('diagnostic.title', 'System diagnostic'));
  const toast = useOptionalToast();
  const runDiagnostic = useRunDiagnostic();
  const [latestError, setLatestError] = useState<Error | null>(null);

  const report = runDiagnostic.data;
  const isRunning = runDiagnostic.isPending;

  const summary = useMemo(() => summarize(report), [report]);

  const handleRun = useCallback(() => {
    setLatestError(null);
    runDiagnostic.mutate(undefined, {
      onError: (e) => {
        setLatestError(e instanceof Error ? e : new Error(String(e)));
      },
    });
  }, [runDiagnostic]);

  const reportText = useMemo(
    () => (report ? formatDiagnosticReportText(report) : ''),
    [report],
  );

  const reportJson = useMemo(
    () => (report ? JSON.stringify(report, null, 2) : ''),
    [report],
  );

  const handleDownload = useCallback(() => {
    if (!report) return;
    const filename = downloadFilename(
      report.generated_at,
      t('diagnostic.filename', { ts: '{{ts}}' }),
    );
    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast?.success(
      t('diagnostic.downloadSuccess', 'Diagnostic report downloaded'),
    );
  }, [report, reportText, t, toast]);

  const runButton = (
    <Button
      variant="primary"
      onClick={handleRun}
      loading={isRunning}
      disabled={isRunning}
      icon={
        report ? (
          <RefreshCw className="h-4 w-4" aria-hidden />
        ) : (
          <PlayCircle className="h-4 w-4" aria-hidden />
        )
      }
      data-testid="diagnostic-run-button"
    >
      {isRunning
        ? t('diagnostic.running', 'Running diagnostic…')
        : report
        ? t('diagnostic.rerun', 'Re-run diagnostic')
        : t('diagnostic.run', 'Run diagnostic')}
    </Button>
  );

  const reportActions = report ? (
    <div
      className="flex flex-wrap items-center gap-2"
      data-testid="diagnostic-actions"
    >
      <CopyButton
        text={reportJson}
        label={t('diagnostic.copyReport', 'Copy report')}
        withToast
        variant="secondary"
        size="md"
      />
      <Button
        variant="secondary"
        onClick={handleDownload}
        icon={<Download className="h-4 w-4" aria-hidden />}
        data-testid="diagnostic-download-button"
      >
        {t('diagnostic.downloadReport', 'Download .txt')}
      </Button>
    </div>
  ) : null;

  return (
    <PageContainer
      title={t('diagnostic.title', 'System diagnostic')}
      subtitle={t(
        'diagnostic.subtitle',
        'Run an aggregated self-test against the database, MQTT broker, Redis, Tesla API, and resilience monitors.',
      )}
      actions={runButton}
    >
      <div className="space-y-4 sm:space-y-6">
        {latestError ? (
          <FadeIn>
            <AlertBanner
              variant="danger"
              icon={<ShieldAlert className="h-5 w-5" aria-hidden />}
              title={t('diagnostic.errorTitle', 'Diagnostic failed to run')}
              data-testid="diagnostic-error"
            >
              {latestError.message ||
                t(
                  'diagnostic.errorBody',
                  'The diagnostic endpoint returned an error. Check API logs and try again.',
                )}
            </AlertBanner>
          </FadeIn>
        ) : null}

        {report ? (
          <>
            <FadeIn>
              <OverallHero
                report={report}
                summary={summary}
                actions={reportActions}
              />
            </FadeIn>

            <FadeIn delay={0.05}>
              <StatusSummary summary={summary} />
            </FadeIn>

            <FadeIn delay={0.1}>
              <section aria-label={t('diagnostic.checksTitle', 'Dependency checks')}>
                <SectionTitle className="mb-3">
                  {t('diagnostic.checksTitle', 'Dependency checks')}
                </SectionTitle>
                <StaggerContainer className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {(report.checks ?? []).map((c) => (
                    <StaggerItem key={c.id}>
                      <CheckCard check={c} />
                    </StaggerItem>
                  ))}
                </StaggerContainer>
              </section>
            </FadeIn>
          </>
        ) : isRunning ? (
          <FadeIn>
            <GlassPanel className="flex items-center justify-center p-12">
              <Spinner
                size="lg"
                label={t('diagnostic.running', 'Running diagnostic…')}
              />
            </GlassPanel>
          </FadeIn>
        ) : (
          <FadeIn>
            <GlassPanel className="p-2">
              <EmptyState
                icon={<Activity className="h-10 w-10" aria-hidden />}
                title={t('diagnostic.title', 'System diagnostic')}
                message={t(
                  'diagnostic.noReport',
                  'No diagnostic has been run in this session yet. Click "Run diagnostic" to probe every dependency.',
                )}
                action={{
                  label: t('diagnostic.run', 'Run diagnostic'),
                  onClick: handleRun,
                }}
              />
            </GlassPanel>
          </FadeIn>
        )}
      </div>
    </PageContainer>
  );
}
