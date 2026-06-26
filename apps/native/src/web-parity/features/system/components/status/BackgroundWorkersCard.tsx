/**
 * Native parity port of
 * web/src/features/system/components/status/BackgroundWorkersCard.tsx (282 lines).
 *
 * Operator-grade per-instance worker visibility. The `/system/workers` payload
 * may carry multiple rows per worker `name` when a worker is horizontally
 * scaled (one row per host); single-instance deployments emit one row per
 * worker. This card groups rows by `name` so the operator can see which worker
 * types are healthy overall (rollup chip per group), which specific instances
 * (host:port) are healthy vs degraded, the exact probe error when one fails,
 * and per-instance latency. No backend changes are required for the
 * single-instance path; `*_HOSTS` env vars surface the additional rows.
 *
 * Native-targeting decisions (no DOM, no react-router-dom, no lucide-react, no
 * Tailwind, no web UI kit):
 *   * react-router-dom <Link to="/api-logs"> -> a module-level navigation sink
 *     (backgroundWorkersNavigate / setBackgroundWorkersNavigator); the footer
 *     "API logs" action calls it with the same `/api-logs` path the web Link
 *     used. The native tree mounts no router here, so the default is a no-op a
 *     host can override.
 *   * lucide-react Activity / AlertTriangle / Boxes / Server -> the repo
 *     SemanticIcon glyph set resolved via getSemanticIconDefinition(...).glyph
 *     and rendered as text (the same way sibling native ports render small
 *     lucide glyphs): Activity->activity, AlertTriangle->warning,
 *     Boxes->package, Server->server.
 *   * Tailwind utility strings + CSS variables -> React Native StyleSheet using
 *     the shared design tokens; the per-severity dot / chip colours map onto the
 *     repo success/warning/danger token families.
 *   * `@/api/types` WorkersHealth / WorkerStatus -> the already-ported native
 *     web-parity api/types (identical shape).
 *
 * Line coverage: see the BackgroundWorkersCard.tsx.parity.json sidecar.
 */

import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { colors, spacing } from '../../../../../theme/tokens';
import type { WorkersHealth, WorkerStatus } from '../../../../api/types';

interface BackgroundWorkersCardProps {
  health: WorkersHealth | undefined;
}

type Severity = 'healthy' | 'degraded' | 'down' | 'unknown';

interface WorkerGroup {
  name: string;
  instances: WorkerStatus[];
  healthy: number;
  total: number;
  severity: Severity;
}

// The web footer used react-router's <Link to="/api-logs">. The native parity
// tree mounts no router here, so the tap defaults to a no-op a host can
// override; it is called with the same `/api-logs` path the web Link used.
type BackgroundWorkersNavigate = (to: string) => void;
let backgroundWorkersNavigate: BackgroundWorkersNavigate = () => {};

export function setBackgroundWorkersNavigator(
  fn: BackgroundWorkersNavigate,
): void {
  backgroundWorkersNavigate = fn;
}

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// lucide -> repo SemanticIcon glyph equivalents, resolved once at module scope.
// Boxes (group/container) -> package; Server -> server; AlertTriangle ->
// warning; Activity -> activity.
const BOXES_GLYPH = getSemanticIconDefinition('package').glyph;
const SERVER_GLYPH = getSemanticIconDefinition('server').glyph;
const ALERT_GLYPH = getSemanticIconDefinition('warning').glyph;
const ACTIVITY_GLYPH = getSemanticIconDefinition('activity').glyph;

