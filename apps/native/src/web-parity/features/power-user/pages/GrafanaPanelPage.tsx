// Native parity port of web/src/features/power-user/pages/GrafanaPanelPage.tsx.
//
// The manual Grafana panel JSON editor for /power/grafana. The page keeps the
// deterministic editor, the curated catalog (panel types / datasource types /
// table catalog), and the copy-to-clipboard workflow visible for every user;
// the optional Helix drafter renders alongside (hidden when the feature is
// off, propose-only). The app never pushes panels to Grafana directly. The
// draft JSON persists under 'ai.grafanaPanel.draft' so accidental navigation
// does not discard a long draft; the curated catalogs are static.
//
// Behaviour preserved one-for-one from the web page:
//   - State names + defaults: panelJson (seeded from the persisted draft via
//     loadPersistedJson()), statusMessage ('').
//   - The persist effect writes panelJson to the 'ai.grafanaPanel.draft' store
//     on every change.
//   - handleApplyAiDraft (JSON.stringify(draft.panel, null, 2) + clears the
//     status), handleClear, handleCopy (empty -> copyEmpty, no clipboard ->
//     copyUnavailable, success -> copySuccess, failure -> copyFailed).
//   - The three localeCompare-sorted catalogs (sortedPanelTypes /
//     sortedDatasourceTypes / sortedTables) and canCopy = trim length > 0.
//   - Section structure: title -> intro -> Helix drafter -> manual editor
//     panel -> curated panel types -> curated datasource types -> curated
//     table catalog.
//   - The curated catalog arrays (CURATED_PANEL_TYPES / _DATASOURCE_TYPES /
//     _TABLES) are ported verbatim, including the SI column descriptions.
//   - Every i18n key keeps its English default string (intent preserved); this
//     page uses no interpolation.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback) => fallback shim, so every t('key','English') keeps its
//     English default copy.
//   - @/components/ai/AINLGrafanaPanel (AINLGrafanaPanel + GrafanaPanelDraft)
//     -> the already-ported native sibling at ../../../components/ai/
//     AINLGrafanaPanel (same onApply(draft) contract + GrafanaPanelDraft type).
//   - @/components/layout Stack -> a plain column View (gap).
//   - @/components/ui PageTitle/PanelTitle -> AppText headings (title/bold and
//     semibold); Textarea -> a multiline React Native <TextInput> (rows={12}
//     -> numberOfLines + minHeight; spellCheck={false} -> spellCheck +
//     autoCorrect off; aria-label -> accessibilityLabel); Button -> the shared
//     native AppButton (variant primary for Copy; secondary -> ghost for
//     Clear; disabled preserved). GlassPanel -> the shared native GlassPanel.
//   - @/hooks/usePageTitle -> native-safe usePageTitle (feature-detects
//     document.title; writes '{title} — TeslaSync', restores on unmount).
//   - window.localStorage (the 'ai.grafanaPanel.draft' persistence) ->
//     getWebStorage(): feature-detects Web Storage (present on
//     react-native-web, absent on bare native); on bare native the draft is
//     remembered in a module-level in-memory store so accidental navigation
//     away + back within a session does not discard a long draft (the web
//     across-reload persistence has no bare-native analogue and degrades to
//     session memory).
//   - navigator.clipboard.writeText -> getClipboardWriter(): feature-detected
//     (present on react-native-web, absent on bare native); when unavailable
//     handleCopy surfaces the explicit copyUnavailable message, mirroring the
//     web no-clipboard branch.
//
// CSS vars / Tailwind map to tokens: --text-secondary -> textSecondary,
// --text-muted -> textMuted, --border-subtle -> colors.border, text-cyan-300
// -> colors.accent, text-emerald-300 -> colors.success, text-amber-300 ->
// colors.warning, font-mono -> the platform monospace family. No DOM-only
// modules, HTML elements, Recharts, Leaflet, or web UI components are imported
// — only react, react-native primitives, the ported native AINLGrafanaPanel,
// and the existing apps/native AppText / AppButton / GlassPanel / theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '../../../../components/ui/AppButton';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import {
  AINLGrafanaPanel,
  type GrafanaPanelDraft,
} from '../../../components/ai/AINLGrafanaPanel';

