// Native parity port of web/src/features/power-user/pages/SqlPlaygroundPage.tsx.
//
// The baseline UI is a manual SQL textarea, curated schema catalog viewer,
// and Apply target. The optional AI drafter (AINLSqlPlayground) is rendered
// alongside via withAiFeature, so it is absent in off-mode and propose-only
// in on-mode. The user must explicitly click Apply to editor to copy the
// LLM proposal into the textarea, then explicitly click Run.
//
// This page does NOT expose a SQL execution endpoint. The Run button shows a
// deterministic help message instructing the user to copy the query into a
// read-only DB tool. A future typed read-only execution endpoint can replace
// that handler without changing this page's structure or the AI drafter's
// contract.
//
// State persistence: SQL textarea contents are persisted under the canonical
// 'ai.sqlPlayground.draft' key.
//
// Visual layout:
//   - Page header (title + AI drafter section conditionally mounted via
//     withAiFeature inside AINLSqlPlayground)
//   - Manual SQL editor (Textarea + Run button + Clear button)
//   - Curated schema catalog viewer (a table-by-table list of column metadata)
//
// ADR-015 alignment is identical to the web module: the manual SQL editor +
// curated catalog always render regardless of the AI toggle (I3 baseline),
// the AI drafter section is absent in off-mode (I5 hidden UI), and the page
// never auto-executes the LLM proposal (I8 propose-only).
//
// Native-safe substitutions (documented in the parity sidecar):
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback) returns the English fallback (the parity bundle ships no
//     i18n runtime), preserving every key + copy string verbatim at the call
//     site.
//   • usePageTitle(...) -> a native no-op hook (RN has no document.title); the
//     call site and its translated title key are preserved.
//   • window.localStorage (loadPersistedSql/persistSql, L141-161) -> a
//     module-level in-memory store keyed by SQL_PLAYGROUND_DRAFT_KEY. It
//     survives navigation away + back within the running app session (the web
//     persistence intent) but NOT a full app restart — the explicit native
//     "unavailable" boundary for durable persistence (no AsyncStorage is wired
//     into the parity layer yet).
//   • The shared web <Stack>/<GlassPanel>/<PageTitle>/<PanelTitle>/<Textarea>/
//     <Button> -> the ported native GlassPanel/AppButton plus inlined native
//     PageTitle/PanelTitle (AppText) and a multiline TextInput (Textarea). The
//     web <div className="space-y-6 p-6"> page shell -> a ScrollView.
//   • The catalog's responsive `sm:grid-cols-2` column grid collapses to a
//     single mobile-first column on native.
// The already-ported native AINLSqlPlayground (+ ReadonlySQLDraft) is reused
// verbatim from ../../../components/ai/AINLSqlPlayground. No DOM elements,
// react-i18next, lucide-react, framer-motion, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AINLSqlPlayground,
  type ReadonlySQLDraft,
} from '../../../components/ai/AINLSqlPlayground';
import {AppButton} from '../../../../components/ui/AppButton';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

// Cross-platform monospace stack for the curated catalog table/column names
// (web `font-mono`).
const MONO_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/* ------------------------------------------------------------------ */
/*  Native stand-ins for react-i18next + usePageTitle                  */
/* ------------------------------------------------------------------ */

