// DiagnosticPage — native parity port of
// web/src/features/system/pages/DiagnosticPage.tsx.
//
// Operator-facing self-test wizard. A single button posts to
// `POST /system/diagnostic` (via the native useRunDiagnostic mutation hook) and
// renders the structured report as a list of cards (one per check) plus an
// overall hero badge. The report can be shared as JSON ("Copy report") or as a
// .txt body ("Download .txt"). We intentionally do NOT auto-run on mount — the
// endpoint fans out concurrent probes and is rate-limited (20/min/IP) on the
// backend, so surprise auto-runs would burn budget for accidental visitors. The
// no-auto-run behavior, every state name, the i18n keys, and the diagnostic
// endpoint contract are preserved verbatim.
//
// Native adaptations vs. the web source (behavior/state/keys/intent kept):
//   - react-i18next `useTranslation` -> a native-safe t(key, default?, options?)
//     fallback. Because react-native has no i18next resource bundle, the en.json
//     `diagnostic.*` subtree is embedded here verbatim so the rendered English
//     (and {{ms}}/{{when}}/{{count}}/{{ts}} interpolation + the checkCount
//     plural) matches exactly what the web app displays; every key from the web
//     source is preserved as the first argument.
//   - `@/components/layout` PageContainer/Stack -> an inline RN PageScaffold
//     (ScrollView header: title/subtitle/actions) + a vertically-gapped View.
//   - `@/components/ui` Badge/Button/CopyButton/GlassPanel + `@/components/ui/
//     Typography` Heading/Text/Caption/MetricLabel -> the canonical native
//     GlassPanel + AppText, plus inline native Badge and Button. The web
//     CopyButton copies report JSON to the clipboard; react-native has no
//     clipboard module wired in this build, so copy is represented by the native
//     Share sheet (Share.share of the same report JSON) — the same primitive the
//     sibling LiveLogsPage uses for its download. The `withToast` confirmation is
//     subsumed by the OS share affordance.
//   - `@/components/feedback` EmptyState/Spinner -> an inline RN EmptyState and an
//     ActivityIndicator-based spinner panel.
//   - `@/components/motion` FadeIn (framer-motion) -> an inline reduced-motion
//     aware Animated FadeIn; StaggerContainer/StaggerItem -> the already-converted
//     native parity StaggerContainer (which wraps each child in a staggered
//     entrance), so the per-check stagger intent is preserved.
//   - lucide-react icons (Activity/AlertTriangle/CheckCircle2/Download/PlayCircle/
//     RefreshCw/ShieldAlert/XCircle) -> SemanticIcon glyphs (lucide is browser
//     only).
//   - `@/hooks/usePageTitle` (writes document.title) -> a native-safe no-op that
//     preserves the call site + argument.
//   - `@/hooks/useDateFormat` `formatDateTime` -> an inline native-safe
//     formatDateTime (locale-aware toLocaleString) for the "Generated {{when}}"
//     label.
//   - the web `handleDownload` Blob + `<a download>` + URL.createObjectURL (all
//     DOM-only) -> Share.share of the same report text with the same
//     downloadFilename({{ts}}) stamp; the filename i18n key is preserved.
//
// No DOM/react-router/react-i18next/lucide/Recharts/Leaflet/framer-motion/
// old-web-UI import reaches the native output — only react, react-native
// primitives, the canonical AppText/GlassPanel/SemanticIcon + theme tokens, the
// native parity StaggerContainer, the native useSystemDiagnostic hook, and the
// shared API types.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { StaggerContainer } from '../../../components/motion/StaggerContainer';
import {
  formatDiagnosticReportText,
  useRunDiagnostic,
} from '../../../api/hooks/useSystemDiagnostic';
import type {
  DiagnosticCheck,
  DiagnosticCheckStatus,
  DiagnosticOverallStatus,
  DiagnosticReport,
} from '../../../../api/types';

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────
//
// The web app renders the en.json `diagnostic.*` resource bundle (the inline
// source defaults are dead fallbacks that never fire because the keys exist).
// To match the web UI exactly, that subtree is embedded verbatim. `t` resolves
// the embedded value first, then the call-site default, then the key; it
// interpolates {{name}} placeholders and selects the `_other` plural form when
// an interpolation `count` is not exactly 1 (mirroring i18next).