// GRAFANA_PANEL_DRAFT_KEY is the canonical storage key for the editor draft.
// Persisted across navigation so a user editing a long JSON envelope doesn't
// lose progress on accidental reload.
const GRAFANA_PANEL_DRAFT_KEY = 'ai.grafanaPanel.draft';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so
// every t('key','English') call keeps its default copy. This page uses no
// interpolation.
function useNativeTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Native-safe usePageTitle: feature-detects document.title (present on
// react-native-web, absent on bare native) and restores it on unmount.
function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as { document?: { title?: string } }).document;
    if (doc && typeof doc.title === 'string') {
      const prev = doc.title;
      doc.title = `${title} — TeslaSync`;
      return () => {
        doc.title = prev;
      };
    }
    return undefined;
  }, [title]);
}

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// Feature-detects Web Storage (present on react-native-web, absent on bare
// native). Returns null on bare native so the caller falls back to in-memory
// session memory.
function getWebStorage(): WebStorageLike | null {
  const ls = (globalThis as { localStorage?: WebStorageLike }).localStorage;
  if (
    ls &&
    typeof ls.getItem === 'function' &&
    typeof ls.setItem === 'function' &&
    typeof ls.removeItem === 'function'
  ) {
    return ls;
  }
  return null;
}

// On bare native the draft is remembered here for the lifetime of the app so
// accidental navigation away + back does not discard a long edit (the web
// across-reload persistence has no bare-native analogue).
const memoryDraftStore = new Map<string, string>();

function loadPersistedJson(): string {
  const ls = getWebStorage();
  if (ls) {
    try {
      return ls.getItem(GRAFANA_PANEL_DRAFT_KEY) ?? '';
    } catch {
      return '';
    }
  }
  return memoryDraftStore.get(GRAFANA_PANEL_DRAFT_KEY) ?? '';
}

function persistJson(value: string): void {
  const ls = getWebStorage();
  if (ls) {
    try {
      if (value) {
        ls.setItem(GRAFANA_PANEL_DRAFT_KEY, value);
      } else {
        ls.removeItem(GRAFANA_PANEL_DRAFT_KEY);
      }
    } catch {
      // ignore — quota exceeded etc.
    }
    return;
  }
  if (value) {
    memoryDraftStore.set(GRAFANA_PANEL_DRAFT_KEY, value);
  } else {
    memoryDraftStore.delete(GRAFANA_PANEL_DRAFT_KEY);
  }
}

type ClipboardWriter = (value: string) => Promise<boolean>;

