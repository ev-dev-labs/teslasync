// Native parity port of
// web/src/features/admin/components/RedisDiagnosticEmptyState.tsx.
//
// The web source replaces the legacy generic "no signals cached" EmptyState with
// a structured, actionable diagnostic banner for the Redis Signal Viewer. It
// branches — in a fixed precedence — on the upstream request error and on the
// `meta` block returned by GET /api/v1/dev-tools/redis-signals:
//   0.A  503 + /not available/      -> Redis cache wiring missing (danger)
//   0.B  502/503/504 + /unreachable|upstream/ -> Redis unreachable (danger)
//   0.C  any other typed ApiError   -> generic request failed (warning, interpolated)
//   0.D  networkError               -> cannot reach the API server (warning)
//   (!meta)                         -> legacy generic EmptyState fallback
//   1    mode === 'local'           -> L2 writes disabled (danger, cta)
//   2    L1>0 && L2===0             -> mirror failing (warning, interpolated, other-vehicles)
//   3    L1===0 && ttlSuspected     -> no recent telemetry (info, stale/absent body, other-vehicles)
//   4    fallthrough                -> both empty, give it a moment (neutral, other-vehicles)
// Error branches always win over meta branches. A secondary `useQuery`
// (['redis-signal-keys'], staleTime 30s) feeds the "other vehicles with cached
// signals" chips shown by the meta branches; when that query errors the chips
// are hidden rather than rendered misleading. It composes the shared web
// GlassPanel / Badge / Button, the shared EmptyState, the lucide
// AlertTriangle/Database/ServerCrash/Radio/Zap glyphs, the ApiError type, and
// the useDateFormat() formatter.
//
// React Native ships none of those DOM/web pieces, so — mirroring the sibling
// admin parity ports (BackendTool inlines its ToolCard/ResultPanel/Badge,
// StatusHeader inlines its StatCard/AlertBanner) — this self-contained port
// rebuilds each piece with React Native primitives and existing native tokens:
//   * The GlassPanel banner keeps the shared native GlassPanel; the four web
//     tone classes (rose/amber/cyan `/30` border + `/5` fill, and the neutral
//     `--border-subtle` + `--surface-2`) become four StyleSheet tone variants
//     using the exact Tailwind rgba stops (neutral maps to the border /
//     surfaceRaised tokens).
//   * lucide AlertTriangle/Database/ServerCrash/Radio/Zap map to the nearest
//     repo SemanticIcon names (warning / database / server / radio / bolt) — the
//     established way every native parity port renders a lucide glyph. The web
//     rendered the glyph in a flat secondary colour; SemanticIcon carries the
//     design-system's own tone tint instead, but the at-a-glance "an icon per
//     cause" intent is preserved. No lucide-react / DOM import.
//   * The shared web Badge (success/danger) becomes an inline `ModeBadge` pill
//     (success = emerald stops, danger = rose stops) on existing tokens.
//   * The web secondary/sm Button wrapped in `<a target="_blank">` becomes an
//     inline `DocsLinkButton` Pressable (accessibilityRole "link") that opens the
//     doc href through React Native Linking — the native analogue of
//     target="_blank". The web hrefs are SPA-origin-relative ("/docs/caching…"),
//     which has no native equivalent, so a relative href is resolved against the
//     deployment origin via `getApiBase()` (docs sit behind the same ingress);
//     like the web <a> it silently no-ops when the platform cannot open it.
//   * The shared EmptyState (icon + message, no title) is inlined as a centred
//     icon + message column (the native EmptyState requires a title the web call
//     omits).
//   * The `<dl>` meta grid + the chip `<button>`s become RN View/Pressable rows;
//     every testid (`redis-diagnostic-banner`, `redis-diagnostic-other-vehicles`,
//     `redis-diagnostic-other-{id}`) is preserved as a `testID`.
//   * useDateFormat() -> a self-contained `useNativeDateFormat` returning the
//     repo's Intl-based `formatDateTime` (the only date formatter wired in
//     native); it accepts the web `string | Date` signature. react-i18next ->
//     a self-contained fallback that preserves every key + English fallback and
//     reproduces i18next `{{var}}` interpolation for the status/message/count/date
//     substitutions.
//
// No DOM, no lucide-react, no Recharts/Leaflet, and no web UI components are
// imported. ApiError / RedisSignalsMeta / RedisSignalKeyEntry / getRedisSignalKeys
// are reused from the existing native client + devtools api ports (the same
// shapes the web source imported from @/lib/resilience and @/api/devtools).

