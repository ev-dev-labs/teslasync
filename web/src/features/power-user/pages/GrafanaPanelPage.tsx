// Phase-50 / 0058 — PU2 Natural-language Grafana panel.
//
// GrafanaPanelPage is the manual Grafana panel JSON editor surface
// mounted at /power/grafana. The page is the deterministic
// baseline for the Phase-50 / 0058 nl-grafana-panel slice: a
// manual JSON textarea + curated panel-builder catalog viewer +
// Copy-to-clipboard target. The optional AI drafter section
// (AINLGrafanaPanel) is rendered alongside via withAiFeature so
// it is entirely absent in off-mode (ADR-015 §I5 + §I6) and
// propose-only in on-mode (the user must explicitly click the
// canonical Apply to editor button to copy the LLM's proposal
// into the textarea, then must explicitly click the canonical
// Copy to clipboard button to paste it into their Grafana
// dashboard).
//
// The page does NOT push the panel to Grafana from the browser —
// adding a Grafana API integration is out of scope per the
// Phase-50 / 0058 "Allowed files" list. The Copy to clipboard
// button uses the standard navigator.clipboard.writeText API and
// surfaces a deterministic confirmation message; the user then
// pastes into their Grafana dashboard editor manually. A future
// slice that ships a typed Grafana-API push handler can swap that
// branch in without churning this page's structure or the AI
// drafter's contract.
//
// State persistence: the JSON textarea contents are persisted to
// localStorage under the canonical 'ai.grafanaPanel.draft' key
// the slice prompt's "Client storage keys" section names. That
// key is the only client-side storage artifact the slice adds.
//
// Visual layout:
//   - Page header (title + AI drafter section conditionally
//     mounted via withAiFeature)
//   - Manual JSON editor (Textarea + Copy to clipboard button +
//     Clear button)
//   - Curated panel-builder catalog viewer (panel types +
//     datasource types + table-by-table column metadata so the
//     user can build a panel deterministically without consulting
//     external docs)
//
// ADR-015 alignment:
//   - I3 baseline intact: this page renders the manual JSON
//     editor + curated catalog regardless of the AI feature
//     toggle's state. The AI drafter section is opt-in
//     propose-only suggestion layered alongside.
//   - I5 hidden UI:       AINLGrafanaPanel is wrapped by
//     withAiFeature so the entire AI section is absent from the
//     DOM in off-mode.
//   - I8 propose-only:    the page never auto-pushes the LLM's
//     proposal to Grafana. The user must explicitly click Apply
//     to editor and then explicitly click Copy to clipboard.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AINLGrafanaPanel,
  type GrafanaPanelDraft,
} from '@/components/ai/AINLGrafanaPanel';
import { Stack } from '@/components/layout';
import { Button, GlassPanel, PageTitle, PanelTitle, Textarea } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';

