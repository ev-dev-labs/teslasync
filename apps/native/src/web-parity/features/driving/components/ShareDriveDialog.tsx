// Native parity port of web/src/features/driving/components/ShareDriveDialog.tsx.
//
// The Share Drive dialog lets the owner mint a public, login-free share link for
// a single drive report. The body has two mutually-exclusive faces:
//   1. The create form (when no link has been minted this session): an optional
//      title field, two include toggles (speed / detailed telemetry), an expiry
//      Select (7d / 30d / 90d / Never), and a "Generate Link" button.
//   2. The result face (after minting): a read-only URL field, a "Copy Link"
//      button + an "open in browser" affordance, and a "Create another link"
//      reset button.
// Below either face, a list of the drive's still-active share links is shown
// (each row: title, view count, expiry/expired label, copy + revoke controls),
// and a spinner while that list loads.
//
// The web version composes the shared <Modal>/<Button>/<CopyButton>/<Toggle>/
// <Select>/<Input>/<GlassPanel>/<Spinner>, the lucide-react Link/Trash2/Eye/
// ExternalLink SVGs, react-i18next, `@/lib/dateFormat` formatDate, and the
// browser-only `window.location.origin` + `window.open`. React Native has no DOM
// <div>/<button>/<input>/<select>/<p>/<h3>/<span>, no lucide SVGs, no Tailwind/CSS
// custom properties, and no `window`, so this port reproduces the same
// behavioural + visual contract with native primitives:
//   - The shared <Modal open onClose title> becomes a transparent fade RN <Modal>
//     with a tap-to-dismiss backdrop <Pressable> + a centered dialog card whose
//     header carries the title and an ✕ close control — the same idiom as the
//     already-converted sibling ConfirmDialog / SignalConfigModal ports. The
//     `space-y-6` body becomes a single scrolling <ScrollView> so the form +
//     existing-share list stays reachable on short screens.
//   - The shared <Toggle> reuses the already-ported native web-parity Toggle
//     (label / checked / onChange), preserving "tap the row toggles".
//   - The shared <Input> (title field + read-only URL field) becomes a native
//     <TextInput> wrapper; the read-only URL field maps onto editable={false}.
//   - The shared <Select> becomes an inline RN Modal-popover <ExpirySelect>
//     (the same trigger-opens-popover idiom as the SignalConfigModal IntervalSelect),
//     listing the four expiry options as accessible Pressable rows.
//   - The shared <Button> variants (primary / outline / ghost, with `loading`)
//     become a reusable <DialogButton>; its spinner state reuses ActivityIndicator.
//   - The shared <CopyButton> (Copy/Copied transition + toast) becomes a native
//     <CopyControl> built on the established navigator.clipboard writeClipboard
//     helper, degrading to an explicit "unavailable" state on iOS/Android where no
//     clipboard module is bundled. It supports the web `iconOnly` (per-row) and
//     labeled "Copy Link" (result face) shapes.
//   - The shared <GlassPanel> reuses the native base GlassPanel for each share row.
//   - The lucide Link/Trash2/Eye/ExternalLink SVGs become compact text glyphs
//     (the same "no SVG icons" idiom as MaskedValue / SemanticIcon).
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next useTranslation -> a native key/English-default fallback `t`
//     that also performs `{{var}}` interpolation, so every share.* key + default
//     (including "Expires {{date}}") is preserved verbatim.
//   - `@/lib/dateFormat` formatDate -> an inlined native-safe equivalent matching
//     the web "Apr 4, 2026" (year/month/day toLocaleDateString) + "—" fallback for
//     nullish/invalid input.
//   - `window.location.origin` is browser-only; the share-link origin is derived
//     from the native API client's getApiBase() (the same host that serves the
//     `/s/{token}` public page), preserving the `${origin}/s/${token}` URL shape.
//   - `window.open(url, '_blank')` -> RN Linking.openURL (errors swallowed, same
//     fire-and-forget intent as the web new-tab open).
//   - The web CopyButton's `withToast` has no native toast wired in these ports;
//     success is surfaced inline via the Copied label, matching the sibling
//     InfrastructureSection / MaskedValue copy ports.
//   - Tailwind utilities + CSS custom properties (var(--text-*), var(--border-*),
//     text-green-400, text-red-400) resolve to StyleSheet styles against the
//     native theme tokens.
//
// No DOM, lucide-react, Recharts, Leaflet, framer-motion, or old web UI
// components are imported.