type TranslationValues = Record<string, string | number>;

const DIAGNOSTIC_EN: Record<string, string> = {
  'diagnostic.title': 'System diagnostic',
  'diagnostic.subtitle':
    "Run an aggregated self-test against the database, MQTT broker, Redis, Tesla API, and resilience monitors. Use this when telemetry is missing, charge sessions don't appear, or notifications stop firing.",
  'diagnostic.run': 'Run diagnostic',
  'diagnostic.running': 'Running diagnostic…',
  'diagnostic.rerun': 'Re-run diagnostic',
  'diagnostic.lastRun': 'Generated {{when}}',
  'diagnostic.noReport':
    'No diagnostic has been run in this session yet. Click "Run diagnostic" to probe every dependency.',
  'diagnostic.errorTitle': 'Diagnostic failed to run',
  'diagnostic.errorBody':
    'The diagnostic endpoint returned an error. Check API logs and try again.',
  'diagnostic.checkCount': '{{count}} check',
  'diagnostic.checkCount_other': '{{count}} checks',
  'diagnostic.duration': '{{ms}}ms',
  'diagnostic.remediationLabel': 'Remediation',
  'diagnostic.copyReport': 'Copy report',
  'diagnostic.copyReportSuccess': 'Diagnostic report copied to clipboard',
  'diagnostic.copyReportError':
    'Could not copy to clipboard. Use Download instead.',
  'diagnostic.downloadReport': 'Download .txt',
  'diagnostic.filename': 'teslasync-diagnostic-{{ts}}.txt',
  'diagnostic.overall.ok': 'All systems healthy',
  'diagnostic.overall.degraded': 'Degraded — some checks need attention',
  'diagnostic.overall.down': 'One or more checks failed',
  'diagnostic.status.ok': 'OK',
  'diagnostic.status.warn': 'Warning',
  'diagnostic.status.fail': 'Fail',
};

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}

type NativeTFunction = (
  key: string,
  defaultOrValues?: string | TranslationValues,
  maybeValues?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key, defaultOrValues, maybeValues) => {
    const defaultValue =
      typeof defaultOrValues === 'string' ? defaultOrValues : undefined;
    const values =
      typeof defaultOrValues === 'string' ? maybeValues : defaultOrValues;

    let lookupKey = key;
    if (values && typeof values.count === 'number' && values.count !== 1) {
      const pluralKey = `${key}_other`;
      if (DIAGNOSTIC_EN[pluralKey] != null) {
        lookupKey = pluralKey;
      }
    }

    const template = DIAGNOSTIC_EN[lookupKey] ?? defaultValue ?? key;
    return interpolate(template, values);
  }, []);
}

// ── Native-safe usePageTitle (web @/hooks/usePageTitle) ──────────────────────

/**
 * Web `usePageTitle` writes `"{title} — TeslaSync"` to `document.title`. React
 * Native has no browser tab / document title, so this is a no-op that preserves
 * the call site and argument.
 */
function usePageTitle(title: string): void {
  useEffect(() => {
    // React Native has no document.title to write; intentionally a no-op. The
    // `title` dependency mirrors the web hook so it re-runs on title changes.
  }, [title]);
}

// ── Native-safe formatDateTime (web @/hooks/useDateFormat formatDateTime) ────

/** "Apr 4, 2026, 2:30 AM"; the raw value on a bad timestamp, '—' when empty. */
function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return typeof value === 'string' ? value : '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ── helpers (ported from the web source) ─────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'danger';

