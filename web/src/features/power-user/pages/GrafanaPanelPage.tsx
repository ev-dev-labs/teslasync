// Manual Grafana panel JSON editor for /power/grafana.
// The page keeps the deterministic textarea, curated catalog, and
// Copy-to-clipboard workflow visible for every user. The optional Helix
// drafter is rendered alongside, hidden when the feature is off, and
// propose-only: users must explicitly apply a draft to the editor and then
// copy it into Grafana themselves. The browser never pushes panels to
// Grafana directly.
//
// The JSON textarea persists to localStorage under
// 'ai.grafanaPanel.draft' so accidental navigation does not discard a
// long draft. The curated catalogs are static because they are the same
// for every install; a future API-backed catalog can replace them without
// changing this page's render tree.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Braces, Columns3, Copy, Database, LayoutDashboard, ListChecks, Table2, Trash2,
} from 'lucide-react';

import {
  AINLGrafanaPanel,
  type GrafanaPanelDraft,
} from '@/components/ai/AINLGrafanaPanel';
import { PageContainer } from '@/components/layout';
import { Button, Code, GlassPanel, PanelTitle, Text, Textarea } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, InlineCallout, type CalloutVariant } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';

// GRAFANA_PANEL_DRAFT_KEY is the canonical localStorage key for the
// editor draft. Persisted across navigation so a user editing a long
// JSON envelope doesn't lose progress on accidental reload.
const GRAFANA_PANEL_DRAFT_KEY = 'ai.grafanaPanel.draft';

// CuratedPanelType / CuratedDatasourceType / CuratedTable mirror
// the Go-side AINLGrafanaPanel*Entry shapes declared in
// internal/api/ai_nl_grafana_panel_handler.go's
// nlGrafanaPanelCuratedPanelTypes / DatasourceTypes / Tables. We
// duplicate the catalogs here (instead of fetching them via a new
// API hook) for two reasons:
//
//   1. The catalogs are install-wide-static — they do not vary
//      per user / per vehicle / per tenant. Fetching them would
//      add a round-trip without any actual dynamism.
//   2. No API hook exists for these catalogs today. A future dynamic
//      catalog can swap the static arrays for hook responses without
//      churning this page's render tree.
interface CuratedPanelType {
  name: string;
  description: string;
}
interface CuratedDatasourceType {
  name: string;
  uid: string;
  description: string;
}
interface CuratedColumn {
  name: string;
  type: string;
  description: string;
}
interface CuratedTable {
  name: string;
  description: string;
  columns: CuratedColumn[];
}

const CURATED_PANEL_TYPES: CuratedPanelType[] = [
  { name: 'timeseries', description: 'time-series chart (default for any time-vs-value query)' },
  { name: 'stat', description: 'single-value big-number stat panel (latest sample of one metric)' },
  { name: 'gauge', description: 'single-value gauge with min/max bounds' },
  { name: 'table', description: 'tabular result of an SQL/PromQL query' },
  { name: 'barchart', description: 'categorical bar chart' },
  { name: 'heatmap', description: 'two-dimensional heatmap (e.g. histograms over time)' },
  { name: 'piechart', description: 'categorical pie chart' },
  { name: 'logs', description: 'log-line stream (for text-shaped data)' },
];

const CURATED_DATASOURCE_TYPES: CuratedDatasourceType[] = [
  {
    name: 'postgres',
    uid: 'tesla-postgres',
    description:
      'TimescaleDB postgres instance — for queries against the curated table catalog below',
  },
  {
    name: 'prometheus',
    uid: 'tesla-prometheus',
    description:
      "Prometheus instance — for PromQL queries against TeslaSync's metrics endpoint",
  },
];