type TFunc = (key: string, fallback: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships
// no i18n runtime, so `t` returns the English fallback while preserving every
// key at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((_key, fallback) => fallback, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

// Canonical localStorage key for the SQL draft. Persisted across navigation
// so a user typing a long query doesn't lose progress on accidental reload.
const SQL_PLAYGROUND_DRAFT_KEY = 'ai.sqlPlayground.draft';

// CuratedTable is a static descriptor mirroring the Go-side
// AINLSQLSchemaCatalogEntry shape declared in
// internal/api/ai_nl_sql_playground_handler.go's
// nlSqlPlaygroundCuratedCatalog. We duplicate the catalog here
// (instead of fetching it via a new API hook) for two reasons:
//
//   1. The catalog is install-wide-static — it does not vary per
//      user / per vehicle / per tenant. Fetching it would add a
//      round-trip without any actual dynamism.
//   2. A future dynamic catalog can swap the static array for a hook response
//      without churning this page's render tree.
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

const CURATED_CATALOG: CuratedTable[] = [
  {
    name: 'drives',
    description: 'Per-trip aggregates for completed drives',
    columns: [
      {name: 'id', type: 'bigint', description: 'primary key'},
      {
        name: 'vehicle_id',
        type: 'bigint',
        description: 'vehicle this drive belongs to',
      },
      {name: 'started_at', type: 'timestamptz', description: 'drive start UTC'},
      {name: 'ended_at', type: 'timestamptz', description: 'drive end UTC'},
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
      {name: 'id', type: 'bigint', description: 'primary key'},
      {name: 'vehicle_id', type: 'bigint', description: 'vehicle being charged'},
      {
        name: 'started_at',
        type: 'timestamptz',
        description: 'session start UTC',
      },
      {name: 'ended_at', type: 'timestamptz', description: 'session end UTC'},
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
      {name: 'id', type: 'bigint', description: 'primary key'},
      {name: 'vin', type: 'text', description: 'Tesla VIN (PII)'},
      {
        name: 'display_name',
        type: 'text',
        description: 'user-chosen display name (PII)',
      },
      {name: 'model', type: 'text', description: 'model code'},
      {name: 'color', type: 'text', description: 'exterior color slug'},
    ],
  },
  {
    name: 'alerts',
    description: 'User-defined alerts that have fired',
    columns: [
      {name: 'id', type: 'bigint', description: 'primary key'},
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
      {name: 'level', type: 'text', description: 'info, warn, critical'},
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
      {name: 'signal_name', type: 'text', description: 'canonical signal name'},
      {name: 'ts', type: 'timestamptz', description: 'sample timestamp UTC'},
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

// Native-safe replacement for the web window.localStorage persistence: a
// module-level store keyed by SQL_PLAYGROUND_DRAFT_KEY (see the header note).
const draftStore = new Map<string, string>();

function loadPersistedSql(): string {
  return draftStore.get(SQL_PLAYGROUND_DRAFT_KEY) ?? '';
}

function persistSql(value: string): void {
  if (value) {
    draftStore.set(SQL_PLAYGROUND_DRAFT_KEY, value);
  } else {
    draftStore.delete(SQL_PLAYGROUND_DRAFT_KEY);
  }
}

// Web PageTitle (Heading level="page" — xl/bold/primary).
function PageTitle({children}: {children: React.ReactNode}): React.ReactElement {
  return (
    <AppText style={styles.pageTitleText} weight="bold">
      {children}
    </AppText>
  );
}

// Web PanelTitle (Heading level="panel" — base/semibold/primary). Spacing below
// is handled by the surrounding Stack gap (the web call site adds no margin).
function PanelTitle({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <AppText style={styles.panelTitleText} weight="semibold">
      {children}
    </AppText>
  );
}

export default function SqlPlaygroundPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('powerSql.title', 'SQL Playground'));

  const [sql, setSql] = useState<string>(() => loadPersistedSql());
  const [runMessage, setRunMessage] = useState<string>('');

  // Persist the SQL textarea contents so a long query survives a navigation
  // away + back.
  useEffect(() => {
    persistSql(sql);
  }, [sql]);

  const handleApplyAiDraft = useCallback((draft: ReadonlySQLDraft) => {
    setSql(draft.sql);
    setRunMessage('');
  }, []);

  const handleClear = useCallback(() => {
    setSql('');
    setRunMessage('');
  }, []);

  const handleRun = useCallback(() => {
    const trimmed = sql.trim();
    if (!trimmed) {
      setRunMessage(
        t(
          'powerSql.editor.runEmpty',
          'Type or paste a SELECT/WITH query above before running.',
        ),
      );
      return;
    }
    // There is no backend SQL execution endpoint yet. Surface a deterministic
    // instruction directing the user to a read-only DB tool. A future typed
    // read-only execution endpoint can swap this branch for an actual fetch.
    setRunMessage(
      t(
        'powerSql.editor.runUnavailable',
        'Read-only execution from the browser is not enabled in this build. Copy the query into your preferred database client (psql, DBeaver, TablePlus) and run it there.',
      ),
    );
  }, [sql, t]);

  const sortedTables = useMemo(
    () => [...CURATED_CATALOG].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  const canRun = sql.trim().length > 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.screen}
      testID="power-sql-playground-root">
      <View style={styles.pageStack}>
        <PageTitle>{t('powerSql.title', 'SQL Playground')}</PageTitle>

        <AppText style={styles.intro} tone="secondary">
          {t(
            'powerSql.intro',
            'Write read-only SELECT or WITH queries against the curated schema catalog below. Queries do NOT execute from the browser; copy your query into your preferred database client.',
          )}
        </AppText>

        <AINLSqlPlayground onApply={handleApplyAiDraft} />

        <GlassPanel style={styles.panel}>
          <View style={styles.panelStack}>
            <PanelTitle>
              {t('powerSql.editor.title', 'Manual SQL editor')}
            </PanelTitle>
            <TextInput
              accessibilityLabel={t('powerSql.editor.label', 'SQL query editor')}
              multiline
              numberOfLines={10}
              onChangeText={setSql}
              placeholder={t(
                'powerSql.editor.placeholder',
                "SELECT COUNT(*) FROM drives WHERE started_at >= NOW() - INTERVAL '7 days'",
              )}
              placeholderTextColor={colors.textMuted}
              spellCheck={false}
              style={styles.editor}
              textAlignVertical="top"
              value={sql}
            />
            <View style={styles.buttonRow}>
              <AppButton
                disabled={!canRun}
                label={t('powerSql.editor.run', 'Run')}
                onPress={handleRun}
                variant="primary"
              />
              <AppButton
                disabled={!canRun}
                label={t('powerSql.editor.clear', 'Clear')}
                onPress={handleClear}
                variant="ghost"
              />
              {runMessage ? (
                <AppText
                  accessibilityLiveRegion="polite"
                  accessibilityRole="text"
                  style={styles.runMessage}
                  variant="caption">
                  {runMessage}
                </AppText>
              ) : null}
            </View>
          </View>
        </GlassPanel>

        <GlassPanel style={styles.panel}>
          <View style={styles.panelStack}>
            <PanelTitle>
              {t('powerSql.catalog.title', 'Curated schema catalog')}
            </PanelTitle>
            <AppText style={styles.intro} tone="secondary">
              {t(
                'powerSql.catalog.intro',
                'These tables are the only tables the curated catalog exposes. The Helix natural-language drafter refuses any query referencing tables outside this list.',
              )}
            </AppText>
            <View style={styles.catalogList}>
              {sortedTables.map(table => (
                <View key={table.name} style={styles.tableCard}>
                  <View style={styles.tableHeader}>
                    <AppText style={styles.tableName}>{table.name}</AppText>
                    <AppText style={styles.tableDescription} tone="secondary">
                      {table.description}
                    </AppText>
                  </View>
                  <View style={styles.columnGrid}>
                    {table.columns.map(col => (
                      <AppText
                        key={col.name}
                        style={styles.columnLine}
                        tone="secondary"
                        variant="caption">
                        <Text style={styles.columnName}>{col.name}</Text>
                        <Text style={styles.columnSep}> · </Text>
                        <Text style={styles.columnType}>{col.type}</Text>
                        <Text style={styles.columnSep}> — </Text>
                        <Text>{col.description}</Text>
                      </AppText>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
        </GlassPanel>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    padding: 24,
  },
  pageStack: {
    gap: 24,
  },
  pageTitleText: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  intro: {
    fontSize: 14,
    lineHeight: 20,
  },
  panel: {
    padding: spacing.lg,
  },
  panelStack: {
    gap: 16,
  },
  panelTitleText: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  editor: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  runMessage: {
    color: colors.warning,
    flexShrink: 1,
  },
  catalogList: {
    gap: 16,
  },
  tableCard: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
  },
  tableHeader: {
    gap: 4,
  },
  tableName: {
    color: colors.accent,
    fontFamily: MONO_FAMILY,
    fontSize: 16,
    lineHeight: 22,
  },
  tableDescription: {
    fontSize: 14,
    lineHeight: 20,
  },
  columnGrid: {
    gap: 4,
    marginTop: 12,
  },
  columnLine: {
    lineHeight: 18,
  },
  columnName: {
    color: colors.success,
    fontFamily: MONO_FAMILY,
  },
  columnSep: {
    color: colors.textMuted,
  },
  columnType: {
    color: colors.textSecondary,
  },
});
