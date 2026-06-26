// Native parity port of
// web/src/features/system/components/status/TeslaAuthCard.tsx.
//
// TeslaAuthCard — dedicated card for Tesla auth status. Promotes Tesla auth from
// a single Health row to a fuller card with a token-expiry countdown and a
// primary "Re-authenticate" CTA. The card is always rendered (operator-grade
// visibility); the styling intensifies as the situation worsens (healthy ->
// amber when expiring within 7 days -> red when expired). The backend's
// /auth/status does not yet expose last_success_at, so this card deliberately
// does not promise that timestamp.
//
// Native-safe substitutions (rules 4-7), documented in the parity sidecar:
//   • react-router-dom <Link to="/tesla-account"> -> a Pressable with
//     accessibilityRole="link" + an onNavigate?(to) callback (the established
//     native nav idiom, VehicleHeroCard / RecentlyViewedWidget precedent); the
//     destination path "/tesla-account" is forwarded verbatim.
//   • lucide-react ShieldCheck / ShieldAlert / ShieldX / ExternalLink -> the
//     parity SemanticIcon glyphs (securityCheck 'SC', securityAlert 'SA',
//     securityOff 'SO', externalLink 'EX') rendered as AppText in the explicit
//     per-severity hex the web icon carried via currentColor (FrontendErrorsCard
//     glyph precedent); the parity bundle ships no lucide / SVG icon set.
//   • shared web '@/components/ui' GlassPanel -> the native GlassPanel; the web
//     `overflow-hidden` is preserved so the severity bar clips to the panel's
//     rounded corners.
//   • shared web '@/components/ui' Badge variant={...} -> an inline native Pill
//     (md size: rounded-full px-2 py-0.5 text-xs font-medium) using the web
//     Badge dark-mode {color}-900/{color}-200 hex pairs (OperationsSection Pill
//     precedent).
//   • Tailwind utility classes + the --text-primary/--text-secondary CSS vars +
//     the DOM <div>/<h3>/<p> tree -> RN View/AppText primitives, a StyleSheet,
//     and theme tokens; aria-live="polite" -> accessibilityLiveRegion="polite",
//     and the two aria-hidden decorations (severity bar + icon) become
//     accessibilityElementsHidden + importantForAccessibility="no".
// State names (authenticated/expiresAt/now/sev/tone/detail), the severityFor
// thresholds (<0 expired, <=7 warn), the day math, every English string, and
// the "/tesla-account" destination are all preserved verbatim. No DOM elements,
// react-router, lucide-react, Recharts, Leaflet, or web UI-kit modules are
// imported into the native output.