const CURATED_TABLES: CuratedTable[] = [
  {
    name: 'drives',
    description: 'Per-trip aggregates for completed drives',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle this drive belongs to' },
      { name: 'started_at', type: 'timestamptz', description: 'drive start UTC' },
      { name: 'ended_at', type: 'timestamptz', description: 'drive end UTC' },
      { name: 'distance_m', type: 'double precision', description: 'distance meters (SI)' },
      { name: 'duration_s', type: 'double precision', description: 'duration seconds (SI)' },
      { name: 'energy_used_wh', type: 'double precision', description: 'energy watt-hours (SI)' },
      { name: 'regen_wh', type: 'double precision', description: 'regen watt-hours' },
      { name: 'avg_speed_mps', type: 'double precision', description: 'avg speed m/s (SI)' },
      { name: 'max_speed_mps', type: 'double precision', description: 'max speed m/s' },
    ],
  },
  {
    name: 'charging_sessions',
    description: 'Per-charge aggregates for completed charging sessions',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle being charged' },
      { name: 'started_at', type: 'timestamptz', description: 'session start UTC' },
      { name: 'ended_at', type: 'timestamptz', description: 'session end UTC' },
      { name: 'energy_added_wh', type: 'double precision', description: 'energy added watt-hours (SI)' },
      { name: 'cost_cents', type: 'bigint', description: 'session cost in user-currency cents' },
      { name: 'charger_kind', type: 'text', description: 'home, supercharger, third_party' },
      { name: 'max_power_w', type: 'double precision', description: 'peak power watts' },
    ],
  },
  {
    name: 'vehicles',
    description: 'Vehicle metadata',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vin', type: 'text', description: 'Tesla VIN (PII)' },
      { name: 'display_name', type: 'text', description: 'user-chosen display name (PII)' },
      { name: 'model', type: 'text', description: 'model code' },
      { name: 'color', type: 'text', description: 'exterior color slug' },
    ],
  },
  {
    name: 'alerts',
    description: 'User-defined alerts that have fired',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle the alert fired for' },
      { name: 'alert_rule_id', type: 'bigint', description: 'alert rule that fired' },
      { name: 'fired_at', type: 'timestamptz', description: 'fire timestamp UTC' },
      { name: 'level', type: 'text', description: 'info, warn, critical' },
    ],
  },
  {
    name: 'signal_log_view',
    description: 'Telemetry signal history exposed as a stable view',
    columns: [
      { name: 'vehicle_id', type: 'bigint', description: 'vehicle the signal belongs to' },
      { name: 'signal_name', type: 'text', description: 'canonical signal name' },
      { name: 'ts', type: 'timestamptz', description: 'sample timestamp UTC' },
      { name: 'num_value', type: 'double precision', description: 'numeric value (SI), null if non-numeric' },
      { name: 'str_value', type: 'text', description: 'string value, null if numeric' },
    ],
  },
];

function loadPersistedJson(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(GRAFANA_PANEL_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistJson(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) {
      window.localStorage.setItem(GRAFANA_PANEL_DRAFT_KEY, value);
    } else {
      window.localStorage.removeItem(GRAFANA_PANEL_DRAFT_KEY);
    }
  } catch {
    /* ignore — quota exceeded etc. */
  }
}