// GRAFANA_PANEL_DRAFT_KEY is the canonical localStorage key the
// Phase-50 / 0058 slice declared in its "Client storage keys"
// section. Persisted across navigation so a user editing a long
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
//   2. Phase-50 / 0058's "Allowed files" list does not include a
//      new API hook file. A future slice that adds dynamic
//      catalog gating can swap the static arrays for hook
//      responses without churning this page's render tree.
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
  const [statusMessage, setStatusMessage] = useState<string>('');

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
    setStatusMessage('');
  }, []);

  const handleClear = useCallback(() => {
    setPanelJson('');
    setStatusMessage('');
  }, []);

  const handleCopy = useCallback(async () => {
    const trimmed = panelJson.trim();
    if (!trimmed) {
      setStatusMessage(
        t(
          'powerGrafana.editor.copyEmpty',
          'Type or paste a Grafana panel JSON envelope above before copying.',
        ),
      );
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setStatusMessage(
        t(
          'powerGrafana.editor.copyUnavailable',
          'Clipboard access is not available in this browser. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(trimmed);
      setStatusMessage(
        t(
          'powerGrafana.editor.copySuccess',
          'Copied. Paste the JSON into your Grafana dashboard editor (Add panel → Edit JSON).',
        ),
      );
    } catch {
      setStatusMessage(
        t(
          'powerGrafana.editor.copyFailed',
          'Clipboard write failed. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      );
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
    <div className="space-y-6 p-6" data-testid="power-grafana-panel-builder-root">
      <PageTitle>{t('powerGrafana.title', 'Grafana Panel Builder')}</PageTitle>

      <p className="text-sm text-[var(--text-secondary)]">
        {t(
          'powerGrafana.intro',
          'Build a Grafana panel JSON envelope against the curated panel-builder catalog below. The browser does not push the panel to Grafana; copy your JSON into your existing Grafana dashboard editor.',
        )}
      </p>

      <AINLGrafanaPanel onApply={handleApplyAiDraft} />

      <GlassPanel>
        <Stack className="gap-4">
          <PanelTitle>{t('powerGrafana.editor.title', 'Manual panel JSON editor')}</PanelTitle>
          <Textarea
            value={panelJson}
            onChange={(e) => setPanelJson(e.target.value)}
            placeholder={t(
              'powerGrafana.editor.placeholder',
              '{\n  "title": "Drives per day",\n  "type": "timeseries",\n  "datasource": { "type": "postgres", "uid": "tesla-postgres" },\n  "targets": [],\n  "grid_pos": { "x": 0, "y": 0, "w": 12, "h": 8 }\n}',
            )}
            rows={12}
            aria-label={t('powerGrafana.editor.label', 'Grafana panel JSON editor')}
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={handleCopy}
              disabled={!canCopy}
              aria-disabled={!canCopy ? 'true' : 'false'}
            >
              {t('powerGrafana.editor.copy', 'Copy to clipboard')}
            </Button>
            <Button variant="secondary" onClick={handleClear} disabled={!canCopy}>
              {t('powerGrafana.editor.clear', 'Clear')}
            </Button>
            {statusMessage && (
              <span className="text-sm text-amber-300" role="status">
                {statusMessage}
              </span>
            )}
          </div>
        </Stack>
      </GlassPanel>

      <GlassPanel>
        <Stack className="gap-4">
          <PanelTitle>
            {t('powerGrafana.panelTypes.title', 'Curated panel types')}
          </PanelTitle>
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'powerGrafana.panelTypes.intro',
              'These are the panel types the curated catalog exposes. The Helix natural-language drafter refuses any panel type outside this list.',
            )}
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sortedPanelTypes.map((entry) => (
              <li key={entry.name} className="rounded-md border border-[var(--border-subtle)] p-3">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-sm text-cyan-300">{entry.name}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{entry.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </Stack>
      </GlassPanel>

      <GlassPanel>
        <Stack className="gap-4">
          <PanelTitle>
            {t('powerGrafana.datasourceTypes.title', 'Curated datasource types')}
          </PanelTitle>
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'powerGrafana.datasourceTypes.intro',
              'These are the datasource types the curated catalog exposes, with their canonical UIDs. The Helix natural-language drafter refuses any datasource type outside this list.',
            )}
          </p>
          <ul className="space-y-2">
            {sortedDatasourceTypes.map((entry) => (
              <li key={entry.name} className="rounded-md border border-[var(--border-subtle)] p-3">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-sm text-cyan-300">
                    {entry.name}
                    <span className="text-[var(--text-muted)]"> · </span>
                    <span className="text-emerald-300">uid={entry.uid}</span>
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">{entry.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </Stack>
      </GlassPanel>

      <GlassPanel>
        <Stack className="gap-4">
          <PanelTitle>
            {t('powerGrafana.tables.title', 'Curated table catalog (postgres targets)')}
          </PanelTitle>
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'powerGrafana.tables.intro',
              'These tables are the only tables the curated catalog exposes for postgres-target rawSql. The Helix natural-language drafter refuses any postgres query referencing tables outside this list.',
            )}
          </p>
          <ul className="space-y-4">
            {sortedTables.map((table) => (
              <li key={table.name} className="rounded-md border border-[var(--border-subtle)] p-4">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-base text-cyan-300">{table.name}</span>
                  <span className="text-sm text-[var(--text-secondary)]">{table.description}</span>
                </div>
                <ul className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {table.columns.map((col) => (
                    <li key={col.name} className="text-xs text-[var(--text-secondary)]">
                      <span className="font-mono text-emerald-300">{col.name}</span>
                      <span className="text-[var(--text-muted)]"> · </span>
                      <span className="text-[var(--text-secondary)]">{col.type}</span>
                      <span className="text-[var(--text-muted)]"> — </span>
                      <span>{col.description}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Stack>
      </GlassPanel>
    </div>
  );
}