import React, { useCallback, useMemo, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { formatDateTime as libFormatDateTime } from '../../../../lib/format';
import { getApiBase, type ApiError } from '../../../api/client';
import {
  getRedisSignalKeys,
  type RedisSignalsMeta,
  type RedisSignalKeyEntry,
} from '../../../api/devtools';

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

// The web component read `t` from react-i18next. Native parity has no i18n
// runtime wired yet, so this returns the English fallback string and reproduces
// i18next's `{{name}}` interpolation, preserving every key, fallback, and the
// status / message / count / date substitutions used by the error and meta
// branches.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }, []);
}

// Native stand-in for the web `useDateFormat()` formatter pair. The web hook is
// locale + tz-settings-aware; native parity wires only the repo's Intl-based
// `formatDateTime` (system locale), so this returns that formatter while keeping
// the web `string | Date | null | undefined` call signature (branch 3 passes a
// Date, the meta list passes strings).
function useNativeDateFormat(): {
  formatDateTime: (value: string | Date | null | undefined) => string;
} {
  return useMemo(
    () => ({
      formatDateTime: (value: string | Date | null | undefined) =>
        value instanceof Date
          ? libFormatDateTime(value.toISOString())
          : libFormatDateTime(value),
    }),
    [],
  );
}

/**
 * Discriminated union for the error-aware props. The banner also speaks for
 * the upstream useQuery — when the page
 * hit a 503 or a network failure, the banner takes precedence over the
 * meta-driven empty-state branches. Three legal shapes:
 *   - no error          → both undefined / false
 *   - typed API error   → serverError = ApiError instance
 *   - network failure   → serverError = null + networkError = true
 * The illegal shape (serverError: ApiError + networkError: true) is
 * type-rejected at the call site.
 */
export type DiagnosticErrorProps =
  | { serverError?: undefined; networkError?: false }
  | { serverError: ApiError; networkError?: false }
  | { serverError: null; networkError: true };

export type RedisDiagnosticEmptyStateProps = {
  vehicleId: number;
  meta: RedisSignalsMeta | undefined;
  onSelectVehicle: (vehicleId: number) => void;
} & DiagnosticErrorProps;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * RedisDiagnosticEmptyState replaces the legacy generic "no signals cached"
 * EmptyState with a structured, actionable banner that branches on the new
 * `meta` block returned by GET /api/v1/dev-tools/redis-signals. Each branch
 * maps to one of the five empty-state root causes (mode-local, mirror-failed,
 * TTL-expired, never-streamed, fall-through) so engineers see a specific
 * next step instead of a black box.
 *
 * Upstream request failures (503 cache not wired, 503 unreachable, generic
 * 5xx, network error) take precedence so a backend outage is never disguised
 * as an empty cache. Error branches always win over meta branches.
 */
