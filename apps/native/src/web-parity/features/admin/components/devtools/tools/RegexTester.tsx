// Native parity port of
// web/src/features/admin/components/devtools/tools/RegexTester.tsx.
//
// `RegexTesterTool` is a devtools card that compiles a user-supplied regular
// expression (pattern + flags) against a test string and lists every match with
// its index. State (`pattern`/`setPattern`, `flags`/`setFlags`,
// `testStr`/`setTestStr`), the memoized `matches` derivation, the global vs
// single-exec branch, the zero-width-match `break`, the try/catch -> [] fallback,
// the `flagOptions` list, and every i18n key are preserved verbatim from the web
// source. The web source pulls modules with no native-parity surface, mapped per
// the conversion contract (rules 4/5/6/7):
//   - react useState/useMemo (L1) kept as-is; `useCallback` is added only for the
//     local i18n shim.
//   - react-i18next `useTranslation` (L2) -> the standard web-parity i18n shim.
//     Every call in this file is a bare `t(key)` with NO inline fallback
//     (`No Flags`, `Regex Tester`, `Regex Tester Desc`, `Pattern`, `Flags`,
//     `Test String`, `Test String Placeholder`, `Matches`, `At Index`), so the
//     shim resolves `fallback ?? key` — i.e. it echoes the key, exactly matching
//     react-i18next's "return the key when there is no translation/fallback".
//   - lucide-react `Regex` (L3, SVG) has no native analog -> a decorative `.*`
//     AppText glyph (the FleetTelemetryHealth/Base64Tool glyph approach), used
//     both as the ToolCard icon and as the Input's leading icon.
//   - `Input`, `Select`, `Badge`, `Textarea` from @/components/ui (L4): the
//     web-parity `Badge` (web-parity/components/ui/Badge) and `Textarea`
//     (web-parity/components/ui/Textarea) are reused as-is. There is no parity
//     `Input` or `Select`, so both are rebuilt locally (the Base64Tool
//     "rebuild the unported sibling locally" precedent): `Input` is a labelled
//     single-line `TextInput` with an optional leading-icon row (web `Input`
//     size `md` + `icon`); `Select` is a native-safe dropdown (see rule 7 below).
//     Both reuse the ported `Label`.
//   - `ToolCard` (L5, sibling ../ToolCard) is not ported yet, so its card chrome
//     (GlassPanel p-5 + tinted 40x40 icon box + title/description) is reproduced
//     by a local `ToolCard` helper, the same approach the Base64Tool /
//     FleetTelemetryHealth ports use. The web `icon`/`color` props collapse to a
//     `glyph` + `color`; the web `color="red"` maps through the TOOL_TONES
//     palette to the native danger tokens (the cyan default is preserved).
//
// Browser-only behaviour (rule 7):
//   - The web `<select>` (via @/components/ui Select) renders a real OS dropdown.
//     React Native has no `<select>` and the app bundles no picker module, so the
//     dropdown is reproduced as a tap-to-expand inline option list (Pressable
//     trigger showing the selected label + a chevron, then a Pressable per
//     option). This is the explicit native-safe implementation; selecting an
//     option drives the same `flags`/`setFlags` state the web `onChange` did.
//   - The DOM change events `onChange={(e) => setX(e.target.value)}` have no
//     native analog -> the RN-idiomatic `onChangeText={setX}` (Input/Textarea)
//     and `onValueChange={setFlags}` (Select), feeding the same state setters.
//
// Visual intent: web `color="red"` -> danger surface/border/foreground tokens.
// Tailwind body classes map to the toned-down SI palette: text-rose-300 ->
// #fda4af; --text-secondary/-muted/-primary -> colors.textSecondary/-Muted/
// -Primary. bg-[var(--surface-overlay)] -> the canonical dark overlay
// rgba(0,0,0,0.6); bg-[var(--surface-1)] -> #0e1727. font-mono -> Platform.select
// monospace. Tailwind spacing -> px: space-y-3 -> gap 12, space-y-1 -> gap 4,
// gap-3 -> 12, gap-2 -> 8, gap-1 -> 4, text-xs -> 12/16, text-sm -> 14/20,
// font-medium -> '500', font-semibold -> '600', mb-1 -> 4, rounded -> 4,
// rounded-md -> 6, rounded-lg -> 8, px-3 -> 12, py-1 -> 4, py-2 -> 8, p-5 -> 20,
// h-10/w-10 -> 40, h-4/w-4 -> 16. The web `grid gap-3 sm:grid-cols-2` is a
// responsive two-column grid above 640px; native is mobile-first, so it resolves
// to the <640px single-column stack (gap 12). The web focus ring
// (focus:ring-blue-500) collapses to a blue focus border on the Input; the
// `<select>` focus ring collapses to the trigger's Pressable pressed style. The
// placeholder `"\\d+"` is kept as a JSX attribute exactly as in the source, so
// the literal value (`\\d+`) is byte-identical to the web.

