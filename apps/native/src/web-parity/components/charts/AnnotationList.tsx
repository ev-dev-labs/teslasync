// Native parity port of web/src/components/charts/AnnotationList.tsx.
// Uses React Native primitives and TeslaSync native tokens instead of DOM,
// lucide icons, Tailwind classes, or web UI buttons.

import React, {useCallback} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import type {
  AnnotationCategory,
  DataAnnotation,
} from '../../api/hooks/useAnnotations';

interface AnnotationListProps {
  annotations: DataAnnotation[];
  onRemove: (id: string) => void;
}

type NativeTFunction = (key: string, fallback: string) => string;

const ANNOTATION_COLORS: Record<AnnotationCategory, string> = {
  milestone: '#3b82f6',
  maintenance: '#f59e0b',
  trip: '#22c55e',
  issue: '#ef4444',
  upgrade: '#a855f7',
  custom: '#94a3b8',
};

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function AnnotationList({annotations, onRemove}: AnnotationListProps) {
  const t = useNativeTranslationFallback();

  if (annotations.length === 0) {
    return null;
  }

  return (
    <View style={styles.root} testID="annotation-list">
      <AppText style={styles.title} variant="caption" weight="semibold">
        {t('annotation.listTitle', 'Annotations')}
      </AppText>
      <View style={styles.list}>
        {annotations.map(ann => (
          <View key={ann.id} style={styles.row}>
            <View
              pointerEvents="none"
              style={[
                styles.categoryDot,
                {backgroundColor: ANNOTATION_COLORS[ann.category]},
              ]}
            />
            <View style={styles.copy}>
              <View style={styles.primaryLine}>
                <AppText
                  numberOfLines={1}
                  style={styles.label}
                  weight="semibold">
                  {ann.label}
                </AppText>
                <AppText numberOfLines={1} style={styles.timestamp} variant="caption">
                  {ann.timestamp}
                </AppText>
              </View>
              {ann.description ? (
                <AppText
                  numberOfLines={1}
                  style={styles.description}
                  variant="caption">
                  {`- ${ann.description}`}
                </AppText>
              ) : null}
            </View>
            <Pressable
              accessibilityLabel={t(
                'annotation.remove',
                'Remove annotation',
              )}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => onRemove(ann.id)}
              style={({pressed}) => [
                styles.removeButton,
                pressed && styles.removeButtonPressed,
              ]}>
              <AppText style={styles.removeGlyph} variant="caption" weight="bold">
                X
              </AppText>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}
AnnotationList.displayName = 'AnnotationList';

const styles = StyleSheet.create({
  categoryDot: {
    borderRadius: 4,
    height: 8,
    marginTop: 8,
    width: 8,
  },
  copy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  description: {
    color: colors.textMuted,
  },
  label: {
    color: colors.textSecondary,
    flex: 1,
    minWidth: 0,
  },
  list: {
    gap: spacing.xs,
  },
  primaryLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  removeButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  removeButtonPressed: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    opacity: 0.88,
  },
  removeGlyph: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  root: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  row: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  timestamp: {
    color: colors.textMuted,
    flexShrink: 0,
  },
  title: {
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
