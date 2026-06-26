// Native parity port of web/src/features/analytics/pages/YearReviewPage.tsx.
//
// YearReviewPage is the full-screen, swipe-style "Year in Review" story: a
// segmented progress bar, an optional multi-vehicle selector, the active story
// slide (rendered by SlideRenderer over a per-slide gradient), left/right tap
// navigation zones, a close affordance, a slide counter, and the opt-in
// AIYearReviewNarration overlay. Loading and "no data for this year" each get a
// dedicated full-screen black state.
//
// The web original leans on browser-only infrastructure that has no native
// analogue, so — following the established conversion idiom (SavingsSlide,
// FleetComparePage) — every such dependency is reproduced with React Native
// primitives + the shared native building blocks and documented in the sidecar:
//
//   - react-router-dom useParams/useNavigate/useSearchParams are not wired on
//     native. `year` (source L21, Number(yearParam) || current year) falls back
//     to new Date().getFullYear(); the `vehicle_id` search param (L25, L36, L133)
//     becomes local `vehicleIdParam` state preserving the exact name, the
//     auto-select-first-vehicle effect (L34-38) and the "reset slide on change"
//     behaviour (L134); navigate(-1) (close / Go Back / Escape, L63/97/186)
//     becomes a `dismiss` that hides the overlay (the native stand-in for the
//     router unmounting the story), keeping the controls live + testable.
//   - usePageTitle (L22) sets document.title, which has no native analogue, so
//     it is dropped (the story has no on-screen title bar in web either).
//   - The window 'keydown' Arrow/Space/Escape handler (L54-68) is dropped — RN
//     has no physical-key window events; the left/right tap zones (L149-153) are
//     the on-device prev/next affordance and are preserved.
//   - The desktop-only ChevronLeft/ChevronRight arrows (L156-179) are rendered
//     `hidden ... md:inline-flex`, i.e. hidden on mobile, so they are omitted on
//     native (mobile parity) — tap zones cover prev/next.
//   - @/components/feedback Spinner -> ActivityIndicator; @/components/ui Button
//     -> AppButton; @/components/ui Select (the multi-vehicle picker) -> a
//     segmented pill group honouring vehicleOptions + value/onChange; lucide X
//     -> SemanticIcon 'close'. @/lib/cn (the progress-bar class join) is dropped
//     in favour of StyleSheet.
//   - ../components/review SlideRenderer + SLIDE_DEFS are not yet converted to
//     native (only SavingsSlide is), and the native review barrel does not exist,
//     so SLIDE_DEFS and a native SlideRenderer are inlined here. SLIDE_DEFS is
//     copied verbatim (all 12 type/field/bg entries); the bg gradient string is
//     preserved and mapped to a representative tailwind `-900` base colour. The
//     dispatch mirrors the web switch: the converted SavingsSlide is rendered
//     for the 'savings' slide, and every other slide renders a native
//     SlidePlaceholder carrying that slide's hero emoji + lead-in title (the
//     same emoji/eyebrow each web slide leads with). Unit-free metrics (drive
//     count, charge sessions, kWh, kg CO2, year) are shown verbatim; metrics
//     that need the user's distance/efficiency unit (km vs mi) are deferred to
//     each slide's own native conversion (SavingsSlide demonstrates the wiring).
//   - framer-motion AnimatePresence/motion slide + entrance animations have no
//     native equivalent and render at their rest state (the established idiom).
//   - react-i18next useTranslation -> a native English-default `t` that keeps
//     every yearReview.* key verbatim and reproduces i18next `{{var}}`
//     interpolation (used by the no-data {{year}} message).
//
// Real data hooks are called unchanged: useYearReview(year, vehicleIdParam ||
// undefined) (L40) and useVehicles() (L26) via the native web-parity hooks, so
// every API path is preserved. AIYearReviewNarration (L206-208) is the converted
// native component and receives the same vehicleId. No DOM, framer-motion,
// lucide-react, Recharts, Leaflet, react-router, or old web UI components are
// imported.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppButton} from '../../../../components/ui/AppButton';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useYearReview} from '../../../api/hooks/useAnalytics';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {YearReview} from '../../../api/types';
import {AIYearReviewNarration} from '../../../components/ai/AIYearReviewNarration';
import {SavingsSlide} from '../components/review/SavingsSlide';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every yearReview.* key verbatim.
function t(_key: string, fallback: string, vars?: Record<string, string | number>): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value == null ? '' : String(value);
  });
}