export function RedisDiagnosticEmptyState({
  vehicleId,
  meta,
  serverError,
  networkError,
  onSelectVehicle,
}: RedisDiagnosticEmptyStateProps) {
  const t = useNativeTranslationFallback();
  const { formatDateTime } = useNativeDateFormat();

  const { data: keysData, isError: keysQueryError } = useQuery({
    queryKey: ['redis-signal-keys'],
    queryFn: () => getRedisSignalKeys(50),
    staleTime: 30_000,
  });

  // Branch 0.A — Redis cache wiring missing on the API server (503 + specific msg).
  if (
    serverError &&
    serverError.status === 503 &&
    /not available/i.test(serverError.message)
  ) {
    return (
      <DiagnosticBanner
        tone="danger"
        icon={<SemanticIcon decorative name="server" size="md" />}
        title={t('redis.diagnostic.cacheNotWired.title', 'Redis cache is not configured')}
        body={t(
          'redis.diagnostic.cacheNotWired.body',
          'The TeslaSync API server started without a Redis connection. Set REDIS_ADDR (or REDIS_HOST + REDIS_PORT) in your environment, ensure the Redis service is reachable, and restart the API. This page reads exclusively from Redis and cannot function without it.',
        )}
        cta={t('redis.diagnostic.cacheNotWired.cta', 'See cache configuration docs')}
        ctaHref="/docs/caching#configuration"
        meta={meta}
      />
    );
  }

  // Branch 0.B — Redis configured but unreachable (5xx + 'unreachable'/'upstream' msg).
  if (
    serverError &&
    (serverError.status === 503 || serverError.status === 502 || serverError.status === 504) &&
    /unreachable|upstream/i.test(serverError.message)
  ) {
    return (
      <DiagnosticBanner
        tone="danger"
        icon={<SemanticIcon decorative name="server" size="md" />}
        title={t('redis.diagnostic.unreachable.title', 'Redis is unreachable')}
        body={t(
          'redis.diagnostic.unreachable.body',
          'The API server is configured to use Redis, but the connection failed. Check that the Redis pod is running, that network policies allow the API to reach it, and review API server logs for "redis signal cache: GetAll failed".',
        )}
        meta={meta}
      />
    );
  }

  // Branch 0.C — Any other typed API error (4xx that shouldn't happen, generic 5xx).
  if (serverError) {
    return (
      <DiagnosticBanner
        tone="warning"
        icon={<SemanticIcon decorative name="warning" size="md" />}
        title={t('redis.diagnostic.requestFailed.title', 'Could not load Redis signals')}
        body={t(
          'redis.diagnostic.requestFailed.body',
          'The server returned an error: {{status}} {{message}}. The Redis Signal Viewer cannot recover automatically — try refreshing, and if the error persists check the API server logs.',
          { status: serverError.status, message: serverError.message },
        )}
        meta={meta}
      />
    );
  }

  // Branch 0.D — Network-layer failure (fetch threw before the server replied).
  if (networkError) {
    return (
      <DiagnosticBanner
        tone="warning"
        icon={<SemanticIcon decorative name="warning" size="md" />}
        title={t('redis.diagnostic.networkError.title', 'Cannot reach the API server')}
        body={t(
          'redis.diagnostic.networkError.body',
          'The browser failed to fetch /api/v1/dev-tools/redis-signals. Check that the API server is running, the proxy/ingress is healthy, and there are no CORS or network errors in DevTools.',
        )}
        meta={meta}
      />
    );
  }

  if (!meta) {
    // Backend doesn't expose meta yet — fall back to the legacy generic message.
    return (
      <NoMetaEmptyState
        message={t('redis.noSignals', 'No signals cached for this vehicle')}
      />
    );
  }

  // When the keys query itself is in an error state we hide the
  // "other vehicles" sub-section rather than render misleading chips
  // — the outer banner already tells the operator the request failed.
  const otherKeys: RedisSignalKeyEntry[] = keysQueryError
    ? []
    : keysData?.keys.filter((k) => k.vehicle_id !== vehicleId && k.field_count > 0) ?? [];

  // Branch 1 — mode=local: structural cause; banner explains the rollback switch.
  if (meta.live_signal_store_mode === 'local') {
    return (
      <DiagnosticBanner
        tone="danger"
        icon={<SemanticIcon decorative name="server" size="md" />}
        title={t('redis.diagnostic.modeLocal.title', 'Redis L2 writes are disabled')}
        body={t(
          'redis.diagnostic.modeLocal.body',
          'LIVE_SIGNAL_STORE_MODE=local means the telemetry pipeline writes only to the in-process L1 store and never mirrors to Redis. This page reads exclusively from Redis, so it cannot show data while local mode is active.',
        )}
        cta={t('redis.diagnostic.modeLocal.cta', 'See live-state contract docs')}
        ctaHref="/docs/caching"
        meta={meta}
      />
    );
  }

  // Branch 2 — hybrid mode, L1 has data but L2 doesn't: mirror is broken.
  if (meta.l1_signal_count > 0 && meta.redis_field_count === 0) {
    return (
      <DiagnosticBanner
        tone="warning"
        icon={<SemanticIcon decorative name="warning" size="md" />}
        title={t('redis.diagnostic.mirrorBroken.title', 'L2 mirror is failing')}
        body={t(
          'redis.diagnostic.mirrorBroken.body',
          'The in-process L1 store has {{count}} signals for this vehicle but Redis is empty. The async mirror goroutine in HybridLiveSignalStore.UpdateNonBlocking may be timing out or the Redis connection may be saturated. Check pod logs for "live signal store: Redis mirror failed".',
          { count: meta.l1_signal_count },
        )}
        otherKeys={otherKeys}
        onSelectVehicle={onSelectVehicle}
        meta={meta}
      />
    );
  }

  // Branch 3 — hybrid mode, both L1 and L2 empty AND no recent L1 telemetry:
  // either TTL expired or the vehicle never streamed.
  const lastSeenL1 = meta.l1_last_seen_at ? new Date(meta.l1_last_seen_at) : null;
  const ttlSuspected =
    !lastSeenL1 || Date.now() - lastSeenL1.getTime() > SEVEN_DAYS_MS;
  if (meta.l1_signal_count === 0 && ttlSuspected) {
    return (
      <DiagnosticBanner
        tone="info"
        icon={<SemanticIcon decorative name="bolt" size="md" />}
        title={t('redis.diagnostic.noTelemetry.title', 'No recent telemetry for this vehicle')}
        body={
          lastSeenL1
            ? t(
                'redis.diagnostic.noTelemetry.bodyStale',
                'Last L1 entry was {{date}}. The 7-day Redis TTL has likely expired. Wait for the next telemetry push or warm the cache from the cold-path reader.',
                { date: formatDateTime(lastSeenL1) },
              )
            : t(
                'redis.diagnostic.noTelemetry.bodyAbsent',
                'This vehicle has no L1 entries on this pod. Either telemetry has never streamed for it, or this pod restarted before any telemetry arrived.',
              )
        }
        otherKeys={otherKeys}
        onSelectVehicle={onSelectVehicle}
        meta={meta}
      />
    );
  }

  // Branch 4 — fallthrough: hybrid + both empty + recent L1 absence (rare).
  return (
    <DiagnosticBanner
      tone="neutral"
      icon={<SemanticIcon decorative name="radio" size="md" />}
      title={t('redis.diagnostic.empty.title', 'No signals cached for this vehicle')}
      body={t(
        'redis.diagnostic.empty.body',
        'Both L1 and L2 are empty. If this vehicle is currently streaming, give the next batch a few seconds to arrive. Otherwise check the telemetry pipeline.',
      )}
      otherKeys={otherKeys}
      onSelectVehicle={onSelectVehicle}
      meta={meta}
    />
  );
}