import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {getApiBase} from '../../../api/client';
import {
  useCreateShareLink,
  useRevokeShareLink,
  useShareLinks,
} from '../../../api/hooks/useSharing';
import {Toggle} from '../../../components/ui/Toggle';

// ---------------------------------------------------------------------------
// Native i18n fallback. react-i18next is not wired in native, so this returns
// the English defaultValue — preserving the web i18n keys + copy verbatim — and
// performs `{{var}}` interpolation so "Expires {{date}}" renders the date.
// ---------------------------------------------------------------------------

type NativeTVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: NativeTVars) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: NativeTVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : `{{${name}}}`,
    );
  }, []);
}

// ---------------------------------------------------------------------------
// Native-safe inline port of `@/lib/dateFormat` formatDate ("Apr 4, 2026").
// Mirrors the web contract: nullish/invalid input -> the "—" placeholder.
// ---------------------------------------------------------------------------

const DATE_FALLBACK = '\u2014'; // —

function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return DATE_FALLBACK;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return DATE_FALLBACK;
  }
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Share-link origin. `window.location.origin` is browser-only; native derives
// the public origin from the API client base (the same host that serves the
// `/s/{token}` page), preserving the `${origin}/s/${token}` URL shape.
// ---------------------------------------------------------------------------

function shareOrigin(): string {
  return getApiBase();
}

function buildShareUrl(token: string): string {
  return `${shareOrigin()}/s/${token}`;
}

// ---------------------------------------------------------------------------
// Native-safe clipboard writer (web-parity of the shared CopyButton). Uses
// navigator.clipboard.writeText when present (react-native-web); on iOS/Android
// no clipboard module is bundled yet, so the copy is reported unavailable rather
// than crashing. Mirrors the web behaviour of not flipping to "Copied" on a
// failed write.
// ---------------------------------------------------------------------------

type CopyState = 'idle' | 'copied' | 'unavailable';

async function writeClipboard(text: string): Promise<CopyState> {
  const nav = (
    globalThis as unknown as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'idle';
  }
}

// lucide affordances rendered as text glyphs (the native "no SVG icons" idiom).
const LINK_GLYPH = '\u26D3'; // ⛓ — chain link (Generate Link).
const EXTERNAL_GLYPH = '\u2197'; // ↗ — open in browser (ExternalLink).
const EYE_GLYPH = '\u25C9'; // ◉ — views (Eye).
const REVOKE_GLYPH = '\u2715'; // ✕ — revoke (Trash2).
const CLOSE_GLYPH = '\u2715'; // ✕ — dismiss the dialog.
const COPY_GLYPH = '\u29C9'; // ⧉ — copy.
const COPIED_GLYPH = '\u2713'; // ✓ — copied (CheckCircle parity).

const COPY_RESET_MS = 2_000;

// text-green-400 / text-red-400 literals so the success/danger accents survive.
const GREEN_400 = '#4ade80';
const RED_400 = '#f87171';

type ExpiryOption = {value: string; label: string};

// ---------------------------------------------------------------------------
// Copy control (web-parity of the shared <CopyButton>). Manages the Copy ->
// Copied -> Copy transition; degrades to an explicit "unavailable" label when no
// clipboard is present.
// ---------------------------------------------------------------------------

