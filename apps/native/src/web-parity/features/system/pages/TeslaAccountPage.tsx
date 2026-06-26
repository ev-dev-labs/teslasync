/**
 * Native parity port of web/src/features/system/pages/TeslaAccountPage.tsx.
 *
 * The web page renders the signed-in user's Tesla account profile that was
 * synced from the Fleet API. A `PageContainer` (title + subtitle + loading +
 * error) wraps two `FadeIn` sections:
 *   1. a "sync bar" row — a left-aligned relative "Last synced: …" / "Never
 *      synced …" caption and a right-aligned primary "Refresh from Tesla"
 *      button (a spinning `RefreshCw` icon while the refresh mutation is
 *      pending, disabled during the request), and
 *   2. a "Profile" `GlassPanel` that, when a profile exists, shows the avatar
 *      (the `profile_image_url` image, or an `ImageOff` placeholder when absent)
 *      next to a `KVList` of Name / Email / Fetched At; when no profile exists
 *      yet it shows an `EmptyState` (User icon + "click Refresh" guidance).
 * Data comes from `useTeslaUserProfile()` (`GET /tesla/user/profile`) and the
 * refresh action from `useRefreshTeslaProfile()` (`POST /tesla/user/profile/refresh`).
 *
 * This native port preserves that contract 1:1 — the same two hooks + API
 * paths, the same `data?.profile ?? null` / `data?.fetched_at ?? null` derived
 * state (the `profile` / `fetchedAt` names), the same `error instanceof Error`
 * gate fed to the container, the same `refreshMutation.mutate()` /
 * `refreshMutation.isPending` refresh wiring, the same avatar image-vs-ImageOff
 * branch, the same three KVList rows (full_name || '—', email || '—',
 * formatDateTime(fetched_at)), the same sync-bar copy, and all i18n keys +
 * English defaults — using React Native primitives, the existing native
 * AppText / GlassPanel + design tokens.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L1): no native i18next runtime → an
 *     inline native-safe `t(key, fallback?, params?)` shim that returns the
 *     English fallback (else the key) and interpolates i18next-style `{{time}}`
 *     placeholders; every key + English default is preserved verbatim.
 *   - lucide-react `RefreshCw` / `User` / `ImageOff` (web L2): DOM SVG icons →
 *     decorative glyph stand-ins (the established icon→glyph precedent); the
 *     spinning RefreshCw becomes an `ActivityIndicator` while the mutation is
 *     pending and the glyph otherwise.
 *   - `@/components/layout` PageContainer (web L4): no native parity port yet →
 *     a minimal native-safe `PageContainer` (ScrollView scaffold with title /
 *     subtitle / actions / children, the body gated behind the loading spinner
 *     then an error box, mirroring the web loading → error → children ladder).
 *   - `@/components/ui` GlassPanel / Button (web L5): GlassPanel is the existing
 *     native port; the web primary Button becomes a local native `RefreshButton`
 *     (accent Pressable + spinner/glyph + label + accessibilityLabel + disabled).
 *   - `@/components/feedback` EmptyState (web L6): a local native-safe EmptyState
 *     (icon glyph + message), mirroring the web `{ icon, message }` usage.
 *   - `@/components/motion` FadeIn (web L7): framer-motion has no native
 *     equivalent → a static passthrough `View` (the established precedent); the
 *     `delay` prop is accepted but inert.
 *   - `@/components/data-display` KVList (web L8): reproduced locally as a native
 *     label/value list with the web's divide-y row separators, preserving the
 *     `{ label, value }[]` contract.
 *   - `@/hooks/usePageTitle` (web L10): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the header title).
 *   - `@/api/hooks/useUser` useTeslaUserProfile / useRefreshTeslaProfile
 *     (web L11): imported from the already-ported native hook module (same
 *     `/tesla/user/profile` + `/tesla/user/profile/refresh` paths + shapes).
 *   - `@/lib/dateFormat` formatDateTime / formatRelative (web L12): ported
 *     native-safe (tz/locale-aware via Intl, '—' for nullish/invalid, the
 *     "just now" / "Nm ago" / "Nh ago" / "Nd ago" / absolute-date ladder).
 */