import React, {useCallback, useMemo, useState} from 'react';
import {Platform, Pressable, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../../theme/tokens';
import {Badge} from '../../../../../components/ui/Badge';
import {Label} from '../../../../../components/ui/Label';
import {Textarea} from '../../../../../components/ui/Textarea';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module. Every call in this file is a bare
// `t(key)` with no inline fallback, so this shim resolves `fallback ?? key` —
// echoing the key, exactly matching react-i18next's "return the key when there
// is no translation/fallback". The hook shape mirrors the web
// `const { t } = useTranslation()` so the component body is unchanged.
type TFn = (key: string, fallback?: string) => string;

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>((key, fallback) => fallback ?? key, []);
  return {t};
}

// Toned-down SI body-text palette + dark surfaces (web text-*/bg-* CSS classes
// have no className analog on native).
const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});
const ROSE_300 = '#fda4af'; // text-rose-300
const SURFACE_OVERLAY = 'rgba(0, 0, 0, 0.6)'; // --surface-overlay (dark canonical)
const SURFACE_1 = '#0e1727'; // --surface-1
const FOCUS_BORDER = 'rgba(59, 130, 246, 0.6)'; // focus:ring-blue-500
// Decorative stand-in for the lucide Regex icon (SVG has no native analog).
const REGEX_GLYPH = '.*';

// ── Input (web @/components/ui Input, size md + leading icon) ─────────────────
// No parity Input port exists; the subset the web body uses (label, placeholder,
// value, onChange, icon) is rebuilt as a labelled single-line TextInput with an
// optional leading-icon row. Web `space-y-1` wrapper, the derived id, and the
// `text-sm font-medium --text-secondary` Label are preserved.
interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (value: string) => void;
  icon?: React.ReactNode;
}

function Input({label, placeholder, value, onChangeText, icon}: InputProps) {
  const [focused, setFocused] = useState(false);
  // Web L36: id || label?.toLowerCase().replace(/\s+/g, '-').
  const inputId = label?.toLowerCase().replace(/\s+/g, '-');
  return (
    <View style={styles.fieldBlock}>
      {label ? (
        <Label htmlFor={inputId} style={styles.fieldLabel}>
          {label}
        </Label>
      ) : null}
      <View
        style={[
          styles.control,
          {borderColor: focused ? FOCUS_BORDER : colors.border},
        ]}>
        {icon ? <View style={styles.controlIcon}>{icon}</View> : null}
        <TextInput
          nativeID={inputId}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.controlInput}
        />
      </View>
    </View>
  );
}

// ── Select (web @/components/ui Select) ──────────────────────────────────────
// React Native has no `<select>` and no picker module is bundled, so the OS
// dropdown is reproduced as a tap-to-expand inline option list (rule 7). The
// SelectOption shape, the derived id, the `text-sm font-medium --text-secondary`
// Label, and the selected-value display are preserved; selecting an option
// drives the same state setter the web `onChange` did.
interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}

