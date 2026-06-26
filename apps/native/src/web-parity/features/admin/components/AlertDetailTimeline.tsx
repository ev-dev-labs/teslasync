// Native parity port of web/src/features/admin/components/AlertDetailTimeline.tsx.
//
// Renders the audit timeline of an alert (created -> acknowledged -> commented
// -> reopened -> ...). The web original composed the shared DOM <Timeline>
// primitive from @/components/data-display; React Native has no Timeline parity
// primitive, so the vertical connector / dot / icon layout is reproduced inline
// with View + AppText while preserving the same visual intent (colored dots
// connected by a hairline, kind glyph inside each dot, title + time on one row,
// optional note beneath).
//
// The synthetic `created` entry is always server-fabricated from
// notification_logs.created_at, while persisted events come from
// notification_log_events -- so an empty timeline is only reachable while
// loading, at which point the shared native EmptyState renders the same
// title/message.
//
// DOM-only pieces are swapped for native equivalents: lucide Icons -> the
// established glyph language (SemanticIcon for the empty state, kind glyphs for
// the dots), formatDateTime stays via lib/format, and react-i18next
// useTranslation -> a native translation-fallback helper that preserves the
// alerts.timeline.* keys, English fallbacks, and the i18next {{actor}}
// interpolation contract. No DOM, Recharts, Leaflet, or web UI components are
// imported.

import React, {useCallback, useMemo} from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {formatDateTime} from '../../../../lib/format';
import {colors, spacing} from '../../../../theme/tokens';
import type {AlertEvent} from '../../../api/types';

export interface AlertDetailTimelineProps {
  events: AlertEvent[] | undefined;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style applied to the timeline container (replaces the web className slot). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const KIND_COLOR: Record<string, string> = {
  created: '#00f0ff',
  acknowledged: '#10b981',
  reopened: '#f59e0b',
  commented: '#a855f7',
};

// Native glyph stand-ins for the web lucide icons (Bell / CheckCircle /
// RefreshCw / Edit3 / Info), matching the established SemanticIcon glyph
// vocabulary so each dot speaks the same visual language as the rest of the app.
const KIND_GLYPH: Record<string, string> = {
  created: 'NO',
  acknowledged: 'OK',
  reopened: 'RE',
  commented: 'ED',
};

interface TimelineEntry {
  title: string;
  subtitle?: string;
  time: string;
  color: string;
  glyph: string;
}

type TranslationOptions = {actor?: string};

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: TranslationOptions,
) => string;

function interpolate(template: string, values: TranslationOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key as keyof TranslationOptions];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return interpolate(fallback, options);
  }, []);
}

export function AlertDetailTimeline({
  events,
  className: _className,
  style,
  testID,
}: AlertDetailTimelineProps) {
  const t = useNativeTranslationFallback();

  const items = useMemo<TimelineEntry[]>(() => {
    if (!events?.length) {
      return [];
    }
    return events.map(ev => {
      const actor = ev.actor && ev.actor.trim().length > 0 ? ev.actor : null;
      const titleKey = actor
        ? `alerts.timeline.kind.${ev.kind}`
        : `alerts.timeline.kindAnonymous.${ev.kind}`;
      const fallback = actor
        ? defaultTitleWithActor(ev.kind, actor)
        : defaultTitleAnonymous(ev.kind);
      const title = t(titleKey, fallback, actor ? {actor} : undefined);
      return {
        title,
        subtitle: ev.note ?? undefined,
        time: formatDateTime(ev.occurred_at),
        color: KIND_COLOR[ev.kind] ?? KIND_COLOR.created,
        glyph: kindGlyph(ev.kind),
      };
    });
  }, [events, t]);

  if (!events || events.length === 0) {
    return (
      // no-action: an alert always has a synthetic 'created' entry -- empty is
      // only possible while loading.
      <View
        style={styles.empty}
        testID={testID ?? 'alert-detail-timeline-empty'}>
        <SemanticIcon decorative name="notifications" />
        <EmptyState
          title={t('alerts.timeline.title', 'Audit timeline')}
          message={t('alerts.timeline.empty', 'No events yet')}
        />
      </View>
    );
  }

  return (
    <View
      style={[styles.timeline, style]}
      testID={testID ?? 'alert-detail-timeline'}>
      {items.map((item, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.markerColumn}>
            <View style={[styles.dot, {borderColor: item.color}]}>
              <AppText style={[styles.glyph, {color: item.color}]}>
                {item.glyph}
              </AppText>
            </View>
            {i < items.length - 1 ? <View style={styles.connector} /> : null}
          </View>
          <View style={styles.content}>
            <View style={styles.titleRow}>
              <AppText numberOfLines={2} style={styles.title} tone="primary">
                {item.title}
              </AppText>
              <AppText style={styles.time} tone="muted">
                {item.time}
              </AppText>
            </View>
            {item.subtitle ? (
              <AppText style={styles.subtitle} tone="muted">
                {item.subtitle}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

function kindGlyph(kind: string): string {
  return KIND_GLYPH[kind] ?? 'i';
}

function defaultTitleWithActor(kind: string, actor: string): string {
  switch (kind) {
    case 'created':
      return 'Alert created';
    case 'acknowledged':
      return `Acknowledged by ${actor}`;
    case 'reopened':
      return `Reopened by ${actor}`;
    case 'commented':
      return `Comment by ${actor}`;
    default:
      return kind;
  }
}

function defaultTitleAnonymous(kind: string): string {
  switch (kind) {
    case 'created':
      return 'Alert created';
    case 'acknowledged':
      return 'Acknowledged';
    case 'reopened':
      return 'Reopened';
    case 'commented':
      return 'Comment added';
    default:
      return kind;
  }
}

AlertDetailTimeline.displayName = 'AlertDetailTimeline';

const styles = StyleSheet.create({
  timeline: {
    rowGap: spacing.md,
  },
  empty: {
    alignItems: 'center',
    rowGap: spacing.xs,
  },
  row: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  markerColumn: {
    alignItems: 'center',
    width: 22,
  },
  dot: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  glyph: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
  },
  connector: {
    backgroundColor: colors.border,
    flex: 1,
    marginTop: 2,
    minHeight: spacing.md,
    width: 1,
  },
  content: {
    flex: 1,
    paddingTop: 2,
    rowGap: 2,
  },
  titleRow: {
    alignItems: 'baseline',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  time: {
    fontSize: 12,
    lineHeight: 16,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
});

export default AlertDetailTimeline;
