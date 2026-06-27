// Native parity port of web/src/features/settings/components/AIFeatureToggleList.tsx.
//
// Settings UI for AI feature toggles. Per-feature opt-in toggles are
// **generated** by mapping over `AI_FEATURE_IDS` from the canonical TS registry
// (never hand-listed) — adding a feature to the registry automatically adds the
// toggle here. The component is fully controlled: the parent owns the
// `values: Record<AiFeatureId, boolean>` map and `onToggle(id, value)` reports
// the flipped value (identical contract to the web component).
//
// i18n: each toggle's copy lives at `ai.settings.feature.<id>.label` /
// `ai.settings.feature.<id>.description`, with a fallback to the registry's
// `name` / `description` so adding a feature without translations still renders
// sensibly. The web `useTranslation('settings')` is reproduced with a native
// `useSettingsTranslation()` fallback that returns each call's English default
// (react-i18next is not wired into the native app); the dotted keys are kept
// verbatim so a future i18n wiring resolves them unchanged.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web <section>/<div> DOM tree becomes <View>s; `aria-label` →
//     accessibilityLabel and `data-testid` → testID.
//   - <Subhead> (typography role `subhead`: text-sm font-medium
//     text-[var(--text-secondary)]) and the row label (text-sm font-medium
//     text-[var(--text-primary)]) and <Caption> (text-xs text-[var(--text-muted)])
//     are rendered with the shared native <AppText> + literal-resolved styles so
//     the Tailwind/CSS-var typography survives without Tailwind.
//   - The `hover:bg-[var(--surface-hover)]` row affordance has no native analog
//     (no pointer hover) and is intentionally dropped; the row itself is
//     non-interactive in both web and native — only the <Toggle> is.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {AI_FEATURE_IDS, AI_FEATURES, type AiFeatureId} from '../../../ai/features';
import {Toggle} from '../../../components/ui/Toggle';

// react-i18next is not wired in native. The web component calls
// t('ai.settings.feature.<id>.label', meta.name) — a dotted key plus an English
// default — and i18next returns the default when the key is unresolved. This
// fallback therefore returns the supplied default and applies the same
// `{{var}}` interpolation the web `t` performs.
type TVars = Record<string, string | number>;
type TFunc = (key: string, defaultValue: string, vars?: TVars) => string;

function useSettingsTranslation(): TFunc {
  return React.useCallback(
    (_key: string, defaultValue: string, vars?: TVars) => {
      if (!vars) {
        return defaultValue;
      }
      return defaultValue.replace(
        /\{\{\s*([^}\s]+)\s*\}\}/g,
        (match, name: string) =>
          Object.prototype.hasOwnProperty.call(vars, name)
            ? String(vars[name])
            : match,
      );
    },
    [],
  );
}

export interface AIFeatureToggleListProps {
  values: Record<AiFeatureId, boolean>;
  onToggle: (id: AiFeatureId, value: boolean) => void;
}

export function AIFeatureToggleList({
  values,
  onToggle,
}: AIFeatureToggleListProps) {
  const t = useSettingsTranslation();

  const legend = t(
    'ai.settings.feature.legend',
    'Per-feature opt-in (all default off)',
  );

  return (
    <View
      accessibilityLabel={legend}
      style={styles.section}
      testID="ai-feature-toggle-list">
      <AppText style={styles.subhead}>{legend}</AppText>
      <View style={styles.list}>
        {AI_FEATURE_IDS.map(id => {
          const meta = AI_FEATURES[id];
          const label = t(
            `ai.settings.feature.${id}.label`,
            // Fallback to registry name keeps the surface self-describing even
            // for newly added features whose translations have not landed yet.
            meta.name,
          );
          const description = t(
            `ai.settings.feature.${id}.description`,
            meta.description,
          );
          return (
            <View
              key={id}
              style={styles.row}
              testID={`ai-feature-row-${id}`}>
              <View style={styles.rowText}>
                <AppText style={styles.label}>{label}</AppText>
                <AppText style={styles.caption}>{description}</AppText>
              </View>
              <Toggle
                accessibilityLabel={label}
                checked={Boolean(values[id])}
                data-testid={`ai-feature-toggle-${id}`}
                onChange={next => onToggle(id, next)}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

AIFeatureToggleList.displayName = 'AIFeatureToggleList';

const styles = StyleSheet.create({
  // space-y-2 rounded-md border border-[var(--border-subtle)] p-4
  section: {
    gap: 8,
    borderRadius: 6,
    borderWidth: 1,
    // --border-subtle (dark) resolves to rgba(255,255,255,0.06).
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 16,
  },
  // space-y-2
  list: {
    gap: 8,
  },
  // flex items-start justify-between gap-3 rounded-sm px-2 py-2
  // (hover:bg-[var(--surface-hover)] dropped — no native hover)
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  // flex-1 min-w-0
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  // text-sm font-medium text-[var(--text-secondary)]
  subhead: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    color: colors.textSecondary,
  },
  // text-sm font-medium text-[var(--text-primary)]
  label: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
    color: colors.textPrimary,
  },
  // text-xs text-[var(--text-muted)]
  caption: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
});

export default AIFeatureToggleList;
