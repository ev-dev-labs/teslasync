/**
 * AlertMessageEditor — React Native parity port of
 * web/src/features/notifications/components/AlertMessageEditor.tsx.
 *
 * State-of-the-art editor for per-rule notification message templates.
 * Composes:
 *
 *  - `include_title` checkbox — when unchecked, transports that render
 *    a separate title (Discord/Slack/Telegram/ntfy/webhook) deliver
 *    body-only notifications. WebPush, email Subject, and Pushover
 *    always send a title regardless.
 *  - Multi-line body template field, with `{{`-trigger autocomplete
 *    suggestions sourced from the backend's
 *    `/alerts/message-placeholders` endpoint.
 *  - "Pick a preset" button → preset gallery with filter chips and
 *    curated templates from `/alerts/message-presets`.
 *  - Live preview pane that calls `/alerts/message-preview` with a
 *    150 ms debounce so the user sees the rendered title + body as
 *    they type.
 *
 * Parent owns the editor state and threads change events back via
 * `onTemplateChange` / `onIncludeTitleChange`. The component itself owns
 * only ephemeral UI state (popover open/closed, autocomplete cursor,
 * preview cache).
 *
 * Browser-only dependencies are reduced explicitly and documented in the
 * `.parity.json` sidecar:
 *   - react-i18next `useTranslation`: replaced by a native-safe
 *     `t(key, fallback?, params?)` that interpolates i18next-style
 *     `{{name}}` placeholders, preserving every translation key + intent.
 *   - `@/components/ui` `Button` / `Checkbox` / `GlassPanel` / `HelpIcon`
 *     / `Modal` / `Popover` / `Textarea`: no native parity port exists
 *     yet, so minimal native-safe equivalents are reproduced locally
 *     (the ActionBuilder / VehicleMultiSelect "reproduce the dependency
 *     locally" precedent). GlassPanel uses the existing native primitive.
 *     The web floating `Popover` autocomplete becomes an inline dropdown
 *     rendered directly below the field (a native soft-keyboard-friendly
 *     analog of the anchored popover); the preset gallery `Modal` becomes
 *     a React Native `<Modal>`; `Checkbox` / `HelpIcon` become a Pressable
 *     check row + a tap-to-reveal "?" hint.
 *   - `@/lib/icons` `Icons.sparkles` / `Icons.show`: rendered as
 *     decorative `AppText` glyphs (✨ / 👁) the same way sibling ports do.
 *   - `@/lib/cn`: dropped — native styling uses `StyleSheet` + tokens.
 *   - DOM caret APIs (`HTMLTextAreaElement.selectionEnd`,
 *     `setSelectionRange`): the textarea becomes a `TextInput` whose caret
 *     is tracked via `onSelectionChange`; the splice + caret-restore is
 *     reproduced with a momentary controlled `selection` override. The
 *     web `onKeyDown` arrow/enter/tab/escape navigation has no on-screen
 *     keyboard analog, so the same switch is wired through `onKeyPress`
 *     for hardware keyboards (`preventDefault` is unavailable on native)
 *     while tapping a suggestion remains the primary selection path.
 *   - `requestAnimationFrame` / `setTimeout`: available globally in React
 *     Native, kept verbatim for caret/focus restore + preview debounce.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextInputSelectionChangeEventData,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {
  useAlertMessagePlaceholders,
  useAlertMessagePresets,
  useAlertMessagePreview,
} from '../../../api/hooks/useAlertMessageHelpers';
import type {
  AlertMessagePlaceholder,
  AlertMessagePreset,
  AlertMessagePreviewRequest,
  AlertMessagePreviewResponse,
  AlertRuleKind,
  AlertRuleOp,
  AlertRuleSeverity,
  ComputedMetricOp,
} from '../../../api/types';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{label}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

/* ── monospace font (web `font-mono`) + decorative glyphs ── */

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

const SPARKLES_GLYPH = '\u2728'; // ✨ (lucide Sparkles / Icons.sparkles)
const EYE_GLYPH = '\uD83D\uDC41'; // 👁 (lucide Eye / Icons.show)
const HELP_GLYPH = '?'; // HelpIcon affordance
const CHECK_GLYPH = '\u2713'; // ✓ (checkbox mark)

const PREVIEW_DEBOUNCE_MS = 150;