function Select({label, options, value, onValueChange}: SelectProps) {
  const [open, setOpen] = useState(false);
  // Web L41: id || label?.toLowerCase().replace(/\s+/g, '-').
  const selectId = label?.toLowerCase().replace(/\s+/g, '-');
  const selected = options.find(opt => opt.value === value);
  return (
    <View style={styles.fieldBlock}>
      {label ? (
        <Label htmlFor={selectId} style={styles.fieldLabel}>
          {label}
        </Label>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        nativeID={selectId}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [
          styles.control,
          styles.selectTrigger,
          pressed && styles.pressed,
        ]}>
        <AppText style={styles.selectValue}>{selected?.label ?? ''}</AppText>
        <AppText style={styles.selectChevron}>
          {open ? '\u25b4' : '\u25be'}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.selectMenu}>
          {options.map(opt => {
            const active = opt.value === value;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="button"
                accessibilityState={{
                  selected: active,
                  disabled: Boolean(opt.disabled),
                }}
                disabled={opt.disabled}
                onPress={() => {
                  onValueChange(opt.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.selectOption,
                  active && styles.selectOptionActive,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  style={[
                    styles.selectOptionText,
                    active && styles.selectOptionTextActive,
                  ]}>
                  {opt.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ── ToolCard (local chrome; sibling ../ToolCard not ported yet) ──────────────
interface ToolTone {
  bg: string;
  border: string;
  fg: string;
}

// web ICON_COLOR_MAP: bg-neon-{color}/10 + ring neon-{color}/20 + text
// neon-{color} -> the native accent/success/violet/warning/danger tokens.
const TOOL_TONES: Record<string, ToolTone> = {
  cyan: {bg: colors.accentSoft, border: colors.borderAccent, fg: colors.accent},
  green: {
    bg: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  purple: {
    bg: colors.violetSurface,
    border: colors.violetBorder,
    fg: colors.violet,
  },
  amber: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
  red: {bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger},
};

interface ToolCardProps {
  /** Decorative glyph standing in for the lucide icon. */
  glyph: string;
  /** Maps the web ToolCard `color` prop (red here). */
  color: string;
  title: string;
  description: string;
  children: React.ReactNode;
}

function ToolCard({glyph, color, title, description, children}: ToolCardProps) {
  // Web: ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan.
  const palette = TOOL_TONES[color] ?? TOOL_TONES.cyan;
  return (
    <GlassPanel style={styles.toolCard}>
      <View style={styles.toolCardHeader}>
        <View
          style={[
            styles.toolCardIcon,
            {backgroundColor: palette.bg, borderColor: palette.border},
          ]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.toolCardGlyph, {color: palette.fg}]}>
            {glyph}
          </AppText>
        </View>
        <View style={styles.toolCardTitleWrap}>
          <AppText style={styles.toolCardTitle}>{title}</AppText>
          <AppText style={styles.toolCardDesc}>{description}</AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

export function RegexTesterTool() {
  const {t} = useTranslation();
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
  const [testStr, setTestStr] = useState('');

  const matches = useMemo(() => {
    if (!pattern || !testStr) {
      return [];
    }
    try {
      const re = new RegExp(pattern, flags);
      const results: {match: string; index: number}[] = [];
      let m: RegExpExecArray | null;
      if (flags.includes('g')) {
        while ((m = re.exec(testStr)) !== null) {
          results.push({match: m[0], index: m.index});
          if (!m[0]) {
            break;
          }
        }
      } else {
        m = re.exec(testStr);
        if (m) {
          results.push({match: m[0], index: m.index});
        }
      }
      return results;
    } catch {
      return [];
    }
  }, [pattern, flags, testStr]);

  const flagOptions = [
    {value: 'g', label: 'g (global)'},
    {value: 'gi', label: 'gi (global, case-insensitive)'},
    {value: 'gm', label: 'gm (global, multiline)'},
    {value: 'gim', label: 'gim (all)'},
    {value: '', label: t('No Flags')},
  ];

  return (
    <ToolCard
      glyph={REGEX_GLYPH}
      color="red"
      title={t('Regex Tester')}
      description={t('Regex Tester Desc')}>
      <View style={styles.stack}>
        <View style={styles.grid}>
          <Input
            label={t('Pattern')}
            placeholder="\\d+"
            value={pattern}
            onChangeText={setPattern}
            icon={
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.inputIconGlyph}>
                {REGEX_GLYPH}
              </AppText>
            }
          />
          <Select
            label={t('Flags')}
            options={flagOptions}
            value={flags}
            onValueChange={setFlags}
          />
        </View>
        <View>
          <AppText style={styles.testStringLabel}>{t('Test String')}</AppText>
          <Textarea
            rows={3}
            value={testStr}
            onChangeText={setTestStr}
            placeholder={t('Test String Placeholder')}
          />
        </View>
        <View style={styles.badgeRow}>
          <Badge variant={matches.length > 0 ? 'success' : 'neutral'} size="sm">
            {matches.length} {t('Matches')}
          </Badge>
        </View>
        {matches.length > 0 ? (
          <View style={styles.matchList}>
            {matches.map((m, i) => (
              <View key={i} style={styles.matchRow}>
                <Badge variant="info" size="sm">
                  {i + 1}
                </Badge>
                <AppText style={styles.matchCode}>{m.match}</AppText>
                <AppText style={styles.matchIndex}>
                  {t('At Index')} {m.index}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </ToolCard>
  );
}

export default RegexTesterTool;

const styles = StyleSheet.create({
  stack: {
    gap: 12, // space-y-3
  },
  grid: {
    // grid gap-3; sm:grid-cols-2 resolves to the <640px single-column stack.
    gap: 12,
  },
  fieldBlock: {
    gap: 4, // space-y-1
  },
  fieldLabel: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    lineHeight: 20,
  },
  control: {
    alignItems: 'center',
    backgroundColor: SURFACE_1, // bg-[var(--surface-1)]
    borderRadius: 6, // rounded-md
    borderWidth: 1, // border
    flexDirection: 'row',
    paddingHorizontal: 12, // px-3
  },
  controlIcon: {
    marginRight: 8, // web absolute left-3 leading icon + pl-10 input padding
  },
  inputIconGlyph: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontFamily: MONO_FONT,
    fontSize: 14,
    lineHeight: 16,
  },
  controlInput: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flex: 1,
    fontSize: 14, // text-sm
    lineHeight: 20,
    paddingVertical: 8, // py-2
  },
  selectTrigger: {
    justifyContent: 'space-between',
    paddingVertical: 8, // py-2
  },
  selectValue: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flexShrink: 1,
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginLeft: 8,
  },
  selectMenu: {
    backgroundColor: SURFACE_1,
    borderColor: colors.border,
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
  selectOption: {
    paddingHorizontal: 12, // px-3
    paddingVertical: 8, // py-2
  },
  selectOptionActive: {
    backgroundColor: colors.surfaceSelected,
  },
  selectOptionText: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  selectOptionTextActive: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  testStringLabel: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
    marginBottom: 4, // mb-1
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  matchList: {
    gap: 4, // space-y-1
  },
  matchRow: {
    alignItems: 'center',
    backgroundColor: SURFACE_OVERLAY, // bg-[var(--surface-overlay)]
    borderRadius: 4, // rounded
    flexDirection: 'row',
    gap: 8, // gap-2
    paddingHorizontal: 12, // px-3
    paddingVertical: 4, // py-1
  },
  matchCode: {
    color: ROSE_300, // text-rose-300
    flexShrink: 1, // keep the index visible when the match is long
    fontFamily: MONO_FONT, // font-mono
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  matchIndex: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  toolCard: {
    padding: 20, // p-5
  },
  toolCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12, // gap-3
    marginBottom: 16, // mb-4
  },
  toolCardIcon: {
    alignItems: 'center',
    borderRadius: 8, // rounded-lg
    borderWidth: 1, // ring-1
    height: 40, // h-10
    justifyContent: 'center',
    width: 40, // w-10
  },
  toolCardGlyph: {
    fontFamily: MONO_FONT,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  toolCardTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  toolCardTitle: {
    color: colors.textPrimary, // text-white
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  toolCardDesc: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
});