function statusBadgeVariant(status: DiagnosticCheckStatus): BadgeVariant {
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
  variant: BadgeVariant;
  icon: SemanticIconName;
} {
  switch (status) {
    case 'ok':
      return { variant: 'success', icon: 'success' };
    case 'degraded':
      return { variant: 'warning', icon: 'warning' };
    case 'down':
    default:
      return { variant: 'danger', icon: 'securityAlert' };
  }
}

function statusIcon(status: DiagnosticCheckStatus): SemanticIconName {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warn':
      return 'warning';
    case 'fail':
    default:
      return 'error';
  }
}

function downloadFilename(reportTs: string, template: string): string {
  // Replace `{{ts}}` with a filesystem-safe slug. Use the report's
  // generated_at when present so re-running and saving twice never collides.
  // Falls back to "now" if the report had a bad timestamp.
  const d = new Date(reportTs);
  const stamp = (Number.isNaN(d.getTime()) ? new Date() : d)
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
  return template.replace('{{ts}}', stamp);
}

// ── Inline FadeIn (web @/components/motion FadeIn — framer-motion) ────────────

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

// ── Inline Badge (web @/components/ui Badge) ─────────────────────────────────

function Badge({
  children,
  variant,
  size = 'md',
}: {
  children: ReactNode;
  variant: BadgeVariant;
  size?: 'md' | 'lg';
}): React.ReactElement {
  return (
    <View
      style={[
        styles.badge,
        size === 'lg' && styles.badgeLg,
        badgeVariantStyles[variant],
      ]}
    >
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold"
      >
        {children}
      </AppText>
    </View>
  );
}

// ── Inline Button (web @/components/ui Button) ───────────────────────────────

function Button({
  label,
  glyph,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  testID,
}: {
  label: string;
  glyph?: SemanticIconName;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.buttonPrimary : styles.buttonSecondary,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.background : colors.accent}
          size="small"
          style={styles.buttonIcon}
        />
      ) : glyph ? (
        <SemanticIcon
          decorative
          name={glyph}
          size="sm"
          style={styles.buttonIcon}
        />
      ) : null}
      <AppText
        style={
          variant === 'primary'
            ? styles.buttonPrimaryText
            : styles.buttonSecondaryText
        }
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

// ── Inline EmptyState (web @/components/feedback EmptyState) ──────────────────

function EmptyState({
  glyph,
  title,
  message,
  actionLabel,
  onAction,
}: {
  glyph: SemanticIconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <SemanticIcon decorative name={glyph} size="lg" />
      <AppText style={styles.emptyTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <Button
          glyph="play"
          label={actionLabel}
          onPress={onAction}
          variant="primary"
        />
      ) : null}
    </View>
  );
}

// ── components (web CheckCard / OverallHero) ─────────────────────────────────