// Mirrors the backend substituteRe in internal/alertmsg/formatter.go.
// Used to extract referenced placeholder keys from a preset template
// so we can hide presets that depend on placeholders the current
// rule's op doesn't populate (e.g. {{Min}}/{{Max}} for a `<` rule).
const PLACEHOLDER_TOKEN_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;

function extractTemplateKeys(template: string): string[] {
  const out: string[] = [];
  PLACEHOLDER_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_TOKEN_RE.exec(template)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** Editor draft shape — mirrors the backend `/message-preview` body. */
export interface AlertMessageEditorDraft {
  name?: string;
  kind?: AlertRuleKind;
  signal_name?: string;
  op?: AlertRuleOp;
  severity?: AlertRuleSeverity;
  vehicle_name?: string;
  value_num?: number | null;
  value_text?: string | null;
  value_bool?: boolean | null;
  value_min?: number | null;
  value_max?: number | null;
  metric_id?: string | null;
  metric_window?: string | null;
  metric_op?: ComputedMetricOp | null;
  metric_threshold?: number | null;
}

export interface AlertMessageEditorProps {
  /** Current template body. `''` is treated as "use default". */
  msgTemplate: string;
  /** Current include_title toggle. */
  includeTitle: boolean;
  /** Rule draft used by the preview + placeholder endpoints. */
  draft: AlertMessageEditorDraft;
  /** Notifies parent when the user edits the template body. */
  onTemplateChange: (next: string) => void;
  /** Notifies parent when the user toggles include_title. */
  onIncludeTitleChange: (next: boolean) => void;
  /** Optional label override (defaults to i18n "Message Template"). */
  label?: string;
  /** Optional help text override. */
  helpContent?: string;
  /** Optional id for the field (used as the native testID base). */
  id?: string;
  /** Disable all controls (e.g. while a save mutation is in flight). */
  disabled?: boolean;
  /** Retained for source compatibility with the web Tailwind API; ignored on native. */
  className?: string;
}

export interface AlertMessageEditorHandle {
  /** Focus the field. Used by the parent to flag validation errors. */
  focus: () => void;
}

/* ── native Checkbox stand-in (`@/components/ui` Checkbox) ── */

interface CheckboxProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  testID?: string;
}

function Checkbox({checked, disabled, onChange, label, testID}: CheckboxProps) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked, disabled: Boolean(disabled)}}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={styles.checkboxRow}
      testID={testID}>
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked ? (
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.checkboxMark}>
            {CHECK_GLYPH}
          </AppText>
        ) : null}
      </View>
      {typeof label === 'string' ? (
        <AppText style={styles.checkboxLabel}>{label}</AppText>
      ) : (
        label
      )}
    </Pressable>
  );
}

/* ── native HelpIcon stand-in (`@/components/ui` HelpIcon) ── */

interface HelpHintProps {
  content: string;
  testID?: string;
}

/**
 * The web HelpIcon shows a "?" affordance that reveals its content in a
 * hover tooltip. React Native has no hover, so the content becomes a
 * tap-to-reveal inline hint (and is exposed as the accessibility hint).
 */
function HelpHint({content, testID}: HelpHintProps) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.helpWrap}>
      <Pressable
        accessibilityHint={content}
        accessibilityLabel={content}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => setOpen((prev) => !prev)}
        style={({pressed}) => [
          styles.helpButton,
          pressed && styles.helpButtonPressed,
        ]}
        testID={testID}>
        <AppText style={styles.helpGlyph}>{HELP_GLYPH}</AppText>
      </Pressable>
      {open ? (
        <View style={styles.helpBubble} testID={testID ? `${testID}-bubble` : undefined}>
          <AppText style={styles.helpBubbleText}>{content}</AppText>
        </View>
      ) : null}
    </View>
  );
}

export const AlertMessageEditor = forwardRef<
  AlertMessageEditorHandle,
  AlertMessageEditorProps
