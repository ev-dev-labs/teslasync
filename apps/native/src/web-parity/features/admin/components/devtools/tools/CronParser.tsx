// Native parity port of web/src/features/admin/components/devtools/tools/CronParser.tsx.
//
// A Dev Tools utility card: the user types a 5-field cron expression (or taps a
// preset), and the card renders a plain-English description plus the next 5 run
// timestamps. The whole thing is pure client-side computation — there is no API
// call, no DOM-only behaviour, and no browser-only dependency, so the logic ports
// 1:1 to React Native.
//
// The web source composes three things this native target cannot import directly:
//   - ./ToolCard            (a devtools-local wrapper — NOT a separate parity target)
//   - ./helpers             (describeCron / getNextCronRuns — NOT a parity target)
//   - @/components/ui Input/Button/Badge + @/lib/dateFormat formatDateTime
// Mirroring the established InfrastructureSection.tsx precedent for this folder,
// the port is SELF-CONTAINED: ToolCard, the labelled Input, the preset Buttons and
// the info Badge are reproduced natively in this one file, and describeCron /
// getNextCronRuns are copied verbatim from web ./helpers (they are plain TS with no
// DOM). State names (expr), the derived parts/description/nextRuns memo logic, the
// five preset values, and every i18n key are preserved exactly.
//
// Native-safe adaptations (documented in the sidecar):
//   - The lucide Timer icon (header + Input leading icon) has no native SVG analog
//     here, so it becomes a short "TM" glyph inside the same web ICON_COLOR_MAP
//     green ring (header) / a muted leading glyph (input), matching the sibling
//     InfrastructureSection glyph language.
//   - The shared web ui (GlassPanel/Input/Button/Badge) and DOM elements
//     (div/span/p/input/button) are replaced by the shared native GlassPanel +
//     RN View/TextInput/Pressable + AppText against the theme tokens.
//   - react-i18next is not wired in native, so useTranslation()'s `t` is replaced
//     by a native fallback returning the i18n key (i18next returns the key for a
//     missing translation, so t('Cron Parser') -> 'Cron Parser'), preserving every
//     key verbatim.
//   - formatDateTime is the native lib/format parity of @/lib/dateFormat; the Date
//     produced by getNextCronRuns is handed to it as an ISO string at the call
//     boundary (it round-trips to the same instant and renders in the same local
//     wall-clock zone), consistent with the sibling AlertDetailTimeline port.
//
// No DOM, Recharts, Leaflet, lucide-react, or old web ui components are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {formatDateTime} from '../../../../../../lib/format';
import {colors, spacing, typography} from '../../../../../../theme/tokens';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback?: string) => string;

// react-i18next is not wired in native. i18next returns the key itself when a
// translation is missing, so the fallback returns the key (web t('Every Minute')
// -> 'Every Minute') or the supplied English default, preserving every key.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ─── cron helpers (web-parity of ./helpers describeCron) ─────────────── */

function describeCron(parts: string[]): string {
  if (parts.length !== 5) {
    return 'Invalid cron expression';
  }
  const [min, hr, dom, mon, dow] = parts;
  const pieces: string[] = [];
  if (min === '*' && hr === '*') {
    pieces.push('Every minute');
  } else if (min !== '*' && hr === '*') {
    pieces.push(`At minute ${min} of every hour`);
  } else if (min !== '*' && hr !== '*') {
    pieces.push(`At ${hr!.padStart(2, '0')}:${min!.padStart(2, '0')}`);
  } else {
    pieces.push(`Every minute of hour ${hr}`);
  }
  if (dom !== '*') {
    pieces.push(`on day ${dom}`);
  }
  if (mon !== '*') {
    pieces.push(`in month ${mon}`);
  }
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const idx = parseInt(dow!, 10);
    pieces.push(`on ${days[idx] ?? dow}`);
  }
  return pieces.join(' ');
}

/* ─── cron helpers (web-parity of ./helpers getNextCronRuns) ──────────── */

