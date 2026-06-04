// DiagnosticPage
//
// Operator-facing self-test wizard. A single button posts to
// `POST /system/diagnostic` and renders the structured report as a
// list of cards (one per check) plus an overall hero badge. The
// report can be copied to the clipboard or downloaded as a .txt
// file for support escalation.
//
// We intentionally do NOT auto-run on mount. The endpoint fans out
// concurrent probes against every shared dependency and is rate-
// limited (20/min/IP) on the backend; surprise auto-runs would burn
// budget for users who navigated here by mistake.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Stack } from '@/components/layout';
import { Badge, Button, CopyButton, GlassPanel } from '@/components/ui';
import { Heading, Text, Caption, MetricLabel } from '@/components/ui/Typography';
import { EmptyState, Spinner } from '@/components/feedback';
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

function statusBadgeVariant(
  status: DiagnosticCheckStatus,
): 'success' | 'warning' | 'danger' {
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
  variant: 'success' | 'warning' | 'danger';
  Icon: typeof CheckCircle2;
} {
  switch (status) {
    case 'ok':
      return { variant: 'success', Icon: CheckCircle2 };
    case 'degraded':
      return { variant: 'warning', Icon: AlertTriangle };
    case 'down':
    default:
      return { variant: 'danger', Icon: ShieldAlert };
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

// ── components ──────────────────────────────────────────────────────

function CheckCard({ check }: { check: DiagnosticCheck }) {
  const { t } = useTranslation();
  const variant = statusBadgeVariant(check.status);
  return (
    <GlassPanel className="p-4" data-testid={`diagnostic-check-${check.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              variant === 'success' &&
                'bg-emerald-500/10 text-emerald-300',
              variant === 'warning' && 'bg-amber-500/10 text-amber-300',
              variant === 'danger' && 'bg-rose-500/10 text-rose-300',
            )}
          >
            {statusIcon(check.status)}
          </span>
          <div className="min-w-0">
            <Heading level="panel" className="mb-1">
              {check.name}
            </Heading>
            <Caption className="block">{check.id}</Caption>
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
          <Badge variant={variant}>
            {t(`diagnostic.status.${check.status}`, check.status.toUpperCase())}
          </Badge>
          <Caption>{t('diagnostic.duration', { ms: check.duration_ms })}</Caption>
        </div>
      </div>
    </GlassPanel>
  );
}

function OverallHero({ report }: { report: DiagnosticReport }) {
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { variant, Icon } = overallTone(report.overall_status);
  return (
    <GlassPanel className="p-5" data-testid="diagnostic-overall">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-full',
              variant === 'success' &&
                'bg-emerald-500/10 text-emerald-300',
              variant === 'warning' && 'bg-amber-500/10 text-amber-300',
              variant === 'danger' && 'bg-rose-500/10 text-rose-300',
            )}
          >
            <Icon className="h-7 w-7" aria-hidden />
          </span>
          <div>
            <Heading level="page">
              {t(
                `diagnostic.overall.${report.overall_status}`,
                report.overall_status,
              )}
            </Heading>
            <Caption className="block">
              {t('diagnostic.lastRun', {
                when: formatDateTime(report.generated_at),
              })}
            </Caption>
          </div>
        </div>
        <Badge variant={variant} size="lg">
          {t('diagnostic.checkCount', { count: report.checks.length })}
        </Badge>
      </div>
    </GlassPanel>
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
      t(
        'diagnostic.copyReportSuccess',
        'Diagnostic report copied to clipboard',
      ),
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

  return (
    <PageContainer
      title={t('diagnostic.title', 'System diagnostic')}
      subtitle={t(
        'diagnostic.subtitle',
        'Run an aggregated self-test against the database, MQTT broker, Redis, Tesla API, and resilience monitors.',
      )}
      actions={runButton}
    >
      <FadeIn>
        <Stack className="gap-6">
          {latestError ? (
            <GlassPanel
              className="border border-rose-500/30 p-4"
              data-testid="diagnostic-error"
            >
              <div className="flex items-start gap-3">
                <ShieldAlert
                  className="h-5 w-5 shrink-0 text-rose-300"
                  aria-hidden
                />
                <div>
                  <Heading level="panel" className="mb-1">
                    {t('diagnostic.errorTitle', 'Diagnostic failed to run')}
                  </Heading>
                  <Text variant="bodySm" as="p">
                    {latestError.message ||
                      t(
                        'diagnostic.errorBody',
                        'The diagnostic endpoint returned an error. Check API logs and try again.',
                      )}
                  </Text>
                </div>
              </div>
            </GlassPanel>
          ) : null}

          {report ? <OverallHero report={report} /> : null}

          {report ? (
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
          ) : null}

          {report ? (
            <StaggerContainer className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {report.checks.map((c) => (
                <StaggerItem key={c.id}>
                  <CheckCard check={c} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : isRunning ? (
            <GlassPanel className="flex items-center justify-center p-12">
              <Spinner
                size="lg"
                label={t('diagnostic.running', 'Running diagnostic…')}
              />
            </GlassPanel>
          ) : (
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
          )}
        </Stack>
      </FadeIn>
    </PageContainer>
  );
}