// Feature-detects the browser clipboard (available under react-native-web,
// absent on bare native). Returns null when no writer exists so handleCopy can
// surface the explicit copyUnavailable message instead of failing silently.
function getClipboardWriter(): ClipboardWriter | null {
  const nav = (
    globalThis as {
      navigator?: {
        clipboard?: { writeText?: (value: string) => Promise<void> };
      };
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  const writeText = clipboard?.writeText;
  if (typeof writeText !== 'function') {
    return null;
  }
  return async (value: string) => {
    try {
      await writeText.call(clipboard, value);
      return true;
    } catch {
      return false;
    }
  };
}

// CuratedPanelType / CuratedDatasourceType / CuratedTable mirror the Go-side
// AINLGrafanaPanel*Entry shapes. The catalogs are duplicated here (instead of
// fetched via an API hook) because they are install-wide-static and no API
// hook exists for them today.
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
  {
    name: 'timeseries',
    description: 'time-series chart (default for any time-vs-value query)',
  },
  {
    name: 'stat',
    description:
      'single-value big-number stat panel (latest sample of one metric)',
  },
  { name: 'gauge', description: 'single-value gauge with min/max bounds' },
  { name: 'table', description: 'tabular result of an SQL/PromQL query' },
  { name: 'barchart', description: 'categorical bar chart' },
  {
    name: 'heatmap',
    description: 'two-dimensional heatmap (e.g. histograms over time)',
  },
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
      {
        name: 'vehicle_id',
        type: 'bigint',
        description: 'vehicle this drive belongs to',
      },
      {
        name: 'started_at',
        type: 'timestamptz',
        description: 'drive start UTC',
      },
      { name: 'ended_at', type: 'timestamptz', description: 'drive end UTC' },
      {
        name: 'distance_m',
        type: 'double precision',
        description: 'distance meters (SI)',
      },
      {
        name: 'duration_s',
        type: 'double precision',
        description: 'duration seconds (SI)',
      },
      {
        name: 'energy_used_wh',
        type: 'double precision',
        description: 'energy watt-hours (SI)',
      },
      {
        name: 'regen_wh',
        type: 'double precision',
        description: 'regen watt-hours',
      },
      {
        name: 'avg_speed_mps',
        type: 'double precision',
        description: 'avg speed m/s (SI)',
      },
      {
        name: 'max_speed_mps',
        type: 'double precision',
        description: 'max speed m/s',
      },
    ],
  },
  {
    name: 'charging_sessions',
    description: 'Per-charge aggregates for completed charging sessions',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      {
        name: 'vehicle_id',
        type: 'bigint',
        description: 'vehicle being charged',
      },
      {
        name: 'started_at',
        type: 'timestamptz',
        description: 'session start UTC',
      },
      { name: 'ended_at', type: 'timestamptz', description: 'session end UTC' },
      {
        name: 'energy_added_wh',
        type: 'double precision',
        description: 'energy added watt-hours (SI)',
      },
      {
        name: 'cost_cents',
        type: 'bigint',
        description: 'session cost in user-currency cents',
      },
      {
        name: 'charger_kind',
        type: 'text',
        description: 'home, supercharger, third_party',
      },
      {
        name: 'max_power_w',
        type: 'double precision',
        description: 'peak power watts',
      },
    ],
  },
  {
    name: 'vehicles',
    description: 'Vehicle metadata',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      { name: 'vin', type: 'text', description: 'Tesla VIN (PII)' },
      {
        name: 'display_name',
        type: 'text',
        description: 'user-chosen display name (PII)',
      },
      { name: 'model', type: 'text', description: 'model code' },
      { name: 'color', type: 'text', description: 'exterior color slug' },
    ],
  },
  {
    name: 'alerts',
    description: 'User-defined alerts that have fired',
    columns: [
      { name: 'id', type: 'bigint', description: 'primary key' },
      {
        name: 'vehicle_id',
        type: 'bigint',
        description: 'vehicle the alert fired for',
      },
      {
        name: 'alert_rule_id',
        type: 'bigint',
        description: 'alert rule that fired',
      },
      {
        name: 'fired_at',
        type: 'timestamptz',
        description: 'fire timestamp UTC',
      },
      { name: 'level', type: 'text', description: 'info, warn, critical' },
    ],
  },
  {
    name: 'signal_log_view',
    description: 'Telemetry signal history exposed as a stable view',
    columns: [
      {
        name: 'vehicle_id',
        type: 'bigint',
        description: 'vehicle the signal belongs to',
      },
      {
        name: 'signal_name',
        type: 'text',
        description: 'canonical signal name',
      },
      { name: 'ts', type: 'timestamptz', description: 'sample timestamp UTC' },
      {
        name: 'num_value',
        type: 'double precision',
        description: 'numeric value (SI), null if non-numeric',
      },
      {
        name: 'str_value',
        type: 'text',
        description: 'string value, null if numeric',
      },
    ],
  },
];

// PanelTitle stands in for the web @/components/ui PanelTitle typography role.
function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <AppText style={styles.panelTitle} weight="semibold">
      {children}
    </AppText>
  );
}

