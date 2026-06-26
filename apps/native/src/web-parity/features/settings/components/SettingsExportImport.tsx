// Native parity port of web/src/features/settings/components/SettingsExportImport.tsx.
//
// `<SettingsExportImport>` is the "Backup & Restore" card on the Settings page.
// It drives two flows that the web version renders inside a single GlassPanel:
//
//   1. Export — a single button that fetches `/settings/export`, drops the JSON
//      into the user's downloads folder, and surfaces a toast confirming the
//      section counts.
//   2. Import — a file picker / drag-drop intake. On parse the SPA validates
//      `schema_version` locally (early reject), then runs a dry-run preview
//      (POST `/settings/import { dry_run: true }`) and renders the per-section
//      {added, updated, skipped} summary. The Apply button reissues the same
//      payload with `dry_run=false`; the shared `request()` client transparently
//      triggers the step-up reauth flow because the route is gated by RequireSudo.
//
// The whole panel never throws: parse errors render an inline error notice plus
// a "Change file" affordance; Apply errors keep the dry-run preview visible so
// the user can retry without re-uploading.
//
// The web version composes the shared GlassPanel/IconBox/Button/Heading/Text/
// ErrorText/HelperText/Code (`@/components/ui`), the <Spinner>
// (`@/components/feedback`), <FadeIn> (`@/components/motion`), the lucide SVGs
// (Database/Download/Upload/FileJson/AlertTriangle), `@/lib/numberFormat` fmtInt,
// the in-house useToast queue, react-i18next (`useTranslation('settings')`), the
// `@/api/client` isApiError/SudoCanceledError, the `@/api/hooks/useSettingsBackup`
// mutations + downloadSettingsBundle, and the `@/lib/settingsImportSchema`
// validate/summarise helpers. React Native has none of the DOM-bound pieces
// (no <div>/<section>/<h2>/<p>/<span>/<ul>/<li>, no `<input type="file">`, no
// HTML5 drag-and-drop DragEvent, no `File.text()`, no Blob/URL.createObjectURL/
// document anchor, no Tailwind/CSS-vars, no lucide SVGs, no react-i18next
// provider), so this self-contained port reproduces the same behavioural +
// visual contract with RN primitives + the existing native theme:
//   - GlassPanel is the already-ported native bordered surface; FadeIn renders
//     its children statically (the established native entrance idiom).
//   - The lucide Database/Download/Upload/FileJson/AlertTriangle SVGs become
//     compact unicode glyphs (the native "no SVG icons" idiom).
//   - The shared <Button> variants become a reusable inline <ActionButton>
//     (primary, with `loading`/`disabled`/optional leading glyph) + <GhostButton>.
//   - <Heading>/<Text>/<HelperText>/<ErrorText>/<Code> resolve to <AppText>
//     styles against the native theme tokens; <Spinner> -> <ActivityIndicator>.
//   - The SectionDiffList <ul>/<li> become <View> rows; the <Code> chip becomes a
//     bordered monospace AppText.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next `useTranslation('settings')` -> a native
//     `useSettingsTranslation()` returning each call's English defaultValue with
//     `{{var}}` interpolation. Every i18n key + fallback is preserved verbatim.
//   - useToast -> React Native Alert.alert(title, message) (the established
//     native toast primitive, see useToast below); the success/info call sites
//     are preserved.
//   - The browser file intake is UNAVAILABLE on native: `<input type="file">`,
//     HTML5 drag-and-drop (onDrop/onDragOver/onDragLeave DragEvent handlers),
//     and `File.text()` have no React Native analog and no document-picker module
//     is bundled in this app. The full intake -> validate -> dry-run -> preview
//     -> apply pipeline is preserved intact in `ingestFile(file)` and reached
//     through an injectable `importFileSource` prop (a native picker adapter can
//     be supplied later / by tests). With no source wired, the dropzone surfaces
//     an explicit "file import unavailable" notice. The web `dragActive` highlight
//     intent is preserved by mapping it onto the dropzone's press-in/press-out
//     state.
//   - `downloadSettingsBundle` is browser-only (Blob + URL.createObjectURL +
//     anchor) and the native hook throws `SettingsBundleDownloadUnavailableError`.
//     The export still fetches the bundle over the network; the unavailable
//     save-as is caught and surfaced as an explicit "bundle ready" notice built
//     from `createSettingsBundleExportPayload`, instead of a silent failure.
//   - `validateSettingsBundle`, `summariseImportResult`,
//     `SETTINGS_BUNDLE_SECTION_KEYS`, and `fmtInt` are ported verbatim because
//     the native `useSettingsBackup` exports the hooks/types but not the schema
//     helpers, and `@/lib/numberFormat` is not yet ported.
//   - Tailwind utilities + CSS custom properties (var(--text-*)/var(--border-*),
//     border-neon-cyan, bg-tesla-red/5, text-rose-300) resolve to StyleSheet
//     styles against the native theme tokens; the responsive layout renders as a
//     single stacked column (the phone breakpoint).
//
// No DOM, lucide-react, Recharts, Leaflet, framer-motion, or old web UI
// components are imported.

