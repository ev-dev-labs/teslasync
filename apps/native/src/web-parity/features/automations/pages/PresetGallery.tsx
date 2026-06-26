/**
 * Native parity port of
 * web/src/features/automations/pages/PresetGallery.tsx.
 *
 * The web file renders the automation **preset gallery**: a responsive card
 * grid where each `PresetCard` shows the preset icon (a lucide glyph resolved
 * from `preset.icon`), the preset name (truncated), the first trigger's
 * human label (or a "no trigger" fallback), a neutral action-count `Badge`, a
 * 2-line clamped description, and a secondary "Install" `Button` that navigates
 * to the builder with `?preset=` pre-filled. While the query loads it shows
 * four `PresetCardSkeleton`s; when the list is empty it shows an `EmptyState`
 * with a Clock icon. This native port preserves that contract 1:1 — the same
 * `iconMap` (now a glyph map) + `triggerLabels` table, the same private
 * `PresetCard` / `PresetCardSkeleton` sub-components, the same
 * `PresetGalleryProps` (`category?`) + the named `PresetGallery` export, the
 * same `useAutomationPresets(category)` hook call, the same
 * `presetList = useMemo(() => data?.presets ?? [], [data])`, and the same
 * loading / empty / list branches — using React Native primitives + the
 * existing native GlassPanel / AppText / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-router-dom `useNavigate` (web L8): the native app has no
 *     react-router, so `useNativeNavigate()` returns a documented no-op — the
 *     Install button still builds the exact `/automations/new?preset=${id}`
 *     web path (preserving intent + the verbatim query param) but cannot push a
 *     route on native (explicit unavailable state).
 *   - react-i18next `useTranslation` (web L9): replaced by a native-safe
 *     `t(key, fallback?, vars?)` fallback (the established sibling
 *     ActionBuilder / RequestBuilder precedent) returning the English default
 *     (else the key) and interpolating i18next-style `{{token}}` placeholders
 *     (needed for `automations.presets.actionCount` `{{count}} actions`). Every
 *     web translation key is preserved verbatim.
 *   - `@/components/ui` `GlassPanel` / `Button` / `Badge` (web L10): the native
 *     GlassPanel is reused (its web `hover` / `glow="cyan"` props have no RN
 *     analog and are dropped; the cyan accent is reproduced on the icon box);
 *     `Button` (secondary/sm) + `Badge` (neutral/sm) have no native parity port
 *     yet, so minimal native-safe equivalents are reproduced locally (the
 *     established "reproduce locally when no native parity port exists"
 *     precedent) — a `Pressable` install button (Plus glyph + label) and a
 *     pill `Badge`.
 *   - `@/components/feedback` `EmptyState` / `Skeleton` (web L11-12): native-safe
 *     local equivalents (a message + optional-icon column; a static placeholder
 *     block — the web `animate-pulse` has no inert RN analog).
 *   - `@/components/motion` `FadeIn` / `StaggerContainer` / `StaggerItem`
 *     (web L13-15): framer-motion entrances → static passthrough Views (the
 *     established Layout framer-motion → static precedent).
 *   - lucide-react `Shield` / `Moon` / `Sun` / `ShieldCheck` / `Lock` / `UserX`
 *     / `CarFront` / `Siren` / `Plus` / `Clock` (web L17-20): rendered as
 *     decorative AppText glyphs marked `importantForAccessibility=
 *     "no-hide-descendants"` (the aria-hidden analog); the `iconMap` /
 *     `?? Shield` default is preserved as a glyph map + default glyph.
 *   - `@/api/types` `AutomationPreset` (web L21) + `@/types/automations`
 *     `AutomationTriggerKind` (web L22): imported from the already-ported native
 *     `../../../api/hooks/useAutomations`.
 *   - Tailwind grid/spacing/typography utilities map to StyleSheet tokens; the
 *     responsive `grid-cols-1 sm:2 lg:3 xl:4` collapses to the mobile-first
 *     single-column base (RN has no CSS media queries); `truncate` ->
 *     numberOfLines 1, `line-clamp-2` -> numberOfLines 2.
 */
import React, {useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useAutomationPresets,
  type AutomationPreset,
  type AutomationTriggerKind,
} from '../../../api/hooks/useAutomations';

/* ── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  vars?: NativeTVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => {
      const template = fallback ?? key;
      if (!vars) {
        return template;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name)
          ? String(vars[name])
          : `{{${name}}}`,
      );
    },
    [],
  );
}

/* ── native-safe navigate (native-safe port of react-router useNavigate) ─── */