import React, {useCallback, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {
  useRefreshTeslaProfile,
  useTeslaUserProfile,
} from '../../../api/hooks/useUser';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L1)     */
/* ------------------------------------------------------------------ */

type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only, L10) */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied.
}

/* ------------------------------------------------------------------ */
/*  ported date helpers (web @/lib/dateFormat, web L12)                */
/* ------------------------------------------------------------------ */

interface FormatOptions {
  tz?: string;
  locale?: string;
}

function intlOpts(
  base: Intl.DateTimeFormatOptions,
  opts?: FormatOptions,
): Intl.DateTimeFormatOptions {
  return opts?.tz ? {...base, timeZone: opts.tz} : base;
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw;
  }
  return undefined;
}

/** Date only: "Apr 4, 2026". '—' for nullish/invalid input. */
function formatDate(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleDateString(
      intlLocale(opts),
      intlOpts({year: 'numeric', month: 'short', day: 'numeric'}, opts),
    );
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Date + time: "Apr 4, 2026, 06:30 PM". '—' for nullish/invalid input. */
function formatDateTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleString(
      intlLocale(opts),
      intlOpts(
        {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
        opts,
      ),
    );
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
}

/** Relative time: "just now", "3m ago", "2h ago", "5d ago", else absolute date. */
function formatRelative(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(iso, opts);
}

/* ------------------------------------------------------------------ */
/*  decorative glyph stand-ins for the lucide-react icons (web L2)     */
/* ------------------------------------------------------------------ */

const ICON_REFRESH = '\u21BB'; // ↻ RefreshCw (refresh from Tesla)
const ICON_USER = '\uD83D\uDC64'; // 👤 User (no-profile empty state)
const ICON_IMAGE_OFF = '\uD83D\uDDBC'; // 🖼 ImageOff (avatar placeholder)
const EM_DASH = '\u2014';

/* ------------------------------------------------------------------ */
/*  native FadeIn (web @/components/motion, web L7)                     */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback/EmptyState, web L6)    */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: string;
  message: string;
  testID?: string;
}

function EmptyState({icon, message, testID}: EmptyStateProps) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState} testID={testID}>
      {icon ? (
        <AppText
          importantForAccessibility="no"
          style={styles.emptyStateIcon}
          tone="muted">
          {icon}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native KVList (web @/components/data-display/KVList, web L8)        */
/* ------------------------------------------------------------------ */

interface KVItem {
  label: string;
  value: ReactNode;
}

function KVList({items}: {items: KVItem[]}) {
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[styles.kvRow, index > 0 && styles.kvRowDivider]}>
          <AppText style={styles.kvLabel} tone="muted">
            {item.label}
          </AppText>
          {typeof item.value === 'string' || typeof item.value === 'number' ? (
            <AppText style={styles.kvValue} weight="semibold">
              {item.value}
            </AppText>
          ) : (
            item.value
          )}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native RefreshButton (web @/components/ui Button primary, web L5)   */
/* ------------------------------------------------------------------ */

interface RefreshButtonProps {
  label: string;
  onPress: () => void;
  pending: boolean;
}

function RefreshButton({label, onPress, pending}: RefreshButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: pending, disabled: pending}}
      disabled={pending}
      onPress={onPress}
      style={({pressed}) => [
        styles.refreshButton,
        pending && styles.refreshButtonDisabled,
        pressed && !pending && styles.refreshButtonPressed,
      ]}
      testID="tesla-account-refresh">
      {pending ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <AppText style={styles.refreshGlyph}>{ICON_REFRESH}</AppText>
      )}
      <AppText style={styles.refreshButtonLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout/PageContainer, L4)    */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  children,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'tesla-account-page'}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText style={styles.title} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.subtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loading} testID="tesla-account-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="tesla-account-error">
          <AppText style={styles.errorText}>{error.message}</AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TeslaAccountPage — synced Tesla account profile (web L14-103)
   ═══════════════════════════════════════════════════════════════════════ */

