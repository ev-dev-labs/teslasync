// Native parity port of web/src/features/admin/pages/SchemaDriftPage.tsx.
//
// Schema Drift admin observability surface. It renders the current schema
// fingerprint vs the recorded seed fingerprint, with deltas for
// table/column/index counts. Every behaviour from the web page is preserved
// one-for-one:
//   - `query = useSchemaDrift()` (GET /api/v1/admin/observability/schema-drift)
//     and `subsystemMissing = isApiError(query.error) && status === 503`.
//   - The four render branches: the 503 "subsystem unavailable" AlertBanner,
//     the DriftSummary panel (when data), the DriftDetails panel wrapped in a
//     SectionErrorBoundary (when data), and the no-fingerprint EmptyState
//     (when not loading, no data, not subsystem-missing).
//   - `isDrifted = data.is_different ?? drift.has_drift`, the warning/success
//     status Badge, the three delta StatCards (tables/columns/indexes), the two
//     FingerprintCards (current / expected-seed) with their per-card
//     tables/columns/indexes stats and optional "Captured {{when}}" caption, and
//     `formatDelta()`.
//   - Every i18n key keeps its English default string (intent preserved), and
//     the interpolated strings ({{current}}/{{expected}}/{{when}}) are
//     reproduced by the native t() shim.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) => fallback shim that reproduces i18next
//     `{{name}}` interpolation against the English fallback copy.
//   - lucide-react Fingerprint / AlertTriangle / CheckCircle2 -> shared
//     SemanticIcon glyphs 'fingerprint' / 'warning' / 'success'.
//   - @/components/layout PageContainer -> inline native PageContainer (title +
//     subtitle + query-driven freshness chip + error-boundary wrapper). The web
//     PageContainer's loading/error/empty branches are not used by this page
//     (it passes only title/subtitle/query and renders its own states inline),
//     so they are intentionally not reproduced.
//   - @/components/ui GlassPanel -> the existing native GlassPanel.
//   - @/components/ui Badge -> inline native Badge (label + optional icon).
//   - @/components/ui/Typography PanelTitle/Text/Caption -> AppText-based helpers
//     (panelTitle = 16px bold primary; Text bodySm = 12px primary; caption =
//     12px muted).
//   - @/components/data-display StatCard -> the already-ported native StatCard.
//   - @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
//   - @/components/feedback EmptyState/AlertBanner/SectionErrorBoundary -> inline
//     native EmptyState (icon + title + message), AlertBanner, and a class error
//     boundary.
//   - @/hooks/usePageTitle -> native-safe usePageTitle(): feature-detects
//     document.title (present on react-native-web, absent on bare native) and
//     writes "{title} — TeslaSync", mirroring the web titleStore format.
//   - @/lib/numberFormat fmtNumber -> inlined safeNumber + fmtNumber (locale
//     'en-US', precision 2 — the web default global locale/precision, since the
//     native parity layer does not wire useSettings into numberFormat), with a
//     toFixed fallback when Intl is unavailable on the host runtime.
//   - @/lib/dateFormat formatDateTime -> inlined byte-for-byte.
//   - @/lib/resilience isApiError -> imported from the ported web-parity client.
//
// CSS vars / Tailwind map to tokens: --text-primary/secondary/muted ->
// textPrimary/textSecondary/textMuted; --border-subtle -> border; --surface-2 ->
// surfaceRaised; amber/warning -> warning tokens; emerald/success -> success
// tokens; font-mono -> a Platform-selected monospace family. No DOM-only
// modules, HTML elements, Recharts, Leaflet, or web UI components are imported —
// only react, react-native primitives, the ported web-parity client + hook, the
// ported native StatCard, and existing apps/native SemanticIcon / AppText /
// GlassPanel / theme tokens.

