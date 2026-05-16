// Phase-50 / 0059 — PU3 Natural-language dashboard composer.
//
// DashboardsPage is the manual dashboard layout JSON composer
// surface mounted at /power/dashboards. The page is the
// deterministic baseline for the Phase-50 / 0059
// nl-dashboard-composer slice: a manual JSON textarea +
// curated panel catalog viewer + Copy-to-clipboard target. The
// optional AI drafter section (AINLDashboardComposer) is
// rendered alongside via withAiFeature so it is entirely
// absent in off-mode (ADR-015 §I5 + §I6) and propose-only in
// on-mode (the user must explicitly click the canonical Apply
// to editor button to copy the LLM's proposal into the
// textarea, then must explicitly click the canonical Copy to
// clipboard button to paste it into their Grafana dashboard).
//
// The page does NOT push the dashboard to Grafana from the
// browser — adding a Grafana API integration is out of scope
// per the Phase-50 / 0059 "Allowed files" list. The Copy to
// clipboard button uses the standard navigator.clipboard
// .writeText API and surfaces a deterministic confirmation
// message; the user then pastes into their Grafana dashboard
// editor manually. A future slice that ships a typed
// Grafana-API push handler can swap that branch in without
// churning this page's structure or the AI drafter's
// contract.
//
// State persistence: the JSON textarea contents are persisted
// to localStorage under the canonical
// 'ai.dashboardComposer.draft' key the slice prompt's "Client
// storage keys" section names. That key is the only client-
// side storage artifact the slice adds.
//
// Visual layout:
//   - Page header (title + AI drafter section conditionally
//     mounted via withAiFeature)
//   - Manual JSON editor (Textarea + Copy to clipboard button
//     + Clear button)
//   - Curated panel catalog viewer (panel-name + hint copy so
//     the user can compose a dashboard deterministically
//     without consulting external docs)
//
// ADR-015 alignment:
//   - I3 baseline intact: this page renders the manual JSON
//     editor + curated catalog regardless of the AI feature
//     toggle's state. The AI drafter section is opt-in
//     propose-only suggestion layered alongside.
//   - I5 hidden UI:       AINLDashboardComposer is wrapped by
//     withAiFeature so the entire AI section is absent from
//     the DOM in off-mode.
//   - I8 propose-only:    the page never auto-pushes the LLM's
//     proposal to Grafana. The user must explicitly click
//     Apply to editor and then explicitly click Copy to
//     clipboard.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AINLDashboardComposer,
  type DashboardLayoutDraft,
} from '@/components/ai/AINLDashboardComposer';
import { Stack } from '@/components/layout';
import { Button, GlassPanel, PageTitle, PanelTitle, Textarea } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';

// DASHBOARD_COMPOSER_DRAFT_KEY is the canonical localStorage
// key the Phase-50 / 0059 slice declared in its "Client
// storage keys" section. Persisted across navigation so a user
// editing a long JSON envelope doesn't lose progress on
// accidental reload.
const DASHBOARD_COMPOSER_DRAFT_KEY = 'ai.dashboardComposer.draft';

// CuratedDashboardPanel mirrors the Go-side
// AINLDashboardComposerPanelEntry shape declared in
// internal/api/ai_nl_dashboard_composer_handler.go's
// nlDashboardComposerCuratedPanels. We duplicate the catalog
// here (instead of fetching it via a new API hook) for two
// reasons:
//
//   1. The catalog is install-wide-static — it does not vary
//      per user / per vehicle / per tenant. Fetching it would
//      add a round-trip without any actual dynamism.
//   2. Phase-50 / 0059's "Allowed files" list does not include
//      a new API hook file. A future slice that adds dynamic
//      catalog gating can swap the static array for a hook
//      response without churning this page's render tree.
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

export default function DashboardsPage() {
  const { t } = useTranslation();
  usePageTitle(t('powerDashboards.title', 'Dashboard Composer'));

  const [dashboardJson, setDashboardJson] = useState<string>(() => loadPersistedJson());
  const [statusMessage, setStatusMessage] = useState<string>('');

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
    setStatusMessage('');
  }, []);

  const handleClear = useCallback(() => {
    setDashboardJson('');
    setStatusMessage('');
  }, []);

  const handleCopy = useCallback(async () => {
    const trimmed = dashboardJson.trim();
    if (!trimmed) {
      setStatusMessage(
        t(
          'powerDashboards.editor.copyEmpty',
          'Type or paste a dashboard JSON envelope above before copying.',
        ),
      );
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setStatusMessage(
        t(
          'powerDashboards.editor.copyUnavailable',
          'Clipboard access is not available in this browser. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      );
      return;
    }
    try {
      await navigator.clipboard.writeText(trimmed);
      setStatusMessage(
        t(
          'powerDashboards.editor.copySuccess',
          'Copied. Paste the JSON into your Grafana dashboard editor (Dashboard settings → JSON Model).',
        ),
      );
    } catch {
      setStatusMessage(
        t(
          'powerDashboards.editor.copyFailed',
          'Clipboard write failed. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      );
    }
  }, [dashboardJson, t]);

  const sortedPanels = useMemo(
    () => [...CURATED_DASHBOARD_PANELS].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const canCopy = dashboardJson.trim().length > 0;

  return (
    <div className="space-y-6 p-6" data-testid="power-dashboards-composer-root">
      <PageTitle>{t('powerDashboards.title', 'Dashboard Composer')}</PageTitle>

      <p className="text-sm text-white/70">
        {t(
          'powerDashboards.intro',
          'Compose a Grafana dashboard JSON envelope by picking panels from the curated catalog below and placing them on the 24-column grid. The browser does not push the dashboard to Grafana; copy your JSON into your existing Grafana dashboard editor.',
        )}
      </p>

      <AINLDashboardComposer onApply={handleApplyAiDraft} />

      <GlassPanel>
        <Stack className="gap-4">
          <PanelTitle>{t('powerDashboards.editor.title', 'Manual dashboard JSON editor')}</PanelTitle>
          <Textarea
            value={dashboardJson}
            onChange={(e) => setDashboardJson(e.target.value)}
            placeholder={t(
              'powerDashboards.editor.placeholder',
              '{\n  "title": "Fleet overview",\n  "slots": [\n    {\n      "panel_name": "drives_per_day_timeseries",\n      "grid_pos": { "x": 0, "y": 0, "w": 24, "h": 8 }\n    }\n  ]\n}',
            )}
            rows={12}
            aria-label={t('powerDashboards.editor.label', 'Dashboard JSON editor')}
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              onClick={handleCopy}
              disabled={!canCopy}
              aria-disabled={!canCopy ? 'true' : 'false'}
            >
              {t('powerDashboards.editor.copy', 'Copy to clipboard')}
            </Button>
            <Button variant="secondary" onClick={handleClear} disabled={!canCopy}>
              {t('powerDashboards.editor.clear', 'Clear')}
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
          <PanelTitle>{t('powerDashboards.panels.title', 'Curated panel catalog')}</PanelTitle>
          <p className="text-sm text-white/70">
            {t(
              'powerDashboards.panels.intro',
              'These are the panels the curated catalog exposes. The Helix natural-language composer refuses any panel_name outside this list, and each dashboard may use each panel_name at most once.',
            )}
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sortedPanels.map((panel) => (
              <li key={panel.name} className="rounded-md border border-white/10 p-3">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-sm text-cyan-300">{panel.name}</span>
                  <span className="text-xs text-white/70">{panel.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </Stack>
      </GlassPanel>
    </div>
  );
}