function CheckCard({
  check,
  t,
}: {
  check: DiagnosticCheck;
  t: NativeTFunction;
}): React.ReactElement {
  const variant = statusBadgeVariant(check.status);
  return (
    <GlassPanel
      style={styles.checkCard}
      testID={`diagnostic-check-${check.id}`}
    >
      <View style={styles.checkRow}>
        <View style={styles.checkMain}>
          <SemanticIcon decorative name={statusIcon(check.status)} size="md" />
          <View style={styles.checkBody}>
            <AppText style={styles.checkName} weight="semibold">
              {check.name}
            </AppText>
            <AppText style={styles.checkId} tone="muted" variant="caption">
              {check.id}
            </AppText>
            <AppText
              style={styles.checkDetail}
              tone="secondary"
              variant="caption"
            >
              {check.detail}
            </AppText>
            {check.remediation ? (
              <View style={styles.remediationBox}>
                <AppText
                  style={styles.remediationLabel}
                  tone="muted"
                  variant="caption"
                  weight="semibold"
                >
                  {t('diagnostic.remediationLabel', 'Remediation')}
                </AppText>
                <AppText
                  style={styles.checkDetail}
                  tone="secondary"
                  variant="caption"
                >
                  {check.remediation}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.checkSide}>
          <Badge variant={variant}>
            {t(`diagnostic.status.${check.status}`, check.status.toUpperCase())}
          </Badge>
          <AppText style={styles.checkId} tone="muted" variant="caption">
            {t('diagnostic.duration', { ms: check.duration_ms })}
          </AppText>
        </View>
      </View>
    </GlassPanel>
  );
}

function OverallHero({
  report,
  t,
}: {
  report: DiagnosticReport;
  t: NativeTFunction;
}): React.ReactElement {
  const { variant, icon } = overallTone(report.overall_status);
  return (
    <GlassPanel style={styles.heroPanel} testID="diagnostic-overall">
      <View style={styles.heroRow}>
        <View style={styles.heroLeft}>
          <SemanticIcon decorative name={icon} size="lg" />
          <View style={styles.heroText}>
            <AppText style={styles.heroTitle} variant="title" weight="bold">
              {t(
                `diagnostic.overall.${report.overall_status}`,
                report.overall_status,
              )}
            </AppText>
            <AppText style={styles.heroCaption} tone="muted" variant="caption">
              {t('diagnostic.lastRun', {
                when: formatDateTime(report.generated_at),
              })}
            </AppText>
          </View>
        </View>
        <Badge size="lg" variant={variant}>
          {t('diagnostic.checkCount', { count: report.checks.length })}
        </Badge>
      </View>
    </GlassPanel>
  );
}

// ── Page scaffold (web @/components/layout PageContainer) ─────────────────────

function PageScaffold({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}
    >
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="display" weight="bold">
            {title}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  );
}

// ── page (web DiagnosticPage) ────────────────────────────────────────────────

