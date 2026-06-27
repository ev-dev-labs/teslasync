// Native parity port of web/src/features/system/pages/RoadmapPage.tsx.
//
// The web module is the product "Roadmap" page: a <PageContainer title subtitle>
// that renders (1) a phase-progress bar GlassPanel — a horizontally scrollable
// row of done/current/next/future markers (colored dot + label + count Badge,
// separated by hairlines) — followed by (2) one section per phase, each a
// FadeIn'd colored heading (PhaseIcon + label) above a Stagger grid of
// RoadmapCards. Every RoadmapCard is a GlassPanel with a faint phase-colored
// blob, a tinted icon box + title + description + phase Badge header, and a
// bulleted feature list whose leading glyph encodes the phase (check = done,
// zap = current, clock = up-next/future). The data is a 16-entry static array;
// the page makes no API calls.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?) returns the English fallback (or the key); the parity
//     bundle ships no i18n runtime, so every `roadmap.*` key is preserved at the
//     call site verbatim.
//   • usePageTitle(title) -> a native no-op hook (RN has no document.title); the
//     call site + its translated title key are kept.
//   • @/lib/cn -> dropped; the responsive Tailwind grid class strings carry no
//     native effect (the cards stack 1-up, matching the web mobile breakpoint)
//     and are replaced by a StyleSheet.
//   • @/types/admin RoadmapPhase -> the same string-literal union, defined inline
//     (verbatim shape) since it is plain type data.
//   • lucide-react glyphs (Rocket/CheckCircle/Clock/Star/Zap/Bell/Smartphone/
//     Cloud/Brain/Plug/Shield/Map/BarChart3/Leaf/Globe/Wrench/Users) -> a local
//     ICON_GLYPH text-glyph map (short codes in the SemanticIcon registry style)
//     rendered by a color-aware GlyphIcon, since RN has no SVG icon set and the
//     app icon system is glyph-based. The per-phase icon color is applied
//     directly (the `style={{ color: phase.color }}` dynamic value is preserved).
//   • The shared web <PageContainer>/<GlassPanel>/<Badge>/<FadeIn>/
//     <StaggerContainer>/<StaggerItem> -> an inlined native PageContainer
//     (ScrollView + header), an inlined Badge (success/info/warning/danger pill),
//     the already-ported native GlassPanel + FadeIn, and a plain stack whose
//     cards each FadeIn with an incremental delay to reproduce the stagger entrance.
// No DOM elements, react-i18next, lucide-react, framer-motion, Recharts, Leaflet,
// react-dom, or web UI-kit modules are imported into the native output.

import React, {useCallback, type ReactNode} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {FadeIn} from '../../../components/motion/FadeIn';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (web react-i18next useTranslation)                   */
/* ------------------------------------------------------------------ */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ------------------------------------------------------------------ */
/*  Types & Config                                                     */
/* ------------------------------------------------------------------ */

// web @/types/admin RoadmapPhase (verbatim string-literal union).
type RoadmapPhase = 'done' | 'current' | 'next' | 'future';

// web lucide nodes -> native glyph keys (see ICON_GLYPH below).
type RoadmapIconName =
  | 'rocket'
  | 'check'
  | 'clock'
  | 'star'
  | 'zap'
  | 'bell'
  | 'smartphone'
  | 'cloud'
  | 'brain'
  | 'plug'
  | 'shield'
  | 'map'
  | 'barChart'
  | 'leaf'
  | 'globe'
  | 'wrench'
  | 'users';

interface RoadmapEntry {
  title: string;
  description: string;
  // web `icon: React.ElementType` (lucide node) -> native glyph key.
  icon: RoadmapIconName;
  phase: RoadmapPhase;
  features: string[];
}

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger';

const phaseConfig: Record<
  RoadmapPhase,
  {label: string; color: string; variant: BadgeVariant}
> = {
  done: {label: 'Completed', color: '#10b981', variant: 'success'},
  current: {label: 'In Progress', color: '#00f0ff', variant: 'info'},
  next: {label: 'Up Next', color: '#a855f7', variant: 'warning'},
  future: {label: 'Future', color: '#f59e0b', variant: 'danger'},
};