import React, {useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

interface TeslaAuthCardProps {
  /** Whether the auth check itself is currently authenticated. */
  authenticated: boolean | undefined;
  /** ISO string for token expiry, if known. */
  expiresAt: string | undefined;
  /** "now" Date.now() — passed in so the page-level tick re-renders the card. */
  now: number;
  /**
   * Native navigation hook replacing react-router-dom's <Link>. Receives the
   * destination path string verbatim when the CTA is pressed. No-op if unwired.
   */
  onNavigate?: (to: string) => void;
}

type Severity = 'ok' | 'warn' | 'expired' | 'disconnected' | 'unknown';

function severityFor(
  authenticated: boolean | undefined,
  expiresAt: string | undefined,
  now: number,
): Severity {
  if (authenticated === false) return 'disconnected';
  if (!expiresAt) return authenticated ? 'unknown' : 'unknown';
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return 'unknown';
  const days = Math.floor((exp - now) / (24 * 60 * 60 * 1000));
  if (days < 0) return 'expired';
  if (days <= 7) return 'warn';
  return 'ok';
}

type PillVariant = 'success' | 'warning' | 'danger' | 'neutral';

// lucide shields -> parity SemanticIcon glyphs (resolved once at module load).
const SHIELD_CHECK_GLYPH = getSemanticIconDefinition('securityCheck').glyph; // ShieldCheck
const SHIELD_ALERT_GLYPH = getSemanticIconDefinition('securityAlert').glyph; // ShieldAlert
const SHIELD_X_GLYPH = getSemanticIconDefinition('securityOff').glyph; // ShieldX
const EXTERNAL_LINK_GLYPH = getSemanticIconDefinition('externalLink').glyph; // ExternalLink

// web TONE map: per-severity bar fill, icon color, glyph, label, Badge variant.
// Tailwind bg-{color}-500/NN + text-{color}-{300,400} classes -> literal forms:
// green-500/40, amber-500/50, red-500/60, zinc-500/40 (bars); green-400 #4ade80,
// amber-300 #fcd34d, red-400 #f87171, zinc-400 #a1a1aa (icons).
const TONE: Record<
  Severity,
  {bar: string; icon: string; glyph: string; label: string; badge: PillVariant}
> = {
  ok: {
    bar: 'rgba(34, 197, 94, 0.4)',
    icon: '#4ade80',
    glyph: SHIELD_CHECK_GLYPH,
    label: 'Connected',
    badge: 'success',
  },
  warn: {
    bar: 'rgba(245, 158, 11, 0.5)',
    icon: '#fcd34d',
    glyph: SHIELD_ALERT_GLYPH,
    label: 'Expires soon',
    badge: 'warning',
  },
  expired: {
    bar: 'rgba(239, 68, 68, 0.6)',
    icon: '#f87171',
    glyph: SHIELD_X_GLYPH,
    label: 'Token expired',
    badge: 'danger',
  },
  disconnected: {
    bar: 'rgba(239, 68, 68, 0.6)',
    icon: '#f87171',
    glyph: SHIELD_X_GLYPH,
    label: 'Not connected',
    badge: 'danger',
  },
  unknown: {
    bar: 'rgba(113, 113, 122, 0.4)',
    icon: '#a1a1aa',
    glyph: SHIELD_ALERT_GLYPH,
    label: 'Unknown',
    badge: 'neutral',
  },
};

// web Badge dark-mode {color}-900 bg / {color}-200 text hex pairs.
const PILL_COLORS: Record<PillVariant, {bg: string; text: string}> = {
  success: {bg: '#14532d', text: '#bbf7d0'},
  warning: {bg: '#713f12', text: '#fef08a'},
  danger: {bg: '#7f1d1d', text: '#fecaca'},
  neutral: {bg: '#374151', text: '#e5e7eb'},
};

// web cyan CTA: bg-cyan-500/15, ring-cyan-400/30, text-cyan-200.
const CTA_BG = 'rgba(6, 182, 212, 0.15)';
const CTA_RING = 'rgba(34, 211, 238, 0.3)';
const CTA_TEXT = '#a5f3fc';

function Pill({variant, children}: {variant: PillVariant; children: string}) {
  const c = PILL_COLORS[variant];
  return (
    <View style={[styles.pill, {backgroundColor: c.bg}]}>
      <AppText style={[styles.pillText, {color: c.text}]}>{children}</AppText>
    </View>
  );
}

Pill.displayName = 'Pill';

export function TeslaAuthCard({
  authenticated,
  expiresAt,
  now,
  onNavigate,
}: TeslaAuthCardProps) {
  const sev = useMemo(
    () => severityFor(authenticated, expiresAt, now),
    [authenticated, expiresAt, now],
  );
  const tone = TONE[sev];
  const {glyph} = tone;

  const detail = useMemo(() => {
    if (sev === 'disconnected') {
      return 'No Tesla account is currently connected.';
    }
    if (!expiresAt) {
      return 'Token expiry unknown — re-authenticate to refresh.';
    }
    const exp = Date.parse(expiresAt);
    if (!Number.isFinite(exp)) {
      return 'Token expiry unparseable.';
    }
    const ms = exp - now;
    if (ms < 0) {
      const ago = Math.floor(-ms / (24 * 60 * 60 * 1000));
      return `Expired ${
        ago === 0 ? 'today' : `${ago}d ago`
      } — re-authenticate to resume Fleet API calls.`;
    }
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    if (days === 0) {
      return 'Token expires later today.';
    }
    if (days === 1) {
      return 'Token expires in 1 day.';
    }
    return `Token expires in ${days} days.`;
  }, [sev, expiresAt, now]);

  const ctaLabel =
    sev === 'expired' || sev === 'disconnected' ? 'Re-authenticate' : 'Manage';

  return (
    <GlassPanel style={styles.panel} accessibilityLiveRegion="polite">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.bar, {backgroundColor: tone.bar}]}
      />
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={[styles.iconGlyph, {color: tone.icon}]}>
            {glyph}
          </AppText>
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <AppText style={styles.title}>Tesla account</AppText>
            <Pill variant={tone.badge}>{tone.label}</Pill>
          </View>
          <AppText style={styles.detail}>{detail}</AppText>
        </View>
        <View style={styles.ctaWrap}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={ctaLabel}
            onPress={() => onNavigate?.('/tesla-account')}
            style={styles.cta}>
            <AppText style={styles.ctaText}>{ctaLabel}</AppText>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={styles.ctaIcon}>
              {EXTERNAL_LINK_GLYPH}
            </AppText>
          </Pressable>
        </View>
      </View>
    </GlassPanel>
  );
}

TeslaAuthCard.displayName = 'TeslaAuthCard';

const styles = StyleSheet.create({
  // overflow-hidden (so the severity bar clips to the GlassPanel radius)
  panel: {
    overflow: 'hidden',
  },
  // h-1 w-full {tone.bar}
  bar: {
    height: 4,
    width: '100%',
  },
  // flex items-start gap-3 p-5
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
  },
  // shrink-0 {tone.icon} wrapper around the h-6 w-6 (24px) icon
  iconWrap: {
    flexShrink: 0,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // flex-1 min-w-0
  body: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // flex items-center gap-2 flex-wrap
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  // text-sm font-semibold text-[var(--text-primary)]
  title: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  // text-sm text-[var(--text-secondary)] mt-1
  detail: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  // shrink-0 (CTA column)
  ctaWrap: {
    flexShrink: 0,
  },
  // inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-1.5
  // ring-1 ring-cyan-400/30 min-h-[36px]
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 6,
    backgroundColor: CTA_BG,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: CTA_RING,
    minHeight: 36,
  },
  // text-xs font-medium text-cyan-200
  ctaText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: CTA_TEXT,
  },
  // ExternalLink h-3.5 w-3.5, inheriting text-cyan-200
  ctaIcon: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: CTA_TEXT,
  },
  // Badge variant + md: rounded-full px-2 py-0.5 text-xs font-medium
  pill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 9999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});