type BannerTone = 'danger' | 'warning' | 'info' | 'neutral';

interface BannerProps {
  tone: BannerTone;
  icon: ReactNode;
  title: string;
  body: string;
  cta?: string;
  ctaHref?: string;
  otherKeys?: RedisSignalKeyEntry[];
  onSelectVehicle?: (id: number) => void;
  meta: RedisSignalsMeta | undefined;
}

function toneStyle(tone: BannerTone) {
  switch (tone) {
    case 'danger':
      return styles.bannerDanger;
    case 'warning':
      return styles.bannerWarning;
    case 'info':
      return styles.bannerInfo;
    default:
      return styles.bannerNeutral;
  }
}

function DiagnosticBanner({
  tone,
  icon,
  title,
  body,
  cta,
  ctaHref,
  otherKeys,
  onSelectVehicle,
  meta,
}: BannerProps) {
  const t = useNativeTranslationFallback();
  return (
    <GlassPanel
      style={[styles.bannerRoot, toneStyle(tone)]}
      testID="redis-diagnostic-banner"
    >
      <View style={styles.bannerInner}>
        {icon}
        <View style={styles.contentColumn}>
          <AppText style={styles.title} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.bodyText} tone="secondary">
            {body}
          </AppText>
          {meta ? <DiagnosticMetaList meta={meta} /> : null}
          {cta && ctaHref ? <DocsLinkButton href={ctaHref} label={cta} /> : null}
          {otherKeys && otherKeys.length > 0 ? (
            <View style={styles.otherSection} testID="redis-diagnostic-other-vehicles">
              <AppText style={styles.otherLabel} tone="muted" variant="caption">
                {t('redis.diagnostic.otherVehicles', 'Other vehicles with cached signals')}
              </AppText>
              <View style={styles.chipRow}>
                {otherKeys.slice(0, 6).map((k) => (
                  <Pressable
                    accessibilityRole="button"
                    key={k.vehicle_id}
                    onPress={() => onSelectVehicle?.(k.vehicle_id)}
                    style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                    testID={`redis-diagnostic-other-${k.vehicle_id}`}
                  >
                    <AppText style={styles.chipText} variant="caption">
                      {k.display_name || k.vehicle_vin || `Vehicle ${k.vehicle_id}`}
                      <AppText style={styles.chipMuted} variant="caption">
                        {' · '}
                        {k.field_count}
                      </AppText>
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

// Native analogue of the web secondary/sm Button wrapped in `<a target="_blank">`.
// Opens the doc href through Linking; web hrefs are SPA-origin-relative, so a
// relative href is resolved against the deployment origin (docs sit behind the
// same ingress as the API). Silently no-ops on failure, like the web <a>.
function DocsLinkButton({ href, label }: { href: string; label: string }) {
  const onPress = useCallback(() => {
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(href)
      ? href
      : `${getApiBase()}${href}`;
    void Linking.openURL(url).catch(() => {
      // Intentionally ignored: matches the web <a> which surfaces no link error.
    });
  }, [href]);

  return (
    <Pressable
      accessibilityHint={href}
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.ctaButton, pressed && styles.ctaButtonPressed]}
    >
      <AppText style={styles.ctaText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// Native analogue of the shared web Badge (size="sm"): success when the live
// store is in hybrid mode, danger otherwise.
function ModeBadge({ mode }: { mode: RedisSignalsMeta['live_signal_store_mode'] }) {
  const success = mode === 'hybrid';
  return (
    <View
      style={[styles.modeBadge, success ? styles.modeBadgeSuccess : styles.modeBadgeDanger]}
    >
      <AppText
        style={success ? styles.modeBadgeTextSuccess : styles.modeBadgeTextDanger}
        variant="caption"
        weight="semibold"
      >
        {mode}
      </AppText>
    </View>
  );
}

function DiagnosticMetaList({ meta }: { meta: RedisSignalsMeta }) {
  const t = useNativeTranslationFallback();
  const { formatDateTime } = useNativeDateFormat();
  return (
    <View style={styles.metaList}>
      <Row label={t('redis.diagnostic.meta.mode', 'Live store mode')}>
        <ModeBadge mode={meta.live_signal_store_mode} />
      </Row>
      <Row label={t('redis.diagnostic.meta.key', 'Redis key')}>
        <AppText style={styles.monoCode}>{meta.redis_key}</AppText>
      </Row>
      <Row label={t('redis.diagnostic.meta.l1Count', 'L1 signals')}>
        {meta.l1_signal_count}
      </Row>
      <Row label={t('redis.diagnostic.meta.l2Count', 'L2 fields (raw)')}>
        {meta.redis_field_count}
      </Row>
      <Row label={t('redis.diagnostic.meta.l1LastSeen', 'L1 last seen')}>
        {meta.l1_last_seen_at ? formatDateTime(meta.l1_last_seen_at) : '—'}
      </Row>
      <Row label={t('redis.diagnostic.meta.l2LastSeen', 'L2 last seen')}>
        {meta.l2_last_seen_at ? formatDateTime(meta.l2_last_seen_at) : '—'}
      </Row>
      {meta.vehicle_vin ? (
        <Row label={t('redis.diagnostic.meta.vin', 'VIN')}>
          <AppText style={styles.monoCode}>{meta.vehicle_vin}</AppText>
        </Row>
      ) : null}
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.metaRow}>
      <AppText style={styles.metaLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <View style={styles.metaValue}>
        {typeof children === 'string' || typeof children === 'number' ? (
          <AppText tone="secondary" variant="caption">
            {children}
          </AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

// Native analogue of the shared web EmptyState (icon + message, no title) used
// for the pre-meta backend rollback fallback.
function NoMetaEmptyState({ message }: { message: string }) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      <SemanticIcon decorative name="database" size="lg" />
      <AppText style={styles.emptyMessage} tone="secondary">
        {message}
      </AppText>
    </View>
  );
}

RedisDiagnosticEmptyState.displayName = 'RedisDiagnosticEmptyState';

// rose-500 / amber-500 / cyan-500 with the web `/30` border + `/5` fill stops.
const ROSE_500 = '244, 63, 94';
const AMBER_500 = '245, 158, 11';
const CYAN_500 = '6, 182, 212';

const styles = StyleSheet.create({
  bannerDanger: {
    backgroundColor: `rgba(${ROSE_500}, 0.05)`,
    borderColor: `rgba(${ROSE_500}, 0.3)`,
  },
  bannerInfo: {
    backgroundColor: `rgba(${CYAN_500}, 0.05)`,
    borderColor: `rgba(${CYAN_500}, 0.3)`,
  },
  bannerInner: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
  },
  bannerNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  bannerRoot: {
    padding: 16,
  },
  bannerWarning: {
    backgroundColor: `rgba(${AMBER_500}, 0.05)`,
    borderColor: `rgba(${AMBER_500}, 0.3)`,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipMuted: {
    color: colors.textMuted,
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chipText: {
    color: colors.textSecondary,
  },
  contentColumn: {
    flex: 1,
    gap: spacing.md,
  },
  ctaButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  ctaButtonPressed: {
    opacity: 0.82,
  },
  ctaText: {
    color: colors.textPrimary,
  },
  emptyMessage: {
    maxWidth: 420,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 48,
  },
  metaLabel: {
    flexBasis: 116,
    flexShrink: 0,
  },
  metaList: {
    gap: spacing.xs,
  },
  metaRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  metaValue: {
    flex: 1,
    flexShrink: 1,
  },
  modeBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  modeBadgeDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  modeBadgeSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  modeBadgeTextDanger: {
    color: colors.danger,
  },
  modeBadgeTextSuccess: {
    color: colors.success,
  },
  monoCode: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
  otherLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  otherSection: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
});