const PHASE_ICONS: Record<RoadmapPhase, RoadmapIconName> = {
  done: 'check', // CheckCircle
  current: 'zap', // Zap
  next: 'star', // Star
  future: 'rocket', // Rocket
};

// web lucide glyphs -> short native text glyphs (SemanticIcon-registry style).
const ICON_GLYPH: Record<RoadmapIconName, string> = {
  rocket: 'RK', // Rocket
  check: 'OK', // CheckCircle
  clock: 'CK', // Clock
  star: 'ST', // Star
  zap: 'ZP', // Zap
  bell: 'BL', // Bell
  smartphone: 'PH', // Smartphone
  cloud: 'CD', // Cloud
  brain: 'AI', // Brain
  plug: 'PL', // Plug
  shield: 'SH', // Shield
  map: 'MP', // Map
  barChart: 'BC', // BarChart3
  leaf: 'LF', // Leaf
  globe: 'GL', // Globe
  wrench: 'WR', // Wrench
  users: 'US', // Users
};

/* ------------------------------------------------------------------ */
/*  Roadmap data                                                       */
/* ------------------------------------------------------------------ */

const roadmapItems: RoadmapEntry[] = [
  {
    title: 'Core Platform',
    description: 'Real-time fleet monitoring, analytics, and vehicle control',
    icon: 'rocket',
    phase: 'done',
    features: [
      'Real-time vehicle state tracking via SSE',
      'Live GPS map with animated markers',
      'Remote vehicle commands (14 commands)',
      'Drive and charging session recording',
      'Energy analytics and efficiency scoring',
      'Battery health monitoring and degradation tracking',
      'PWA support — installable on any device',
      'Command palette (Cmd+K) navigation',
      'Grafana dashboards (16 pre-built)',
      'MQTT telemetry publishing',
      'CSV and JSON data export',
    ],
  },
  {
    title: 'Smart Notifications',
    description: 'Multi-channel alerts, scheduling, and custom automation rules',
    icon: 'bell',
    phase: 'done',
    features: [
      'Discord, Slack, and Telegram integrations',
      'Webhook, ntfy, and Pushover channels',
      'Custom alert rules (battery, speed, charge, geofence, sentry)',
      'Battery level thresholds with configurable triggers',
      'Geofence enter/exit notifications',
      'Charging completion alerts',
      'Notification history, analytics, and metrics',
      'Scheduled & recurring notifications',
      'Per-channel notification preferences',
    ],
  },
  {
    title: 'Intelligence & Observability',
    description: 'Advanced analytics, system health, and background processing',
    icon: 'brain',
    phase: 'done',
    features: [
      'Fleet analytics with deep drive/charging/battery insights',
      'System status and component health dashboard',
      'Natural language chatbot for vehicle queries',
      'Async export worker (MQTT-backed background jobs)',
      'Audit trail logging',
      'API key management with HMAC authentication',
      '25+ developer tools (VIN decoder, JWT decoder, API diagnostics)',
      'Parallel CI/CD Docker builds',
    ],
  },
  {
    title: 'Fleet Telemetry',
    description: 'Real-time streaming from vehicles via Tesla Fleet Telemetry',
    icon: 'zap',
    phase: 'done',
    features: [
      'Full signal ingestion (50+ signals — driving, charging, climate, TPMS)',
      'Hybrid poll/stream mode (auto-reduces polling when streaming)',
      'Drive & charge session detection from streaming data',
      'Alert evaluation from streaming signals',
      'SSE broadcast of streamed telemetry to frontend',
      'Per-vehicle streaming health monitoring',
      'Bundled or external Fleet Telemetry server support',
    ],
  },
  {
    title: 'Premium UI & Design System',
    description:
      'Shared component library, accessibility, and consistent design language',
    icon: 'star',
    phase: 'done',
    features: [
      '17-component shared library (Button, Input, Select, Modal, DataTable, etc.)',
      'WCAG AA accessibility — focus traps, keyboard nav, ARIA labels, contrast',
      'Light and dark mode with 5 neon color themes',
      'Glassmorphism design tokens and cn() utility',
      'Error and loading states across all 77 pages',
      'Global decimal precision control (0–20)',
      'SVG car visualization per Tesla model',
      'Page title hooks for screen readers',
    ],
  },
  {
    title: 'External Integrations',
    description: 'Connect with calendars, weather, and smart home systems',
    icon: 'plug',
    phase: 'current',
    features: [
      'Home Assistant MQTT auto-discovery',
      'Calendar integration for trip planning',
      'Weather-adjusted range predictions',
      'IFTTT and Zapier webhooks',
      'Electricity rate API for cost optimization',
      'Fleet Telemetry deployment wizard',
    ],
  },
  {
    title: 'Enhanced Visualization',
    description: 'Interactive replays, custom dashboards, and advanced maps',
    icon: 'star',
    phase: 'next',
    features: [
      'Interactive trip replay with elevation profile',
      'Charging station map overlay',
      'Fleet heatmap showing high-traffic corridors',
      'Custom dashboard builder (drag-and-drop widgets)',
      'Signal-level real-time graphs for Fleet Telemetry',
      'Streaming vs polling cost comparison dashboard',
    ],
  },
  {
    title: 'Helix & Predictive Analytics',
    description: 'Machine learning models for predictive insights',
    icon: 'brain',
    phase: 'next',
    features: [
      'Predictive battery degradation modeling',
      'Optimal charging schedule recommendations',
      'Driving pattern analysis and coaching',
      'Anomaly detection for vehicle health',
      'Energy cost forecasting',
      'Range prediction based on weather + route + driving style',
    ],
  },
  {
    title: 'Enterprise & Scale',
    description: 'Multi-tenant support, advanced security, and horizontal scaling',
    icon: 'cloud',
    phase: 'future',
    features: [
      'Multi-tenant fleet management',
      'Role-based access control (RBAC)',
      'SSO / SAML authentication',
      'Horizontal scaling with load balancing',
      'Compliance reporting (SOC 2, GDPR)',
      'White-label customization',
      'API rate limiting per tenant',
      'Audit log export and retention policies',
    ],
  },
  {
    title: 'Mobile App',
    description: 'Native mobile experience for iOS and Android',
    icon: 'smartphone',
    phase: 'future',
    features: [
      'Native iOS and Android apps (React Native)',
      'Widgets for battery level and charging status',
      'Background push notifications',
      'Apple Watch / Wear OS companion',
      'Offline mode with local data caching',
      'Biometric authentication (Face ID / fingerprint)',
      'Quick actions — lock, unlock, climate from home screen',
    ],
  },
  {
    title: 'Advanced Fleet Intelligence',
    description:
      'Fleet-wide insights, benchmarking, and operational optimization',
    icon: 'barChart',
    phase: 'future',
    features: [
      'Fleet-wide efficiency leaderboard and benchmarks',
      'Total cost of ownership (TCO) calculator per vehicle',
      'Maintenance prediction and service scheduling',
      'Driver behavior scoring with gamification',
      'Fleet utilization reports and idle vehicle detection',
      'Carbon offset tracking and sustainability reports',
      'Automated monthly/quarterly fleet digest emails',
    ],
  },
  {
    title: 'Smart Routing & Navigation',
    description:
      'Intelligent trip planning with charging stops and real-time conditions',
    icon: 'map',
    phase: 'future',
    features: [
      'Multi-stop trip planner with optimal charging stops',
      'Real-time Supercharger availability and queue times',
      'Elevation-aware range estimation',
      'Weather and traffic impact on range calculation',
      'Charging cost comparison across networks (Tesla, ChargePoint, etc.)',
      'Shareable trip plans with ETA and charging schedule',
      'Historical route efficiency analysis',
    ],
  },
  {
    title: 'Security & Privacy',
    description: 'Advanced security features and privacy controls',
    icon: 'shield',
    phase: 'future',
    features: [
      'End-to-end encryption for all vehicle data',
      'Geo-restricted access zones (block commands outside regions)',
      'Valet mode monitoring with speed/area alerts',
      'Theft detection with instant notifications and GPS tracking',
      'Data anonymization for shared fleet analytics',
      'Configurable data retention and auto-purge policies',
      'Two-factor authentication for critical commands',
    ],
  },
  {
    title: 'Smart Home & EV Ecosystem',
    description: 'Deep integration with home energy, solar, and smart devices',
    icon: 'leaf',
    phase: 'future',
    features: [
      'Tesla Powerwall and Solar Roof integration',
      'Smart charging — charge when solar production is high',
      'Time-of-use electricity rate optimization',
      'Vehicle-to-home (V2H) energy flow monitoring',
      'Smart home scene triggers (arrive home → lights on, garage open)',
      'Amazon Alexa and Google Home voice commands',
      'Apple HomeKit and Matter protocol support',
    ],
  },
  {
    title: 'Community & Social',
    description: 'Connect with other Tesla owners, share data, and compete',
    icon: 'users',
    phase: 'future',
    features: [
      'Public efficiency leaderboards (opt-in)',
      'Road trip sharing with photos and stats',
      'Community charging station reviews and ratings',
      'Fleet comparison — how does your car stack up?',
      'Achievement badges (100k miles, 1000 charges, etc.)',
      'Community-contributed alert rules marketplace',
      'Regional Tesla meetup and event discovery',
    ],
  },
  {
    title: 'Developer Platform',
    description: 'Open APIs, plugins, and extensibility for power users',
    icon: 'wrench',
    phase: 'future',
    features: [
      'Public REST API with OAuth 2.0',
      'GraphQL API for flexible data queries',
      'Plugin system for custom dashboard widgets',
      'Custom automation scripting (JavaScript/Python)',
      'Webhook builder with visual flow editor',
      'Community plugin marketplace',
      'CLI tool for headless fleet management',
    ],
  },
  {
    title: 'Global & Multi-Brand',
    description: 'Expand beyond Tesla to support all electric vehicles',
    icon: 'globe',
    phase: 'future',
    features: [
      'Rivian, Polestar, and BMW i integration',
      'Ford Mustang Mach-E and F-150 Lightning support',
      'Hyundai/Kia EV platform support',
      'Multi-language localization (20+ languages)',
      'Region-specific charging network integrations',
      'Universal OBD-II dongle support for any EV',
      'Cross-brand fleet management for mixed fleets',
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  GlyphIcon — color-aware lucide glyph substitute                    */
/* ------------------------------------------------------------------ */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: RoadmapIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {ICON_GLYPH[name]}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge (subset: variants + size="sm")       */
/* ------------------------------------------------------------------ */

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText
        style={[styles.badgeText, badgeTextStyles[variant]]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/layout PageContainer (subset used here)        */
/* ------------------------------------------------------------------ */

function PageContainer({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <View style={styles.pageHeader}>
        <AppText style={styles.pageTitle} weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.sections}>{children}</View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  RoadmapCard                                                        */
/* ------------------------------------------------------------------ */

function RoadmapCard({item, t}: {item: RoadmapEntry; t: TFunc}) {
  const phase = phaseConfig[item.phase];

  // web feature-row leading glyph: done -> green check, current -> cyan zap,
  // else -> muted clock.
  const featureGlyph: {name: RoadmapIconName; color: string} =
    item.phase === 'done'
      ? {name: 'check', color: '#4ade80'}
      : item.phase === 'current'
        ? {name: 'zap', color: '#22d3ee'}
        : {name: 'clock', color: colors.textMuted};

  return (
    <GlassPanel style={styles.card}>
      {/* faint phase-colored blob (web `blur-[60px] opacity-5`) */}
      <View
        pointerEvents="none"
        style={[styles.cardBlob, {backgroundColor: phase.color}]}
      />
      <View>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View
              style={[styles.iconBox, {backgroundColor: `${phase.color}15`}]}>
              <GlyphIcon name={item.icon} color={phase.color} size={13} />
            </View>
            <View style={styles.cardHeaderText}>
              <AppText style={styles.cardTitle} weight="semibold">
                {item.title}
              </AppText>
              <AppText style={styles.cardDesc} tone="muted">
                {item.description}
              </AppText>
            </View>
          </View>
          <Badge variant={phase.variant}>
            {t(`roadmap.phase.${item.phase}`, phase.label)}
          </Badge>
        </View>

        <View style={styles.featureList}>
          {item.features.map((f, i) => (
            <View key={i} style={styles.featureRow}>
              <View style={styles.featureBullet}>
                <GlyphIcon
                  name={featureGlyph.name}
                  color={featureGlyph.color}
                  size={11}
                />
              </View>
              <AppText style={styles.featureText} tone="secondary">
                {f}
              </AppText>
            </View>
          ))}
        </View>
      </View>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function RoadmapPage() {
  const {t} = useTranslation();
  usePageTitle(t('roadmap.title', 'Roadmap'));

  const phases: RoadmapPhase[] = ['done', 'current', 'next', 'future'];

  return (
    <PageContainer
      title={t('roadmap.title', 'Roadmap')}
      subtitle={t(
        'roadmap.subtitle',
        "What's been built, what's in progress, and what's coming next",
      )}>
      {/* Phase progress bar */}
      <FadeIn>
        <GlassPanel style={styles.progressPanel}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.progressRow}>
            {phases.map((phase, i) => {
              const config = phaseConfig[phase];
              const count = roadmapItems.filter(
                item => item.phase === phase,
              ).length;
              return (
                <View key={phase} style={styles.progressItem}>
                  <View style={styles.progressMarker}>
                    <View
                      style={[styles.dot, {backgroundColor: config.color}]}
                    />
                    <AppText
                      style={[styles.phaseLabel, {color: config.color}]}
                      weight="semibold">
                      {t(`roadmap.phase.${phase}`, config.label)}
                    </AppText>
                    <Badge variant={config.variant}>{count}</Badge>
                  </View>
                  {i < phases.length - 1 ? (
                    <View style={styles.separator} />
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </GlassPanel>
      </FadeIn>

      {/* Roadmap cards by phase */}
      {phases.map(phase => {
        const items = roadmapItems.filter(item => item.phase === phase);
        if (items.length === 0) {
          return null;
        }
        const config = phaseConfig[phase];
        const phaseIcon = PHASE_ICONS[phase];
        return (
          <View key={phase}>
            <FadeIn>
              <View style={styles.sectionHeaderRow}>
                <GlyphIcon name={phaseIcon} color={config.color} size={15} />
                <AppText
                  style={[styles.sectionHeaderText, {color: config.color}]}
                  weight="bold">
                  {t(`roadmap.phase.${phase}`, config.label)}
                </AppText>
              </View>
            </FadeIn>
            <View style={styles.cardsStack}>
              {items.map((item, i) => (
                <FadeIn key={item.title} delay={i * 0.06}>
                  <RoadmapCard item={item} t={t} />
                </FadeIn>
              ))}
            </View>
          </View>
        );
      })}
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: 24,
  },
  pageHeader: {
    gap: 4,
  },
  pageTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  sections: {
    gap: 24,
  },
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  // Phase progress bar.
  progressPanel: {
    padding: spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressMarker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  phaseLabel: {
    fontSize: 12,
  },
  separator: {
    width: 40,
    height: 1,
    marginHorizontal: 12,
    backgroundColor: colors.border,
  },
  // Section heading.
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionHeaderText: {
    fontSize: 18,
    lineHeight: 24,
  },
  // Roadmap cards.
  cardsStack: {
    gap: 16,
  },
  card: {
    padding: 20,
    overflow: 'hidden',
  },
  cardBlob: {
    position: 'absolute',
    top: -28,
    right: -28,
    width: 128,
    height: 128,
    borderRadius: 64,
    opacity: 0.05,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHeaderText: {
    flexShrink: 1,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  cardDesc: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  featureList: {
    marginTop: 16,
    gap: 6,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  featureBullet: {
    width: 16,
    alignItems: 'center',
    marginTop: 1,
  },
  featureText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  // Badge.
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 15,
  },
});

const badgeVariantStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  info: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderColor: 'rgba(59, 130, 246, 0.32)',
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  info: {
    color: '#93c5fd',
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
});