function getNextCronRuns(parts: string[], count: number): Date[] {
  if (parts.length !== 5) {
    return [];
  }
  const results: Date[] = [];
  const now = new Date();
  const check = new Date(now);
  check.setSeconds(0, 0);
  check.setMinutes(check.getMinutes() + 1);
  const matchField = (field: string, value: number): boolean => {
    if (field === '*') {
      return true;
    }
    if (field.includes('/')) {
      const [, step] = field.split('/');
      return value % parseInt(step ?? '1', 10) === 0;
    }
    if (field.includes(',')) {
      return field.split(',').map(Number).includes(value);
    }
    if (field.includes('-')) {
      const [lo, hi] = field.split('-').map(Number);
      return value >= (lo ?? 0) && value <= (hi ?? 0);
    }
    return parseInt(field, 10) === value;
  };
  let safety = 0;
  while (results.length < count && safety < 525960) {
    safety++;
    const [min, hr, dom, mon, dow] = parts;
    if (
      matchField(min ?? '*', check.getMinutes()) &&
      matchField(hr ?? '*', check.getHours()) &&
      matchField(dom ?? '*', check.getDate()) &&
      matchField(mon ?? '*', check.getMonth() + 1) &&
      matchField(dow ?? '*', check.getDay())
    ) {
      results.push(new Date(check));
    }
    check.setMinutes(check.getMinutes() + 1);
  }
  return results;
}

/* ─── ToolCard (web-parity of ./ToolCard, green variant) ──────────────── */

