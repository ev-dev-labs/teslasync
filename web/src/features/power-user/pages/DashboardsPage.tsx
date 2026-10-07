// Manual dashboard layout JSON composer at /power/dashboards.
//
// The page provides a JSON textarea, curated panel catalog, and copy-to-
// clipboard flow. The optional AI drafter is wrapped with withAiFeature so
// AI-off mode still renders the manual baseline and AI-on mode remains
// propose-only: users must explicitly apply a draft to the editor and then
// copy it.
//
// This page never pushes to Grafana directly. Users paste the copied JSON
// into Grafana manually; a future server-side Grafana integration can replace
// that branch without changing the drafter contract.
//
// Layout (modern-ui full-width bento):
//   1. How-it-works band — intro + three workflow steps.
//   2. AI drafter — AINLDashboardComposer (renders null in AI-off mode).
//   3. Compose bento — the JSON editor (hero) beside the curated catalog,
//      reflowing to more columns on wide monitors.
//
// State persistence: the JSON textarea is stored in localStorage under
// 'ai.dashboardComposer.draft'.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Braces,
  Check,
  ClipboardCopy,
  Eraser,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Table,
} from 'lucide-react';

import {
  AINLDashboardComposer,
  type DashboardLayoutDraft,
} from '@/components/ai/AINLDashboardComposer';
import { PageContainer } from '@/components/layout';
import { Button, GlassPanel, Heading, HelperText, Text, Textarea } from '@/components/ui';
import { InlineCallout, type CalloutVariant } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';

// Persisted across navigation so a user editing a long JSON envelope
// doesn't lose progress on accidental reload.
const DASHBOARD_COMPOSER_DRAFT_KEY = 'ai.dashboardComposer.draft';

// CuratedDashboardPanel mirrors the Go-side AINLDashboardComposerPanelEntry
// shape in internal/api/ai_nl_dashboard_composer_handler.go. The catalog is
// install-wide static, so fetching it would add a round-trip without any
// useful dynamism.
interface CuratedDashboardPanel {
  name: string;
  description: string;
}

const CURATED_DASHBOARD_PANELS: CuratedDashboardPanel[] = [
  {
    name: 'drives_per_day_timeseries',
    description: 'Timeseries panel: SUM(distance_m)/day from the drives table',
  },
  {
    name: 'battery_soc_stat',
    description: 'Stat panel: latest BatteryLevel sample from signal_log_view',
  },
  {
    name: 'charging_sessions_table',
    description: 'Table panel: recent rows from the charging_sessions table',
  },
  {
    name: 'alerts_count_stat',
    description: 'Stat panel: count of alerts fired in the last 7 days',
  },
  {
    name: 'vehicles_table',
    description: 'Table panel: vehicles metadata overview (id, model, color)',
  },
  {
    name: 'energy_used_per_day_barchart',
    description: 'Barchart panel: SUM(energy_used_wh)/day from the drives table',
  },
];

// Pick a glyph from the curated panel's name suffix so each catalog entry
// carries a color-independent visual cue for its Grafana panel kind.
function panelKindIcon(name: string): ReactNode {
  if (name.endsWith('_timeseries')) return <Activity className="h-4 w-4" aria-hidden="true" />;
  if (name.endsWith('_barchart')) return <BarChart3 className="h-4 w-4" aria-hidden="true" />;
  if (name.endsWith('_table')) return <Table className="h-4 w-4" aria-hidden="true" />;
  if (name.endsWith('_stat')) return <Gauge className="h-4 w-4" aria-hidden="true" />;
  return <LayoutDashboard className="h-4 w-4" aria-hidden="true" />;
}

function loadPersistedJson(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(DASHBOARD_COMPOSER_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistJson(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(DASHBOARD_COMPOSER_DRAFT_KEY, value);
    } else {
      window.localStorage.removeItem(DASHBOARD_COMPOSER_DRAFT_KEY);
    }
  } catch {
    /* ignore — quota exceeded etc. */
  }
}

interface ComposerStatus {
  text: string;
  variant: CalloutVariant;
}