function groupByName(workers: WorkerStatus[]): WorkerGroup[] {
  const groups = new Map<string, WorkerStatus[]>();
  for (const w of workers) {
    const list = groups.get(w.name);
    if (list) {
      list.push(w);
    } else {
      groups.set(w.name, [w]);
    }
  }
  const out: WorkerGroup[] = [];
  for (const [name, instances] of groups) {
    const healthy = instances.filter((i) => i.status === 'healthy').length;
    const total = instances.length;
    let severity: Severity;
    if (instances.every((i) => i.status === 'healthy')) severity = 'healthy';
    else if (instances.every((i) => i.status === 'down')) severity = 'down';
    else severity = 'degraded';
    out.push({ name, instances, healthy, total, severity });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

interface SeverityMeta {
  dotStyle: ViewStyle;
  chipStyle: ViewStyle;
  chipTextStyle: TextStyle;
  label: string;
}

function severityMeta(s: Severity): SeverityMeta {
  switch (s) {
    case 'healthy':
      return {
        dotStyle: dotStyles.healthy,
        chipStyle: chipStyles.healthy,
        chipTextStyle: chipTextStyles.healthy,
        label: 'all healthy',
      };
    case 'degraded':
      return {
        dotStyle: dotStyles.degraded,
        chipStyle: chipStyles.degraded,
        chipTextStyle: chipTextStyles.degraded,
        label: 'degraded',
      };
    case 'down':
      return {
        dotStyle: dotStyles.down,
        chipStyle: chipStyles.down,
        chipTextStyle: chipTextStyles.down,
        label: 'down',
      };
    case 'unknown':
    default:
      return {
        dotStyle: dotStyles.unknown,
        chipStyle: chipStyles.unknown,
        chipTextStyle: chipTextStyles.unknown,
        label: 'unknown',
      };
  }
}

function instanceMeta(status: WorkerStatus['status']): SeverityMeta {
  if (status === 'healthy') {
    return {
      dotStyle: dotStyles.healthy,
      chipStyle: chipStyles.healthy,
      chipTextStyle: chipTextStyles.healthy,
      label: 'healthy',
    };
  }
  if (status === 'unhealthy') {
    return {
      dotStyle: dotStyles.degraded,
      chipStyle: chipStyles.degraded,
      chipTextStyle: chipTextStyles.degraded,
      label: 'unhealthy',
    };
  }
  return {
    dotStyle: dotStyles.down,
    chipStyle: chipStyles.down,
    chipTextStyle: chipTextStyles.down,
    label: 'down',
  };
}

// Strip `http://` and trailing `/healthz` so the host column is readable
// without sacrificing the underlying detail (full URL stays on the row's
// accessibilityLabel, the native analogue of the web title= tooltip).
function shortHost(rawUrl: string): string {
  let s = rawUrl.replace(/^https?:\/\//, '');
  s = s.replace(/\/healthz\/?$/, '');
  return s;
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return `${Math.round(ms)} ms`;
}

export function BackgroundWorkersCard({ health }: BackgroundWorkersCardProps) {
  const workers: WorkerStatus[] = health?.workers ?? [];
  const groups = groupByName(workers);

  if (!health || workers.length === 0) {
    return (
      <View style={styles.root}>
        <View style={styles.emptyState}>
          <AppText style={styles.emptyText}>
            No background workers reporting. Ensure the notification, export, and
            automation worker processes are running and reachable on their
            configured ports.
          </AppText>
        </View>
      </View>
    );
  }

  const totalInstances = workers.length;
  const healthyInstances = workers.filter((w) => w.status === 'healthy').length;
  const groupCount = groups.length;
  const healthyGroups = groups.filter((g) => g.severity === 'healthy').length;
  const multiInstanceGroups = groups.filter((g) => g.total > 1).length;

  return (
    <View style={styles.root}>
      {/* Top-line summary — types vs. instances. The two-axis count is the key
          differentiator for horizontally-scaled deployments. */}
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <AppText style={styles.summaryLabel}>Worker types</AppText>
          <AppText style={styles.summaryValue}>
            {healthyGroups} of {groupCount} types
          </AppText>
        </View>
        <View style={styles.summaryItem}>
          <AppText style={styles.summaryLabel}>Instances</AppText>
          <AppText style={styles.summaryValue}>
            {healthyInstances} of {totalInstances} instances
          </AppText>
        </View>
        <View style={styles.summaryItem}>
          <AppText style={styles.summaryLabel}>Replicated</AppText>
          <AppText style={styles.summaryValue}>
            {multiInstanceGroups > 0
              ? `${multiInstanceGroups} of ${groupCount} type${
                  groupCount === 1 ? '' : 's'
                }`
              : 'single instance each'}
          </AppText>
        </View>
      </View>

      {/* Per-worker-name groups, each containing 1..N instance rows. */}
      <View style={styles.groupList}>
        {groups.map((g) => {
          const meta = severityMeta(g.severity);
          const isMulti = g.total > 1;
          return (
            <View key={g.name} style={styles.group}>
              {/* Group header */}
              <View style={styles.groupHeader}>
                <View
                  accessibilityLabel={`${g.name} status: ${meta.label}`}
                  style={[styles.groupDot, meta.dotStyle]}
                />
                <AppText style={styles.mutedGlyph}>{BOXES_GLYPH}</AppText>
                <AppText style={styles.groupName}>{g.name}</AppText>
                <View style={[styles.chip, meta.chipStyle]}>
                  <AppText style={[styles.chipText, meta.chipTextStyle]}>
                    {g.healthy} / {g.total} healthy
                  </AppText>
                </View>
                <AppText style={styles.groupCount}>
                  {isMulti ? `${g.total} instances` : '1 instance'}
                </AppText>
              </View>

              {/* Per-instance rows */}
              {g.instances.map((inst, idx) => {
                const cls = instanceMeta(inst.status);
                const host = shortHost(inst.host);
                return (
                  <View
                    key={`${inst.name}::${inst.host}`}
                    style={[
                      styles.instanceRow,
                      idx > 0 && styles.instanceDivider,
                    ]}>
                    <View style={styles.instanceMain}>
                      <View
                        accessibilityLabel={`instance status: ${cls.label}`}
                        style={[styles.instanceDot, cls.dotStyle]}
                      />
                      <AppText style={styles.mutedGlyphSm}>
                        {SERVER_GLYPH}
                      </AppText>
                      <AppText
                        accessibilityLabel={inst.host}
                        numberOfLines={1}
                        style={styles.host}>
                        {host}
                      </AppText>
                    </View>

                    <View style={styles.instanceMeta}>
                      <View style={[styles.chip, cls.chipStyle]}>
                        <AppText style={[styles.chipText, cls.chipTextStyle]}>
                          {cls.label}
                        </AppText>
                      </View>
                      <AppText style={styles.latency}>
                        {fmtLatency(inst.latency_ms)}
                      </AppText>
                    </View>

                    {inst.error ? (
                      <View style={styles.errorWrap}>
                        <View style={styles.errorBox}>
                          <AppText style={styles.errorGlyph}>
                            {ALERT_GLYPH}
                          </AppText>
                          <AppText style={styles.errorText}>
                            {inst.error}
                          </AppText>
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
      </View>

      {/* Footer guidance: explain how to scale, since most operators won't know
          the *_HOSTS env contract until the panel tells them. */}
      {multiInstanceGroups === 0 ? (
        <View style={styles.callout}>
          <AppText style={styles.calloutText}>
            Running multiple instances of a worker? Set{' '}
            <AppText style={styles.code}>NOTIFICATION_WORKER_HOSTS</AppText>,{' '}
            <AppText style={styles.code}>EXPORT_WORKER_HOSTS</AppText>, or{' '}
            <AppText style={styles.code}>AUTOMATION_WORKER_HOSTS</AppText> to a
            comma-separated list of hostnames. Each instance will then appear
            here with its own status and latency.
          </AppText>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="link"
          onPress={() => backgroundWorkersNavigate('/api-logs')}
          style={({ pressed }) => [
            styles.logsLink,
            pressed && styles.logsLinkPressed,
          ]}>
          <AppText style={styles.logsGlyph}>{ACTIVITY_GLYPH}</AppText>
          <AppText style={styles.logsText}>API logs</AppText>
        </Pressable>
      </View>
    </View>
  );
}

BackgroundWorkersCard.displayName = 'BackgroundWorkersCard';

const styles = StyleSheet.create({
  callout: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    padding: 10,
  },
  calloutText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipText: {
    fontSize: 11,
    lineHeight: 15,
  },
  code: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
  },
  emptyState: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    padding: 16,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  errorBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  errorGlyph: {
    color: colors.danger,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 1,
  },
  errorText: {
    color: colors.danger,
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
  errorWrap: {
    width: '100%',
  },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  group: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  groupCount: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginLeft: 'auto',
  },
  groupDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  groupHeader: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  groupList: {
    gap: spacing.md,
  },
  groupName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  host: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  instanceDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  instanceDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  instanceMain: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  instanceMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  instanceRow: {
    flexDirection: 'column',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  latency: {
    color: colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    lineHeight: 15,
    minWidth: 64,
    textAlign: 'right',
  },
  logsGlyph: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
    marginRight: 6,
  },
  logsLink: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  logsLinkPressed: {
    backgroundColor: colors.surfaceHover,
  },
  logsText: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  mutedGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 14,
  },
  mutedGlyphSm: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 13,
  },
  root: {
    gap: 16,
  },
  summary: {
    columnGap: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  summaryItem: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 120,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  summaryValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
  },
});

const dotStyles = StyleSheet.create<Record<Severity, ViewStyle>>({
  degraded: {
    backgroundColor: colors.warning,
  },
  down: {
    backgroundColor: colors.danger,
  },
  healthy: {
    backgroundColor: colors.success,
    elevation: 2,
    shadowColor: colors.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  unknown: {
    backgroundColor: colors.surfaceRaised,
  },
});

const chipStyles = StyleSheet.create<Record<Severity, ViewStyle>>({
  degraded: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  down: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  healthy: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  unknown: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const chipTextStyles = StyleSheet.create<Record<Severity, TextStyle>>({
  degraded: {
    color: colors.warning,
  },
  down: {
    color: colors.danger,
  },
  healthy: {
    color: colors.success,
  },
  unknown: {
    color: colors.textMuted,
  },
});
