// Native parity port of web/src/components/ui/MaskedValue.tsx.
//
// `<MaskedValue>` privacy primitive. Renders a sensitive string in masked form
// by default with a tap-to-reveal affordance, used wherever the cleartext value
// is occasionally needed for copy/paste or visual confirmation but should never
// be shown to a casual screen-share viewer.
//
// Behavioural contract (identical to web):
//   - Initial render is always masked. The accessibilityLabel (web aria-label)
//     describes the value semantically (e.g. "API key, click to reveal") so
//     screen readers do not blurt out the raw value.
//   - Tapping the eye toggle reveals the value AND, when auditOnReveal=true,
//     fires a fire-and-forget POST to `/api/v1/audit/reveal` so the action is
//     recorded in audit_logs. Audit failures NEVER block the UX.
//   - The reveal auto-hides after 30 seconds. Manually toggling back also clears
//     the timer.
//   - The copy button (when `copyable`) always copies the underlying value,
//     regardless of mask state — operators can hand off the secret without a
//     permanent on-screen reveal.
//
// The web version composes the shared <Button> / <CopyButton>, the lucide
// Eye/EyeOff/Copy/CheckCircle SVGs, the `@/lib/cn` Tailwind merge, react-i18next,
// `@/lib/maskValue`, and `navigator.clipboard`. React Native has no DOM
// `<span>`/`<code>`/`<button>`, no lucide SVGs, no Tailwind, no wired
// react-i18next, and no bundled clipboard module, so this port reproduces the
// same contract with native primitives:
//   - The masked/cleartext value is an <AppText> in a monospace family (web
//     `<code className="font-mono">`), cyan-300 when revealed, text-secondary
//     when masked.
//   - The reveal toggle and copy control become small <Pressable
//     accessibilityRole="button"> affordances carrying their state-mirroring
//     accessibilityLabel; the toggle reflects the web `aria-pressed` via
//     accessibilityState.selected and the eye glyphs swap with reveal state.
//   - The masking strategy (`maskFor` + `MaskVariant`) is a faithful inline port
//     of `@/lib/maskValue` (pure, native-safe logic) kept private to this file
//     until that module gets its own dedicated native conversion.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so useTranslation()'s `t` is replaced
//     by the established useNativeTranslationFallback helper returning the English
//     defaultValue. The i18n keys/copy (mask.hide, mask.reveal, mask.copy) are
//     preserved verbatim; a native-only mask.copyUnavailable hint backs the
//     unavailable-clipboard state.
//   - `navigator.clipboard.writeText` is browser-only. On react-native-web it is
//     used as-is; on iOS/Android (no bundled clipboard module yet) the copy
//     control degrades to an explicit "copy unavailable" state instead of silently
//     succeeding. The fire-and-forget audit POST keeps `keepalive` for source
//     fidelity (a no-op on native fetch).
//   - The optional web `className` is accepted-but-ignored for source
//     compatibility and mirrored by a native `style` override on the wrapper.

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {apiUrl} from '../../api/client';

// ---------------------------------------------------------------------------
// Faithful inline port of `@/lib/maskValue` (pure, native-safe logic). Kept
// private here until web/src/lib/maskValue.ts gets its own native conversion.
// ---------------------------------------------------------------------------

/** MaskVariant selects the masking strategy. */
export type MaskVariant = 'token' | 'vin' | 'coords' | 'email' | 'generic';

const BULLET = '\u2022'; // •
const SEPARATOR = ', ';

/** Default number of trailing characters visible per variant. */
const DEFAULT_SHOW_LAST: Record<MaskVariant, number> = {
  token: 4,
  vin: 4,
  coords: 0,
  email: 1,
  generic: 0,
};

function bullets(count: number): string {
  if (count <= 0) {
    return '';
  }
  return BULLET.repeat(count);
}

function maskGeneric(value: string, showLast: number): string {
  if (value.length === 0) {
    return '';
  }
  const visible = Math.max(0, Math.min(showLast, value.length));
  const hidden = value.length - visible;
  return bullets(hidden) + value.slice(value.length - visible);
}

function maskToken(value: string, showLast: number): string {
  if (value.length === 0) {
    return '';
  }
  const visible = Math.max(0, Math.min(showLast, value.length));
  // Tokens always render a fixed-length bullet run so the masked form does not
  // leak the original length (a 16-char token and a 64-char token must look the
  // same when masked).
  return bullets(12) + value.slice(value.length - visible);
}

function maskVin(value: string, showLast: number): string {
  if (value.length === 0) {
    return '';
  }
  // Tesla VINs are 17 characters; a typical first three are the WMI ("5YJ").
  // When the input matches the expected shape we expose the WMI plus the last 4;
  // otherwise we fall back to a fully-bulleted mask.
  if (value.length >= 11) {
    const visibleSuffix = Math.max(0, Math.min(showLast, value.length - 3));
    const hidden = value.length - 3 - visibleSuffix;
    return (
      value.slice(0, 3) + bullets(hidden) + value.slice(value.length - visibleSuffix)
    );
  }
  return bullets(value.length);
}