export default function GrafanaPanelPage() {
  const { t } = useTranslation();
  usePageTitle(t('powerGrafana.title', 'Grafana Panel Builder'));

  const [panelJson, setPanelJson] = useState<string>(() => loadPersistedJson());
  const [status, setStatus] = useState<{ variant: CalloutVariant; message: string } | null>(
    null,
  );

  // Static-catalog summary counts for the KPI band. Derived from the
  // install-wide-static catalogs above, so surfacing them never triggers a
  // fetch — they are the same for every install.
  const panelTypeCount = CURATED_PANEL_TYPES.length;
  const datasourceCount = CURATED_DATASOURCE_TYPES.length;
  const tableCount = CURATED_TABLES.length;
  const totalColumns = useMemo(
    () => CURATED_TABLES.reduce((sum, tbl) => sum + tbl.columns.length, 0),
    [],
  );

  // Persist the JSON textarea contents so a long edit survives a
  // navigation away + back. Synchronous setItem in the effect is
  // fine — modern browsers handle 4KB writes in <1ms.
  useEffect(() => {
    persistJson(panelJson);
  }, [panelJson]);

  const handleApplyAiDraft = useCallback((draft: GrafanaPanelDraft) => {
    // Render the full panel envelope as pretty-printed JSON so the
    // user pastes a Grafana-ready document rather than a
    // wire-format blob. The user can still edit it before clicking
    // Copy to clipboard.
    setPanelJson(JSON.stringify(draft.panel, null, 2));
    setStatus(null);
  }, []);

  const handleClear = useCallback(() => {
    setPanelJson('');
    setStatus(null);
  }, []);

  const handleCopy = useCallback(async () => {
    const trimmed = panelJson.trim();
    if (!trimmed) {
      setStatus({
        variant: 'warning',
        message: t(
          'powerGrafana.editor.copyEmpty',
          'Type or paste a Grafana panel JSON envelope above before copying.',
        ),
      });
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setStatus({
        variant: 'warning',
        message: t(
          'powerGrafana.editor.copyUnavailable',
          'Clipboard access is not available in this browser. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(trimmed);
      setStatus({
        variant: 'success',
        message: t(
          'powerGrafana.editor.copySuccess',
          'Copied. Paste the JSON into your Grafana dashboard editor (Add panel → Edit JSON).',
        ),
      });
    } catch {
      setStatus({
        variant: 'danger',
        message: t(
          'powerGrafana.editor.copyFailed',
          'Clipboard write failed. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      });
    }
  }, [panelJson, t]);

  const sortedPanelTypes = useMemo(
    () => [...CURATED_PANEL_TYPES].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const sortedDatasourceTypes = useMemo(
    () => [...CURATED_DATASOURCE_TYPES].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const sortedTables = useMemo(
    () => [...CURATED_TABLES].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const canCopy = panelJson.trim().length > 0;

  return (
    <PageContainer
      title={t('powerGrafana.title', 'Grafana Panel Builder')}
      subtitle={t(
        'powerGrafana.subtitle',
        'Build a Grafana panel JSON envelope against the curated catalog, then copy it into your own dashboard.',
      )}
    >
      <div className="space-y-6" data-testid="power-grafana-panel-builder-root">
        {/* 1 — Catalog summary KPI band (derived from the static catalogs) */}
        <FadeIn>
          <section
            aria-label={t('powerGrafana.summary.aria', 'Curated catalog summary')}
            className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
          >
            <MetricCard
              label={t('powerGrafana.summary.panelTypes', 'Panel types')}
              value={panelTypeCount}
              icon={<LayoutDashboard className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t('powerGrafana.summary.datasources', 'Datasources')}
              value={datasourceCount}
              icon={<Database className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t('powerGrafana.summary.tables', 'Tables')}
              value={tableCount}
              icon={<Table2 className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('powerGrafana.summary.columns', 'Columns')}
              value={totalColumns}
              icon={<Columns3 className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
          </section>
        </FadeIn>

        {/* 2 — Optional Helix natural-language drafter (hidden when AI is off) */}
        <FadeIn delay={0.05}>
          <AINLGrafanaPanel onApply={handleApplyAiDraft} />
        </FadeIn>

        {/* 3 — Editor (hero) + workflow guidance bento */}
        <FadeIn delay={0.1}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Braces className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('powerGrafana.editor.title', 'Manual panel JSON editor')}
              </PanelTitle>
              <div className="space-y-4">
                <Textarea
                  value={panelJson}
                  onChange={(e) => setPanelJson(e.target.value)}
                  placeholder={t(
                    'powerGrafana.editor.placeholder',
                    '{\n  "title": "Drives per day",\n  "type": "timeseries",\n  "datasource": { "type": "postgres", "uid": "tesla-postgres" },\n  "targets": [],\n  "grid_pos": { "x": 0, "y": 0, "w": 12, "h": 8 }\n}',
                  )}
                  rows={14}
                  aria-label={t('powerGrafana.editor.label', 'Grafana panel JSON editor')}
                  spellCheck={false}
                  className="font-mono"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={handleCopy}
                    disabled={!canCopy}
                    aria-disabled={!canCopy ? 'true' : 'false'}
                    icon={<Copy className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('powerGrafana.editor.copy', 'Copy to clipboard')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleClear}
                    disabled={!canCopy}
                    icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('powerGrafana.editor.clear', 'Clear')}
                  </Button>
                </div>
                {status && (
                  <InlineCallout variant={status.variant}>{status.message}</InlineCallout>
                )}
              </div>
            </GlassPanel>

            {/* Workflow guidance — reading column beside the editor */}
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('powerGrafana.workflow.title', 'How it works')}
              </PanelTitle>
              <Text as="p" size="sm" color="secondary" className="mb-3 max-w-prose">
                {t(
                  'powerGrafana.intro',
                  'Build a Grafana panel JSON envelope against the curated panel-builder catalog below. The browser does not push the panel to Grafana; copy your JSON into your existing Grafana dashboard editor.',
                )}
              </Text>
              <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-cyan-300">
                <li>
                  <Text as="span" size="sm" color="secondary">
                    {t(
                      'powerGrafana.workflow.step1',
                      'Draft with Helix or write / paste a Grafana panel JSON envelope in the editor.',
                    )}
                  </Text>
                </li>
                <li>
                  <Text as="span" size="sm" color="secondary">
                    {t('powerGrafana.workflow.step2', 'Click Copy to clipboard to grab the JSON.')}
                  </Text>
                </li>
                <li>
                  <Text as="span" size="sm" color="secondary">
                    {t(
                      'powerGrafana.workflow.step3',
                      'In Grafana, choose Add panel → Edit JSON and paste it in.',
                    )}
                  </Text>
                </li>
              </ol>
              <InlineCallout variant="info" className="mt-4">
                {t(
                  'powerGrafana.workflow.note',
                  'The browser never pushes panels to Grafana directly — you stay in control of what lands on your dashboards.',
                )}
              </InlineCallout>
            </GlassPanel>
          </section>
        </FadeIn>

        {/* 4 — Curated panel types + datasource types bento */}
        <FadeIn delay={0.15}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-2 flex items-center gap-2">
                <LayoutDashboard className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('powerGrafana.panelTypes.title', 'Curated panel types')}
              </PanelTitle>
              <Text as="p" size="sm" color="secondary" className="mb-4 max-w-prose">
                {t(
                  'powerGrafana.panelTypes.intro',
                  'These are the panel types the curated catalog exposes. The Helix natural-language drafter refuses any panel type outside this list.',
                )}
              </Text>
              {sortedPanelTypes.length === 0 ? (
                // no-action: unreachable — sortedPanelTypes sorts the static CURATED_PANEL_TYPES constant, which never has zero entries.
                <EmptyState
                  icon={<LayoutDashboard className="h-8 w-8" aria-hidden="true" />}
                  message={t('powerGrafana.panelTypes.empty', 'No panel types available.')}
                />
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 3xl:grid-cols-3">
                  {sortedPanelTypes.map((entry) => (
                    <li
                      key={entry.name}
                      className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <Code className="text-cyan-300">{entry.name}</Code>
                        <Text as="span" variant="caption">
                          {entry.description}
                        </Text>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>

            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-2 flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('powerGrafana.datasourceTypes.title', 'Curated datasource types')}
              </PanelTitle>
              <Text as="p" size="sm" color="secondary" className="mb-4 max-w-prose">
                {t(
                  'powerGrafana.datasourceTypes.intro',
                  'These are the datasource types the curated catalog exposes, with their canonical UIDs. The Helix natural-language drafter refuses any datasource type outside this list.',
                )}
              </Text>
              {sortedDatasourceTypes.length === 0 ? (
                // no-action: unreachable — sortedDatasourceTypes sorts the static CURATED_DATASOURCE_TYPES constant, never empty.
                <EmptyState
                  icon={<Database className="h-8 w-8" aria-hidden="true" />}
                  message={t('powerGrafana.datasourceTypes.empty', 'No datasource types available.')}
                />
              ) : (
                <ul className="space-y-2">
                  {sortedDatasourceTypes.map((entry) => (
                    <li
                      key={entry.name}
                      className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <Code className="text-cyan-300">{entry.name}</Code>
                          <Text as="span" variant="caption" aria-hidden="true">
                            ·
                          </Text>
                          <Code className="text-emerald-300">uid={entry.uid}</Code>
                        </span>
                        <Text as="span" variant="caption">
                          {entry.description}
                        </Text>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </section>
        </FadeIn>

        {/* 5 — Curated table catalog band — auto-fit bento fills the full width */}
        <FadeIn delay={0.2}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-2 flex items-center gap-2">
              <Table2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('powerGrafana.tables.title', 'Curated table catalog (postgres targets)')}
            </PanelTitle>
            <Text as="p" size="sm" color="secondary" className="mb-4 max-w-prose">
              {t(
                'powerGrafana.tables.intro',
                'These tables are the only tables the curated catalog exposes for postgres-target rawSql. The Helix natural-language drafter refuses any postgres query referencing tables outside this list.',
              )}
            </Text>
            {sortedTables.length === 0 ? (
              // no-action: unreachable — sortedTables sorts the static CURATED_TABLES constant, never empty.
              <EmptyState
                icon={<Table2 className="h-8 w-8" aria-hidden="true" />}
                message={t('powerGrafana.tables.empty', 'No tables available.')}
              />
            ) : (
              <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
                {sortedTables.map((table) => (
                  <li
                    key={table.name}
                    className="rounded-lg border border-[var(--border-subtle)] bg-white/[0.02] p-4"
                  >
                    <div className="flex flex-col gap-1">
                      <Code className="text-base text-cyan-300">{table.name}</Code>
                      <Text as="span" size="sm" color="secondary">
                        {table.description}
                      </Text>
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {(table.columns ?? []).map((col) => (
                        <li key={col.name} className="flex flex-wrap items-baseline gap-x-1.5">
                          <Code className="text-emerald-300">{col.name}</Code>
                          <Text as="span" variant="caption">
                            {col.type}
                          </Text>
                          <Text as="span" variant="caption" aria-hidden="true">
                            —
                          </Text>
                          <Text as="span" variant="caption">
                            {col.description}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
