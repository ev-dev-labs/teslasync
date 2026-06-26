// Native parity port of web/src/features/system/pages/HelpPage.tsx.
//
// HelpPage is the deterministic baseline for the N6 RAG-backed app help slice
// (web L1-18). It renders the SAME curated link grid regardless of ai_mode; the
// AI surface (AIRAGHelp) is layered alongside via withAiFeature and only mounts
// when ai_mode != 'off' AND the rag-help toggle is on (ADR-015 §I3
// baseline-intact + §I5 hidden UI in off mode). The curated link set is
// intentionally short + stable so EVERY user — including off-mode users who
// never see the AI surface — has a single visible jumping-off point to the
// canonical destinations the app already exposes (docs API page, system status,
// chatbot, global search, onboarding). The set is duplicated in the off-mode
// test (TestRagHelpAIOffHidesAssistantAndDocsLinksWork) which asserts every
// entry is present; updating one MUST update the other.
//
// The web original leans on browser-only infrastructure with no native analogue,
// so — following the established conversion idiom (SafetyPage / GlancePage) —
// every such dependency is reproduced with React Native primitives + the shared
// native building blocks and documented in the sidecar:
//
//   - react-i18next `useTranslation` is not wired in native; i18next returns the
//     supplied default when a translation is missing, so a native English-default
//     `t(key, fallback)` keeps every help.* key verbatim. No call site
//     interpolates.
//   - usePageTitle(title) sets document.title — no native analogue — so it is
//     dropped; the same translated title renders in the on-screen header.
//   - @/components/layout PageContainer (title scaffold) is inlined as a
//     ScrollView + header (title), preserving the exact translated title.
//   - @/components/ui GlassPanel -> the already-ported native GlassPanel
//     (bordered glass surface). The web usage passed no `padding` prop; native
//     adds card padding so content does not clip the rounded border (the
//     established native GlassPanel idiom).
//   - @/components/ai AIRAGHelp is the already-converted native component and is
//     imported unchanged; it self-gates on ai_mode + the rag-help feature flag
//     (withAiFeature) and renders null when AI is off, so the section is absent
//     from the tree exactly like the web DOM (ADR-015 §I3/§I5).
//   - lucide-react icons (BookOpen, Rocket, ServerCog, Search, MessagesSquare)
//     have no native SVG analogue; each is mapped to the closest shared
//     SemanticIcon glyph (fileText, sparkles, server, search, bot). The
//     borderless inline ArrowRight becomes a muted `→` text glyph.
//   - react-router-dom `Link to={route}` performs in-app SPA navigation; React
//     Native has no DOM router, so each card becomes a Pressable
//     (accessibilityRole="link") whose onPress delegates to a native-safe
//     `onNavigate(to)` callback (the analogue of the SPA navigate), exactly the
//     pattern the native parity shell already uses for in-app navigation.
//   - Tailwind utility classes + CSS custom properties (var(--text-primary/
//     secondary/muted), text-cyan-300, bg-cyan-300/10) resolve to StyleSheet
//     styles against the native theme tokens; the responsive
//     `sm:grid-cols-2 lg:grid-cols-3` grid renders as the phone-breakpoint
//     single stacked column.
//
// HELP_LINKS (the deterministic curated set), every `to` value, every i18n key +
// English fallback, the section order (intro panel, then AIRAGHelp, then grid),
// and every testID marker are preserved. No DOM, react-i18next, react-router,
// lucide-react, Recharts, Leaflet, or old web UI components are imported.

import React from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {AIRAGHelp} from '../../../components/ai/AIRAGHelp';

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every help.* key verbatim. No call site interpolates.
function t(_key: string, fallback: string): string {
  return fallback;
}

// Native-safe replacement for react-router-dom `Link`'s in-app navigation: the
// resolved destination path is handed to the navigation shell. Optional so the
// page can be mounted before a shell wires navigation; when absent the tap is a
// no-op (the card still renders), mirroring a `Link` rendered without a router.
export type HelpNavigateHandler = (to: string) => void;

export interface HelpPageProps {
  onNavigate?: HelpNavigateHandler;
}

interface HelpLink {
  /** stable id used as React key + test marker */
  readonly id: string;
  /** target SPA route (existing canonical destinations only) */
  readonly to: string;
  /** shared SemanticIcon glyph standing in for the web lucide icon */
  readonly icon: SemanticIconName;
  /** i18n key for the link's display title */
  readonly titleKey: string;
  /** fallback English display title (used if translation is missing) */
  readonly titleFallback: string;
  /** i18n key for the one-line link description */
  readonly descKey: string;
  /** fallback English description */
  readonly descFallback: string;
}