export default function DashboardsPage() {
  const { t } = useTranslation();
  usePageTitle(t('powerDashboards.title', 'Dashboard Composer'));

  const [dashboardJson, setDashboardJson] = useState<string>(() => loadPersistedJson());
  const [status, setStatus] = useState<ComposerStatus | null>(null);

  // Persist the JSON textarea contents so a long edit survives
  // a navigation away + back. Synchronous setItem in the
  // effect is fine — modern browsers handle 4KB writes in
  // <1ms.
  useEffect(() => {
    persistJson(dashboardJson);
  }, [dashboardJson]);

  const handleApplyAiDraft = useCallback((draft: DashboardLayoutDraft) => {
    // Render the full dashboard envelope as pretty-printed
    // JSON so the user pastes a Grafana-ready document rather
    // than a wire-format blob. The user can still edit it
    // before clicking Copy to clipboard.
    setDashboardJson(JSON.stringify(draft.dashboard, null, 2));
    setStatus(null);
  }, []);

  const handleClear = useCallback(() => {
    setDashboardJson('');
    setStatus(null);
  }, []);

  const handleCopy = useCallback(async () => {
    const trimmed = dashboardJson.trim();
    if (!trimmed) {
      setStatus({
        variant: 'warning',
        text: t(
          'powerDashboards.editor.copyEmpty',
          'Type or paste a dashboard JSON envelope above before copying.',
        ),
      });
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setStatus({
        variant: 'warning',
        text: t(
          'powerDashboards.editor.copyUnavailable',
          'Clipboard access is not available in this browser. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(trimmed);
      setStatus({
        variant: 'success',
        text: t(
          'powerDashboards.editor.copySuccess',
          'Copied. Paste the JSON into your Grafana dashboard editor (Dashboard settings → JSON Model).',
        ),
      });
    } catch {
      setStatus({
        variant: 'warning',
        text: t(
          'powerDashboards.editor.copyFailed',
          'Clipboard write failed. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      });
    }
  }, [dashboardJson, t]);

  const sortedPanels = useMemo(
    () => [...CURATED_DASHBOARD_PANELS].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const workflowSteps = useMemo(
    () => [
      {
        id: 'pick',
        icon: <ListChecks className="h-5 w-5" aria-hidden="true" />,
        title: t('powerDashboards.howTo.step1.title', 'Pick panels'),
        body: t(
          'powerDashboards.howTo.step1.body',
          'Choose from the curated catalog — each panel maps to a real query against your fleet data.',
        ),
      },
      {
        id: 'compose',
        icon: <Braces className="h-5 w-5" aria-hidden="true" />,
        title: t('powerDashboards.howTo.step2.title', 'Compose JSON'),
        body: t(
          'powerDashboards.howTo.step2.body',
          'Place panels on the 24-column grid in the editor, or let Helix draft the envelope for you.',
        ),
      },
      {
        id: 'copy',
        icon: <ClipboardCopy className="h-5 w-5" aria-hidden="true" />,
        title: t('powerDashboards.howTo.step3.title', 'Copy to Grafana'),
        body: t(
          'powerDashboards.howTo.step3.body',
          'Copy the envelope and paste it into Grafana under Dashboard settings → JSON Model.',
        ),
      },
    ],
    [t],
  );

  const canCopy = dashboardJson.trim().length > 0;
  // Clear resets the editor whenever there is *any* content — including
  // whitespace-only text that `canCopy` (which trims) treats as empty.
  // Reusing canCopy here would strand a user who wants to wipe stray
  // whitespace or newlines with a single click.
  const canClear = dashboardJson.length > 0;

  return (
    <div data-testid="power-dashboards-composer-root">
      <PageContainer
        title={t('powerDashboards.title', 'Dashboard Composer')}
        subtitle={t(
          'powerDashboards.subtitle',
          'Assemble a Grafana dashboard JSON envelope from curated panels, then copy it into Grafana.',
        )}
      >
        {/* 1 — How-it-works band: intro + workflow steps, full-width. */}
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5">
            <Heading level="panel" as="h2" className="mb-2">
              {t('powerDashboards.howTo.title', 'How it works')}
            </Heading>
            <Text as="p" size="sm" color="secondary" className="max-w-3xl">
              {t(
                'powerDashboards.intro',
                'Compose a Grafana dashboard JSON envelope by picking panels from the curated catalog below and placing them on the 24-column grid. The browser does not push the dashboard to Grafana; copy your JSON into your existing Grafana dashboard editor.',
              )}
            </Text>
            <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
              {workflowSteps.map((step, index) => (
                <li
                  key={step.id}
                  className="flex items-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3"
                >
                  <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300 ring-1 ring-cyan-400/20">
                    {step.icon}
                  </span>
                  <div className="min-w-0">
                    <Text as="div" size="sm" weight="semibold" color="primary">
                      <Text as="span" color="muted">{index + 1}. </Text>
                      {step.title}
                    </Text>
                    <HelperText className="mt-0.5">
                      {step.body}
                    </HelperText>
                  </div>
                </li>
              ))}
            </ol>
          </GlassPanel>
        </FadeIn>

        {/* 2 — AI drafter: propose-only Helix composer. Renders null in
            AI-off mode (withAiFeature), so it never leaves a dead grid cell. */}
        <AINLDashboardComposer onApply={handleApplyAiDraft} />

        {/* 3 — Compose bento: JSON editor (hero) beside the curated catalog.
            1 col on phone → 2+1 on xl → balanced 2+2 on 3xl. */}
        <FadeIn delay={0.1}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 3xl:grid-cols-4">
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2 3xl:col-span-2">
              <Heading level="panel" as="h2" className="mb-1 flex items-center gap-2">
                <Braces className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('powerDashboards.editor.title', 'Manual dashboard JSON editor')}
              </Heading>
              <HelperText className="mb-3">
                {t(
                  'powerDashboards.editor.helper',
                  'Edit the Grafana JSON model directly. Nothing is sent to Grafana — you copy it in yourself.',
                )}
              </HelperText>
              <Textarea
                value={dashboardJson}
                onChange={(e) => setDashboardJson(e.target.value)}
                placeholder={t(
                  'powerDashboards.editor.placeholder',
                  '{\n  "title": "Fleet overview",\n  "slots": [\n    {\n      "panel_name": "drives_per_day_timeseries",\n      "grid_pos": { "x": 0, "y": 0, "w": 24, "h": 8 }\n    }\n  ]\n}',
                )}
                rows={18}
                aria-label={t('powerDashboards.editor.label', 'Dashboard JSON editor')}
                spellCheck={false}
                className="font-mono"
              />
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  onClick={handleCopy}
                  disabled={!canCopy}
                  aria-disabled={!canCopy ? 'true' : 'false'}
                >
                  <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
                  {t('powerDashboards.editor.copy', 'Copy to clipboard')}
                </Button>
                <Button variant="secondary" onClick={handleClear} disabled={!canClear}>
                  <Eraser className="h-4 w-4" aria-hidden="true" />
                  {t('powerDashboards.editor.clear', 'Clear')}
                </Button>
              </div>
              {status && (
                <div className="mt-3">
                  <InlineCallout
                    variant={status.variant}
                    icon={
                      status.variant === 'success' ? (
                        <Check className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      )
                    }
                  >
                    {status.text}
                  </InlineCallout>
                </div>
              )}
            </GlassPanel>

            {/* Curated panel catalog — reference column beside the editor. */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-1 3xl:col-span-2">
              <Heading level="panel" as="h2" className="mb-1 flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('powerDashboards.panels.title', 'Curated panel catalog')}
              </Heading>
              <HelperText className="mb-3">
                {t(
                  'powerDashboards.panels.intro',
                  'These are the panels the curated catalog exposes. The Helix natural-language composer refuses any panel_name outside this list, and each dashboard may use each panel_name at most once.',
                )}
              </HelperText>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 3xl:grid-cols-2">
                {sortedPanels.map((panel) => (
                  <li
                    key={panel.name}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/[0.03] text-cyan-300 ring-1 ring-white/[0.06]">
                        {panelKindIcon(panel.name)}
                      </span>
                      <Text as="span" mono size="sm" className="min-w-0 break-all text-cyan-300">
                        {panel.name}
                      </Text>
                    </div>
                    <HelperText className="mt-1.5">
                      {panel.description}
                    </HelperText>
                  </li>
                ))}
              </ul>
            </GlassPanel>
          </section>
        </FadeIn>
      </PageContainer>
    </div>
  );
}