>(function AlertMessageEditor(
  {
    msgTemplate,
    includeTitle,
    draft,
    onTemplateChange,
    onIncludeTitleChange,
    label,
    helpContent,
    id,
    disabled,
    className: _className,
  },
  ref,
) {
  const t = useNativeTranslationFallback();
  const textInputRef = useRef<TextInput | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textInputRef.current?.focus(),
  }));

  const textareaId = id ?? 'alert-message-template';

  // Always-current mirror of the template + caret so the autocomplete
  // detection can read them synchronously across change/selection events
  // without stale closures (the native analog of reading the DOM textarea
  // value + selectionEnd at event time).
  const templateRef = useRef(msgTemplate);
  useEffect(() => {
    templateRef.current = msgTemplate;
  }, [msgTemplate]);
  const caretRef = useRef(msgTemplate.length);
  // Momentary controlled-selection override used to restore the caret after
  // a placeholder splice; released on the next selection-change event.
  const [selectionOverride, setSelectionOverride] = useState<
    {start: number; end: number} | null
  >(null);

  // ──────────────── Autocomplete state ────────────────
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  // The character index in the field where the `{{` trigger started — we
  // use it to compute the substring to filter against and to know where to
  // splice the chosen placeholder back in.
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null);
  const [autocompleteFilter, setAutocompleteFilter] = useState('');
  const [autocompleteCursor, setAutocompleteCursor] = useState(0);

  const placeholdersQuery = useAlertMessagePlaceholders({
    kind: draft.kind,
    signal_name: draft.signal_name,
    op: draft.op,
    metric_id: draft.metric_id ?? null,
    enabled: !disabled,
  });

  const filteredPlaceholders = useMemo<AlertMessagePlaceholder[]>(() => {
    const all = placeholdersQuery.data ?? [];
    const needle = autocompleteFilter.trim().toLowerCase();
    if (!needle) {
      return all;
    }
    return all.filter(
      (p) =>
        p.key.toLowerCase().includes(needle) ||
        p.label.toLowerCase().includes(needle),
    );
  }, [autocompleteFilter, placeholdersQuery.data]);

  // Re-clamp the cursor whenever the filter changes (the previously
  // highlighted index may now point past the end of the new list).
  useEffect(() => {
    setAutocompleteCursor((c) =>
      filteredPlaceholders.length === 0
        ? 0
        : Math.min(c, filteredPlaceholders.length - 1),
    );
  }, [filteredPlaceholders.length]);

  const closeAutocomplete = useCallback(() => {
    setAutocompleteOpen(false);
    setTriggerIndex(null);
    setAutocompleteFilter('');
    setAutocompleteCursor(0);
  }, []);

  // Walk back from the caret looking for `{{` — only open the autocomplete
  // when the user is actively typing inside an un-closed brace expression.
  // Mirrors the web handleTextareaChange detection 1:1.
  const syncAutocomplete = useCallback(
    (text: string, caret: number) => {
      const upToCaret = text.slice(0, caret);
      const openIdx = upToCaret.lastIndexOf('{{');
      const closeIdx = upToCaret.lastIndexOf('}}');
      if (openIdx !== -1 && openIdx > closeIdx) {
        const partial = upToCaret.slice(openIdx + 2);
        // Bail out if the partial contains whitespace/newline — that means
        // the user is typing something other than a key.
        if (/[\s\n\r]/.test(partial)) {
          closeAutocomplete();
          return;
        }
        setAutocompleteOpen(true);
        setTriggerIndex(openIdx);
        setAutocompleteFilter(partial);
        setAutocompleteCursor(0);
      } else {
        closeAutocomplete();
      }
    },
    [closeAutocomplete],
  );

  const insertPlaceholder = useCallback(
    (placeholder: AlertMessagePlaceholder) => {
      if (triggerIndex == null) {
        return;
      }
      // Replace the trigger window (`{{` + any partial text) with the
      // canonical `{{key}}` form. The closing braces are always injected —
      // saves the user a keystroke.
      const cursor = Math.min(caretRef.current, msgTemplate.length);
      const before = msgTemplate.slice(0, triggerIndex);
      const after = msgTemplate.slice(cursor);
      const insertion = `{{${placeholder.key}}}`;
      const next = before + insertion + after;
      templateRef.current = next;
      onTemplateChange(next);
      closeAutocomplete();
      // Restore caret position after React re-renders.
      const caret = before.length + insertion.length;
      caretRef.current = caret;
      setSelectionOverride({start: caret, end: caret});
      requestAnimationFrame(() => {
        textInputRef.current?.focus();
      });
    },
    [closeAutocomplete, msgTemplate, onTemplateChange, triggerIndex],
  );

  const handleTextChange = useCallback(
    (next: string) => {
      templateRef.current = next;
      onTemplateChange(next);
      // Best-effort detection at the change site (caret assumed at the new
      // end for the common append case); the authoritative caret arrives via
      // onSelectionChange and re-runs detection.
      const caret = Math.min(
        caretRef.current > next.length ? next.length : Math.max(caretRef.current, 0),
        next.length,
      );
      syncAutocomplete(next, caret === 0 ? next.length : caret);
    },
    [onTemplateChange, syncAutocomplete],
  );

  const handleSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const {selection} = e.nativeEvent;
      caretRef.current = selection.end;
      if (selectionOverride != null) {
        setSelectionOverride(null);
      }
      syncAutocomplete(templateRef.current, selection.end);
    },
    [selectionOverride, syncAutocomplete],
  );

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (!autocompleteOpen || filteredPlaceholders.length === 0) {
        return;
      }
      // preventDefault is unavailable on native onKeyPress; tapping a
      // suggestion is the primary selection path on touch devices, this
      // switch serves hardware keyboards (desktop targets).
      const key = e.nativeEvent.key;
      if (key === 'ArrowDown') {
        setAutocompleteCursor((c) => (c + 1) % filteredPlaceholders.length);
      } else if (key === 'ArrowUp') {
        setAutocompleteCursor(
          (c) =>
            (c - 1 + filteredPlaceholders.length) % filteredPlaceholders.length,
        );
      } else if (key === 'Enter' || key === 'Tab') {
        insertPlaceholder(filteredPlaceholders[autocompleteCursor]);
      } else if (key === 'Escape') {
        closeAutocomplete();
      }
    },
    [
      autocompleteCursor,
      autocompleteOpen,
      closeAutocomplete,
      filteredPlaceholders,
      insertPlaceholder,
    ],
  );

  // ──────────────── Preset gallery ────────────────
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const presetsQuery = useAlertMessagePresets(draft.kind);
  const [presetFilter, setPresetFilter] = useState<string | null>(null);

  // Set of placeholder keys that are valid for the current rule's op.
  // Sourced from the same `/message-placeholders` endpoint that drives the
  // autocomplete picker, so the preset gallery and autocomplete stay in
  // lockstep about what's available.
  const availableKeys = useMemo<Set<string>>(() => {
    const keys = new Set<string>();
    for (const p of placeholdersQuery.data ?? []) {
      keys.add(p.key);
    }
    return keys;
  }, [placeholdersQuery.data]);

  // Op-validity filter: hide presets whose template references any
  // placeholder the current op doesn't populate. While the placeholders
  // query is loading, the catalog is empty for any reason, OR the rule
  // doesn't have an op yet (skeleton "New Rule" state), we degrade
  // gracefully by showing all presets — better to over-show for one frame
  // than flash an empty gallery, and we can't filter responsibly without
  // knowing the op.
  const opValidPresets = useMemo<AlertMessagePreset[]>(() => {
    const all = presetsQuery.data ?? [];
    if (placeholdersQuery.isLoading || availableKeys.size === 0 || !draft.op) {
      return all;
    }
    return all.filter((preset) => {
      const keys = extractTemplateKeys(preset.template);
      return keys.every((k) => availableKeys.has(k));
    });
  }, [availableKeys, draft.op, placeholdersQuery.isLoading, presetsQuery.data]);

  const presetTags = useMemo<string[]>(() => {
    const tags = new Set<string>();
    for (const preset of opValidPresets) {
      for (const tag of preset.tags ?? []) {
        tags.add(tag);
      }
    }
    return Array.from(tags).sort();
  }, [opValidPresets]);

  // If the user had a tag chip selected and changing the rule op narrowed
  // the gallery so that tag no longer has any matches, drop the filter back
  // to "All" — otherwise the modal would render an empty state with no
  // obvious way out.
  useEffect(() => {
    if (presetFilter && !presetTags.includes(presetFilter)) {
      setPresetFilter(null);
    }
  }, [presetFilter, presetTags]);

  const filteredPresets = useMemo<AlertMessagePreset[]>(() => {
    if (!presetFilter) {
      return opValidPresets;
    }
    return opValidPresets.filter((p) => (p.tags ?? []).includes(presetFilter));
  }, [opValidPresets, presetFilter]);

  const applyPreset = useCallback(
    (preset: AlertMessagePreset) => {
      onTemplateChange(preset.template);
      setPresetModalOpen(false);
      // Return focus to the field so the user can keep editing.
      requestAnimationFrame(() => textInputRef.current?.focus());
    },
    [onTemplateChange],
  );

  // ──────────────── Live preview ────────────────
  const previewMut = useAlertMessagePreview();
  const [preview, setPreview] = useState<AlertMessagePreviewResponse | null>(
    null,
  );
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Debounced preview refresh — driven by msgTemplate + include_title + any
  // field of the draft that affects rendering. We deliberately serialise the
  // draft to a stable string so the effect doesn't re-run on object-identity
  // churn.
  const previewKey = useMemo(
    () =>
      JSON.stringify({
        msgTemplate,
        includeTitle,
        name: draft.name,
        kind: draft.kind,
        signal_name: draft.signal_name,
        op: draft.op,
        severity: draft.severity,
        vehicle_name: draft.vehicle_name,
        value_num: draft.value_num,
        value_text: draft.value_text,
        value_bool: draft.value_bool,
        value_min: draft.value_min,
        value_max: draft.value_max,
        metric_id: draft.metric_id,
        metric_window: draft.metric_window,
        metric_op: draft.metric_op,
        metric_threshold: draft.metric_threshold,
      }),
    [draft, includeTitle, msgTemplate],
  );

  const previewMutate = previewMut.mutate;
  useEffect(() => {
    const handle = setTimeout(() => {
      const body: AlertMessagePreviewRequest = {
        name: draft.name,
        kind: draft.kind,
        signal_name: draft.signal_name,
        op: draft.op,
        severity: draft.severity,
        vehicle_name: draft.vehicle_name,
        value_num: draft.value_num,
        value_text: draft.value_text,
        value_bool: draft.value_bool,
        value_min: draft.value_min,
        value_max: draft.value_max,
        metric_id: draft.metric_id,
        metric_window: draft.metric_window,
        metric_op: draft.metric_op,
        metric_threshold: draft.metric_threshold,
        msg_template: msgTemplate.trim() === '' ? null : msgTemplate,
        include_title: includeTitle,
      };
      previewMutate(body, {
        onSuccess: (data) => {
          setPreview(data);
          setPreviewError(null);
        },
        onError: (err) => {
          setPreviewError(
            err instanceof Error ? err.message : 'Preview failed',
          );
        },
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // ──────────────── Render ────────────────
  return (
    <View style={styles.root} testID="alert-message-editor">
      <View style={styles.titleRow}>
        <Checkbox
          checked={includeTitle}
          disabled={disabled}
          onChange={onIncludeTitleChange}
          label={
            <AppText style={styles.includeTitleLabel}>
              {t(
                'notifications.alertStudio.editor.includeTitleLabel',
                'Include title in notifications',
              )}
            </AppText>
          }
          testID={`${textareaId}-include-title`}
        />
        <HelpHint
          content={t(
            'notifications.alertStudio.editor.includeTitleHelp',
            'When unchecked, Discord/Slack/Telegram/ntfy/webhook deliver only the body. WebPush, email, and Pushover always include a title.',
          )}
          testID={`${textareaId}-include-title-help`}
        />
      </View>

      <View style={styles.labelRow}>
        <View style={styles.labelGroup}>
          <AppText style={styles.fieldLabel}>
            {label ??
              t(
                'notifications.alertStudio.editor.messageTemplateLabel',
                'Message Template',
              )}
          </AppText>
          <AppText style={styles.fieldHint}>
            {t(
              'notifications.alertStudio.editor.messageTemplateHint',
              'Type {{ to insert a placeholder',
            )}
          </AppText>
          <HelpHint
            content={
              helpContent ??
              t(
                'notifications.alertStudio.editor.messageTemplateHelp',
                'Per-rule body template. Reference live signals with double-brace placeholders like {{BatteryLevel}}. Leave blank to use the op-aware default body.',
              )
            }
            testID={`${textareaId}-help`}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{disabled: Boolean(disabled)}}
          disabled={disabled}
          onPress={() => setPresetModalOpen(true)}
          style={({pressed}) => [
            styles.presetButton,
            disabled && styles.presetButtonDisabled,
            pressed && !disabled && styles.presetButtonPressed,
          ]}
          testID="alert-message-preset-button">
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.presetButtonGlyph}>
            {SPARKLES_GLYPH}
          </AppText>
          <AppText style={styles.presetButtonLabel}>
            {t('notifications.alertStudio.editor.presetButton', 'Pick a preset')}
          </AppText>
        </Pressable>
      </View>

      <TextInput
        ref={textInputRef}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        maxLength={1024}
        multiline
        numberOfLines={3}
        onChangeText={handleTextChange}
        onKeyPress={handleKeyPress}
        onSelectionChange={handleSelectionChange}
        placeholder={t(
          'notifications.alertStudio.editor.messageTemplatePlaceholder',
          'Battery at {{BatteryLevel}}% — leave blank for the smart default',
        )}
        placeholderTextColor={colors.textMuted}
        selection={selectionOverride ?? undefined}
        style={[styles.textarea, disabled && styles.textareaDisabled]}
        testID={textareaId}
        textAlignVertical="top"
        value={msgTemplate}
      />

      <PlaceholderAutocomplete
        open={autocompleteOpen}
        items={filteredPlaceholders}
        cursor={autocompleteCursor}
        onSelect={insertPlaceholder}
        loading={placeholdersQuery.isLoading}
      />

      <PreviewPanel
        preview={preview}
        error={previewError}
        loading={previewMut.isPending && preview == null}
        includeTitle={includeTitle}
      />

      <PresetGalleryModal
        open={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        presets={filteredPresets}
        tags={presetTags}
        activeTag={presetFilter}
        onTagChange={setPresetFilter}
        onApply={applyPreset}
        loading={presetsQuery.isLoading}
      />
    </View>
  );
});

// ────────────────────────────────────────────────────────────────────
// Internal subcomponents
// ────────────────────────────────────────────────────────────────────

interface PlaceholderAutocompleteProps {
  open: boolean;
  items: AlertMessagePlaceholder[];
  cursor: number;
  loading: boolean;
  onSelect: (item: AlertMessagePlaceholder) => void;
}

function PlaceholderAutocomplete({
  open,
  items,
  cursor,
  loading,
  onSelect,
}: PlaceholderAutocompleteProps) {
  const t = useNativeTranslationFallback();

  // Group entries by their `group` field so the catalog reads cleanly.
  // Keeping the cursor index in the flattened sequence keeps keyboard
  // navigation predictable across groups.
  const grouped = useMemo(() => {
    const out = new Map<
      string,
      {item: AlertMessagePlaceholder; index: number}[]
    >();
    items.forEach((item, index) => {
      const list = out.get(item.group) ?? [];
      list.push({item, index});
      out.set(item.group, list);
    });
    return Array.from(out.entries());
  }, [items]);

  if (!open) {
    return null;
  }

  return (
    <View
      accessibilityLabel={t(
        'notifications.alertStudio.editor.autocompleteLabel',
        'Placeholder suggestions',
      )}
      style={styles.autocomplete}
      testID="alert-message-autocomplete">
      {loading ? (
        <AppText style={styles.autocompleteMuted}>
          {t('common.loading', 'Loading…')}
        </AppText>
      ) : items.length === 0 ? (
        <AppText style={styles.autocompleteMuted}>
          {t(
            'notifications.alertStudio.editor.autocompleteEmpty',
            'No matching placeholders',
          )}
        </AppText>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          style={styles.autocompleteScroll}>
          {grouped.map(([groupName, entries]) => (
            <View key={groupName} style={styles.autocompleteGroup}>
              <AppText style={styles.autocompleteGroupLabel}>
                {groupName}
              </AppText>
              {entries.map(({item, index}) => (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  onPress={() => onSelect(item)}
                  style={({pressed}) => [
                    styles.autocompleteItem,
                    index === cursor && styles.autocompleteItemActive,
                    pressed && styles.autocompleteItemPressed,
                  ]}
                  testID={`alert-message-autocomplete-option-${item.key}`}>
                  <AppText style={styles.autocompleteCode}>
                    {`{{${item.key}}}`}
                  </AppText>
                  <AppText
                    numberOfLines={1}
                    style={styles.autocompleteItemLabel}>
                    {item.label}
                  </AppText>
                </Pressable>
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface PreviewPanelProps {
  preview: AlertMessagePreviewResponse | null;
  error: string | null;
  loading: boolean;
  includeTitle: boolean;
}

function PreviewPanel({preview, error, loading, includeTitle}: PreviewPanelProps) {
  const t = useNativeTranslationFallback();
  return (
    <GlassPanel style={styles.preview} testID="alert-message-preview">
      <View style={styles.previewHeader}>
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={styles.previewHeaderGlyph}>
          {EYE_GLYPH}
        </AppText>
        <AppText style={styles.previewHeaderLabel}>
          {t('notifications.alertStudio.editor.previewLabel', 'Preview')}
        </AppText>
      </View>
      {error ? (
        <AppText style={styles.previewError} testID="alert-message-preview-error">
          {error}
        </AppText>
      ) : loading ? (
        <AppText style={styles.previewMuted}>
          {t('common.loading', 'Loading…')}
        </AppText>
      ) : preview == null ? (
        <AppText style={styles.previewMuted}>
          {t(
            'notifications.alertStudio.editor.previewEmpty',
            'Start typing to see a preview',
          )}
        </AppText>
      ) : (
        <View style={styles.previewBodyWrap}>
          {includeTitle && preview.title ? (
            <AppText style={styles.previewTitle} testID="alert-message-preview-title">
              {preview.title}
            </AppText>
          ) : null}
          {preview.body ? (
            <AppText style={styles.previewBody} testID="alert-message-preview-body">
              {preview.body}
            </AppText>
          ) : (
            <AppText style={styles.previewEmptyBody}>
              {t(
                'notifications.alertStudio.editor.previewEmptyBody',
                '(no body — title carries the alert)',
              )}
            </AppText>
          )}
        </View>
      )}
    </GlassPanel>
  );
}

interface PresetGalleryModalProps {
  open: boolean;
  presets: AlertMessagePreset[];
  tags: string[];
  activeTag: string | null;
  loading: boolean;
  onTagChange: (tag: string | null) => void;
  onApply: (preset: AlertMessagePreset) => void;
  onClose: () => void;
}

function PresetGalleryModal({
  open,
  presets,
  tags,
  activeTag,
  loading,
  onTagChange,
  onApply,
  onClose,
}: PresetGalleryModalProps) {
  const t = useNativeTranslationFallback();
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <Pressable
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onPress={onClose}
        style={styles.backdrop}
        testID="alert-message-preset-backdrop"
      />
      <View style={styles.modalCenter} pointerEvents="box-none">
        <View
          accessibilityViewIsModal
          style={styles.modalCard}
          testID="alert-message-preset-modal">
          <View style={styles.modalHeader}>
            <AppText style={styles.modalTitle} weight="semibold">
              {t(
                'notifications.alertStudio.editor.presetModalTitle',
                'Message Presets',
              )}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({pressed}) => [
                styles.modalClose,
                pressed && styles.modalClosePressed,
              ]}
              testID="alert-message-preset-close">
              <AppText style={styles.modalCloseGlyph}>{'\u2715'}</AppText>
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={styles.modalScroll}>
            <AppText style={styles.modalIntro}>
              {t(
                'notifications.alertStudio.editor.presetModalIntro',
                'Curated templates for common alert shapes. Tap one to apply it; you can edit it afterwards.',
              )}
            </AppText>
            {tags.length > 0 ? (
              <View style={styles.tagRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{selected: activeTag == null}}
                  onPress={() => onTagChange(null)}
                  style={[
                    styles.tagChip,
                    activeTag == null
                      ? styles.tagChipActive
                      : styles.tagChipInactive,
                  ]}
                  testID="alert-message-tag-all">
                  <AppText
                    style={[
                      styles.tagChipText,
                      activeTag == null && styles.tagChipTextActive,
                    ]}>
                    {t(
                      'notifications.alertStudio.editor.presetAllTag',
                      'All',
                    )}
                  </AppText>
                </Pressable>
                {tags.map((tag) => {
                  const isActive = activeTag === tag;
                  return (
                    <Pressable
                      key={tag}
                      accessibilityRole="button"
                      accessibilityState={{selected: isActive}}
                      onPress={() => onTagChange(tag)}
                      style={[
                        styles.tagChip,
                        isActive ? styles.tagChipActive : styles.tagChipInactive,
                      ]}
                      testID={`alert-message-tag-${tag}`}>
                      <AppText
                        style={[
                          styles.tagChipText,
                          isActive && styles.tagChipTextActive,
                        ]}>
                        {tag}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {loading ? (
              <AppText
                style={styles.modalCenterMuted}
                testID="alert-message-preset-loading">
                {t('common.loading', 'Loading…')}
              </AppText>
            ) : presets.length === 0 ? (
              <AppText
                style={styles.modalCenterMuted}
                testID="alert-message-preset-empty">
                {t(
                  'notifications.alertStudio.editor.presetEmpty',
                  'No presets match this filter',
                )}
              </AppText>
            ) : (
              <View style={styles.presetGrid}>
                {presets.map((preset) => (
                  <Pressable
                    key={preset.id}
                    accessibilityRole="button"
                    onPress={() => onApply(preset)}
                    style={({pressed}) => [
                      styles.presetCard,
                      pressed && styles.presetCardPressed,
                    ]}
                    testID={`alert-message-preset-${preset.id}`}>
                    <AppText style={styles.presetName} weight="semibold">
                      {preset.name}
                    </AppText>
                    {preset.description ? (
                      <AppText style={styles.presetDescription}>
                        {preset.description}
                      </AppText>
                    ) : null}
                    <AppText
                      numberOfLines={1}
                      style={styles.presetTemplate}>
                      {preset.template}
                    </AppText>
                    {preset.tags && preset.tags.length > 0 ? (
                      <View style={styles.presetTagRow}>
                        {preset.tags.map((tag) => (
                          <View key={tag} style={styles.presetTagPill}>
                            <AppText style={styles.presetTagPillText}>
                              {tag}
                            </AppText>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  includeTitleLabel: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  labelGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fieldHint: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 11,
  },
  presetButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  presetButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  presetButtonDisabled: {
    opacity: 0.48,
  },
  presetButtonGlyph: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
  },
  presetButtonLabel: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  textarea: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.caption,
    minHeight: 78,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  textareaDisabled: {
    opacity: 0.6,
  },
  checkboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  checkboxBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxBoxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxMark: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 14,
  },
  checkboxLabel: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  helpWrap: {
    position: 'relative',
  },
  helpButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  helpButtonPressed: {
    borderColor: colors.borderAccent,
  },
  helpGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  helpBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.xs,
    maxWidth: 260,
    padding: spacing.sm,
    position: 'absolute',
    top: 18,
    zIndex: 20,
  },
  helpBubbleText: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
  },
  autocomplete: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    maxHeight: 248,
    padding: spacing.xs,
  },
  autocompleteScroll: {
    maxHeight: 232,
  },
  autocompleteMuted: {
    color: colors.textMuted,
    fontSize: typography.caption,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  autocompleteGroup: {
    marginBottom: spacing.xs,
  },
  autocompleteGroupLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    paddingBottom: 2,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    textTransform: 'uppercase',
  },
  autocompleteItem: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  autocompleteItemActive: {
    backgroundColor: colors.surfaceSelected,
  },
  autocompleteItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  autocompleteCode: {
    color: colors.accent,
    fontFamily: MONO_FONT,
    fontSize: typography.caption,
  },
  autocompleteItemLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: typography.caption,
  },
  preview: {
    borderRadius: 12,
    padding: spacing.sm,
  },
  previewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  previewHeaderGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  previewHeaderLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  previewError: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  previewMuted: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  previewBodyWrap: {
    gap: 2,
  },
  previewTitle: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  previewBody: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  previewEmptyBody: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontStyle: 'italic',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 4, 10, 0.72)',
  },
  modalCenter: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '86%',
    maxWidth: 640,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  modalClose: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  modalClosePressed: {
    backgroundColor: colors.surfaceHover,
  },
  modalCloseGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 20,
  },
  modalScroll: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalIntro: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    marginBottom: spacing.md,
  },
  modalCenterMuted: {
    color: colors.textMuted,
    fontSize: typography.caption,
    paddingVertical: spacing.xl,
    textAlign: 'center',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  tagChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  tagChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  tagChipInactive: {
    borderColor: colors.border,
  },
  tagChipText: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tagChipTextActive: {
    color: colors.accent,
  },
  presetGrid: {
    gap: spacing.sm,
  },
  presetCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  presetCardPressed: {
    borderColor: colors.borderAccent,
  },
  presetName: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  presetDescription: {
    color: colors.textMuted,
    fontSize: 11,
  },
  presetTemplate: {
    backgroundColor: colors.surfaceHover,
    borderRadius: 6,
    color: colors.accent,
    fontFamily: MONO_FONT,
    fontSize: 11,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  presetTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  presetTagPill: {
    backgroundColor: colors.surfaceHover,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  presetTagPillText: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});

export default AlertMessageEditor;