export default function TeslaAccountPage() {
  const t = useNativeTranslation();
  usePageTitle(t('teslaAccount.title', 'Tesla Account'));

  const {data, isLoading, error} = useTeslaUserProfile();
  const refreshMutation = useRefreshTeslaProfile();

  const profile = data?.profile ?? null;
  const fetchedAt = data?.fetched_at ?? null;

  return (
    <PageContainer
      error={error instanceof Error ? error : null}
      loading={isLoading}
      subtitle={t(
        'teslaAccount.subtitle',
        'Your Tesla account profile synced from the Fleet API',
      )}
      testID="tesla-account-page"
      title={t('teslaAccount.title', 'Tesla Account')}>
      {/* Sync bar */}
      <FadeIn>
        <View style={styles.syncBar}>
          <AppText style={styles.syncText} tone="secondary">
            {fetchedAt
              ? t('teslaAccount.lastSynced', 'Last synced: {{time}}', {
                  time: formatRelative(fetchedAt),
                })
              : t(
                  'teslaAccount.neverSynced',
                  `Never synced ${EM_DASH} click Refresh to fetch from Tesla`,
                )}
          </AppText>
          <RefreshButton
            label={t('teslaAccount.refresh', 'Refresh from Tesla')}
            onPress={() => refreshMutation.mutate()}
            pending={refreshMutation.isPending}
          />
        </View>
      </FadeIn>

      {/* Profile card */}
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.cardTitle} weight="semibold">
            {t('teslaAccount.profile', 'Profile')}
          </AppText>
          {profile ? (
            <View style={styles.profileRow}>
              {/* Avatar */}
              <View style={styles.avatarWrap}>
                {profile.profile_image_url ? (
                  <Image
                    accessibilityLabel={t(
                      'teslaAccount.avatar',
                      'Profile picture',
                    )}
                    resizeMode="cover"
                    source={{uri: profile.profile_image_url}}
                    style={styles.avatarImage}
                    testID="tesla-account-avatar-image"
                  />
                ) : (
                  <View
                    style={styles.avatarPlaceholder}
                    testID="tesla-account-avatar-placeholder">
                    <AppText
                      importantForAccessibility="no"
                      style={styles.avatarPlaceholderGlyph}
                      tone="muted">
                      {ICON_IMAGE_OFF}
                    </AppText>
                  </View>
                )}
              </View>

              {/* Details */}
              <View style={styles.profileDetails}>
                <KVList
                  items={[
                    {
                      label: t('teslaAccount.name', 'Name'),
                      value: profile.full_name || EM_DASH,
                    },
                    {
                      label: t('teslaAccount.email', 'Email'),
                      value: profile.email || EM_DASH,
                    },
                    {
                      label: t('teslaAccount.fetchedAt', 'Fetched At'),
                      value: formatDateTime(profile.fetched_at),
                    },
                  ]}
                />
              </View>
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState
              icon={ICON_USER}
              message={t(
                'teslaAccount.noProfile',
                'No profile data yet. Click "Refresh from Tesla" to sync your account.',
              )}
              testID="tesla-account-no-profile"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  avatarImage: {
    borderColor: colors.border,
    borderRadius: 40,
    borderWidth: 2,
    height: 80,
    width: 80,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 40,
    borderWidth: 2,
    height: 80,
    justifyContent: 'center',
    width: 80,
  },
  avatarPlaceholderGlyph: {
    fontSize: 30,
  },
  avatarWrap: {
    flexShrink: 0,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    marginBottom: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
  },
  emptyStateIcon: {
    fontSize: 28,
  },
  emptyStateMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  kvLabel: {
    fontSize: typography.body,
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  kvRowDivider: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  kvValue: {
    color: colors.textPrimary,
    fontSize: typography.body,
    textAlign: 'right',
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  panel: {
    padding: spacing.xl,
  },
  profileDetails: {
    flex: 1,
    minWidth: 0,
  },
  profileRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.lg,
  },
  refreshButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  refreshButtonDisabled: {
    opacity: 0.48,
  },
  refreshButtonLabel: {
    color: colors.background,
  },
  refreshButtonPressed: {
    opacity: 0.82,
  },
  refreshGlyph: {
    color: colors.background,
    fontSize: typography.body,
    fontWeight: '700',
  },
  scaffold: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  syncBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  syncText: {
    flex: 1,
    fontSize: typography.caption,
    minWidth: 160,
  },
  title: {
    color: colors.textPrimary,
  },
});
