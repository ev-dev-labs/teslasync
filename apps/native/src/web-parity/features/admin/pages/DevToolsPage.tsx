// Native parity port of web/src/features/admin/pages/DevToolsPage.tsx.
//
// `DevToolsPage` is a thin shell with a tabbed layout: a horizontal tab bar
// (Fleet API / Telemetry / Infrastructure / Utilities / Reference) above a
// `FadeIn`-wrapped body that swaps the active section. The state name (`tab`),
// the active-tab value, the tab keys/labels, and the i18n intent are preserved
// verbatim from the web source.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4/5/7):
//   - react-i18next `useTranslation` (L1) -> the standard web-parity i18n shim
//     returning the inline English fallback (deps lack react-i18next), so the
//     component body's `t('key', 'English')` calls are unchanged.
//   - lucide-react Globe/Radio/Server/Wrench/BookOpen (L2-4, SVG) have no native
//     analog -> decorative emoji glyphs in the local `TABS` table. The label is
//     always rendered next to the glyph, so the glyph is decorative for a11y
//     (Globe -> '\u{1F310}', Radio -> '\u{1F4E1}', Server -> '\u{1F5A5}',
//     Wrench -> '\u{1F527}', BookOpen -> '\u{1F4D6}').
//   - `PageContainer` (L5) -> the web-parity layout `PageContainer` (reused).
//   - `TabNav` (L6) from `@/components/ui` is not ported yet, so its chrome
//     (rounded pill bar + per-tab icon+label, active/inactive states, horizontal
//     overflow scroll) is reproduced by a local `TabNav` helper — the same
//     "own the unported sibling locally" approach the FleetTelemetryHealth port
//     used for ToolCard. The web `hover:text-secondary` affordance has no touch
//     analog and collapses into a Pressable pressed style.
//   - `FadeIn` (L7) -> the web-parity motion `FadeIn` (reused); keyed by `tab`
//     so it re-animates on tab change, matching the source `<FadeIn key={tab}>`.
//   - `usePageTitle` (L8) writes `document.title`; native has no DOM document
//     and the browser-tab title has no analog, so it is a documented native-safe
//     no-op shim (the call site is kept so the translated title is still
//     computed identically and PageContainer still renders it as the header).
//   - `useUrlEnum` (L9) mirrors the active tab into the `?tab=` URL query via
//     react-router-dom; native has no DOM URL/history, so it is a local
//     useState-backed shim with the SAME (key, allowed, defaultValue) signature
//     and the SAME enum guard (a value outside `allowed` falls back to the
//     default). URL persistence / bookmarking is UNAVAILABLE on native.
//   - the five section components (L11-17) are imported from the
//     `../components/devtools` barrel on web. Only `FleetTelemetryHealth` has a
//     native parity port so far; it is imported and rendered for real. The other
//     four (FleetApiSection / InfrastructureSection / ClientUtilitiesSection /
//     ReferenceLinksSection) are separate web source files not yet converted, so
//     each renders a native-safe `PendingSection` placeholder with an explicit
//     "unavailable" state (contract rule 7). When those siblings are converted
//     the placeholders are swapped for their imports.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported — only React + react-native primitives (View /
// Pressable / ScrollView / StyleSheet), the web-parity PageContainer / FadeIn,
// the ported FleetTelemetryHealth, the shared AppText / GlassPanel, and theme
// tokens. Tailwind classes map to StyleSheet: rounded-xl -> 12, rounded-lg -> 8,
// p-1/gap-1 -> 4, gap-1.5 -> 6, space-y-6 -> gap 24, bg-white/[0.02]/[0.06]/
// [0.08] -> rgba literals, --text-primary/secondary/muted -> colors.text*.

import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn} from '../../../components/motion';
import {FleetTelemetryHealth} from '../components/devtools/FleetTelemetryHealth';

// ── i18n shim ────────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ── usePageTitle shim ────────────────────────────────────────────────────────
// The web hook writes `document.title`. Native has no DOM document and the
// browser-tab title has no analog, so this is a documented native-safe no-op.
// The call site is kept so the translated title is still computed identically
// (and PageContainer renders it as the on-screen page header).
function usePageTitle(title: string): void {
  useEffect(() => {
    // Intentionally no side effect — see header note. A future native title
    // surface (e.g. a nav header) could read `title` here.
    return undefined;
  }, [title]);
}

// ── useUrlEnum shim ──────────────────────────────────────────────────────────
// The web hook mirrors a single enum value into the `?tab=` URL query string via
// react-router-dom. Native has no DOM URL/history, so this is a useState-backed
// shim with the SAME (key, allowed, defaultValue) signature and the SAME enum
// guard: a value outside `allowed` falls back to the default (protecting against
// a stale/invalid value the way the web parse guard does). URL persistence and
// bookmarking are unavailable on native (documented in the parity sidecar).
function useUrlEnum<E extends string>(
  _key: string,
  allowed: readonly E[],
  defaultValue: E,
): [E, (value: E) => void] {
  const [value, setValue] = useState<E>(defaultValue);
  const setEnum = useCallback(
    (next: E) => setValue(allowed.includes(next) ? next : defaultValue),
    [allowed, defaultValue],
  );
  return [value, setEnum];
}

/* ─── tab definitions ─────────────────────────────────────────────────── */

const TAB_KEY = 'tab';
const DEFAULT_TAB = 'fleet-api';

