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
// State persistence: the JSON textarea is stored in localStorage under
// 'ai.dashboardComposer.draft'.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AINLDashboardComposer,
  type DashboardLayoutDraft,
} from '@/components/ai/AINLDashboardComposer';
import { Stack } from '@/components/layout';
import { Button, GlassPanel, PageTitle, PanelTitle, Textarea } from '@/components/ui';
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

      <p className="text-sm text-[var(--text-secondary)]">
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
          <p className="text-sm text-[var(--text-secondary)]">
            {t(
              'powerDashboards.panels.intro',
              'These are the panels the curated catalog exposes. The Helix natural-language composer refuses any panel_name outside this list, and each dashboard may use each panel_name at most once.',
            )}
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sortedPanels.map((panel) => (
              <li key={panel.name} className="rounded-md border border-[var(--border-subtle)] p-3">
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-sm text-cyan-300">{panel.name}</span>
                  <span className="text-xs text-[var(--text-secondary)]">{panel.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </Stack>
      </GlassPanel>
    </div>
  );
}