type NativeNavigate = (path: string) => void;

function useNativeNavigate(): NativeNavigate {
  return useMemo<NativeNavigate>(
    () => () => {
      // The native app has no react-router; the web navigate(`/automations/new
      // ?preset=${id}`) route push is unavailable. The path is still built at
      // the call site so the intent is preserved (see sidecar).
    },
    [],
  );
}

/* ── decorative glyph stand-ins for the lucide-react icons (web L17-20) ───── */

const ICON_GLYPHS: Record<string, string> = {
  Shield: '\uD83D\uDEE1', // 🛡 (lucide Shield)
  Moon: '\uD83C\uDF19', // 🌙 (lucide Moon)
  Sun: '\u2600\uFE0F', // ☀️ (lucide Sun)
  ShieldCheck: '\u2705', // ✅ (lucide ShieldCheck)
  Lock: '\uD83D\uDD12', // 🔒 (lucide Lock)
  UserX: '\uD83D\uDEAB', // 🚫 (lucide UserX)
  CarFront: '\uD83D\uDE97', // 🚗 (lucide CarFront)
  Siren: '\uD83D\uDEA8', // 🚨 (lucide Siren)
};
const DEFAULT_ICON_GLYPH = ICON_GLYPHS.Shield; // web `iconMap[preset.icon] ?? Shield`
const PLUS_GLYPH = '\u002B'; // + (lucide Plus)
const CLOCK_GLYPH = '\uD83D\uDD50'; // 🕐 (lucide Clock)

/* ── ported verbatim: triggerLabels table (web L35-40) ───────────────────── */

const triggerLabels: Record<
  AutomationTriggerKind,
  {key: string; fallback: string}
> = {
  trigger_schedule: {
    key: 'automations.builder.triggerSchedule',
    fallback: 'Schedule',
  },
  trigger_event: {
    key: 'automations.builder.triggerEvent',
    fallback: 'Vehicle Event',
  },
  trigger_geofence: {
    key: 'automations.builder.triggerGeofence',
    fallback: 'Geofence',
  },
  trigger_signal: {
    key: 'automations.builder.triggerSignal',
    fallback: 'Signal Threshold',
  },
};

/* ── native Badge stand-in (`@/components/ui` Badge, neutral/sm) ──────────── */

function Badge({label}: {label: string}) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ── native Skeleton stand-in (`@/components/feedback` Skeleton) ──────────── */

function Skeleton({style}: {style?: StyleProp<ViewStyle>}) {
  return <View style={[styles.skeleton, style]} />;
}

/* ── native EmptyState stand-in (`@/components/feedback` EmptyState) ──────── */

function EmptyState({
  icon,
  message,
  testID,
}: {
  icon?: ReactNode;
  message: string;
  testID?: string;
}) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      <AppText
        style={styles.emptyStateMessage}
        tone="muted"
        variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ── native motion stand-ins (`@/components/motion`, framer-motion → static) ─ */