// The curated link palette. Order is intentional: documentation first (most
// common entry point), then onboarding (for new users), then system status (for
// operators), then search (for everyone), then chatbot (for those who want to
// ask a question). Every `to` value points at an existing canonical route
// already mounted in the app — this page does NOT introduce any new
// entity-detail surface (ADR-015 §I3 baseline-intact). The web lucide icon for
// each row is mapped to the closest shared SemanticIcon glyph.
const HELP_LINKS: readonly HelpLink[] = [
  {
    id: 'docs-status-api',
    to: '/docs/status-api',
    icon: 'fileText', // web: BookOpen
    titleKey: 'help.baseline.links.docsStatusApi.title',
    titleFallback: 'Documentation',
    descKey: 'help.baseline.links.docsStatusApi.description',
    descFallback:
      'Browse the public API documentation including endpoints, schemas, and example requests.',
  },
  {
    id: 'onboarding',
    to: '/onboarding',
    icon: 'sparkles', // web: Rocket
    titleKey: 'help.baseline.links.onboarding.title',
    titleFallback: 'Onboarding',
    descKey: 'help.baseline.links.onboarding.description',
    descFallback:
      'Walk through the first-time setup wizard to connect a Tesla account and configure live telemetry.',
  },
  {
    id: 'system-status',
    to: '/system-status',
    icon: 'server', // web: ServerCog
    titleKey: 'help.baseline.links.systemStatus.title',
    titleFallback: 'System status',
    descKey: 'help.baseline.links.systemStatus.description',
    descFallback:
      'Inspect the live health of every backend service: database, MQTT, Redis, and the Tesla API.',
  },
  {
    id: 'search',
    to: '/search',
    icon: 'search', // web: Search
    titleKey: 'help.baseline.links.search.title',
    titleFallback: 'Search',
    descKey: 'help.baseline.links.search.description',
    descFallback:
      'Find drives, charging sessions, alerts, and other records using typed filters.',
  },
  {
    id: 'chatbot',
    to: '/chatbot',
    icon: 'bot', // web: MessagesSquare
    titleKey: 'help.baseline.links.chatbot.title',
    titleFallback: 'Chatbot',
    descKey: 'help.baseline.links.chatbot.description',
    descFallback:
      'Talk to the in-app assistant. Available in deterministic mode or LLM mode when Helix is enabled.',
  },
];

interface HelpLinkCardProps {
  link: HelpLink;
  onNavigate?: HelpNavigateHandler;
}

// One curated link card. The whole card is the tap target (web: the entire
// `<Link>`), so it is a Pressable accessibilityRole="link" that delegates to
// onNavigate(link.to). The pressed state stands in for the web focus-visible
// cyan ring.
function HelpLinkCard({link, onNavigate}: HelpLinkCardProps) {
  const title = t(link.titleKey, link.titleFallback);
  const description = t(link.descKey, link.descFallback);

  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="link"
      onPress={() => onNavigate?.(link.to)}
      style={({pressed}) => [styles.cardPressable, pressed && styles.cardPressed]}
      testID={`help-baseline-link-${link.id}`}>
      <GlassPanel style={styles.card}>
        <View style={styles.cardRow}>
          <SemanticIcon name={link.icon} size="md" decorative />
          <View style={styles.cardBody}>
            <View style={styles.cardTitleRow}>
              <AppText style={styles.cardTitle} weight="semibold">
                {title}
              </AppText>
              <AppText style={styles.cardArrow}>{'\u2192'}</AppText>
            </View>
            <AppText style={styles.cardDesc}>{description}</AppText>
          </View>
        </View>
      </GlassPanel>
    </Pressable>
  );
}

export default function HelpPage({onNavigate}: HelpPageProps = {}) {
  // usePageTitle(t('help.title','Help')) sets document.title on web — no native
  // analogue, so the same translated title renders in the header below.
  const pageTitle = t('help.title', 'Help');

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={styles.screen}
      testID="help-page">
      {/* PageContainer title scaffold, inlined. */}
      <View style={styles.header}>
        <AppText variant="title" weight="bold">
          {pageTitle}
        </AppText>
      </View>

      {/* space-y-6 block: intro panel, then AIRAGHelp, then the curated grid. */}
      <View style={styles.stack}>
        <GlassPanel style={styles.introPanel}>
          <AppText style={styles.introText}>
            {t(
              'help.intro',
              'Get started with TeslaSync. The links below cover the most common questions; for anything else, ask the in-app assistant or open the documentation.',
            )}
          </AppText>
        </GlassPanel>

        {/* Absent from the tree when AI is off (withAiFeature -> null). */}
        <AIRAGHelp />

        <View style={styles.grid} testID="help-baseline-links">
          {HELP_LINKS.map(link => (
            <HelpLinkCard key={link.id} link={link} onNavigate={onNavigate} />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  stack: {
    gap: spacing.lg,
  },
  introPanel: {
    padding: spacing.lg,
  },
  introText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  grid: {
    gap: spacing.md,
  },
  cardPressable: {
    borderRadius: 24,
  },
  cardPressed: {
    opacity: 0.82,
  },
  card: {
    padding: spacing.lg,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  cardArrow: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.textMuted,
  },
  cardDesc: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
});