import React, {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

import {isApiError} from '../../../api/client';
import {StatCard} from '../../../components/data-display';
import {useSchemaDrift} from '../../../api/hooks/useOperatorConfidence';

/* ─── shared types ────────────────────────────────────────────────────── */

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type BadgeSize = 'sm' | 'md' | 'lg';
type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

interface FreshnessQueryLike {
  isFetching?: boolean;
  isError?: boolean;
  isStale?: boolean;
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

/* ─── i18n shim ───────────────────────────────────────────────────────── */

// react-i18next useTranslation replacement: returns the English fallback that
// the source passes as the second argument, with i18next `{{name}}`
// interpolation applied against that fallback when an options bag is supplied.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ─── usePageTitle shim ───────────────────────────────────────────────── */

// Native-safe port of @/hooks/usePageTitle. document.title exists on
// react-native-web but not on bare native, so the write is feature-detected.
// Mirrors the web titleStore "{title} — TeslaSync" format and restores the
// previous title on unmount.
function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as {document?: {title?: string}}).document;
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

/* ─── number formatting (ported from @/lib/numberFormat) ──────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// fmtNumber with the web default global locale ('en-US') and precision (2),
// falling back to a fixed-precision string if Intl is unavailable on the host
// runtime. The native parity layer does not wire useSettings into numberFormat,
// so the default precision is preserved exactly.
function fmtNumber(v: unknown, decimals = 2): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/* ─── date formatting (ported from @/lib/dateFormat) ──────────────────── */

function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── typography helpers (Typography PanelTitle / Text / Caption) ─────── */

function PanelTitle({children}: {children: ReactNode}) {
  return (
    <AppText style={styles.panelTitle} weight="bold">
      {children}
    </AppText>
  );
}

// Text level="bodySm" -> 12px primary; the source overrides the colour to
// --text-primary via className, so the default secondary tone is not used here.
function Text({children, style}: {children: ReactNode; style?: TextStyle}) {
  return (
    <AppText style={style} variant="caption">
      {children}
    </AppText>
  );
}

function Caption({children}: {children: ReactNode}) {
  return (
    <AppText tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

/* ─── Badge (web @/components/ui Badge) ───────────────────────────────── */

function Badge({
  label,
  variant = 'neutral',
  size = 'md',
  icon,
}: {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: SemanticIconName;
}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant], badgeSizeStyles[size]]}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="sm" style={styles.badgeIcon} />
      ) : null}
      <AppText
        style={[badgeTextStyles[variant], size === 'lg' ? styles.badgeTextLg : styles.badgeTextSm]}
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ─── FadeIn (web @/components/motion FadeIn) ─────────────────────────── */

function FadeIn({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

/* ─── EmptyState (web @/components/feedback EmptyState) ───────────────── */

function EmptyState({
  icon,
  title,
  message,
}: {
  icon?: SemanticIconName;
  title: string;
  message: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      ) : null}
      <AppText style={styles.emptyTitle} weight="bold">
        {title}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── AlertBanner (web @/components/feedback AlertBanner) ─────────────── */

function AlertBanner({
  variant,
  title,
  children,
}: {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
}) {
  return (
    <View style={[styles.alert, alertSurfaceStyles[variant]]}>
      {title ? (
        <AppText style={[styles.alertTitle, alertTitleStyles[variant]]} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.alertBody} tone="secondary" variant="caption">
        {children}
      </AppText>
    </View>
  );
}

/* ─── SectionErrorBoundary (web @/components/feedback) ────────────────── */

class SectionErrorBoundary extends React.Component<
  {name?: string; fallback?: string; children: ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};

  static getDerivedStateFromError(): {hasError: boolean} {
    return {hasError: true};
  }

  componentDidCatch(): void {
    // Render-time crashes are contained to the wrapped section; the fallback
    // message replaces the subtree, mirroring the web SectionErrorBoundary.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <AppText style={styles.boundaryFallback} tone="danger" variant="caption">
          {this.props.fallback ?? 'Something went wrong.'}
        </AppText>
      );
    }
    return this.props.children;
  }
}

/* ─── PageContainer (web @/components/layout PageContainer) ───────────── */

function FreshnessChip({query}: {query: FreshnessQueryLike}) {
  const t = useNativeTranslation();
  if (query.isError) {
    return <Badge label={t('common.freshness.error', 'Error')} variant="danger" size="sm" />;
  }
  if (query.isFetching) {
    return <Badge label={t('common.freshness.updating', 'Updating…')} variant="info" size="sm" />;
  }
  if (query.isStale) {
    return <Badge label={t('common.freshness.stale', 'Stale')} variant="warning" size="sm" />;
  }
  return <Badge label={t('common.freshness.live', 'Live')} variant="success" size="sm" />;
}