/* ─── Slide definitions (verbatim copy of ../components/review slides.ts) ───── */

interface SlideDefinition {
  type: string;
  bg: string;
  field?: string;
}

const SLIDE_DEFS: SlideDefinition[] = [
  {type: 'title', bg: 'from-blue-900 via-indigo-900 to-slate-900'},
  {type: 'stat-hero', field: 'distance', bg: 'from-emerald-900 via-green-900 to-teal-900'},
  {type: 'stat-chart', field: 'drives', bg: 'from-purple-900 via-violet-900 to-indigo-900'},
  {type: 'drive-highlight', field: 'longest', bg: 'from-amber-900 via-orange-900 to-yellow-900'},
  {type: 'stat-hero', field: 'energy', bg: 'from-cyan-900 via-sky-900 to-blue-900'},
  {type: 'charging-breakdown', bg: 'from-orange-900 via-red-900 to-pink-900'},
  {type: 'savings', bg: 'from-emerald-900 via-teal-900 to-cyan-900'},
  {type: 'environment', bg: 'from-green-900 via-emerald-900 to-lime-900'},
  {type: 'patterns', bg: 'from-indigo-900 via-blue-900 to-violet-900'},
  {type: 'drive-highlight', field: 'efficient', bg: 'from-teal-900 via-cyan-900 to-sky-900'},
  {type: 'comparisons', bg: 'from-pink-900 via-rose-900 to-fuchsia-900'},
  {type: 'summary', bg: 'from-blue-900 via-indigo-900 to-purple-900'},
];

// Tailwind `-900` shade hexes; the web slide backgrounds are `bg-gradient-to-br`
// of three `-900` tones. RN has no gradient primitive here, so the gradient's
// middle (`via-`) tone is used as a representative solid backdrop per slide,
// preserving each slide's distinct colour identity.
const TAILWIND_900: Record<string, string> = {
  blue: '#1e3a8a',
  indigo: '#312e81',
  slate: '#0f172a',
  emerald: '#064e3b',
  green: '#14532d',
  teal: '#134e4a',
  purple: '#581c87',
  violet: '#4c1d95',
  amber: '#78350f',
  orange: '#7c2d12',
  yellow: '#713f12',
  cyan: '#164e63',
  sky: '#0c4a6e',
  red: '#7f1d1d',
  pink: '#831843',
  lime: '#365314',
  rose: '#881337',
  fuchsia: '#701a75',
};

function gradientBaseColor(bg: string): string {
  const via = bg.match(/via-([a-z]+)-900/);
  const from = bg.match(/from-([a-z]+)-900/);
  const key = via?.[1] ?? from?.[1] ?? '';
  return TAILWIND_900[key] ?? colors.background;
}

/* ─── Inlined native SlideRenderer (mirrors ../components/review/SlideRenderer) */

interface SlideHero {
  emoji?: string;
  title: string;
  subtitle?: string;
}

// Mirrors the web SlideRenderer switch: returns the hero emoji + lead-in copy
// each web slide opens with, keeping every yearReview.* key verbatim.
function slideHero(slide: SlideDefinition, data: YearReview): SlideHero {
  switch (slide.type) {
    case 'title':
      return {
        emoji: '🚗',
        title: String(data.year),
        subtitle: `${t('yearReview.title', 'Year in Review')} · ${data.vehicle.display_name}`,
      };
    case 'stat-hero':
      if (slide.field === 'energy') {
        return {
          emoji: '⚡',
          title: String(Math.round(data.total_energy_kwh)),
          subtitle: t('yearReview.energyUnit', 'kWh charged'),
        };
      }
      // Distance hero needs the user's km/mi preference -> deferred to the
      // stat-hero slide's own native conversion; the lead-in is preserved.
      return {emoji: '🛣️', title: t('yearReview.distance', 'Distance traveled')};
    case 'stat-chart':
      return {
        emoji: '🗓️',
        title: String(data.total_drives),
        subtitle: t('yearReview.drives', 'drives'),
      };
    case 'drive-highlight':
      return slide.field === 'longest'
        ? {emoji: '🏔️', title: t('yearReview.longestDrive', 'Longest Drive')}
        : {emoji: '🌿', title: t('yearReview.mostEfficient', 'Most Efficient Drive')};
    case 'charging-breakdown':
      return {
        emoji: '🔌',
        title: String(data.total_charge_sessions),
        subtitle: t('yearReview.chargeSessions', 'charge sessions'),
      };
    case 'environment':
      return {
        emoji: '🌍',
        title: `${Math.round(data.co2_offset_kg)} kg`,
        subtitle: t('yearReview.co2Offset', 'CO₂ offset'),
      };
    case 'patterns':
      return {emoji: '📊', title: t('yearReview.drivingPatterns', 'Your driving patterns')};
    case 'comparisons':
      return {title: t('yearReview.funFacts', 'Fun facts about your year')};
    case 'summary':
      return {
        emoji: '🏆',
        title: String(data.year),
        subtitle: `${t('yearReview.title', 'Year in Review')} · ${data.vehicle.display_name}`,
      };
    default:
      return {title: ''};
  }
}

