// Native parity port of web/src/components/charts/AddAnnotationPopover.tsx.
// Replaces the web form/date input and lucide category icons with React Native
// modal, text inputs, pressable category pills, and native TeslaSync tokens.

import React, {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';
import type {AnnotationCategory} from '../../api/hooks/useAnnotations';

type NativeTFunction = (key: string, fallback: string) => string;

const ANNOTATION_COLORS: Record<AnnotationCategory, string> = {
  milestone: '#3b82f6',
  maintenance: '#f59e0b',
  trip: '#22c55e',
  issue: '#ef4444',
  upgrade: '#a855f7',
  custom: '#94a3b8',
};

/**
 * Normalises any ISO-ish timestamp into the `YYYY-MM-DD` value expected by
 * the editable date field. Returns an empty string when parsing fails so the
 * input renders empty rather than NaN.
 */
function toDateInputValue(timestamp: string): string {
  if (!timestamp) {
    return '';
  }
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) {
    // Already in YYYY-MM-DD shape -- accept verbatim.
    return /^\d{4}-\d{2}-\d{2}$/.test(timestamp) ? timestamp : '';
  }
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Inverse of `toDateInputValue` -- pins a YYYY-MM-DD value to UTC midnight. */
function toIsoTimestamp(date: string): string {
  if (!date) {
    return '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return '';
  }
  return `${date}T00:00:00Z`;
}

interface AddAnnotationPopoverProps {
  open: boolean;
  timestamp: string;
  onAdd: (
    label: string,
    category: AnnotationCategory,
    description?: string,
    occurredAt?: string,
  ) => void;
  onCancel: () => void;
  /** When true, the timestamp becomes editable with a native date text field. */
  editableDate?: boolean;
}

const CATEGORY_OPTIONS: ReadonlyArray<{
  value: AnnotationCategory;
  label: string;
  glyph: string;
}> = [
  {value: 'milestone', label: 'Milestone', glyph: 'FL'},
  {value: 'maintenance', label: 'Maintenance', glyph: 'WN'},
  {value: 'trip', label: 'Trip', glyph: 'TR'},
  {value: 'issue', label: 'Issue', glyph: '!!'},
  {value: 'upgrade', label: 'Upgrade', glyph: 'UP'},
  {value: 'custom', label: 'Custom', glyph: 'TG'},
];

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function AddAnnotationPopover({
  open,
  timestamp,
  onAdd,
  onCancel,
  editableDate = false,
}: AddAnnotationPopoverProps) {
  const t = useNativeTranslationFallback();
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<AnnotationCategory>('milestone');
  const [description, setDescription] = useState('');
  const [editedDate, setEditedDate] = useState(() =>
    toDateInputValue(timestamp),
  );

  // Re-sync the date field whenever the popover re-opens with a fresh
  // timestamp, matching the chart click/header date flow on web.
  useEffect(() => {
    if (open) {
      setEditedDate(toDateInputValue(timestamp));
    }
  }, [open, timestamp]);

  const maxDate = toDateInputValue(new Date().toISOString());
  const editedIsoTimestamp = toIsoTimestamp(editedDate);
  const dateInputInvalid =
    editableDate && (!editedIsoTimestamp || editedDate > maxDate);
  const canSubmit = label.trim().length > 0 && !dateInputInvalid;

  const handleSubmit = () => {
    if (!label.trim()) {
      return;
    }
    const occurredAt = editableDate ? toIsoTimestamp(editedDate) : timestamp;
    if (!occurredAt) {
      return;
    }
    onAdd(label.trim(), category, description.trim() || undefined, occurredAt);
    setLabel('');
    setCategory('milestone');
    setDescription('');
  };

  const handleClose = () => {
    setLabel('');
    setCategory('milestone');
    setDescription('');
    onCancel();
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={open}>
      <View
        accessibilityLabel={t('annotation.addTitle', 'Add Annotation')}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={handleClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="add-annotation-popover">
          <AppText style={styles.title} variant="title" weight="bold">
            {t('annotation.addTitle', 'Add Annotation')}
          </AppText>

          <ScrollView
            bounces={false}
            contentContainerStyle={styles.form}
            keyboardShouldPersistTaps="handled">
            {editableDate ? (
              <FormField label={t('annotation.date', 'Date')}>
                <TextInput
                  accessibilityLabel={t('annotation.date', 'Date')}
                  autoCapitalize="none"
                  maxLength={10}
                  onChangeText={setEditedDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, dateInputInvalid && styles.inputError]}
                  value={editedDate}
                />
                <AppText
                  style={[
                    styles.helperText,
                    dateInputInvalid && styles.errorText,
                  ]}
                  variant="caption">
                  {dateInputInvalid
                    ? t(
                        'annotation.dateInvalid',
                        'Use YYYY-MM-DD and choose today or earlier.',
                      )
                    : t('annotation.dateFormatHint', 'Format: YYYY-MM-DD')}
                </AppText>
              </FormField>
            ) : (
              <AppText
                style={styles.timestamp}
                testID="annotation-popover-timestamp"
                variant="caption">
                {timestamp}
              </AppText>
            )}

            <FormField label={t('annotation.label', 'Label')}>
              <TextInput
                accessibilityLabel={t('annotation.label', 'Label')}
                autoCapitalize="sentences"
                autoFocus
                maxLength={50}
                onChangeText={setLabel}
                placeholder={t(
                  'annotation.labelPlaceholder',
                  'e.g., Battery replaced',
                )}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={label}
              />
            </FormField>

            <FormField label={t('annotation.category', 'Category')}>
              <View style={styles.categoryGrid}>
                {CATEGORY_OPTIONS.map(opt => (
                  <CategoryPill
                    key={opt.value}
                    color={ANNOTATION_COLORS[opt.value]}
                    glyph={opt.glyph}
                    label={t(`annotation.cat.${opt.value}`, opt.label)}
                    onPress={() => setCategory(opt.value)}
                    selected={category === opt.value}
                  />
                ))}
              </View>
            </FormField>

            <FormField label={t('annotation.description', 'Description')}>
              <TextInput
                accessibilityLabel={t(
                  'annotation.description',
                  'Description',
                )}
                autoCapitalize="sentences"
                maxLength={200}
                onChangeText={setDescription}
                placeholder={t(
                  'annotation.descPlaceholder',
                  'Optional description...',
                )}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={description}
              />
            </FormField>

            <View style={styles.actionRow}>
              <DialogAction
                label={t('common.cancel', 'Cancel')}
                onPress={handleClose}
                variant="secondary"
              />
              <DialogAction
                disabled={!canSubmit}
                label={t('annotation.add', 'Add Annotation')}
                onPress={handleSubmit}
                variant="primary"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
AddAnnotationPopover.displayName = 'AddAnnotationPopover';

function FormField({children, label}: {children: ReactNode; label: string}) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
      {children}
    </View>
  );
}

function CategoryPill({
  color,
  glyph,
  label,
  onPress,
  selected,
}: {
  color: string;
  glyph: string;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      style={({pressed}) => [
        styles.categoryPill,
        selected && [styles.categoryPillSelected, {borderColor: color}],
        pressed && styles.pressed,
      ]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[
          styles.categoryGlyphBadge,
          selected && {borderColor: color, backgroundColor: colors.surface},
        ]}>
        <AppText
          style={[styles.categoryGlyph, selected && {color}]}
          variant="caption"
          weight="bold">
          {glyph}
        </AppText>
      </View>
      <AppText
        style={[styles.categoryText, selected && {color}]}
        variant="caption"
        weight={selected ? 'semibold' : 'regular'}>
        {label}
      </AppText>
    </Pressable>
  );
}

function DialogAction({
  disabled = false,
  label,
  onPress,
  variant,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.secondaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.secondaryButtonText
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 116,
    paddingHorizontal: spacing.lg,
  },
  categoryGlyph: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  categoryGlyphBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryPill: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: 'transparent',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  categoryPillSelected: {
    backgroundColor: colors.surfaceRaised,
  },
  categoryText: {
    color: colors.textMuted,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxHeight: '88%',
    maxWidth: 560,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  disabled: {
    opacity: 0.48,
  },
  errorText: {
    color: colors.danger,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  form: {
    gap: spacing.md,
  },
  helperText: {
    color: colors.textMuted,
  },
  input: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputError: {
    borderColor: colors.danger,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
  },
  timestamp: {
    color: colors.textMuted,
  },
  title: {
    color: colors.textPrimary,
  },
});
