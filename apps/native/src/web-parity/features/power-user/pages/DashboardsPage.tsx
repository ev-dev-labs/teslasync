// Native parity port of web/src/features/power-user/pages/DashboardsPage.tsx.
//
// Manual dashboard layout JSON composer (web route /power/dashboards). The page
// provides a JSON editor, a curated panel catalog, and a copy-to-clipboard flow.
// The optional AI drafter (AINLDashboardComposer) is propose-only: users must
// explicitly apply a draft to the editor and then copy it. The page never pushes
// to Grafana directly — users paste the copied JSON into Grafana manually.
//
// Browser-only behaviour is reduced to native-safe equivalents and documented in
// the .parity.json sidecar:
//   - react-i18next useTranslation -> inline useNativeTranslation() returning
//     t(key, fallback?) = fallback ?? key (no {{token}} placeholders in this file).
//   - @/hooks/usePageTitle (document.title) -> native no-op; the navigator owns
//     the header title.
//   - localStorage draft persistence -> the AIVoiceMode globalThis-cast precedent:
//     the real Web Storage is used when present (react-native-web) and degrades to
//     a documented no-op on pure native (no AsyncStorage dependency wired).
//   - navigator.clipboard.writeText -> the same globalThis-cast guard; on native
//     navigator.clipboard is absent so the editor surfaces the explicit
//     copyUnavailable status (mirroring the web's !navigator.clipboard branch),
//     while react-native-web keeps the real copySuccess/copyFailed paths.
//   - DOM/Tailwind UI (div/p/ul/li, Textarea, Button, GlassPanel, PageTitle,
//     PanelTitle, Stack) -> React Native primitives + the existing native AppText /
//     AppButton / GlassPanel + design tokens.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ScrollView, StyleSheet, TextInput, View} from 'react-native';

import {AppButton} from '../../../../components/ui/AppButton';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {
  AINLDashboardComposer,
  type DashboardLayoutDraft,
} from '../../../components/ai/AINLDashboardComposer';

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

/* ── native translation fallback (native-safe port of react-i18next) ──────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  // Mirrors the web `t(key, default?)`: returns the English default (else the
  // key). This file uses no {{token}} placeholders, so no interpolation is
  // needed. Every web key + English default is preserved verbatim at call sites.
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ── native-safe usePageTitle (web document.title is browser-only) ────────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    // The web hook writes document.title; on native the navigator owns the
    // header title, so the resolved title is intentionally not applied here.
    void title;
  }, [title]);
}

/* ── draft persistence (web localStorage -> globalThis Web Storage if present) */

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// Mirrors the web `window.localStorage`. The real Web Storage is used when it is
// present (react-native-web), matching the cross-navigation persistence intent;
// on pure native it is absent (no AsyncStorage dependency wired), so the helpers
// degrade to a documented no-op — the same shape as the web `typeof window ===
// 'undefined'` guard + try/catch.
function getDraftStorage(): WebStorageLike | null {
  const candidate = (globalThis as typeof globalThis & {localStorage?: unknown})
    .localStorage;
  if (candidate == null || typeof candidate !== 'object') {
    return null;
  }
  const storage = candidate as Partial<WebStorageLike>;
  if (
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
  ) {
    return storage as WebStorageLike;
  }
  return null;
}