function PageContainer({
  title,
  subtitle,
  query,
  children,
}: {
  title: string;
  subtitle?: string;
  query?: FreshnessQueryLike | null;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.page}
      keyboardShouldPersistTaps="handled">
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {query ? <FreshnessChip query={query} /> : null}
      </View>
      <SectionErrorBoundary name={title}>{children}</SectionErrorBoundary>
    </ScrollView>
  );
}

/* ─── page ────────────────────────────────────────────────────────────── */

export default function SchemaDriftPage() {
  const t = useNativeTranslation();
  usePageTitle(t('admin.schemaDrift.pageTitle', 'Schema Drift'));

  const query = useSchemaDrift();
  const subsystemMissing = isApiError(query.error) && query.error.status === 503;

  return (
    <PageContainer
      title={t('admin.schemaDrift.pageTitle', 'Schema Drift')}
      subtitle={t(
        'admin.schemaDrift.subtitle',
        'Current database schema fingerprint compared against the recorded seed. Drift indicates a migration ran without a seed refresh, or raw DDL bypassed the migration system.',
      )}
      query={query}>
      <FadeIn>
        <View style={styles.stack}>
          {subsystemMissing ? (
            <AlertBanner
              variant="warning"
              title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}>
              {t(
                'admin.schemaDrift.notConfigured',
                'The schema-drift subsystem is not configured on this deployment. Enable schema fingerprinting in config to populate this page.',
              )}
            </AlertBanner>
          ) : null}

          {query.data ? <DriftSummary data={query.data} /> : null}
          {query.data ? (
            <SectionErrorBoundary name="schema-drift-details">
              <DriftDetails data={query.data} />
            </SectionErrorBoundary>
          ) : null}

          {!query.isLoading && !query.data && !subsystemMissing ? (
            <GlassPanel style={styles.panel}>
              {/* no-action: the schema fingerprint is seeded by an API restart, which is an ops action not exposed in the UI */}
              <EmptyState
                icon="fingerprint"
                title={t('admin.schemaDrift.emptyTitle', 'No fingerprint available')}
                message={t(
                  'admin.schemaDrift.emptyMessage',
                  'The schema fingerprint has not been computed yet. Restart the API to capture a seed fingerprint.',
                )}
              />
            </GlassPanel>
          ) : null}
        </View>
      </FadeIn>
    </PageContainer>
  );
}

interface DriftSummaryProps {
  data: ReturnType<typeof useSchemaDrift>['data'] & object;
}

function DriftSummary({data}: DriftSummaryProps) {
  const t = useNativeTranslation();
  const drift = data.drift;
  const isDrifted = data.is_different ?? drift.has_drift;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.summaryHeader}>
        <PanelTitle>{t('admin.schemaDrift.statusTitle', 'Drift status')}</PanelTitle>
        <Badge
          variant={isDrifted ? 'warning' : 'success'}
          icon={isDrifted ? 'warning' : 'success'}
          label={
            isDrifted
              ? t('admin.schemaDrift.statusDrifted', 'Drift detected')
              : t('admin.schemaDrift.statusClean', 'No drift')
          }
        />
      </View>
      <View style={styles.statGrid}>
        <StatCard
          label={t('admin.schemaDrift.tableDelta', 'Tables Δ')}
          value={formatDelta(drift.table_count_delta)}
          sublabel={t('admin.schemaDrift.tableSub', '{{current}} current · {{expected}} expected', {
            current: fmtNumber(drift.current.table_count),
            expected: fmtNumber(drift.expected.table_count),
          })}
        />
        <StatCard
          label={t('admin.schemaDrift.columnDelta', 'Columns Δ')}
          value={formatDelta(drift.column_count_delta)}
          sublabel={t('admin.schemaDrift.columnSub', '{{current}} current · {{expected}} expected', {
            current: fmtNumber(drift.current.column_count),
            expected: fmtNumber(drift.expected.column_count),
          })}
        />
        <StatCard
          label={t('admin.schemaDrift.indexDelta', 'Indexes Δ')}
          value={formatDelta(drift.index_count_delta)}
          sublabel={t('admin.schemaDrift.indexSub', '{{current}} current · {{expected}} expected', {
            current: fmtNumber(drift.current.index_count),
            expected: fmtNumber(drift.expected.index_count),
          })}
        />
      </View>
    </GlassPanel>
  );
}

