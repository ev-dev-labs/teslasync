// Native parity port of
// web/src/features/system/components/status/SubscribeCard.tsx (60 lines).
//
// SubscribeCard is the alert-channel discoverability tile on /system-status. It
// deliberately does NOT reimplement subscription management: self-hosted
// operators already configure email / Slack / Discord / webhook channels via
// /notifications/channels and browser push via /settings/notifications, so this
// card is just a one-click route to all of those channel setups in one place —
// the "how do I get notified about this" answer when the operator lands on the
// status page.
//
// Native-targeting decisions (no DOM, no react-router-dom, no lucide-react, no
// Tailwind, no web UI kit):
//   * `@/components/ui` GlassPanel -> the native GlassPanel primitive.
//   * react-router-dom <Link to=...> -> a module-level navigation sink
//     subscribeCardNavigate / setSubscribeCardNavigator (the same convention as
//     the sibling BackgroundWorkersCard port). Each tile is a Pressable
//     (accessibilityRole="link") whose onPress calls the sink with the SAME
//     route string the web Link used ('/notifications/channels' or
//     '/settings/notifications'). The native tree mounts no router here, so the
//     default is a host-overridable no-op.
//   * lucide-react Bell / Mail / MessageSquare / Hash / Webhook / Smartphone ->
//     short text glyphs rendered as AppText (the same way sibling native ports
//     render small lucide glyphs). Bell reuses the repo-canonical
//     SemanticIcon('notifications') glyph; the five channel icons — none of which
//     has a SemanticIcon equivalent (the set has no mail/chat/hash/webhook/phone)
//     — use intuitive per-channel glyphs ('@' Email, 'SL' Slack, '#' Discord per
//     the sibling HashCalculator '#' precedent, 'WH' Webhook, 'PH' Browser push).
//   * Tailwind utility strings + CSS variables -> React Native StyleSheet using
//     the shared design tokens: hover:bg -> the pressed state; --border-subtle ->
//     colors.border; bg-white/[0.02] -> colors.surfaceRaised; text-cyan-300 ->
//     colors.accent; the grid-cols-1 sm:grid-cols-2 layout -> a flex-wrap row
//     whose tiles carry a minWidth floor so they stack one-up on a phone and sit
//     two-up once there is room (the responsive-wrap convention used by the
//     sibling BackgroundWorkersCard summary).
//   * The source has no i18n runtime (all copy is literal English) -> every
//     string is preserved verbatim.
//
// Line coverage: see the SubscribeCard.tsx.parity.json sidecar.

import { Pressable, StyleSheet, View } from 'react-native';

import { getSemanticIconDefinition } from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../theme/tokens';

// The web tiles used react-router's <Link to=...>. The native parity tree mounts
// no router here, so the tap defaults to a host-overridable no-op; it is called
// with the SAME route string ('/notifications/channels' | '/settings/notifications')
// the web Link used.
type SubscribeCardNavigate = (to: string) => void;
let subscribeCardNavigate: SubscribeCardNavigate = () => {};

export function setSubscribeCardNavigator(fn: SubscribeCardNavigate): void {
  subscribeCardNavigate = fn;
}

// lucide -> short text glyphs. Bell reuses the repo-canonical SemanticIcon
// 'notifications' glyph; the channel icons have no SemanticIcon equivalent and
// use intuitive per-channel abbreviations (resolved once at module scope).
const BELL_GLYPH = getSemanticIconDefinition('notifications').glyph;
const MAIL_GLYPH = '@';
const SLACK_GLYPH = 'SL';
const DISCORD_GLYPH = '#';
const WEBHOOK_GLYPH = 'WH';
const PUSH_GLYPH = 'PH';

interface ChannelTileProps {
  to: string;
  // Web `icon: typeof Bell` (a LucideIcon component) -> a native glyph string,
  // since native renders these small icons as text rather than as an <svg>.
  icon: string;
  label: string;
  description: string;
}

function ChannelTile({ to, icon, label, description }: ChannelTileProps) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => subscribeCardNavigate(to)}
      style={({ pressed }) => [styles.tile, pressed ? styles.tilePressed : null]}>
      <AppText style={styles.tileIcon}>{icon}</AppText>
      <View style={styles.tileBody}>
        <AppText style={styles.tileLabel}>{label}</AppText>
        <AppText style={styles.tileDescription}>{description}</AppText>
      </View>
    </Pressable>
  );
}

export function SubscribeCard() {
  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.header}>
        <AppText style={styles.headerGlyph}>{BELL_GLYPH}</AppText>
        <AppText accessibilityRole="header" style={styles.headerTitle}>
          Get notified about incidents
        </AppText>
      </View>
      <AppText style={styles.subtitle}>
        Self-hosted: configure your own channels for status events.
      </AppText>
      <View style={styles.grid}>
        <ChannelTile
          to="/notifications/channels"
          icon={MAIL_GLYPH}
          label="Email"
          description="SMTP-based delivery"
        />
        <ChannelTile
          to="/notifications/channels"
          icon={SLACK_GLYPH}
          label="Slack"
          description="Webhook channel"
        />
        <ChannelTile
          to="/notifications/channels"
          icon={DISCORD_GLYPH}
          label="Discord"
          description="Webhook channel"
        />
        <ChannelTile
          to="/notifications/channels"
          icon={WEBHOOK_GLYPH}
          label="Webhook"
          description="Custom HTTP endpoint"
        />
        <ChannelTile
          to="/settings/notifications"
          icon={PUSH_GLYPH}
          label="Browser push"
          description="Opt-in PWA notifications"
        />
      </View>
    </GlassPanel>
  );
}

SubscribeCard.displayName = 'SubscribeCard';

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  headerGlyph: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 18,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  panel: {
    padding: spacing.md,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  tile: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.md,
    minWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  tileBody: {
    flex: 1,
  },
  tileDescription: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  tileIcon: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
    lineHeight: 18,
    marginTop: 2,
    textAlign: 'center',
    width: 18,
  },
  tileLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  tilePressed: {
    backgroundColor: colors.surfaceHover,
  },
});
