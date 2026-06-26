// Native parity port of
// web/src/features/analytics/components/review/ComparisonsSlide.tsx.
//
// Renders the Year-in-Review "Comparisons" slide: a centred animated title
// ("Fun facts about your year") above a two-column grid of fun-fact cards, each
// showing a large emoji, a bold label, and a value. The web file depends on a
// couple of browser-only modules that have no native counterpart (contract
// rules 4, 5 & 7); each is replaced with a React Native-safe equivalent and
// documented in the sidecar:
//
//   - react-i18next `useTranslation` (web L2) -> inlined useNativeTranslation():
//     a stable (key, fallback) => fallback shim so the single t('key','English')
//     call keeps its English default and translation-key intent at the call site.
//   - `@/components/motion` framer-motion `motion.p` / `motion.div` (web L1) ->
//     native Animated.View entrance animations. The title's framer transition
//     { y: 20 -> 0, opacity: 0 -> 1, delay 0.1s, duration 0.4s } maps to an
//     Animated.timing slide-up + fade; each card's framer spring
//     { scale: 0.8 -> 1, opacity: 0 -> 1, rotateY: 90 -> 0, delay 0.3 + i*0.12s }
//     maps to a staggered Animated.spring driving an opacity/scale/rotateY
//     interpolation (with a perspective for the 3D flip), preserving the
//     staggered "flip-in" visual intent.
//
// The Tailwind utility classes on the web DOM elements are reproduced with RN
// StyleSheet entries: `flex flex-col items-center justify-center h-full px-6
// text-center` -> a flex:1 centred root with 24px horizontal padding; the
// `grid grid-cols-2 gap-3 max-w-md w-full` grid -> a flex-wrap row capped at
// 448px with two equal flex-grow columns; the card's `bg-white/[0.05]
// rounded-xl p-4 border border-white/[0.08]` and the text sizes/weights/tones
// are matched 1:1. The CSS var colors map to AppText tones
// (var(--text-secondary) -> tone="secondary", var(--text-primary) -> "primary").
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components
// are imported — only react, react-native primitives, the existing apps/native
// AppText, and theme spacing tokens.

import React, {useEffect, useRef, type ReactNode} from 'react';
import {Animated, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {spacing} from '../../../../../theme/tokens';
import type {YearReviewComparison} from '../../../../api/types';

interface Props {
  comparisons: YearReviewComparison[];
}

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation-key intent is preserved at the call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

const TITLE_DELAY_MS = 100;
const TITLE_DURATION_MS = 400;
const TITLE_TRANSLATE_Y = 20;

const CARD_BASE_DELAY_MS = 300;
const CARD_STAGGER_MS = 120;
const CARD_PERSPECTIVE = 800;

// @/components/motion motion.p -> Animated.View slide-up + fade entrance
// (framer initial { y: 20, opacity: 0 } -> animate { y: 0, opacity: 1 }).
function SlideUpTitle({children}: {children: ReactNode}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      delay: TITLE_DELAY_MS,
      duration: TITLE_DURATION_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [TITLE_TRANSLATE_Y, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

// @/components/motion motion.div -> staggered Animated.spring "flip-in" entrance
// (framer initial { scale: 0.8, opacity: 0, rotateY: 90 } -> animate
// { scale: 1, opacity: 1, rotateY: 0 } with delay 0.3 + i*0.12s, type 'spring').
function ComparisonCard({
  item,
  index,
}: {
  item: YearReviewComparison;
  index: number;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.spring(progress, {
      toValue: 1,
      delay: CARD_BASE_DELAY_MS + index * CARD_STAGGER_MS,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, index]);

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1],
  });
  const rotateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['90deg', '0deg'],
  });

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: progress,
          transform: [{perspective: CARD_PERSPECTIVE}, {rotateY}, {scale}],
        },
      ]}>
      <AppText style={styles.emoji}>{item.emoji}</AppText>
      <AppText tone="primary" style={styles.label}>
        {item.label}
      </AppText>
      <AppText tone="secondary" style={styles.value}>
        {item.value}
      </AppText>
    </Animated.View>
  );
}

export function ComparisonsSlide({comparisons}: Props) {
  const t = useNativeTranslation();
  const items = comparisons ?? [];

  return (
    <View style={styles.root}>
      <SlideUpTitle>
        <AppText tone="secondary" style={styles.title}>
          {t('yearReview.funFacts', 'Fun facts about your year')}
        </AppText>
      </SlideUpTitle>

      <View style={styles.grid}>
        {items.map((item, i) => (
          <ComparisonCard key={item.label} index={i} item={item} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    maxWidth: 448,
    width: '100%',
  },
  card: {
    flexBasis: '45%',
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  emoji: {
    fontSize: 30,
    lineHeight: 38,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  value: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
});