export default function GrafanaPanelPage() {
  const t = useNativeTranslation();
  usePageTitle(t('powerGrafana.title', 'Grafana Panel Builder'));

  const [panelJson, setPanelJson] = useState<string>(() => loadPersistedJson());
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Persist the JSON editor contents so a long edit survives a navigation away
  // + back.
  useEffect(() => {
    persistJson(panelJson);
  }, [panelJson]);

  const handleApplyAiDraft = useCallback((draft: GrafanaPanelDraft) => {
    // Render the full panel envelope as pretty-printed JSON so the user pastes
    // a Grafana-ready document rather than a wire-format blob. The user can
    // still edit it before copying.
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
    const writer = getClipboardWriter();
    if (!writer) {
      setStatusMessage(
        t(
          'powerGrafana.editor.copyUnavailable',
          'Clipboard access is not available in this browser. Select the text manually and copy with Ctrl+C / Cmd+C.',
        ),
      );
      return;
    }
    const ok = await writer(trimmed);
    if (ok) {
      setStatusMessage(
        t(
          'powerGrafana.editor.copySuccess',
          'Copied. Paste the JSON into your Grafana dashboard editor (Add panel → Edit JSON).',
        ),
      );
    } else {
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
    () =>
      [...CURATED_DATASOURCE_TYPES].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [],
  );
  const sortedTables = useMemo(
    () => [...CURATED_TABLES].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const canCopy = panelJson.trim().length > 0;

  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}
      testID="power-grafana-panel-builder-root"
    >
      <AppText variant="title" weight="bold">
        {t('powerGrafana.title', 'Grafana Panel Builder')}
      </AppText>

      <AppText style={styles.intro} tone="secondary">
        {t(
          'powerGrafana.intro',
          'Build a Grafana panel JSON envelope against the curated panel-builder catalog below. The browser does not push the panel to Grafana; copy your JSON into your existing Grafana dashboard editor.',
        )}
      </AppText>

      <AINLGrafanaPanel onApply={handleApplyAiDraft} />

      <GlassPanel style={styles.panel}>
        <PanelTitle>
          {t('powerGrafana.editor.title', 'Manual panel JSON editor')}
        </PanelTitle>
        <TextInput
          accessibilityLabel={t(
            'powerGrafana.editor.label',
            'Grafana panel JSON editor',
          )}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          numberOfLines={12}
          onChangeText={setPanelJson}
          placeholder={t(
            'powerGrafana.editor.placeholder',
            '{\n  "title": "Drives per day",\n  "type": "timeseries",\n  "datasource": { "type": "postgres", "uid": "tesla-postgres" },\n  "targets": [],\n  "grid_pos": { "x": 0, "y": 0, "w": 12, "h": 8 }\n}',
          )}
          placeholderTextColor={colors.textMuted}
          spellCheck={false}
          style={styles.textarea}
          textAlignVertical="top"
          value={panelJson}
        />
        <View style={styles.buttonRow}>
          <AppButton
            disabled={!canCopy}
            label={t('powerGrafana.editor.copy', 'Copy to clipboard')}
            onPress={() => {
              void handleCopy();
            }}
            variant="primary"
          />
          <AppButton
            disabled={!canCopy}
            label={t('powerGrafana.editor.clear', 'Clear')}
            onPress={handleClear}
            variant="ghost"
          />
          {statusMessage ? (
            <AppText
              accessibilityLiveRegion="polite"
              style={styles.statusMessage}
            >
              {statusMessage}
            </AppText>
          ) : null}
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <PanelTitle>
          {t('powerGrafana.panelTypes.title', 'Curated panel types')}
        </PanelTitle>
        <AppText style={styles.panelIntro} tone="secondary">
          {t(
            'powerGrafana.panelTypes.intro',
            'These are the panel types the curated catalog exposes. The Helix natural-language drafter refuses any panel type outside this list.',
          )}
        </AppText>
        <View style={styles.cardGrid}>
          {sortedPanelTypes.map(entry => (
            <View key={entry.name} style={styles.gridCard}>
              <AppText style={styles.monoName}>{entry.name}</AppText>
              <AppText
                style={styles.itemDescription}
                tone="secondary"
                variant="caption"
              >
                {entry.description}
              </AppText>
            </View>
          ))}
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <PanelTitle>
          {t('powerGrafana.datasourceTypes.title', 'Curated datasource types')}
        </PanelTitle>
        <AppText style={styles.panelIntro} tone="secondary">
          {t(
            'powerGrafana.datasourceTypes.intro',
            'These are the datasource types the curated catalog exposes, with their canonical UIDs. The Helix natural-language drafter refuses any datasource type outside this list.',
          )}
        </AppText>
        <View style={styles.stack}>
          {sortedDatasourceTypes.map(entry => (
            <View key={entry.name} style={styles.rowCard}>
              <AppText style={styles.monoName}>
                {entry.name}
                <AppText style={styles.monoSeparator}>{' · '}</AppText>
                <AppText style={styles.monoUid}>uid={entry.uid}</AppText>
              </AppText>
              <AppText
                style={styles.itemDescription}
                tone="secondary"
                variant="caption"
              >
                {entry.description}
              </AppText>
            </View>
          ))}
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panel}>
        <PanelTitle>
          {t(
            'powerGrafana.tables.title',
            'Curated table catalog (postgres targets)',
          )}
        </PanelTitle>
        <AppText style={styles.panelIntro} tone="secondary">
          {t(
            'powerGrafana.tables.intro',
            'These tables are the only tables the curated catalog exposes for postgres-target rawSql. The Helix natural-language drafter refuses any postgres query referencing tables outside this list.',
          )}
        </AppText>
        <View style={styles.tableStack}>
          {sortedTables.map(table => (
            <View key={table.name} style={styles.tableCard}>
              <AppText style={styles.tableName}>{table.name}</AppText>
              <AppText style={styles.itemDescription} tone="secondary">
                {table.description}
              </AppText>
              <View style={styles.columnGrid}>
                {table.columns.map(col => (
                  <AppText
                    key={col.name}
                    style={styles.columnLine}
                    tone="secondary"
                    variant="caption"
                  >
                    <AppText style={styles.columnName} variant="caption">
                      {col.name}
                    </AppText>
                    <AppText style={styles.monoSeparator} variant="caption">
                      {' · '}
                    </AppText>
                    <AppText tone="secondary" variant="caption">
                      {col.type}
                    </AppText>
                    <AppText style={styles.monoSeparator} variant="caption">
                      {' — '}
                    </AppText>
                    <AppText tone="secondary" variant="caption">
                      {col.description}
                    </AppText>
                  </AppText>
                ))}
              </View>
            </View>
          ))}
        </View>
      </GlassPanel>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  panelIntro: {
    fontSize: 14,
    lineHeight: 20,
  },
  textarea: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 13,
    lineHeight: 18,
    minHeight: 240,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusMessage: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 20,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stack: {
    gap: spacing.sm,
  },
  gridCard: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 220,
    padding: spacing.md,
  },
  rowCard: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  monoName: {
    color: colors.accent,
    fontFamily: MONO_FONT,
    fontSize: 14,
    lineHeight: 18,
  },
  monoSeparator: {
    color: colors.textMuted,
  },
  monoUid: {
    color: colors.success,
    fontFamily: MONO_FONT,
  },
  itemDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  tableStack: {
    gap: spacing.lg,
  },
  tableCard: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  tableName: {
    color: colors.accent,
    fontFamily: MONO_FONT,
    fontSize: 15,
    lineHeight: 20,
  },
  columnGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  columnLine: {
    flexBasis: '47%',
    flexGrow: 1,
    fontSize: 12,
    lineHeight: 16,
    minWidth: 220,
  },
  columnName: {
    color: colors.success,
    fontFamily: MONO_FONT,
  },
});