export default function DiagnosticPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  usePageTitle(t('diagnostic.title', 'System diagnostic'));
  const runDiagnostic = useRunDiagnostic();
  const [latestError, setLatestError] = useState<Error | null>(null);

  const report = runDiagnostic.data;
  const isRunning = runDiagnostic.isPending;

  const handleRun = useCallback(() => {
    setLatestError(null);
    runDiagnostic.mutate(undefined, {
      onError: e => {
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

  // Web CopyButton copies report JSON to the clipboard; native has no clipboard
  // module wired in this build, so the JSON is offered through the share sheet.
  const handleCopy = useCallback(() => {
    if (!reportJson) {
      return;
    }
    void Share.share({ message: reportJson }).catch(() => undefined);
  }, [reportJson]);

  const handleDownload = useCallback(() => {
    if (!report) {
      return;
    }
    const filename = downloadFilename(
      report.generated_at,
      t('diagnostic.filename', { ts: '{{ts}}' }),
    );
    // Web wrote a Blob + <a download>; react-native has no DOM filesystem, so
    // the report text is exported through the native share sheet instead. The
    // share sheet's own affordance subsumes the web copyReportSuccess toast.
    void Share.share({ message: reportText, title: filename }).catch(
      () => undefined,
    );
  }, [report, reportText, t]);

  const runButton = (
    <Button
      disabled={isRunning}
      glyph={report ? 'refresh' : 'play'}
      label={
        isRunning
          ? t('diagnostic.running', 'Running diagnostic…')
          : report
          ? t('diagnostic.rerun', 'Re-run diagnostic')
          : t('diagnostic.run', 'Run diagnostic')
      }
      loading={isRunning}
      onPress={handleRun}
      testID="diagnostic-run-button"
      variant="primary"
    />
  );

  return (
    <PageScaffold
      actions={runButton}
      subtitle={t(
        'diagnostic.subtitle',
        'Run an aggregated self-test against the database, MQTT broker, Redis, Tesla API, and resilience monitors.',
      )}
      title={t('diagnostic.title', 'System diagnostic')}
    >
      <FadeIn>
        <View style={styles.stack}>
          {latestError ? (
            <GlassPanel style={styles.errorPanel} testID="diagnostic-error">
              <View style={styles.errorRow}>
                <SemanticIcon decorative name="securityAlert" size="md" />
                <View style={styles.errorBody}>
                  <AppText style={styles.errorTitle} weight="semibold">
                    {t('diagnostic.errorTitle', 'Diagnostic failed to run')}
                  </AppText>
                  <AppText
                    style={styles.errorMessage}
                    tone="secondary"
                    variant="caption"
                  >
                    {latestError.message ||
                      t(
                        'diagnostic.errorBody',
                        'The diagnostic endpoint returned an error. Check API logs and try again.',
                      )}
                  </AppText>
                </View>
              </View>
            </GlassPanel>
          ) : null}

          {report ? <OverallHero report={report} t={t} /> : null}

          {report ? (
            <View style={styles.actionsRow} testID="diagnostic-actions">
              <Button
                glyph="copy"
                label={t('diagnostic.copyReport', 'Copy report')}
                onPress={handleCopy}
                testID="diagnostic-copy-button"
                variant="secondary"
              />
              <Button
                glyph="download"
                label={t('diagnostic.downloadReport', 'Download .txt')}
                onPress={handleDownload}
                testID="diagnostic-download-button"
                variant="secondary"
              />
            </View>
          ) : null}

          {report ? (
            <StaggerContainer style={styles.stack}>
              {report.checks.map(c => (
                <CheckCard check={c} key={c.id} t={t} />
              ))}
            </StaggerContainer>
          ) : isRunning ? (
            <GlassPanel style={styles.spinnerPanel}>
              <ActivityIndicator color={colors.accent} size="large" />
              <AppText
                style={styles.spinnerLabel}
                tone="muted"
                variant="caption"
              >
                {t('diagnostic.running', 'Running diagnostic…')}
              </AppText>
            </GlassPanel>
          ) : (
            <GlassPanel style={styles.emptyPanel}>
              <EmptyState
                actionLabel={t('diagnostic.run', 'Run diagnostic')}
                glyph="activity"
                message={t(
                  'diagnostic.noReport',
                  'No diagnostic has been run in this session yet. Click "Run diagnostic" to probe every dependency.',
                )}
                onAction={handleRun}
                title={t('diagnostic.title', 'System diagnostic')}
              />
            </GlassPanel>
          )}
        </View>
      </FadeIn>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeLg: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonIcon: {
    marginRight: spacing.xs,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonSecondaryText: {
    color: colors.textPrimary,
  },
  checkBody: {
    flex: 1,
    gap: spacing.xs,
  },
  checkCard: {
    padding: spacing.md,
  },
  checkDetail: {
    color: colors.textSecondary,
  },
  checkId: {
    color: colors.textMuted,
  },
  checkMain: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  checkName: {
    color: colors.textPrimary,
  },
  checkRow: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  checkSide: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  emptyMessage: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  emptyPanel: {
    padding: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  errorBody: {
    flex: 1,
    gap: spacing.xs,
  },
  errorMessage: {
    color: colors.textSecondary,
  },
  errorPanel: {
    borderColor: colors.dangerBorder,
    padding: spacing.md,
  },
  errorRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  errorTitle: {
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  heroCaption: {
    color: colors.textMuted,
  },
  heroLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  heroPanel: {
    padding: spacing.lg,
  },
  heroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  heroText: {
    flex: 1,
    gap: spacing.xs,
  },
  heroTitle: {
    color: colors.textPrimary,
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageHeaderText: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    color: colors.textMuted,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  remediationBox: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  remediationLabel: {
    color: colors.textMuted,
  },
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  spinnerLabel: {
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  spinnerPanel: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  stack: {
    gap: spacing.lg,
  },
});

const badgeVariantStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  danger: {
    color: colors.danger,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