function loadPersistedJson(): string {
  const storage = getDraftStorage();
  if (!storage) {
    return '';
  }
  try {
    return storage.getItem(DASHBOARD_COMPOSER_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistJson(value: string): void {
  const storage = getDraftStorage();
  if (!storage) {
    return;
  }
  try {
    if (value) {
      storage.setItem(DASHBOARD_COMPOSER_DRAFT_KEY, value);
    } else {
      storage.removeItem(DASHBOARD_COMPOSER_DRAFT_KEY);
    }
  } catch {
    /* ignore — quota exceeded etc. */
  }
}

/* ── clipboard access (web navigator.clipboard -> globalThis guard) ───────── */

interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

// Mirrors the web `typeof navigator === 'undefined' || !navigator.clipboard`
// guard. On native navigator.clipboard is absent -> null (the editor reports the
// explicit copyUnavailable status); on react-native-web the real clipboard is
// returned so the copySuccess/copyFailed branches stay live.
function getClipboard(): ClipboardLike | null {
  const nav = (globalThis as typeof globalThis & {
    navigator?: {clipboard?: {writeText?: (text: string) => Promise<void>}};
  }).navigator;
  if (!nav || !nav.clipboard || typeof nav.clipboard.writeText !== 'function') {
    return null;
  }
  return nav.clipboard as ClipboardLike;
}

export default function DashboardsPage() {
  const t = useNativeTranslation();
  usePageTitle(t('powerDashboards.title', 'Dashboard Composer'));

  const [dashboardJson, setDashboardJson] = useState<string>(() =>
    loadPersistedJson(),
  );
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Persist the JSON editor contents so a long edit survives a navigation away
  // + back. Synchronous setItem in the effect is fine — modern Web Storage
  // handles 4KB writes in <1ms; on native this is a no-op.
  useEffect(() => {
    persistJson(dashboardJson);
  }, [dashboardJson]);

  const handleApplyAiDraft = useCallback((draft: DashboardLayoutDraft) => {
    // Render the full dashboard envelope as pretty-printed JSON so the user
    // pastes a Grafana-ready document rather than a wire-format blob. The user
    // can still edit it before pressing Copy to clipboard.
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
    const clipboard = getClipboard();
    if (!clipboard) {
      setStatusMessage(
        t(
          'powerDashboards.editor.copyUnavailable',
          'Clipboard access is not available in this browser. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      );
      return;
    }
    try {
      await clipboard.writeText(trimmed);
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
    () =>
      [...CURATED_DASHBOARD_PANELS].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const canCopy = dashboardJson.trim().length > 0;

  return (
    <ScrollView
      contentContainerStyle={styles.root}
      testID="power-dashboards-composer-root">
      <AppText style={styles.pageTitle} variant="title" weight="bold">
        {t('powerDashboards.title', 'Dashboard Composer')}
      </AppText>

      <AppText style={styles.intro} tone="secondary">
        {t(
          'powerDashboards.intro',
          'Compose a Grafana dashboard JSON envelope by picking panels from the curated catalog below and placing them on the 24-column grid. The browser does not push the dashboard to Grafana; copy your JSON into your existing Grafana dashboard editor.',
        )}
      </AppText>

      <AINLDashboardComposer onApply={handleApplyAiDraft} />

      <GlassPanel style={styles.panel}>
        <View style={styles.stack}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('powerDashboards.editor.title', 'Manual dashboard JSON editor')}
          </AppText>
          <TextInput
            accessibilityLabel={t(
              'powerDashboards.editor.label',
              'Dashboard JSON editor',
            )}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            numberOfLines={12}
            onChangeText={setDashboardJson}
            placeholder={t(
              'powerDashboards.editor.placeholder',
              '{\n  "title": "Fleet overview",\n  "slots": [\n    {\n      "panel_name": "drives_per_day_timeseries",\n      "grid_pos": { "x": 0, "y": 0, "w": 24, "h": 8 }\n    }\n  ]\n}',
            )}
            placeholderTextColor={colors.textMuted}
            spellCheck={false}
            style={styles.textarea}
            testID="power-dashboards-json-editor"
            textAlignVertical="top"
            value={dashboardJson}
          />
          <View style={styles.buttonRow}>
            <AppButton
              disabled={!canCopy}
              label={t('powerDashboards.editor.copy', 'Copy to clipboard')}
              onPress={handleCopy}
              variant="primary"
            />
            <AppButton
              disabled={!canCopy}
              label={t('powerDashboards.editor.clear', 'Clear')}
              onPress={handleClear}
              variant="ghost"
            />
            {statusMessage ? (
              <AppText
                accessibilityLiveRegion="polite"
                style={styles.statusMessage}
                testID="power-dashboards-status">
                {statusMessage}
              </AppText>
            ) : null}
          </View>
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <View style={styles.stack}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('powerDashboards.panels.title', 'Curated panel catalog')}
          </AppText>
          <AppText style={styles.intro} tone="secondary">
            {t(
              'powerDashboards.panels.intro',
              'These are the panels the curated catalog exposes. The Helix natural-language composer refuses any panel_name outside this list, and each dashboard may use each panel_name at most once.',
            )}
          </AppText>
          <View style={styles.panelGrid}>
            {sortedPanels.map(panel => (
              <View
                key={panel.name}
                style={styles.panelCard}
                testID={`power-dashboards-panel-${panel.name}`}>
                <AppText style={styles.panelName}>{panel.name}</AppText>
                <AppText style={styles.panelDescription} tone="secondary">
                  {panel.description}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: spacing.lg,
    gap: spacing.lg,
    backgroundColor: colors.background,
    flexGrow: 1,
  },
  pageTitle: {
    fontSize: typography.title,
    lineHeight: 28,
  },
  intro: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  panel: {
    padding: spacing.lg,
  },
  stack: {
    gap: spacing.md,
  },
  panelTitle: {
    fontSize: typography.body,
    lineHeight: 22,
  },
  textarea: {
    minHeight: 240,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: typography.caption,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusMessage: {
    color: colors.warning,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  panelGrid: {
    gap: spacing.sm,
  },
  panelCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.md,
    gap: spacing.xs,
  },
  panelName: {
    fontFamily: 'monospace',
    fontSize: typography.caption,
    lineHeight: 18,
    color: colors.accent,
  },
  panelDescription: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
});