import React, {useCallback, useId, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {isApiError, SudoCanceledError} from '../../../api/client';
import {
  createSettingsBundleExportPayload,
  downloadSettingsBundle,
  nativeSettingsBackupCapabilities,
  SettingsBundleDownloadUnavailableError,
  useApplyImport,
  useDryRunImport,
  useExportSettings,
  type SettingsBundle,
  type SettingsBundleExportPayload,
  type SettingsBundleSectionKey,
  type SettingsImportResult,
} from '../../../api/hooks/useSettingsBackup';

// ---------------------------------------------------------------------------
// Constants ported verbatim from the web source.
// ---------------------------------------------------------------------------

const MAX_IMPORT_FILE_BYTES = 1 << 20; // 1 MiB — matches backend MaxSettingsImportBodyBytes

/** The schema_version this build emits + accepts (web settingsImportSchema). */
const SETTINGS_BUNDLE_SCHEMA_VERSION = 1;

/** Section keys carried in the bundle, in render order (web settingsImportSchema). */
const SETTINGS_BUNDLE_SECTION_KEYS: readonly SettingsBundleSectionKey[] = [
  'settings',
  'alert_rules',
  'geofences',
  'quiet_hours',
];

// lucide affordances rendered as unicode glyphs (the native "no SVG icons"
// idiom — Database / Download / Upload / FileJson / AlertTriangle).
const DATABASE_GLYPH = '\uD83D\uDDC4'; // 🗄 Database
const DOWNLOAD_GLYPH = '\u2913'; // ⤓ Download
const UPLOAD_GLYPH = '\u2912'; // ⤒ Upload
const FILE_JSON_GLYPH = '\uD83D\uDCC4'; // 📄 FileJson
const ALERT_GLYPH = '\u26A0'; // ⚠ AlertTriangle

// Resolved palette. The web uses Tailwind tokens / CSS vars; native carries the
// literal references so the visual intent survives without Tailwind.
const ROSE_300 = '#fda4af'; // text-rose-300 (parse-error glyph)
const DROP_ACTIVE_BG = 'rgba(53, 213, 255, 0.06)'; // bg-neon-cyan/5
const DROP_ACTIVE_BORDER = colors.accent; // border-neon-cyan
const DROP_IDLE_BG = 'rgba(255, 255, 255, 0.03)'; // bg-[var(--surface-2)]
const DROP_IDLE_BORDER = 'rgba(255, 255, 255, 0.12)'; // border-[var(--border-subtle)]
const HAIRLINE = 'rgba(255, 255, 255, 0.08)'; // border-[var(--border-subtle)]
const MONO_FONT = Platform.select({ios: 'Courier', default: 'monospace'});

type ImportStage = 'idle' | 'parsing' | 'preview' | 'applied';

interface PendingImport {
  bundle: SettingsBundle;
  filename: string;
  sizeBytes: number;
}

/**
 * Native-safe `File` analog. The web reads `file.size`, `file.name`, and
 * `await file.text()`; this is the minimal shape `ingestFile` needs so the
 * intake/validate/dry-run pipeline stays platform-agnostic. A native document
 * picker adapter (or a test) supplies it via the `importFileSource` prop.
 */
export interface ImportFileLike {
  name: string;
  size: number;
  text: () => Promise<string>;
}

/** Injectable native file-intake adapter. Returns null when the user cancels. */
export type ImportFilePicker = () => Promise<ImportFileLike | null>;

export interface SettingsExportImportProps {
  importFileSource?: ImportFilePicker;
}

// ---------------------------------------------------------------------------
// fmtInt — ported from web/src/lib/numberFormat.ts. Locale grouping is applied
// without depending on Intl (kept deterministic across native engines).
// ---------------------------------------------------------------------------

function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const rounded = Math.round(n);
  const negative = rounded < 0;
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

// ---------------------------------------------------------------------------
// validateSettingsBundle — ported verbatim from web/src/lib/settingsImportSchema.ts.
// Returns a normalised SettingsBundle on success or a string describing the
// first validation failure.
// ---------------------------------------------------------------------------

function validateSettingsBundle(input: unknown): SettingsBundle | string {
  if (input == null || typeof input !== 'object') {
    return 'Bundle must be a JSON object';
  }
  const obj = input as Record<string, unknown>;

  const version = obj.schema_version;
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1) {
    return 'schema_version must be a positive integer';
  }
  if (version > SETTINGS_BUNDLE_SCHEMA_VERSION) {
    return `schema_version ${version} is newer than this build supports (max ${SETTINGS_BUNDLE_SCHEMA_VERSION})`;
  }

  const exportedAt = obj.exported_at;
  if (typeof exportedAt !== 'string' || exportedAt.trim() === '') {
    return 'exported_at must be a non-empty ISO-8601 string';
  }

  const rawSections = obj.sections;
  if (rawSections == null || typeof rawSections !== 'object') {
    return 'sections must be a JSON object';
  }
  const sections = rawSections as Record<string, unknown>;

  for (const key of Object.keys(sections)) {
    if (!(SETTINGS_BUNDLE_SECTION_KEYS as readonly string[]).includes(key)) {
      return `Unknown section "${key}"`;
    }
  }

  if (sections.settings != null && typeof sections.settings !== 'object') {
    return 'sections.settings must be an object';
  }
  for (const k of ['alert_rules', 'geofences', 'quiet_hours'] as const) {
    if (sections[k] != null && !Array.isArray(sections[k])) {
      return `sections.${k} must be an array`;
    }
  }

  return {
    schema_version: version,
    exported_at: exportedAt,
    sections: {
      settings: sections.settings as Record<string, unknown> | undefined,
      alert_rules: sections.alert_rules as unknown[] | undefined,
      geofences: sections.geofences as unknown[] | undefined,
      quiet_hours: sections.quiet_hours as unknown[] | undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// summariseImportResult — ported verbatim from web/src/lib/settingsImportSchema.ts.
// ---------------------------------------------------------------------------

function summariseImportResult(result: SettingsImportResult): {
  added: number;
  updated: number;
  skipped: number;
  total: number;
} {
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const sec of Object.values(result.sections)) {
    if (sec == null) {
      continue;
    }
    added += sec.added;
    updated += sec.updated;
    skipped += sec.skipped;
  }
  return {added, updated, skipped, total: added + updated};
}

// ---------------------------------------------------------------------------
// react-i18next is not wired in native; this fallback returns each call's
// English defaultValue (web: useTranslation('settings')) and interpolates
// `{{var}}` placeholders.
// ---------------------------------------------------------------------------

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

function useSettingsTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }, []);
}