function FadeIn({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

function StaggerContainer({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

function StaggerItem({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

/* ── ported: PresetCard (web L42-93) ─────────────────────────────────────── */

function PresetCard({preset}: {preset: AutomationPreset}) {
  const t = useNativeTranslationFallback();
  const navigate = useNativeNavigate();
  const iconGlyph = ICON_GLYPHS[preset.icon] ?? DEFAULT_ICON_GLYPH;
  const firstTrigger = preset.triggers[0];
  const triggerLabel = firstTrigger ? triggerLabels[firstTrigger.kind] : null;

  const handleInstall = () => {
    navigate(`/automations/new?preset=${preset.id}`);
  };

  return (
    <GlassPanel style={styles.card} testID={`preset-card-${preset.id}`}>
      <View style={styles.cardHeader}>
        <View style={styles.iconBox}>
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.iconGlyph}>
            {iconGlyph}
          </AppText>
        </View>
        <View style={styles.cardHeaderText}>
          <AppText numberOfLines={1} style={styles.cardTitle} weight="semibold">
            {preset.name}
          </AppText>
          <AppText
            style={styles.cardSubtitle}
            tone="secondary"
            variant="caption">
            {triggerLabel
              ? t(triggerLabel.key, triggerLabel.fallback)
              : t('automations.builder.noTrigger', 'No trigger configured')}
          </AppText>
        </View>
        <Badge
          label={t('automations.presets.actionCount', '{{count}} actions', {
            count: preset.actions.length,
          })}
        />
      </View>

      <AppText
        numberOfLines={2}
        style={styles.cardDescription}
        tone="secondary"
        variant="caption">
        {preset.description}
      </AppText>

      <Pressable
        accessibilityLabel={t('automations.presets.install', 'Install')}
        accessibilityRole="button"
        onPress={handleInstall}
        style={({pressed}) => [
          styles.installButton,
          pressed && styles.installButtonPressed,
        ]}
        testID={`preset-install-${preset.id}`}>
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={styles.installGlyph}>
          {PLUS_GLYPH}
        </AppText>
        <AppText style={styles.installLabel} weight="semibold">
          {t('automations.presets.install', 'Install')}
        </AppText>
      </Pressable>
    </GlassPanel>
  );
}

/* ── ported: PresetCardSkeleton (web L95-109) ────────────────────────────── */

function PresetCardSkeleton() {
  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <Skeleton style={styles.skeletonIcon} />
        <View style={styles.skeletonHeaderText}>
          <Skeleton style={styles.skeletonTitle} />
          <Skeleton style={styles.skeletonSubtitle} />
        </View>
      </View>
      <Skeleton style={styles.skeletonDescription} />
      <Skeleton style={styles.skeletonButton} />
    </GlassPanel>
  );
}

/* ── ported: PresetGalleryProps + PresetGallery (web L111-151) ───────────── */

interface PresetGalleryProps {
  category?: string;
}

export function PresetGallery({category}: PresetGalleryProps) {
  const t = useNativeTranslationFallback();
  const {data, isLoading} = useAutomationPresets(category);

  const presetList = useMemo(() => data?.presets ?? [], [data]);

  if (isLoading) {
    return (
      <View style={styles.grid} testID="preset-gallery-loading">
        {Array.from({length: 4}).map((_, i) => (
          <PresetCardSkeleton key={i} />
        ))}
      </View>
    );
  }

  if (presetList.length === 0) {
    return (
      <EmptyState
        /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.emptyStateGlyph}>
            {CLOCK_GLYPH}
          </AppText>
        }
        message={t(
          'automations.presets.empty',
          'No preset templates available',
        )}
        testID="preset-gallery-empty"
      />
    );
  }

  return (
    <FadeIn>
      <StaggerContainer style={styles.grid}>
        {presetList.map(preset => (
          <StaggerItem key={preset.id}>
            <PresetCard preset={preset} />
          </StaggerItem>
        ))}
      </StaggerContainer>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  // web `grid grid-cols-1 sm:2 lg:3 xl:4 gap-4` -> mobile-first single column,
  // gap-4 == 16.
  grid: {
    gap: 16,
  },
  // web GlassPanel `p-5 flex flex-col gap-3`.
  card: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  // web `flex items-start gap-3`.
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  // web `w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20`.
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // web `h-5 w-5 text-cyan-400`.
  iconGlyph: {
    fontSize: 18,
    color: colors.accent,
  },
  // web `flex-1 min-w-0`.
  cardHeaderText: {
    flex: 1,
  },
  // web `text-sm font-semibold text-[var(--text-primary)] truncate`.
  cardTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  // web `text-xs text-[var(--text-secondary)] mt-0.5`.
  cardSubtitle: {
    marginTop: 2,
  },
  // web `text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-2`.
  cardDescription: {
    lineHeight: 18,
  },
  // web Badge `variant="neutral" size="sm"`.
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    color: colors.textSecondary,
  },
  // web Button `size="sm" variant="secondary" mt-1 w-full`.
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xs,
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  installButtonPressed: {
    opacity: 0.82,
  },
  // web `h-3.5 w-3.5 mr-1.5`.
  installGlyph: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  installLabel: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  // web Skeleton `animate-pulse` block -> static placeholder.
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
  },
  // web `w-10 h-10 rounded-lg`.
  skeletonIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  // web `flex-1`.
  skeletonHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  // web `h-4 w-32 mb-1`.
  skeletonTitle: {
    height: 16,
    width: 128,
  },
  // web `h-3 w-20`.
  skeletonSubtitle: {
    height: 12,
    width: 80,
  },
  // web `h-8 w-full`.
  skeletonDescription: {
    height: 32,
    width: '100%',
  },
  // web `h-7 w-full mt-auto`.
  skeletonButton: {
    height: 28,
    width: '100%',
    marginTop: 'auto',
  },
  // web EmptyState column.
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyStateIcon: {
    marginBottom: spacing.xs,
  },
  // web Clock `h-8 w-8`.
  emptyStateGlyph: {
    fontSize: 28,
    color: colors.textMuted,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
});