interface ToolCardProps {
  glyph: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function ToolCard({glyph, title, description, children}: ToolCardProps) {
  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.iconBox}>
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={styles.iconGlyph}
            weight="bold">
            {glyph}
          </AppText>
        </View>
        <View style={styles.cardHeaderText}>
          <AppText style={styles.cardTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.cardDescription} tone="secondary">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

/* ─── PresetButton (web-parity of the ghost/sm Button) ────────────────── */

function PresetButton({label, onPress}: {label: string; onPress: () => void}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [styles.preset, pressed && styles.pressed]}>
      <AppText style={styles.presetLabel} tone="secondary" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── InfoBadge (web-parity of <Badge variant="info" size="sm">) ──────── */

function InfoBadge({label}: {label: string}) {
  return (
    <View style={styles.infoBadge}>
      <AppText
        allowFontScaling={false}
        style={styles.infoBadgeLabel}
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Cron Parser Tool
   ═══════════════════════════════════════════════════════════════════════ */

export interface CronParserToolProps {
  /** Native style applied to the card wrapper (replaces the web className slot). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function CronParserTool({style, testID}: CronParserToolProps = {}) {
  const t = useNativeTranslationFallback();
  const [expr, setExpr] = useState('');

  const parts = useMemo(() => expr.trim().split(/\s+/), [expr]);
  const description = useMemo(
    () => (parts.length === 5 ? describeCron(parts) : ''),
    [parts],
  );
  const nextRuns = useMemo(
    () => (parts.length === 5 ? getNextCronRuns(parts, 5) : []),
    [parts],
  );

  const presets = [
    {label: t('Every Minute'), value: '* * * * *'},
    {label: t('Every Hour'), value: '0 * * * *'},
    {label: t('Every Day'), value: '0 0 * * *'},
    {label: t('Every Week'), value: '0 0 * * 0'},
    {label: t('Every Month'), value: '0 0 1 * *'},
  ];

  return (
    <View style={style} testID={testID ?? 'cron-parser-tool'}>
      <ToolCard
        glyph="TM"
        title={t('Cron Parser')}
        description={t('Cron Parser Desc')}>
        <View style={styles.body}>
          <View style={styles.field}>
            <AppText style={styles.fieldLabel} tone="secondary">
              {t('Cron Expression')}
            </AppText>
            <View style={styles.inputRow}>
              <AppText
                accessible={false}
                allowFontScaling={false}
                style={styles.inputGlyph}
                tone="muted">
                TM
              </AppText>
              <TextInput
                accessibilityLabel={t('Cron Expression')}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setExpr}
                placeholder="*/5 * * * *"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={expr}
              />
            </View>
          </View>

          <View style={styles.presetRow}>
            {presets.map(p => (
              <PresetButton
                key={p.value}
                label={p.label}
                onPress={() => setExpr(p.value)}
              />
            ))}
          </View>

          {description ? (
            <View style={styles.descriptionBox}>
              <AppText style={styles.metaLabel} tone="secondary">
                {t('Description')}
              </AppText>
              <AppText style={styles.descriptionText}>{description}</AppText>
            </View>
          ) : null}

          {nextRuns.length > 0 ? (
            <View style={styles.runsBlock}>
              <AppText style={styles.metaLabel} tone="secondary">
                {t('Next Runs')}
              </AppText>
              {nextRuns.map((d, i) => (
                <View key={i} style={styles.runRow}>
                  <InfoBadge label={String(i + 1)} />
                  <AppText style={styles.runText} tone="secondary">
                    {formatDateTime(d.toISOString())}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ToolCard>
    </View>
  );
}

CronParserTool.displayName = 'CronParserTool';

export default CronParserTool;

/* ─── styles ──────────────────────────────────────────────────────────── */

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

// web --surface-overlay (dark theme): rgba(15, 23, 42, 0.5)
const SURFACE_OVERLAY = 'rgba(15, 23, 42, 0.5)';
// web Input bg approximation (matches sibling InfrastructureSection)
const INPUT_BG = 'rgba(255, 255, 255, 0.04)';
// web text-emerald-300
const EMERALD_300 = '#6ee7b7';
// web Badge variant="info" (dark): bg-blue-900 text-blue-200
const INFO_BADGE_BG = '#1e3a8a';
const INFO_BADGE_TEXT = '#bfdbfe';

const styles = StyleSheet.create({
  // web ToolCard: <GlassPanel className="p-5">
  card: {
    padding: spacing.lg,
  },
  // web: mb-4 flex items-start gap-3
  cardHeader: {
    columnGap: spacing.md,
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  // web: h-10 w-10 shrink-0 rounded-lg + ICON_COLOR_MAP.green ring
  iconBox: {
    alignItems: 'center',
    backgroundColor: 'rgba(52, 211, 153, 0.10)',
    borderColor: 'rgba(52, 211, 153, 0.20)',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    color: colors.success,
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  cardHeaderText: {
    flex: 1,
  },
  // web: text-sm font-semibold text-white
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  // web: text-xs text-[var(--text-secondary)]
  cardDescription: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  // web: <div className="space-y-3">
  body: {
    rowGap: spacing.md,
  },
  field: {
    rowGap: spacing.xs,
  },
  // web Input label: text-sm font-medium text-[var(--text-secondary)]
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  // web Input md w/ leading icon: border + bg-surface-1 + pl-10
  inputRow: {
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  inputGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
    marginRight: spacing.sm,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    paddingVertical: spacing.sm,
  },
  // web: flex flex-wrap gap-1
  presetRow: {
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  // web ghost/sm Button
  preset: {
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  presetLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.7,
  },
  // web: rounded bg-[var(--surface-overlay)] px-3 py-2
  descriptionBox: {
    backgroundColor: SURFACE_OVERLAY,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // web: text-xs text-[var(--text-secondary)] (Description / Next Runs labels)
  metaLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web: text-sm text-emerald-300
  descriptionText: {
    color: EMERALD_300,
    fontSize: 14,
    lineHeight: 19,
    marginTop: 2,
  },
  // web: <div className="space-y-1">
  runsBlock: {
    rowGap: spacing.xs,
  },
  // web: flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1
  runRow: {
    alignItems: 'center',
    backgroundColor: SURFACE_OVERLAY,
    borderRadius: 8,
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  // web Badge variant="info" size="sm": rounded-full px-1.5 py-0.5 text-xs
  infoBadge: {
    backgroundColor: INFO_BADGE_BG,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  infoBadgeLabel: {
    color: INFO_BADGE_TEXT,
    fontSize: 12,
    lineHeight: 16,
  },
  // web: text-xs font-mono text-[var(--text-secondary)]
  runText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
});