// ---------------------------------------------------------------------------
// useToast → React Native Alert.alert (the established native toast primitive).
// ---------------------------------------------------------------------------

interface ToastApi {
  success: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

function useToast(): ToastApi {
  return useMemo(
    () => ({
      success: (title: string, message?: string) => Alert.alert(title, message),
      info: (title: string, message?: string) => Alert.alert(title, message),
      error: (title: string, message?: string) => Alert.alert(title, message),
    }),
    [],
  );
}

// ---------------------------------------------------------------------------
// FadeIn — the web framer-motion entrance is a visual-only flourish with no
// behavioural contract; native renders children statically (the established
// Toggle/Checkbox/GeneralSettings idiom).
// ---------------------------------------------------------------------------

function FadeIn({children}: {children: React.ReactNode}): React.ReactElement {
  return <View>{children}</View>;
}

// ---------------------------------------------------------------------------
// IconBox — small accent-tinted rounded container (web IconBox color="cyan").
// ---------------------------------------------------------------------------

function IconBox({children}: {children: React.ReactNode}) {
  return <View style={styles.iconBox}>{children}</View>;
}

// ---------------------------------------------------------------------------
// ActionButton / GhostButton — the shared <Button> primary + ghost variants
// (with `loading`/`disabled` + optional leading glyph). The spinner reuses
// ActivityIndicator (web <Spinner>).
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  glyph,
  onPress,
  size = 'md',
  loading = false,
  disabled = false,
  testID,
}: {
  label: string;
  glyph?: string;
  onPress: () => void;
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const isDisabled = loading || disabled;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.primaryButton,
        size === 'sm' && styles.primaryButtonSm,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : glyph ? (
        <AppText
          accessible={false}
          allowFontScaling={false}
          style={styles.primaryButtonGlyph}>
          {glyph}
        </AppText>
      ) : null}
      <AppText style={styles.primaryButtonText} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function GhostButton({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.ghostButton,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      <AppText style={styles.ghostButtonText}>{label}</AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// SettingsExportImport
// ---------------------------------------------------------------------------

export function SettingsExportImport({
  importFileSource,
}: SettingsExportImportProps = {}) {
  const t = useSettingsTranslation();
  const toast = useToast();

  const exportMut = useExportSettings();
  const dryRunMut = useDryRunImport();
  const applyMut = useApplyImport();

  const [pending, setPending] = useState<PendingImport | null>(null);
  const [stage, setStage] = useState<ImportStage>('idle');
  const [parseError, setParseError] = useState<string | null>(null);
  const [previewResult, setPreviewResult] = useState<SettingsImportResult | null>(
    null,
  );
  const [appliedResult, setAppliedResult] = useState<SettingsImportResult | null>(
    null,
  );
  const [dragActive, setDragActive] = useState(false);
  const [exportPayload, setExportPayload] =
    useState<SettingsBundleExportPayload | null>(null);

  // Web binds this to the hidden <input id>; native carries it as the dropzone's
  // stable accessibility id so the intake element keeps a single identity.
  const fileInputId = useId();

  const summary = useMemo(
    () => (previewResult ? summariseImportResult(previewResult) : null),
    [previewResult],
  );

  const resetImport = useCallback(() => {
    setPending(null);
    setStage('idle');
    setParseError(null);
    setPreviewResult(null);
    setAppliedResult(null);
    // Web also clears fileInputRef.current.value; there is no DOM input here.
  }, []);

  const handleExport = useCallback(async () => {
    setExportPayload(null);
    try {
      const bundle = await exportMut.mutateAsync();
      try {
        downloadSettingsBundle(bundle);
        toast.success(
          t('backup.export.successTitle', 'Settings exported'),
          t('backup.export.successDetail', 'Saved to your downloads folder.'),
        );
      } catch (dlErr) {
        if (dlErr instanceof SettingsBundleDownloadUnavailableError) {
          // Save-as is browser-only; surface the ready bundle explicitly
          // instead of swallowing it.
          const payload = createSettingsBundleExportPayload(bundle);
          setExportPayload(payload);
          toast.info(
            t('backup.export.nativeReadyTitle', 'Settings bundle ready'),
            t(
              'backup.export.nativeUnavailableReason',
              nativeSettingsBackupCapabilities.unavailableReason,
            ),
          );
          return;
        }
        throw dlErr;
      }
    } catch {
      // useExportSettings already surfaces a toast via useMutationToast.
    }
  }, [exportMut, t, toast]);

  const ingestFile = useCallback(
    async (file: ImportFileLike) => {
      resetImport();
      setStage('parsing');

      if (file.size > MAX_IMPORT_FILE_BYTES) {
        setStage('idle');
        setParseError(
          t('backup.import.errorTooLarge', 'File is too large (max 1 MB).'),
        );
        return;
      }

      let text: string;
      try {
        text = await file.text();
      } catch {
        setStage('idle');
        setParseError(t('backup.import.errorRead', 'Failed to read the file.'));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        setStage('idle');
        setParseError(
          t('backup.import.errorJson', 'File is not valid JSON: {{detail}}', {
            detail: err instanceof Error ? err.message : 'parse error',
          }),
        );
        return;
      }

      const validation = validateSettingsBundle(parsed);
      if (typeof validation === 'string') {
        setStage('idle');
        setParseError(validation);
        return;
      }

      const next: PendingImport = {
        bundle: validation,
        filename: file.name,
        sizeBytes: file.size,
      };
      setPending(next);

      try {
        const result = await dryRunMut.mutateAsync({bundle: validation});
        setPreviewResult(result);
        setStage('preview');
      } catch (err) {
        setStage('idle');
        setPending(null);
        setParseError(
          isApiError(err)
            ? err.message
            : err instanceof Error
              ? err.message
              : t('backup.import.errorPreview', 'Failed to preview import.'),
        );
      }
    },
    [dryRunMut, resetImport, t],
  );

  // The web `<input type="file">` change handler + the HTML5 drag-and-drop
  // handlers (onDrop/onDragOver/onDragLeave) are browser-only. Their intake
  // intent funnels through an injectable native picker; with none wired the
  // dropzone explains the unavailable state instead of silently doing nothing.
  const triggerFilePick = useCallback(async () => {
    if (!importFileSource) {
      toast.info(
        t('backup.import.nativeUnavailableTitle', 'File import unavailable'),
        t(
          'backup.import.nativeUnavailableDetail',
          'Importing a settings bundle needs a platform document picker, which is not bundled in this app yet.',
        ),
      );
      return;
    }
    let file: ImportFileLike | null;
    try {
      file = await importFileSource();
    } catch {
      setParseError(t('backup.import.errorRead', 'Failed to read the file.'));
      return;
    }
    if (file) {
      void ingestFile(file);
    }
  }, [importFileSource, ingestFile, t, toast]);

  const handleApply = useCallback(async () => {
    if (!pending) {
      return;
    }
    try {
      const result = await applyMut.mutateAsync({bundle: pending.bundle});
      setAppliedResult(result);
      setStage('applied');
      const applied = summariseImportResult(result);
      toast.success(
        t('backup.import.appliedTitle', 'Settings imported'),
        t(
          'backup.import.appliedDetail',
          '{{added}} added, {{updated}} updated, {{skipped}} skipped.',
          {
            added: applied.added,
            updated: applied.updated,
            skipped: applied.skipped,
          },
        ),
      );
    } catch (err) {
      if (err instanceof SudoCanceledError) {
        // User cancelled the step-up — treat as a non-error and keep the
        // dry-run preview visible so they can retry.
        return;
      }
      // useApplyImport already surfaces a toast via useMutationToast.
    }
  }, [applyMut, pending, t, toast]);

  const applyLabel = applyMut.isPending
    ? t('backup.import.applying', 'Applying…')
    : summary && summary.total > 0
      ? t('backup.import.applyCount', 'Apply {{count}} change(s)', {
          count: summary.total,
        })
      : t('backup.import.applyNoChanges', 'Nothing to apply');

  return (
    <FadeIn>
      <GlassPanel style={styles.panel} testID="settings-export-import">
        <View style={styles.stack}>
          <View style={styles.header}>
            <IconBox>
              <AppText
                accessible={false}
                allowFontScaling={false}
                style={styles.headerGlyph}>
                {DATABASE_GLYPH}
              </AppText>
            </IconBox>
            <View style={styles.headerText}>
              <AppText style={styles.title} weight="semibold">
                {t('backup.title', 'Backup & Restore')}
              </AppText>
              <AppText style={styles.subtitle}>
                {t(
                  'backup.subtitle',
                  'Export your TeslaSync configuration as a JSON file you can stash in a backup folder or git repo, and import it on a fresh install.',
                )}
              </AppText>
            </View>
          </View>

          {/* Export row */}
          <View style={styles.section}>
            <View style={styles.exportRow}>
              <View style={styles.exportText}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('backup.export.title', 'Export settings')}
                </AppText>
                <AppText style={styles.helperText}>
                  {t(
                    'backup.export.help',
                    'Includes general settings, alert rules, geofences, and your quiet-hours windows. Tesla credentials and notification-channel secrets are NEVER exported.',
                  )}
                </AppText>
              </View>
              <ActionButton
                label={
                  exportMut.isPending
                    ? t('backup.export.busy', 'Exporting…')
                    : t('backup.export.cta', 'Export JSON')
                }
                glyph={DOWNLOAD_GLYPH}
                loading={exportMut.isPending}
                onPress={handleExport}
                testID="settings-export-button"
              />
            </View>

            {exportPayload ? (
              <View style={styles.noticeBox} testID="settings-export-ready">
                <AppText style={styles.noticeTitle} weight="semibold">
                  {exportPayload.filename}
                </AppText>
                <AppText style={styles.helperText}>
                  {t(
                    'backup.export.nativeUnavailableReason',
                    nativeSettingsBackupCapabilities.unavailableReason,
                  )}
                </AppText>
              </View>
            ) : null}
          </View>

          {/* Import row */}
          <View style={styles.section}>
            <View style={styles.importHeader}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('backup.import.title', 'Import settings')}
              </AppText>
              <AppText style={styles.helperText}>
                {t(
                  'backup.import.help',
                  'Drop or pick a previously exported bundle. Existing items with the same name are updated; nothing is deleted.',
                )}
              </AppText>
            </View>

            {stage !== 'preview' && stage !== 'applied' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{disabled: stage === 'parsing'}}
                disabled={stage === 'parsing'}
                nativeID={fileInputId}
                onPress={triggerFilePick}
                onPressIn={() => setDragActive(true)}
                onPressOut={() => setDragActive(false)}
                style={[
                  styles.dropzone,
                  dragActive ? styles.dropzoneActive : styles.dropzoneIdle,
                  stage === 'parsing' && styles.buttonDisabled,
                ]}
                testID="settings-import-dropzone">
                <AppText
                  accessible={false}
                  allowFontScaling={false}
                  style={styles.dropGlyph}>
                  {FILE_JSON_GLYPH}
                </AppText>
                <AppText style={styles.dropPrompt}>
                  {t('backup.import.dropPrompt', 'Drag a JSON bundle here, or')}
                </AppText>
                <View style={styles.chooseAffordance} testID="settings-import-choose">
                  {stage === 'parsing' ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <AppText
                      accessible={false}
                      allowFontScaling={false}
                      style={styles.chooseGlyph}>
                      {UPLOAD_GLYPH}
                    </AppText>
                  )}
                  <AppText style={styles.chooseLabel} weight="semibold">
                    {stage === 'parsing'
                      ? t('backup.import.parsing', 'Reading…')
                      : t('backup.import.choose', 'Choose a file')}
                  </AppText>
                </View>
                {!importFileSource ? (
                  <AppText
                    style={styles.unavailableNote}
                    testID="settings-import-unavailable">
                    {t(
                      'backup.import.nativeUnavailableDetail',
                      'Importing a settings bundle needs a platform document picker, which is not bundled in this app yet.',
                    )}
                  </AppText>
                ) : null}
              </Pressable>
            ) : null}

            {parseError ? (
              <View style={styles.errorBox} testID="settings-import-error">
                <AppText
                  accessible={false}
                  allowFontScaling={false}
                  style={styles.errorGlyph}>
                  {ALERT_GLYPH}
                </AppText>
                <AppText style={styles.errorText}>{parseError}</AppText>
              </View>
            ) : null}

            {stage === 'preview' && pending && previewResult ? (
              <View style={styles.previewStack} testID="settings-import-preview">
                <View style={styles.previewHeaderRow}>
                  <View style={styles.previewHeaderText}>
                    <AppText style={styles.bodySm}>
                      {t(
                        'backup.import.previewHeader',
                        'Previewing {{name}} ({{size}} bytes)',
                        {
                          name: pending.filename,
                          size: fmtInt(pending.sizeBytes),
                        },
                      )}
                    </AppText>
                    {summary ? (
                      <AppText style={styles.helperText}>
                        {t(
                          'backup.import.summary',
                          '{{added}} added, {{updated}} updated, {{skipped}} unchanged',
                          {
                            added: summary.added,
                            updated: summary.updated,
                            skipped: summary.skipped,
                          },
                        )}
                      </AppText>
                    ) : null}
                  </View>
                  <GhostButton
                    label={t('backup.import.changeFile', 'Change file')}
                    onPress={resetImport}
                    testID="settings-import-change"
                  />
                </View>

                <SectionDiffList result={previewResult} />

                <View style={styles.previewActions}>
                  <GhostButton
                    label={t('backup.import.cancel', 'Cancel')}
                    onPress={resetImport}
                    disabled={applyMut.isPending}
                    testID="settings-import-cancel"
                  />
                  <ActionButton
                    label={applyLabel}
                    loading={applyMut.isPending}
                    disabled={
                      applyMut.isPending ||
                      (summary != null && summary.total === 0)
                    }
                    onPress={handleApply}
                    testID="settings-import-apply"
                  />
                </View>
              </View>
            ) : null}

            {stage === 'applied' && appliedResult ? (
              <View style={styles.previewStack} testID="settings-import-applied">
                <AppText style={styles.bodySm}>
                  {t('backup.import.appliedHeader', 'Import complete')}
                </AppText>
                <SectionDiffList result={appliedResult} />
                <View style={styles.appliedActions}>
                  <GhostButton
                    label={t('backup.import.done', 'Done')}
                    onPress={resetImport}
                    testID="settings-import-done"
                  />
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

SettingsExportImport.displayName = 'SettingsExportImport';

// ---------------------------------------------------------------------------
// SectionDiffList — the per-section {added, updated, skipped} diff rows (web
// <ul>/<li> + <Code> chip).
// ---------------------------------------------------------------------------

function SectionDiffList({result}: {result: SettingsImportResult}) {
  const t = useSettingsTranslation();
  const sectionLabels: Record<SettingsBundleSectionKey, string> = {
    settings: t('backup.section.settings', 'General settings'),
    alert_rules: t('backup.section.alertRules', 'Alert rules'),
    geofences: t('backup.section.geofences', 'Geofences'),
    quiet_hours: t('backup.section.quietHours', 'Quiet hours'),
  };
  const rows = SETTINGS_BUNDLE_SECTION_KEYS.map(key => ({
    key,
    label: sectionLabels[key],
    counts: result.sections[key],
  }));
  return (
    <View style={styles.diffList} testID="settings-import-section-list">
      {rows.map(row => (
        <View key={row.key} style={styles.diffRow}>
          <AppText style={styles.diffLabel}>{row.label}</AppText>
          {row.counts ? (
            <View style={styles.codeChip}>
              <AppText
                allowFontScaling={false}
                style={styles.codeText}>
                {`+${row.counts.added} ~${row.counts.updated} =${row.counts.skipped}`}
              </AppText>
            </View>
          ) : (
            <AppText style={styles.diffEmpty}>—</AppText>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  appliedActions: {
    alignItems: 'flex-end',
  },
  bodySm: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  chooseAffordance: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chooseGlyph: {
    color: colors.accent,
    fontSize: 15,
  },
  chooseLabel: {
    color: colors.accent,
    fontSize: 14,
  },
  codeChip: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  codeText: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
  diffEmpty: {
    color: colors.textMuted,
    fontSize: 13,
  },
  diffLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
  },
  diffList: {
    gap: 6,
  },
  diffRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  dropGlyph: {
    color: colors.textMuted,
    fontSize: 28,
  },
  dropPrompt: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  dropzone: {
    alignItems: 'center',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 2,
    padding: spacing.lg,
  },
  dropzoneActive: {
    backgroundColor: DROP_ACTIVE_BG,
    borderColor: DROP_ACTIVE_BORDER,
  },
  dropzoneIdle: {
    backgroundColor: DROP_IDLE_BG,
    borderColor: DROP_IDLE_BORDER,
  },
  errorBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorGlyph: {
    color: ROSE_300,
    fontSize: 15,
    marginTop: 1,
  },
  errorText: {
    color: colors.danger,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  exportRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  exportText: {
    flex: 1,
    gap: 4,
  },
  ghostButton: {
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  ghostButtonText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerGlyph: {
    color: colors.accent,
    fontSize: 20,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: 'rgba(53, 213, 255, 0.2)',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  importHeader: {
    gap: 4,
  },
  noticeBox: {
    backgroundColor: DROP_IDLE_BG,
    borderColor: HAIRLINE,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  noticeTitle: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  panel: {
    padding: spacing.lg,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  previewActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  previewHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  previewHeaderText: {
    flex: 1,
    gap: 2,
  },
  previewStack: {
    gap: spacing.md,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonGlyph: {
    color: colors.background,
    fontSize: 15,
  },
  primaryButtonSm: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.82,
  },
  section: {
    borderTopColor: HAIRLINE,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  stack: {
    gap: spacing.lg,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  unavailableNote: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});

export default SettingsExportImport;