function maskEmail(value: string, showLast: number): string {
  const at = value.indexOf('@');
  if (at <= 0) {
    return maskGeneric(value, Math.max(showLast, 0));
  }
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const visible = Math.max(0, Math.min(showLast, local.length));
  const masked = local.slice(0, visible) + bullets(Math.max(local.length - visible, 1));
  return masked + domain;
}

function maskCoords(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const parts = trimmed
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);
  if (parts.length === 0) {
    return '';
  }
  const numeric = parts.every(p => Number.isFinite(Number(p)));
  if (!numeric) {
    return maskGeneric(trimmed, 0);
  }
  return parts
    .map(() => `${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}`)
    .join(SEPARATOR);
}

/**
 * Pure, total masking function — never throws, even on empty strings or
 * unexpected variants. An unknown variant is treated as `generic`.
 */
function maskFor(
  value: string,
  variant: MaskVariant,
  showLast?: number,
): string {
  if (value == null) {
    return '';
  }
  const last = showLast ?? DEFAULT_SHOW_LAST[variant] ?? 0;
  switch (variant) {
    case 'token':
      return maskToken(value, last);
    case 'vin':
      return maskVin(value, last);
    case 'coords':
      return maskCoords(value);
    case 'email':
      return maskEmail(value, last);
    case 'generic':
    default:
      return maskGeneric(value, last);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export type MaskedValueVariant = MaskVariant;

export interface MaskedValueProps {
  /** The raw value to mask. Empty/undefined renders an em-dash. */
  value: string | null | undefined;
  /** Masking strategy — see the inline `maskFor()` port. */
  variant: MaskedValueVariant;
  /** Override the variant's default visible-suffix length. */
  showLast?: number;
  /** Render a copy button next to the toggle that copies the raw value. */
  copyable?: boolean;
  /** When true, POSTs `/audit/reveal` on each reveal. Default: false. */
  auditOnReveal?: boolean;
  /** Required: human-readable description for screen readers and tests. */
  ariaLabel: string;
  /** Override the auto-hide duration (ms). Default: 30 000. */
  autoHideMs?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the outer wrapper (RN equivalent of `className`). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type CopyState = 'idle' | 'copied' | 'unavailable';

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * Native i18n fallback: react-i18next is not wired in native, so this returns
 * the English defaultValue — preserving the web i18n keys and copy verbatim.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

const DEFAULT_AUTO_HIDE_MS = 30_000;
const COPY_RESET_MS = 2_000;

// lucide Eye / EyeOff / Copy / CheckCircle affordances rendered as text glyphs.
const REVEAL_GLYPH = '\u25C9'; // ◉ — open eye (reveal action while masked).
const HIDE_GLYPH = '\u2298'; // ⊘ — eye-off (hide action while revealed).
const COPY_GLYPH = '\u29C9'; // ⧉ — two joined squares (copy/duplicate).
const COPIED_GLYPH = '\u2713'; // ✓ — success check (CheckCircle parity).

// text-cyan-300 literal so the revealed/copied accents survive without Tailwind.
const CYAN_300 = '#67e8f9';

// Monospace family for the value (web `<code className="font-mono">`).
const MONOSPACE = Platform.select({ios: 'Menlo', default: 'monospace'});

/**
 * Fire-and-forget audit POST. Plain `fetch` (NOT the resilient client) so a
 * non-existent endpoint or transient backend failure never interferes with the
 * reveal UX. Errors are swallowed by design. `keepalive` is retained for source
 * fidelity (a no-op on native fetch).
 */
function postRevealAudit(variant: string): void {
  try {
    void fetch(apiUrl('/audit/reveal'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({kind: 'masked_reveal', variant}),
      credentials: 'include',
      keepalive: true,
    }).catch(() => {
      /* silent: audit is defense-in-depth; never block reveal UX */
    });
  } catch {
    /* silent: same rationale as above for synchronous throw paths */
  }
}

/**
 * Native-safe clipboard writer. Uses `navigator.clipboard.writeText` when
 * present (react-native-web), otherwise reports `unavailable` so callers can
 * surface an explicit degraded state rather than silently "succeeding".
 */
async function writeClipboard(text: string): Promise<CopyState> {
  const nav = (globalThis as unknown as {
    navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
  }).navigator;
  const clipboard = nav?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    // Clipboard exists but the write failed — mirror the web behaviour of not
    // flipping to the "copied" state.
    return 'idle';
  }
}

/**
 * Privacy primitive that masks a sensitive string with a tap-to-reveal toggle
 * and an optional copy control. Feature screens should import this component
 * instead of rolling their own mask + reveal block.
 */
export function MaskedValue({
  value,
  variant,
  showLast,
  copyable = false,
  auditOnReveal = false,
  ariaLabel,
  autoHideMs = DEFAULT_AUTO_HIDE_MS,
  className: _className,
  style,
  testID,
}: MaskedValueProps) {
  const t = useNativeTranslationFallback();
  const [revealed, setRevealed] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reactId = useId();

  const raw = value ?? '';
  const masked = useMemo(() => maskFor(raw, variant, showLast), [raw, variant, showLast]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearCopyTimer = useCallback(() => {
    if (copyTimerRef.current != null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, []);

  // Always release the timers on unmount so a teardown mid-reveal does not leak
  // a setTimeout that fires against an unmounted component.
  useEffect(
    () => () => {
      clearTimer();
      clearCopyTimer();
    },
    [clearTimer, clearCopyTimer],
  );

  const reveal = useCallback(() => {
    if (raw.length === 0) {
      return;
    }
    setRevealed(true);
    clearTimer();
    if (auditOnReveal) {
      postRevealAudit(variant);
    }
    if (autoHideMs > 0) {
      timerRef.current = setTimeout(() => {
        setRevealed(false);
        timerRef.current = null;
      }, autoHideMs);
    }
  }, [auditOnReveal, autoHideMs, clearTimer, raw, variant]);

  const hide = useCallback(() => {
    setRevealed(false);
    clearTimer();
  }, [clearTimer]);

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(raw);
    setCopyState(outcome);
    clearCopyTimer();
    copyTimerRef.current = setTimeout(() => {
      setCopyState('idle');
      copyTimerRef.current = null;
    }, COPY_RESET_MS);
  }, [raw, clearCopyTimer]);

  const toggleLabel = revealed
    ? t('mask.hide', 'Hide value')
    : t('mask.reveal', 'Reveal value');
  const copyLabel = t('mask.copy', 'Copy value');
  const copyUnavailableHint = t(
    'mask.copyUnavailable',
    'Copy is unavailable on this device',
  );

  // Empty values render an em-dash (matching the rest of the UI's missing-data
  // convention) without a toggle — there is nothing to reveal and rendering the
  // toggle would be misleading.
  if (raw.length === 0) {
    return (
      <View
        accessibilityLabel={ariaLabel}
        accessible
        style={[styles.emptyWrapper, style]}
        testID={testID}>
        <AppText accessible={false} style={styles.emptyDash}>
          —
        </AppText>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={ariaLabel}
      style={[styles.wrapper, style]}
      testID={testID ?? 'masked-value'}>
      <AppText
        nativeID={`masked-value-${reactId}`}
        numberOfLines={1}
        style={[styles.value, revealed ? styles.valueRevealed : styles.valueMasked]}
        testID="masked-value-text">
        {revealed ? raw : masked}
      </AppText>

      <Pressable
        accessibilityLabel={toggleLabel}
        accessibilityRole="button"
        accessibilityState={{selected: revealed}}
        hitSlop={8}
        onPress={revealed ? hide : reveal}
        style={({pressed}) => [styles.control, pressed && styles.controlPressed]}
        testID="masked-value-toggle">
        <AppText accessible={false} allowFontScaling={false} style={styles.controlGlyph}>
          {revealed ? HIDE_GLYPH : REVEAL_GLYPH}
        </AppText>
      </Pressable>

      {copyable ? (
        <Pressable
          accessibilityHint={
            copyState === 'unavailable' ? copyUnavailableHint : undefined
          }
          accessibilityLabel={copyLabel}
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleCopy}
          style={({pressed}) => [styles.control, pressed && styles.controlPressed]}
          testID="masked-value-copy">
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={[
              styles.controlGlyph,
              copyState === 'copied' && styles.controlGlyphCopied,
              copyState === 'unavailable' && styles.controlGlyphUnavailable,
            ]}>
            {copyState === 'copied' ? COPIED_GLYPH : COPY_GLYPH}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

MaskedValue.displayName = 'MaskedValue';

/**
 * Test-only: re-export the audit helper so tests can mock the network layer
 * without going through the component's internals.
 */
export const __postRevealAuditForTests = postRevealAudit;

const styles = StyleSheet.create({
  // inline-flex items-center gap-1.5 align-middle
  wrapper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  // inline-flex items-center gap-1 (empty / em-dash variant)
  emptyWrapper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  emptyDash: {
    color: colors.textMuted,
  },
  // font-mono text-sm break-all
  value: {
    flexShrink: 1,
    fontFamily: MONOSPACE,
    fontSize: 14,
    lineHeight: 18,
  },
  valueRevealed: {
    color: CYAN_300,
  },
  valueMasked: {
    color: colors.textSecondary,
  },
  // ghost sm button: !h-7 !min-h-0 !px-1.5
  control: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    paddingHorizontal: spacing.xs + 2,
  },
  controlPressed: {
    opacity: 0.6,
  },
  controlGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  controlGlyphCopied: {
    color: CYAN_300,
  },
  controlGlyphUnavailable: {
    color: colors.textMuted,
  },
});

export default MaskedValue;