interface TabDef {
  key: string;
  label: string;
  /** Decorative emoji glyph standing in for the lucide icon. */
  glyph: string;
}

// lucide icons (Globe/Radio/Server/Wrench/BookOpen) -> decorative emoji glyphs;
// the always-visible label carries the meaning, so each glyph is decorative.
const TABS: TabDef[] = [
  {key: 'fleet-api', label: 'Fleet API', glyph: '\u{1F310}'},
  {key: 'telemetry', label: 'Telemetry', glyph: '\u{1F4E1}'},
  {key: 'infrastructure', label: 'Infrastructure', glyph: '\u{1F5A5}\u{FE0F}'},
  {key: 'utilities', label: 'Utilities', glyph: '\u{1F527}'},
  {key: 'reference', label: 'Reference', glyph: '\u{1F4D6}'},
];

const TAB_KEYS = [
  'fleet-api',
  'telemetry',
  'infrastructure',
  'utilities',
  'reference',
] as const;
type TabKey = (typeof TAB_KEYS)[number];

// Tailwind bg-white/[N] tints (no className analog on native).
const TAB_BAR_BG = 'rgba(255, 255, 255, 0.02)'; // bg-white/[0.02]
const TAB_BAR_BORDER = 'rgba(255, 255, 255, 0.06)'; // border-white/[0.06]
const TAB_ACTIVE_BG = 'rgba(255, 255, 255, 0.08)'; // bg-white/[0.08]

// ── TabNav (web @/components/ui TabNav not ported; local chrome) ──────────────
interface TabNavProps {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}

function TabNav({tabs, active, onChange}: TabNavProps) {
  return (
    <ScrollView
      accessibilityRole="tablist"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabBar}
      contentContainerStyle={styles.tabBarContent}>
      {tabs.map(tab => {
        const isActive = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{selected: isActive}}
            hitSlop={4}
            onPress={() => onChange(tab.key)}
            style={({pressed}) => [
              styles.tab,
              isActive ? styles.tabActive : null,
              pressed && !isActive ? styles.tabPressed : null,
            ]}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.tabGlyph}>
              {tab.glyph}
            </AppText>
            <AppText
              style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── PendingSection (native-safe placeholder for not-yet-ported sections) ─────
// FleetApiSection / InfrastructureSection / ClientUtilitiesSection /
// ReferenceLinksSection are separate web source files not yet converted. Per
// contract rule 7 each renders an explicit "unavailable on native" state until
// its own parity port lands, then is swapped for the real import.
interface PendingSectionProps {
  title: string;
  message: string;
}

function PendingSection({title, message}: PendingSectionProps) {
  return (
    <GlassPanel style={styles.pending}>
      <AppText style={styles.pendingTitle}>{title}</AppText>
      <AppText style={styles.pendingMessage} tone="muted">
        {message}
      </AppText>
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Main DevTools Page — thin shell with tabbed layout
   ═══════════════════════════════════════════════════════════════════════ */

export default function DevToolsPage() {
  const {t} = useTranslation();
  usePageTitle(t('devtools.title', 'Developer Tools'));

  const [tab, setTab] = useUrlEnum<TabKey>(TAB_KEY, TAB_KEYS, DEFAULT_TAB);

  const unavailable = t(
    'devtools.section.unavailableOnNative',
    'This section is not yet available in the native app.',
  );

  return (
    <PageContainer
      title={t('devtools.title', 'Developer Tools')}
      subtitle={t(
        'devtools.subtitle',
        'Fleet API, telemetry, infrastructure & utilities',
      )}>
      <View style={styles.body}>
        <TabNav tabs={TABS} active={tab} onChange={k => setTab(k as TabKey)} />

        <FadeIn key={tab}>
          {tab === 'fleet-api' && (
            <PendingSection title="Fleet API" message={unavailable} />
          )}
          {tab === 'telemetry' && <FleetTelemetryHealth />}
          {tab === 'infrastructure' && (
            <PendingSection title="Infrastructure" message={unavailable} />
          )}
          {tab === 'utilities' && (
            <PendingSection title="Utilities" message={unavailable} />
          )}
          {tab === 'reference' && (
            <PendingSection title="Reference" message={unavailable} />
          )}
        </FadeIn>
      </View>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: 24, // space-y-6
  },
  tabBar: {
    backgroundColor: TAB_BAR_BG,
    borderColor: TAB_BAR_BORDER,
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    flexGrow: 0,
  },
  tabBarContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs, // gap-1 (4)
    padding: spacing.xs, // p-1 (4)
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8, // rounded-lg
    flexDirection: 'row',
    flexShrink: 0, // shrink-0
    gap: 6, // gap-1.5
    minHeight: 36,
    paddingHorizontal: 14, // px-2.5 / sm:px-4
    paddingVertical: 8, // py-1.5 / sm:py-2
  },
  tabActive: {
    backgroundColor: TAB_ACTIVE_BG,
    // shadow-sm
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.18,
    shadowRadius: 2,
  },
  tabPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  tabGlyph: {
    fontSize: 14, // h-4 w-4 icon
    lineHeight: 18,
  },
  tabLabel: {
    color: colors.textMuted, // inactive text-[--text-muted]
    fontSize: 13, // text-xs / sm:text-sm
    fontWeight: '500', // font-medium
    lineHeight: 18,
  },
  tabLabelActive: {
    color: colors.textPrimary, // active text-[--text-primary]
  },
  pending: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  pendingTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  pendingMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
});