function SlidePlaceholder({hero}: {hero: SlideHero}): React.ReactElement {
  return (
    <View style={styles.slideInner}>
      {hero.emoji ? <AppText style={styles.slideEmoji}>{hero.emoji}</AppText> : null}
      <AppText style={styles.slideTitle} weight="bold">
        {hero.title}
      </AppText>
      {hero.subtitle ? (
        <AppText style={styles.slideSubtitle} tone="secondary">
          {hero.subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

interface SlideRendererProps {
  slideIndex: number;
  slide: SlideDefinition;
  data: YearReview;
}

function SlideRenderer({slideIndex, slide, data}: SlideRendererProps): React.ReactElement {
  return (
    <View
      style={[styles.slide, {backgroundColor: gradientBaseColor(slide.bg)}]}
      testID={`year-review-slide-${slideIndex}`}>
      {slide.type === 'savings' ? (
        <SavingsSlide data={data} />
      ) : (
        <SlidePlaceholder hero={slideHero(slide, data)} />
      )}
    </View>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */

export default function YearReviewPage(): React.ReactElement {
  // react-router useParams is not wired on native; default to the current year.
  const year = new Date().getFullYear();

  // Vehicle selection mirrors the web `vehicle_id` search param via local state.
  const [vehicleIdParam, setVehicleIdParam] = useState('');
  const {data: vehicles} = useVehicles();
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);
  const vehicleOptions = useMemo(
    () => vehicleList.map(v => ({value: String(v.id), label: v.display_name})),
    [vehicleList],
  );

  // Auto-select first vehicle if none specified.
  useEffect(() => {
    if (!vehicleIdParam && vehicleList.length > 0) {
      setVehicleIdParam(String(vehicleList[0].id));
    }
  }, [vehicleIdParam, vehicleList]);

  const {data, isLoading} = useYearReview(year, vehicleIdParam || undefined);

  const [slideIndex, setSlideIndex] = useState(0);
  const slides = useMemo(() => SLIDE_DEFS, []);
  const [dismissed, setDismissed] = useState(false);

  const goNext = useCallback(() => {
    setSlideIndex(prev => Math.min(prev + 1, slides.length - 1));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setSlideIndex(prev => Math.max(prev - 1, 0));
  }, []);

  // Native stand-in for navigate(-1): hide the full-screen story overlay.
  const dismiss = useCallback(() => setDismissed(true), []);

  if (dismissed) {
    return <View style={styles.dismissed} testID="year-review-dismissed" />;
  }

  // Loading state.
  if (isLoading || !data) {
    return (
      <View style={styles.fullscreen} testID="year-review-loading">
        <ActivityIndicator color={colors.textSecondary} />
        <AppText style={styles.loadingText} tone="muted">
          {t('yearReview.loading', 'Building your year in review...')}
        </AppText>
      </View>
    );
  }

  // No data for this year.
  if (data.total_drives === 0 && data.total_charge_sessions === 0) {
    return (
      <View style={styles.fullscreen} testID="year-review-empty">
        <AppText style={styles.emptyEmoji}>🚗</AppText>
        <AppText style={styles.emptyTitle} tone="secondary">
          {t('yearReview.noData', 'No driving data for {{year}}', {year})}
        </AppText>
        <AppText style={styles.emptyHint} tone="muted">
          {t('yearReview.noDataHint', 'Start driving and charging to build your annual review!')}
        </AppText>
        <View style={styles.emptyAction}>
          <AppButton variant="ghost" label={t('yearReview.goBack', 'Go Back')} onPress={dismiss} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="year-review-page">
      {/* Progress bar */}
      <View style={styles.progress} testID="year-review-progress">
        {slides.map((slide, i) => (
          <View key={`${slide.type}-${i}`} style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                i <= slideIndex ? styles.progressFillActive : styles.progressFillInactive,
              ]}
            />
          </View>
        ))}
      </View>

      {/* Vehicle selector (if multiple) */}
      {vehicleList.length > 1 ? (
        <View style={styles.selector} testID="year-review-vehicle-select">
          {vehicleOptions.map(opt => {
            const active = opt.value === vehicleIdParam;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="button"
                accessibilityLabel={opt.label}
                onPress={() => {
                  setVehicleIdParam(opt.value);
                  setSlideIndex(0);
                }}
                style={[styles.selectorPill, active && styles.selectorPillActive]}>
                <AppText variant="caption" tone={active ? 'accent' : 'secondary'}>
                  {opt.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Slide content */}
      <SlideRenderer slideIndex={slideIndex} slide={slides[slideIndex]} data={data} />

      {/* Tap navigation zones */}
      <View style={styles.tapZones} pointerEvents="box-none">
        <Pressable
          style={styles.tapZone}
          onPress={goPrev}
          accessibilityRole="button"
          accessibilityLabel={t('yearReview.prev', 'Previous slide')}
          testID="year-review-tap-prev"
        />
        <View style={styles.tapZone} />
        <Pressable
          style={styles.tapZone}
          onPress={goNext}
          accessibilityRole="button"
          accessibilityLabel={t('yearReview.next', 'Next slide')}
          testID="year-review-tap-next"
        />
      </View>

      {/* Close button */}
      <Pressable
        style={styles.close}
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel={t('yearReview.close', 'Close')}
        testID="year-review-close">
        <SemanticIcon name="close" size="sm" decorative />
      </Pressable>

      {/* Slide counter */}
      <View style={styles.counter} testID="year-review-counter">
        <AppText variant="caption" tone="muted">
          {slideIndex + 1} / {slides.length}
        </AppText>
      </View>

      {/*
        Renders nothing when ai_mode='off' or the yir-narration toggle is off
        (the withAiFeature HOC returns null), so the baseline slide deck is
        visually unchanged for off-mode users.
      */}
      <View style={styles.narration} pointerEvents="box-none">
        <AIYearReviewNarration vehicleId={vehicleIdParam ? Number(vehicleIdParam) : undefined} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  close: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    zIndex: 20,
  },
  counter: {
    alignItems: 'center',
    bottom: spacing.md,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 20,
  },
  dismissed: {
    backgroundColor: '#000000',
    flex: 1,
  },
  emptyAction: {
    marginTop: spacing.lg,
  },
  emptyEmoji: {
    fontSize: 60,
    lineHeight: 68,
    marginBottom: spacing.md,
  },
  emptyHint: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  emptyTitle: {
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
  fullscreen: {
    alignItems: 'center',
    backgroundColor: '#000000',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  narration: {
    bottom: spacing.xxl,
    left: 0,
    paddingHorizontal: spacing.md,
    position: 'absolute',
    right: 0,
    zIndex: 20,
  },
  progress: {
    flexDirection: 'row',
    gap: 2,
    left: 0,
    paddingHorizontal: spacing.md,
    position: 'absolute',
    right: 0,
    top: spacing.md,
    zIndex: 20,
  },
  progressFill: {
    borderRadius: 999,
    height: '100%',
  },
  progressFillActive: {
    backgroundColor: colors.textSecondary,
    width: '100%',
  },
  progressFillInactive: {
    backgroundColor: 'transparent',
    width: '0%',
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 2,
    overflow: 'hidden',
  },
  root: {
    backgroundColor: '#000000',
    flex: 1,
    position: 'relative',
  },
  selector: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    position: 'absolute',
    top: spacing.xl,
    zIndex: 20,
  },
  selectorPill: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  selectorPillActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  slide: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 0,
  },
  slideEmoji: {
    fontSize: 64,
    lineHeight: 72,
    marginBottom: spacing.lg,
    textAlign: 'center',
  },
  slideInner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  slideSubtitle: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  slideTitle: {
    color: colors.textPrimary,
    fontSize: 44,
    lineHeight: 52,
    textAlign: 'center',
  },
  tapZone: {
    flex: 1,
    height: '100%',
  },
  tapZones: {
    bottom: 0,
    flexDirection: 'row',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
  },
});
