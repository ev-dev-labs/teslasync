// Native parity port of web/src/components/data-display/HistoryListRow.tsx.
//
// The web row composes a react-router `Link` (or an onClick `GlassPanel`), a
// lucide `ChevronRight`, and a Tailwind slot layout. This native version keeps
// the same slot-based public contract (checkbox / leading / primary / route /
// metrics / insight / actions / href / onClick / selected / glow /
// hideChevron / className / testId) using React Native primitives and the
// existing TeslaSync native GlassPanel + design tokens.
//
// Browser-only react-router navigation is bridged through an optional
// `onNavigate(href)` callback so a native navigator can wire it up; without a
// navigator an `href` row stays a no-op link-role press target (explicit
// unavailable state, documented in the sidecar). Hover-revealed actions become
// always-visible on touch because native has no hover, and the checkbox /
// actions `stopPropagation` guards are reproduced through the responder system
// (the actions overlay absorbs presses so they never trigger navigation).

import React, {useCallback, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';

export type HistoryListRowGlow = 'cyan' | 'green' | 'purple' | 'none';

export interface HistoryListRowProps {
  /**
   * Optional checkbox slot. Presses inside this region don't trigger the row's
   * navigation (it renders outside the pressable body).
   */
  checkbox?: ReactNode;
  /**
   * Leading badge slot -- score letter, charger icon, ProgressRing. Rendered in
   * a fixed-width centred column so rows align regardless of badge content.
   */
  leading?: ReactNode;
  /**
   * Required primary line -- typically time + duration + main metric badge +
   * status badges. Caller composes inline.
   */
  primary: ReactNode;
  /** Optional second line -- RouteDisplay, charger location, etc. */
  route?: ReactNode;
  /**
   * Optional third line -- InlineMetric chips (avg speed, battery delta,
   * efficiency, cost, ...).
   */
  metrics?: ReactNode;
  /**
   * Optional fourth slot -- inline insight (e.g. "Low efficiency -- investigate
   * ->"). Renders below the metrics row.
   */
  insight?: ReactNode;
  /**
   * Action controls (eye / map / curve / more menu). On web they are revealed
   * on hover; native has no hover, so they stay visible in the top-right and
   * absorb their own presses. Pass an array of already-built native controls.
   */
  actions?: ReactNode[];
  /** Navigate to this URL when the row is pressed (handled via onNavigate). */
  href?: string;
  /** Or, run this handler on press (mutually exclusive with `href`). */
  onClick?: (event: GestureResponderEvent) => void;
  /**
   * Native bridge for the web react-router `Link`. Invoked with `href` when an
   * href row is pressed. Without it an href row is a no-op press target.
   */
  onNavigate?: (href: string) => void;
  /** Adds the "selected" tint on the panel border. */
  selected?: boolean;
  /** Hover glow colour on web. Inert on native (no hover). Default `'cyan'`. */
  glow?: HistoryListRowGlow;
  /** Hide the trailing chevron (set when the row isn't navigable). */
  hideChevron?: boolean;
  /** Accepted for web source parity; native styling uses StyleSheet. */
  className?: string;
  /** Native style override applied to the panel (web maps className here). */
  style?: StyleProp<ViewStyle>;
  /** Test hook (web `testId`). */
  testId?: string;
  /** Native alias for `testId`. */
  testID?: string;
}

/**
 * `HistoryListRow` -- generic, slot-based row for history-style screens.
 *
 * Used by drive and charging-session cards which compose the same row with
 * different leading badges, metric chips, and actions.
 *
 * Press handling:
 *   - If `onClick` is set, the body fires it on press.
 *   - Else if `href` is set, the body calls `onNavigate(href)` on press and is
 *     exposed with the `link` accessibility role.
 *   - Presses inside the actions overlay are absorbed so they never navigate.
 *   - The checkbox renders outside the pressable body, so toggling selection
 *     never navigates.
 */
export function HistoryListRow({
  checkbox,
  leading,
  primary,
  route,
  metrics,
  insight,
  actions,
  href,
  onClick,
  onNavigate,
  selected,
  glow: _glow = 'cyan',
  hideChevron,
  className: _className,
  style,
  testId,
  testID,
}: HistoryListRowProps) {
  const resolvedTestID = testId ?? testID;

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (onClick) {
        onClick(event);
        return;
      }
      if (href && onNavigate) {
        onNavigate(href);
      }
    },
    [href, onClick, onNavigate],
  );

  // Mirror the web stopPropagation guard: a press inside the actions overlay
  // must not bubble through to the row's href / onClick navigation.
  const absorbPress = useCallback((event: GestureResponderEvent) => {
    event.stopPropagation();
  }, []);

  const actionNodes = actions ?? [];
  const hasActions = actionNodes.length > 0;
  const isPressable = Boolean(onClick || href);

  const content = (
    <View style={styles.contentRow}>
      {leading != null ? (
        <View style={styles.leading}>{leading}</View>
      ) : null}

      <View style={styles.main}>
        <View style={styles.primaryRow}>{primary}</View>
        {route ? <View style={styles.routeRow}>{route}</View> : null}
        {metrics ? <View style={styles.metricsRow}>{metrics}</View> : null}
        {insight ? <View style={styles.insightRow}>{insight}</View> : null}
      </View>

      {hideChevron ? null : (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.chevron}
          tone="muted">
          {'\u203A'}
        </AppText>
      )}
    </View>
  );

  return (
    <View style={styles.row} testID={resolvedTestID}>
      {checkbox != null ? (
        <View style={styles.checkbox}>{checkbox}</View>
      ) : null}

      <View style={styles.bodyWrap}>
        <GlassPanel
          style={[styles.panel, selected && styles.panelSelected, style]}
          testID={resolvedTestID ? `${resolvedTestID}-panel` : undefined}>
          {hasActions ? (
            <Pressable
              accessible={false}
              onPress={absorbPress}
              style={styles.actions}>
              {actionNodes.map((node, i) => (
                <View key={i} style={styles.actionItem}>
                  {node}
                </View>
              ))}
            </Pressable>
          ) : null}

          {isPressable ? (
            <Pressable
              accessibilityRole={href ? 'link' : 'button'}
              onPress={handlePress}
              style={({pressed}) => (pressed ? styles.pressed : undefined)}>
              {content}
            </Pressable>
          ) : (
            content
          )}
        </GlassPanel>
      </View>
    </View>
  );
}

HistoryListRow.displayName = 'HistoryListRow';

const styles = StyleSheet.create({
  actionItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 10,
  },
  bodyWrap: {
    flex: 1,
    minWidth: 0,
  },
  checkbox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: spacing.sm,
  },
  chevron: {
    fontSize: 18,
    lineHeight: 18,
  },
  contentRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  insightRow: {
    marginTop: spacing.xs,
  },
  leading: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
  },
  main: {
    flex: 1,
    minWidth: 0,
  },
  metricsRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  panel: {
    padding: spacing.md,
    position: 'relative',
  },
  panelSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  pressed: {
    opacity: 0.85,
  },
  primaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  routeRow: {
    marginBottom: spacing.xs,
  },
  row: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