function DriftDetails({data}: DriftSummaryProps) {
  const t = useNativeTranslation();
  const drift = data.drift;

  return (
    <GlassPanel style={styles.panel}>
      <PanelTitle>{t('admin.schemaDrift.fingerprintTitle', 'Fingerprints')}</PanelTitle>
      <View style={styles.fingerprintGrid}>
        <FingerprintCard
          title={t('admin.schemaDrift.fingerprintCurrent', 'Current')}
          sha256={drift.current.sha256}
          tableCount={drift.current.table_count}
          columnCount={drift.current.column_count}
          indexCount={drift.current.index_count}
        />
        <FingerprintCard
          title={t('admin.schemaDrift.fingerprintExpected', 'Expected (seed)')}
          sha256={drift.expected.sha256}
          tableCount={drift.expected.table_count}
          columnCount={drift.expected.column_count}
          indexCount={drift.expected.index_count}
          generatedAt={drift.expected_generated_at ?? null}
        />
      </View>
    </GlassPanel>
  );
}

interface FingerprintCardProps {
  title: string;
  sha256: string;
  tableCount: number;
  columnCount: number;
  indexCount: number;
  generatedAt?: string | null;
}

function FingerprintCard({
  title,
  sha256,
  tableCount,
  columnCount,
  indexCount,
  generatedAt,
}: FingerprintCardProps) {
  const t = useNativeTranslation();
  return (
    <View style={styles.fingerprintCard}>
      <Text style={styles.fingerprintTitle}>{title}</Text>
      <AppText style={styles.fingerprintHash} tone="muted" variant="caption">
        {sha256 || '—'}
      </AppText>
      <View style={styles.fingerprintStats}>
        <FingerprintStat label={t('admin.schemaDrift.tables', 'Tables')} value={tableCount} />
        <FingerprintStat label={t('admin.schemaDrift.columns', 'Columns')} value={columnCount} />
        <FingerprintStat label={t('admin.schemaDrift.indexes', 'Indexes')} value={indexCount} />
      </View>
      {generatedAt ? (
        <Caption>
          {t('admin.schemaDrift.generatedAt', 'Captured {{when}}', {
            when: formatDateTime(generatedAt),
          })}
        </Caption>
      ) : null}
    </View>
  );
}

function FingerprintStat({label, value}: {label: string; value: number}) {
  return (
    <View style={styles.fingerprintStat}>
      <AppText style={styles.fingerprintStatValue} weight="semibold">
        {fmtNumber(value)}
      </AppText>
      <Caption>{label}</Caption>
    </View>
  );
}

function formatDelta(delta: number): string {
  if (delta === 0) {
    return '0';
  }
  return delta > 0 ? `+${fmtNumber(delta)}` : fmtNumber(delta);
}

/* ─── styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  stack: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statGrid: {
    gap: spacing.md,
  },
  fingerprintGrid: {
    gap: spacing.lg,
  },
  fingerprintCard: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
  },
  fingerprintTitle: {
    color: colors.textPrimary,
    fontWeight: '500',
  },
  fingerprintHash: {
    fontFamily: MONO_FONT,
  },
  fingerprintStats: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fingerprintStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  fingerprintStatValue: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
  },
  badgeIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
  },
  badgeTextSm: {
    fontSize: 11,
    lineHeight: 16,
  },
  badgeTextLg: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  emptyMessage: {
    textAlign: 'center',
    maxWidth: 360,
  },
  alert: {
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
  },
  alertTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  alertBody: {
    color: colors.textSecondary,
  },
  boundaryFallback: {
    paddingVertical: spacing.md,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
});

const badgeSizeStyles = StyleSheet.create<Record<BadgeSize, ViewStyle>>({
  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  md: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  lg: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {color: colors.accent},
  success: {color: colors.success},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
  neutral: {color: colors.textSecondary},
});

const alertSurfaceStyles = StyleSheet.create<Record<AlertVariant, ViewStyle>>({
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
});

const alertTitleStyles = StyleSheet.create<Record<AlertVariant, TextStyle>>({
  info: {color: colors.accent},
  success: {color: colors.success},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
});