interface CopyControlProps {
  text: string;
  /** Copy/Copied label for the labeled (primary) shape. */
  label: string;
  /** Drop the label for dense per-row use (web `iconOnly`). */
  iconOnly?: boolean;
  variant?: 'primary' | 'ghost';
  /** Accessible label override (web `ariaLabel`); falls back to `label`. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function CopyControl({
  text,
  label,
  iconOnly = false,
  variant = 'ghost',
  accessibilityLabel,
  style,
  testID,
}: CopyControlProps) {
  const t = useNativeTranslationFallback();
  const [state, setState] = useState<CopyState>('idle');

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(text);
    setState(outcome);
    if (outcome === 'copied') {
      setTimeout(() => setState('idle'), COPY_RESET_MS);
    }
  }, [text]);

  const copied = state === 'copied';
  const unavailable = state === 'unavailable';
  const visibleLabel = unavailable
    ? t('common.copyButton.unavailable', 'Copy unavailable')
    : copied
      ? t('common.copyButton.copied', 'Copied')
      : label;
  const glyph = copied ? COPIED_GLYPH : COPY_GLYPH;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? visibleLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={handleCopy}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        pressed && styles.pressed,
        style,
      ]}
      testID={testID}>
      <AppText
        accessible={false}
        allowFontScaling={false}
        style={[
          styles.buttonGlyph,
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.ghostButtonText,
        ]}>
        {glyph}
      </AppText>
      {iconOnly ? null : (
        <AppText
          style={
            variant === 'primary'
              ? styles.primaryButtonText
              : styles.ghostButtonText
          }
          weight="semibold">
          {visibleLabel}
        </AppText>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Dialog button (web-parity of the shared <Button> variants + `loading`).
// ---------------------------------------------------------------------------

interface DialogButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  loading?: boolean;
  fullWidth?: boolean;
  leadingGlyph?: string;
  iconOnly?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  glyphTone?: string;
  testID?: string;
}

function DialogButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  fullWidth = false,
  leadingGlyph,
  iconOnly = false,
  accessibilityLabel,
  style,
  glyphTone,
  testID,
}: DialogButtonProps) {
  const variantBg =
    variant === 'primary'
      ? styles.primaryButton
      : variant === 'outline'
        ? styles.outlineButton
        : styles.ghostButton;
  const textStyle =
    variant === 'primary' ? styles.primaryButtonText : styles.ghostButtonText;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: loading}}
      disabled={loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variantBg,
        fullWidth && styles.fullWidth,
        loading && styles.disabled,
        pressed && !loading && styles.pressed,
        style,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.background : colors.accent}
          size="small"
        />
      ) : (
        <>
          {leadingGlyph ? (
            <AppText
              accessible={false}
              allowFontScaling={false}
              style={[styles.buttonGlyph, textStyle, glyphTone ? {color: glyphTone} : null]}>
              {leadingGlyph}
            </AppText>
          ) : null}
          {iconOnly ? null : (
            <AppText style={textStyle} weight="semibold">
              {label}
            </AppText>
          )}
        </>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Text field (web-parity of the shared <Input>). The read-only URL field maps
// onto editable={false}.
// ---------------------------------------------------------------------------

interface TextFieldProps {
  value: string;
  onChangeText?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}

function TextField({
  value,
  onChangeText,
  placeholder,
  readOnly = false,
  accessibilityLabel,
  testID,
}: TextFieldProps) {
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel ?? placeholder}
      editable={!readOnly}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      selectTextOnFocus={readOnly}
      style={[styles.input, readOnly && styles.inputReadOnly]}
      testID={testID}
      value={value}
    />
  );
}

// ---------------------------------------------------------------------------
// Expiry select (web-parity of the shared <Select>). A Pressable trigger showing
// the current label opens a transparent Modal popover listing the options.
// ---------------------------------------------------------------------------

interface ExpirySelectProps {
  label: string;
  value: string;
  options: ExpiryOption[];
  onValueChange: (value: string) => void;
}

function ExpirySelect({label, value, options, onValueChange}: ExpirySelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  const selectedLabel = selected?.label ?? value;

  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
      <Pressable
        accessibilityLabel={`${label}: ${selectedLabel}`}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}
        testID="share-expiry-select">
        <AppText style={styles.selectValue}>{selectedLabel}</AppText>
        <AppText accessible={false} allowFontScaling={false} style={styles.selectCaret}>
          {'\u25BE'}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable
          accessibilityLabel={label}
          onPress={() => setOpen(false)}
          style={styles.popoverBackdrop}>
          <View style={styles.popoverCard}>
            {options.map(option => {
              const isSelected = option.value === value;
              return (
                <Pressable
                  accessibilityLabel={option.label}
                  accessibilityRole="button"
                  accessibilityState={{selected: isSelected}}
                  key={option.value}
                  onPress={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  style={({pressed}) => [
                    styles.popoverOption,
                    isSelected && styles.popoverOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <AppText
                    style={isSelected ? styles.popoverOptionSelectedText : undefined}
                    weight={isSelected ? 'semibold' : 'regular'}>
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

interface ShareDriveDialogProps {
  driveId: string;
  open: boolean;
  onClose: () => void;
}

export function ShareDriveDialog({driveId, open, onClose}: ShareDriveDialogProps) {
  const t = useNativeTranslationFallback();
  const createShare = useCreateShareLink(driveId);
  const {data: existingShares, isLoading: sharesLoading} = useShareLinks(driveId);
  const revokeShare = useRevokeShareLink(driveId);

  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [includeSpeed, setIncludeSpeed] = useState(true);
  const [includeTelemetry, setIncludeTelemetry] = useState(false);
  const [expiryDays, setExpiryDays] = useState('30');
  const [title, setTitle] = useState('');

  const handleCreate = async () => {
    const result = await createShare.mutateAsync({
      title: title || undefined,
      include_speed: includeSpeed,
      include_telemetry: includeTelemetry,
      expires_in_days: Number(expiryDays) || undefined,
    });
    setShareUrl(buildShareUrl(result.token));
  };

  const handleRevoke = async (token: string) => {
    await revokeShare.mutateAsync(token);
  };

  const handleClose = () => {
    setShareUrl(null);
    setTitle('');
    onClose();
  };

  const shares = existingShares ?? [];

  const expiryOptions: ExpiryOption[] = [
    {value: '7', label: t('share.expiry7d', '7 days')},
    {value: '30', label: t('share.expiry30d', '30 days')},
    {value: '90', label: t('share.expiry90d', '90 days')},
    {value: '0', label: t('share.expiryNever', 'Never')},
  ];

  const dialogTitle = t('share.title', 'Share Drive');

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={open}>
      <View
        accessibilityLabel={dialogTitle}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={handleClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="share-drive-dialog">
          <View style={styles.header}>
            <AppText style={styles.title} variant="title" weight="bold">
              {dialogTitle}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={handleClose}
              style={({pressed}) => [styles.closeButton, pressed && styles.pressed]}
              testID="share-drive-close">
              <AppText accessible={false} allowFontScaling={false} style={styles.closeGlyph}>
                {CLOSE_GLYPH}
              </AppText>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body} style={styles.scroll}>
            {/* Create new share */}
            {!shareUrl ? (
              <View style={styles.section}>
                <AppText style={styles.description} tone="secondary">
                  {t(
                    'share.description',
                    'Generate a public link to share this drive report. Anyone with the link can view the map, stats, and charts — no login required.',
                  )}
                </AppText>

                <TextField
                  onChangeText={setTitle}
                  placeholder={t(
                    'share.titlePlaceholder',
                    'Optional title (e.g., "SF to LA Road Trip")',
                  )}
                  testID="share-title-input"
                  value={title}
                />

                <Toggle
                  checked={includeSpeed}
                  label={t('share.includeSpeed', 'Include speed data')}
                  onChange={setIncludeSpeed}
                />
                <Toggle
                  checked={includeTelemetry}
                  label={t(
                    'share.includeTelemetry',
                    'Include detailed telemetry (battery, power)',
                  )}
                  onChange={setIncludeTelemetry}
                />

                <ExpirySelect
                  label={t('share.expiry', 'Link expires after')}
                  onValueChange={setExpiryDays}
                  options={expiryOptions}
                  value={expiryDays}
                />

                <DialogButton
                  fullWidth
                  label={t('share.generate', 'Generate Link')}
                  leadingGlyph={LINK_GLYPH}
                  loading={createShare.isPending}
                  onPress={handleCreate}
                  testID="share-generate"
                  variant="primary"
                />
              </View>
            ) : (
              /* Share URL result */
              <View style={styles.resultSection}>
                <AppText style={styles.createdText}>
                  {t('share.created', 'Share link created!')}
                </AppText>
                <TextField
                  accessibilityLabel={dialogTitle}
                  readOnly
                  testID="share-url-input"
                  value={shareUrl}
                />
                <View style={styles.resultRow}>
                  <CopyControl
                    label={t('share.copy', 'Copy Link')}
                    style={styles.fullWidth}
                    testID="share-copy"
                    text={shareUrl}
                    variant="primary"
                  />
                  <DialogButton
                    accessibilityLabel={EXTERNAL_GLYPH}
                    iconOnly
                    label={EXTERNAL_GLYPH}
                    leadingGlyph={EXTERNAL_GLYPH}
                    onPress={() => {
                      void Linking.openURL(shareUrl).catch(() => undefined);
                    }}
                    testID="share-open-external"
                    variant="outline"
                  />
                </View>
                <DialogButton
                  fullWidth
                  label={t('share.createAnother', 'Create another link')}
                  onPress={() => setShareUrl(null)}
                  testID="share-create-another"
                  variant="ghost"
                />
              </View>
            )}

            {/* Existing shares */}
            {shares.length > 0 && (
              <View style={styles.existingSection}>
                <AppText style={styles.existingHeading} variant="caption" weight="semibold">
                  {t('share.existing', 'Active Share Links')}
                </AppText>
                {shares.map(share => {
                  const isExpired = share.expires_at
                    ? new Date(share.expires_at) < new Date()
                    : false;
                  const expiryText = isExpired
                    ? t('share.expired', 'Expired')
                    : share.expires_at
                      ? t('share.expiresOn', 'Expires {{date}}', {
                          date: formatDate(share.expires_at),
                        })
                      : t('share.noExpiry', 'No expiry');
                  return (
                    <GlassPanel key={share.id} style={styles.shareRow}>
                      <View style={styles.shareInfo}>
                        <AppText numberOfLines={1} style={styles.shareTitle}>
                          {share.title ?? t('share.untitled', 'Untitled share')}
                        </AppText>
                        <View style={styles.shareMeta}>
                          <View style={styles.shareMetaItem}>
                            <AppText
                              accessible={false}
                              allowFontScaling={false}
                              style={styles.shareMetaGlyph}>
                              {EYE_GLYPH}
                            </AppText>
                            <AppText style={styles.shareMetaText} variant="caption">
                              {`${share.views} ${t('share.views', 'views')}`}
                            </AppText>
                          </View>
                          <AppText style={styles.shareMetaText} variant="caption">
                            {expiryText}
                          </AppText>
                        </View>
                      </View>
                      <View style={styles.shareActions}>
                        <CopyControl
                          accessibilityLabel={t('share.copyLink', 'Copy link')}
                          iconOnly
                          label={t('share.copyLink', 'Copy link')}
                          testID={`share-copy-${share.id}`}
                          text={buildShareUrl(share.token)}
                          variant="ghost"
                        />
                        <DialogButton
                          accessibilityLabel={t('share.revoke', 'Revoke')}
                          glyphTone={RED_400}
                          iconOnly
                          label={t('share.revoke', 'Revoke')}
                          leadingGlyph={REVOKE_GLYPH}
                          onPress={() => {
                            void handleRevoke(share.token);
                          }}
                          testID={`share-revoke-${share.id}`}
                          variant="ghost"
                        />
                      </View>
                    </GlassPanel>
                  );
                })}
              </View>
            )}

            {sharesLoading && (
              <View style={styles.spinnerRow}>
                <ActivityIndicator color={colors.accent} size="small" />
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

ShareDriveDialog.displayName = 'ShareDriveDialog';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  buttonGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  closeGlyph: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 20,
  },
  createdText: {
    color: GREEN_400,
    fontSize: 14,
    fontWeight: '500',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    margin: spacing.lg,
    maxHeight: '86%',
    maxWidth: 560,
    width: '92%',
    ...shadows.panel,
  },
  disabled: {
    opacity: 0.48,
  },
  existingHeading: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    color: colors.textSecondary,
    paddingTop: spacing.md,
  },
  existingSection: {
    gap: spacing.sm,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fullWidth: {
    flex: 1,
  },
  ghostButton: {
    backgroundColor: 'transparent',
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputReadOnly: {
    color: colors.textSecondary,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  popoverBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  popoverCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 360,
    overflow: 'hidden',
    width: '100%',
    ...shadows.panel,
  },
  popoverOption: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  popoverOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  popoverOptionSelectedText: {
    color: colors.accent,
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
  resultRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resultSection: {
    gap: spacing.md,
  },
  scroll: {
    flexGrow: 0,
  },
  section: {
    gap: spacing.md,
  },
  selectCaret: {
    color: colors.textMuted,
    fontSize: 14,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  shareActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  shareInfo: {
    flex: 1,
    minWidth: 0,
  },
  shareMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  shareMetaGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    marginRight: spacing.xs,
  },
  shareMetaItem: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  shareMetaText: {
    color: colors.textMuted,
  },
  shareRow: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  shareTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  spinnerRow: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
  },
});

export default ShareDriveDialog;
