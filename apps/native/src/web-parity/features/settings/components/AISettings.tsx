// Native parity port of web/src/features/settings/components/AISettings.tsx.
//
// Settings UI for AI ("Helix"). This is the only surface in the app where AI is
// ever turned on. Per ADR-015 (the AI-Off Contract), preserved verbatim in
// intent from the web original (web L1-28 doc comment):
//   §I1 Default-off: a fresh install never auto-enables AI.
//   §I7 Per-feature opt-in: each feature toggle starts unchecked, and
//       re-enabling a previously archived selection requires explicit
//       confirmation (no silent restore).
//   §I9 Off-mode redaction: the API key is never echoed back when
//       ai_mode === 'off'; this component therefore never pre-populates the key
//       field unless mode is local/cloud and the server returned a value.
//
// Layout tree (web L19-27) is preserved 1:1, with the four child sections that
// the web file imports inlined as native-safe ports because the standalone
// native parity modules do not exist yet (the PrivacySection / TOTPEnrollmentSection
// "inline the unavailable dependency" precedent in this same directory):
//   AISettings (this file — mode picker, archive preview, save flow)
//     ├── AIProviderSection      provider/baseURL/model/key/cost (+ Azure flavor)
//     ├── AIFeatureToggleList    per-feature switches from the AI registry
//     ├── AIRestorePanel         "Restore previous selection?" CTA
//     └── AIUsageCard            live "usage today" card (/ai/usage/today)
//
// Every state name (mode/features/provider/restoreDismissed/aiSnapshot),
// API path (PUT /settings via useSaveAiSettings, /settings/ai/validate-config via
// useValidateAiProvider, /ai/usage/today via useAiUsageToday), the cost-cap
// micro-cents math, the i18n keys + English fallbacks, and the data-testid hooks
// are kept 1:1 with the web original.
//
// Web -> native dependency mapping (every web import documented here + sidecar):
//   - react useEffect/useMemo/useState/useCallback (web L30) -> + useRef for the
//     inlined FadeIn animation. No behavioural change.
//   - react-i18next useTranslation('settings') (web L31) -> inlined
//     useNativeTranslationFallback(): a (key, defaultOrOptions, options) => string
//     shim returning the English fallback verbatim with {{var}} interpolation
//     (covers validate.successPinned {{ip}}, successProbed {{model}}, and
//     costCap.amount {{spent}}/{{cap}}). Matches the PrivacySection parity shim.
//   - @/components/branding/HelixMark (web L32) -> inline 🧬 glyph in the header
//     IconBox (the PrivacySection inline-glyph precedent).
//   - @/components/ui GlassPanel (web L33-41) -> ported native GlassPanel; the
//     IconBox / Button / PanelTitle / Subhead / HelperText / Caption / Input /
//     Select / Toggle primitives are not ported to the native parity tree, so
//     native-safe equivalents are inlined below (the TOTPEnrollmentSection
//     inline-primitive precedent): Button -> Pressable (primary/ghost, disabled),
//     Input -> labelled TextInput (+ hint, secureTextEntry, numeric keyboard),
//     Select -> a labelled pressable option list (native has no <select> dropdown;
//     the chosen value is highlighted with a ✓), Toggle -> the RN Switch primitive,
//     the typography roles -> AppText wrappers.
//   - @/components/motion FadeIn (web L42) -> inline FadeIn: Animated.View opacity
//     0->1 + translateY 12->0 mount fade, honouring OS reduced-motion via
//     AccessibilityInfo (the Toast / PrivacySection analogue).
//   - @/components/layout Stack (web L43) -> RN View with flex gap.
//   - @/api/hooks/useSettings useSettings + AppSettings (web L44) -> ported native
//     web-parity useSettings (GET /settings) + AppSettings type.
//   - @/api/hooks/useAiSettings useSaveAiSettings (web L45) + useValidateAiProvider
//     (web AIProviderSection L20) -> ported native web-parity useAiSettings.
//   - @/ai/features AI_FEATURE_IDS/AI_FEATURES/isKnownAiFeature/AiFeatureId
//     (web L46 + child imports) -> ported native web-parity ai/features registry.
//   - ./AIProviderSection / ./AIFeatureToggleList / ./AIRestorePanel / ./AIUsageCard
//     (web L47-50) -> inlined native ports (see above).
//   - @/api/hooks/useAiUsage useAiUsageToday (web L51) -> ported native web-parity
//     useAiUsage.
//   - @/hooks/useFormatting useFormatting + @/lib/numberFormat fmtInt (web
//     AIUsageCard L25-26) -> inline native-safe Intl.NumberFormat helpers
//     (formatCurrency USD + fmtInt), wrapped in try/catch with manual fallbacks
//     so they are safe under both Hermes and the jest/node test runtime.
//
// No DOM-only modules, browser HTML elements, react-i18next, lucide-react,
// Recharts, Leaflet, framer-motion, or web UI components are imported — only
// react, react-native primitives, and ported native parity modules.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing, typography } from '../../../../theme/tokens';
import { useSettings, type AppSettings } from '../../../api/hooks/useSettings';
import { useSaveAiSettings, useValidateAiProvider } from '../../../api/hooks/useAiSettings';
import { useAiUsageToday } from '../../../api/hooks/useAiUsage';
import {
  AI_FEATURE_IDS,
  AI_FEATURES,
  isKnownAiFeature,
  type AiFeatureId,
} from '../../../ai/features';

// ── Inline glyphs (web HelixMark / lucide-react) ──
const HELIX_GLYPH = '\u{1F9EC}'; // 🧬 — web HelixMark (Helix header brand).
const SPARKLES_GLYPH = '\u2728'; // ✨ — web lucide-react Sparkles (restore panel).
const CHECK_GLYPH = '\u2713'; // ✓ — Select chosen-option tick.
const PLACEHOLDER = '\u2014'; // — long em-dash usage placeholder (web AIUsageCard L28).

// ---------------------------------------------------------------------------
// useNativeTranslationFallback — inlined react-i18next fallback. Returns the
// web English fallback verbatim with {{var}} interpolation, preserving every
// key + default. Supports the web call shapes used here:
//   t(key, 'Default string')
//   t(key, 'Default {{ip}}', { ip })
//   t(key, { defaultValue, ...interpolations })
// ---------------------------------------------------------------------------

type NativeTOptions = { defaultValue?: string } & Record<string, string | number | undefined>;
type NativeTFunction = (
  key: string,
  defaultOrOptions?: string | NativeTOptions,
  maybeOptions?: NativeTOptions,
) => string;

function interpolate(template: string, opts?: NativeTOptions): string {
  if (opts == null) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = opts[name];
    return value == null ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (key: string, defaultOrOptions?: string | NativeTOptions, maybeOptions?: NativeTOptions) => {
      if (typeof defaultOrOptions === 'string') {
        return interpolate(defaultOrOptions, maybeOptions);
      }
      if (defaultOrOptions && typeof defaultOrOptions.defaultValue === 'string') {
        return interpolate(defaultOrOptions.defaultValue, defaultOrOptions);
      }
      return key;
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// Number formatting (web @/hooks/useFormatting + @/lib/numberFormat). Native-safe
// Intl.NumberFormat with manual fallbacks so they never throw under Hermes or the
// jest/node runtime.
// ---------------------------------------------------------------------------

function fmtInt(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function formatCurrency(n: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

// ---------------------------------------------------------------------------
// FadeIn — web @/components/motion FadeIn. Animated.View opacity 0->1 +
// translateY 12->0 mount fade, honouring the OS reduced-motion preference.
// ---------------------------------------------------------------------------

function FadeIn({ children }: { children: ReactNode }): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduce(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduce,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduce]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{ opacity: progress, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Typography roles — web @/components/ui PanelTitle / Subhead / Caption /
// HelperText. AppText wrappers preserving the web hierarchy.
// ---------------------------------------------------------------------------

function PanelTitle({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <AppText style={styles.panelTitle} weight="semibold">
      {children}
    </AppText>
  );
}

function Subhead({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <AppText style={styles.subhead} weight="semibold">
      {children}
    </AppText>
  );
}

function Caption({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <AppText style={styles.caption} tone="muted">
      {children}
    </AppText>
  );
}

function HelperText({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <AppText style={styles.helperText} tone="muted">
      {children}
    </AppText>
  );
}

// ---------------------------------------------------------------------------
// IconBox — web @/components/ui IconBox color="purple". A violet-tinted rounded
// glyph container.
// ---------------------------------------------------------------------------

function IconBox({ glyph }: { glyph: string }): React.ReactElement {
  return (
    <View style={styles.iconBox}>
      <AppText style={styles.iconGlyph}>{glyph}</AppText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Button — web @/components/ui Button. Pressable with the web variants used in
// this tree (primary / ghost), a disabled state (web disabled:opacity-50), and
// an optional leading glyph.
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'ghost';

function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'ghost' ? styles.buttonGhost : styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {icon ? (
        <AppText style={[styles.buttonIcon, buttonTextStyles[variant]]}>{icon}</AppText>
      ) : null}
      <AppText style={buttonTextStyles[variant]} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Input — web @/components/ui Input. Labelled TextInput preserving the label +
// placeholder + optional hint, secureTextEntry (web type="password"), and a
// numeric keyboard (web type="number") for the cost-cap field.
// ---------------------------------------------------------------------------

function Input({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  secureTextEntry = false,
  keyboardType = 'default',
  testID,
}: {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric';
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.inputGroup}>
      {label ? <AppText style={styles.inputLabel}>{label}</AppText> : null}
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        secureTextEntry={secureTextEntry}
        style={styles.input}
        testID={testID}
        value={value}
      />
      {hint ? <AppText style={styles.inputHint} tone="muted">{hint}</AppText> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Select — web @/components/ui Select. Native has no <select> dropdown, so the
// options render as a labelled vertical list of Pressable rows; the chosen value
// is highlighted and ticked. onChange(value) mirrors the web e.target.value flow.
// ---------------------------------------------------------------------------

interface SelectOption {
  value: string;
  label: string;
}

function Select({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (next: string) => void;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.inputGroup} testID={testID}>
      <AppText style={styles.inputLabel}>{label}</AppText>
      <View style={styles.selectList}>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.selectOption,
                selected && styles.selectOptionSelected,
                pressed && styles.selectOptionPressed,
              ]}
              testID={testID ? `${testID}-${option.value}` : undefined}>
              <AppText
                style={selected ? styles.selectOptionLabelSelected : styles.selectOptionLabel}>
                {option.label}
              </AppText>
              {selected ? (
                <AppText style={styles.selectOptionTick}>{CHECK_GLYPH}</AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pure helpers — ported verbatim from the web original (web L60-157). These are
// loosely-typed JSON readers + normalisers with no DOM dependency.
// ---------------------------------------------------------------------------

type AiMode = 'off' | 'local' | 'cloud';

/**
 * Returns true when the supplied mode is one of the canonical three. Defensive
 * against legacy payloads that may arrive as the empty string (web L55-62).
 */
function isAiMode(value: unknown): value is AiMode {
  return value === 'off' || value === 'local' || value === 'cloud';
}

/**
 * Pulls a `string` out of a loosely-typed JSON object. Returns the supplied
 * fallback when the key is missing or non-string (web L64-76).
 */
function readProviderString(
  cfg: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  if (cfg == null) {
    return fallback;
  }
  const v = cfg[key];
  return typeof v === 'string' ? v : fallback;
}

/**
 * Drills into the namespaced `ai_provider_config` and returns one provider's
 * typed sub-entry (web L78-103). Migration 000208 converts the legacy flat shape
 * to the namespaced form on the next API boot, so SPA reads assume namespaced.
 */
function readProviderConfigEntry(
  cfg: Record<string, unknown> | undefined,
  providerName: string,
): Record<string, unknown> | undefined {
  if (cfg == null || providerName === '') {
    return undefined;
  }
  const entry = cfg[providerName];
  return entry != null && typeof entry === 'object' && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : undefined;
}

/**
 * The four legacy top-level keys the pre-fix SPA wrote directly onto
 * `ai_provider_config` (web L105-113). Defense-in-depth for export/import
 * round-trips of legacy snapshots.
 */
const LEGACY_TOP_LEVEL_KEYS = ['provider', 'base_url', 'model', 'api_key'] as const;

function stripLegacyTopLevelKeys(
  cfg: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (cfg == null) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if ((LEGACY_TOP_LEVEL_KEYS as readonly string[]).includes(k)) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Normalises the loaded settings into a per-feature toggle map keyed by every
 * known feature ID, backfilling untouched IDs with `false` (web L127-141).
 */
function normaliseFeatureMap(
  source: Record<string, boolean> | undefined,
): Record<AiFeatureId, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of AI_FEATURE_IDS) {
    out[id] = Boolean(source?.[id]);
  }
  return out as Record<AiFeatureId, boolean>;
}

/**
 * Returns true when the archived selection contains at least one `true` entry
 * the user can plausibly want to restore (web L143-157, ADR-015 §I7).
 */
function archiveHasRestorableEntries(
  archive: Record<string, boolean> | undefined,
): boolean {
  if (archive == null) {
    return false;
  }
  for (const value of Object.values(archive)) {
    if (value) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// AIProviderDraft — web ./AIProviderSection AIProviderDraft (web AIProviderSection
// L27-62). Local in-memory form shape mirroring `ai_provider_config` + the cap.
// ---------------------------------------------------------------------------

export interface AIProviderDraft {
  provider: string;
  base_url: string;
  model: string;
  /** Live in memory only. Empty string means "no change on save". */
  api_key: string;
  /** Daily cap in cents. 0 means unset. */
  cost_cap_cents: number;
  /** Azure-only: API version query parameter. */
  api_version: string;
  /** Azure-only: Azure OpenAI Service vs Azure AI Foundry / Inference. */
  flavor: string;
  /** Azure-only: chat deployment name. Empty -> adapter falls back to `model`. */
  deployment: string;
  /** Embedding model identifier (F7 RAG worker). */
  embedding_model: string;
  /** Azure-only embedding deployment name. */
  embedding_deployment: string;
}

// ---------------------------------------------------------------------------
// AIProviderSection — web ./AIProviderSection. Provider configuration, visible
// only when AI mode is not off. Validate calls /settings/ai/validate-config.
// ---------------------------------------------------------------------------

const CLOUD_PROVIDER_OPTIONS: SelectOption[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'azure', label: 'Azure AI' },
  { value: 'google', label: 'Google' },
];

const LOCAL_PROVIDER_OPTIONS: SelectOption[] = [
  { value: 'ollama', label: 'Ollama' },
  { value: 'lmstudio', label: 'LM Studio' },
  { value: 'llama-cpp', label: 'llama.cpp' },
];

const AZURE_FLAVOR_OPTIONS: SelectOption[] = [
  { value: 'openai', label: 'Azure OpenAI Service (gpt-4o, gpt-4-turbo, …)' },
  { value: 'foundry', label: 'Azure AI Foundry / Inference (multi-vendor)' },
];

function AIProviderSection({
  value,
  isCloud,
  onChange,
}: {
  value: AIProviderDraft;
  isCloud: boolean;
  onChange: (next: AIProviderDraft) => void;
}): React.ReactElement {
  const t = useNativeTranslationFallback();
  const validate = useValidateAiProvider();

  // Latest validation banner. Cleared on input change so the user never sees
  // stale feedback after editing the URL (web AIProviderSection L74-78).
  const [validateBanner, setValidateBanner] = useState<
    { kind: 'ok' | 'fail'; message: string } | null
  >(null);

  const patch = useCallback(
    (next: Partial<AIProviderDraft>) => {
      onChange({ ...value, ...next });
      setValidateBanner(null);
    },
    [onChange, value],
  );

  async function runValidate() {
    setValidateBanner(null);
    // For local mode only mode + base_url matter; for cloud mode send the full
    // configuration so the backend can run a 1-token probe. Empty fields fall
    // back to the saved per-provider entry server-side (web L85-117).
    const result = await validate.mutateAsync(
      isCloud
        ? {
            mode: 'cloud',
            provider: value.provider,
            base_url: value.base_url,
            ...(value.api_key.trim() === '' ? {} : { api_key: value.api_key }),
            model: value.model,
            api_version: value.api_version,
            flavor: value.flavor,
            deployment: value.deployment,
            embedding_model: value.embedding_model,
            embedding_deployment: value.embedding_deployment,
          }
        : {
            mode: 'local',
            provider: value.provider,
            base_url: value.base_url,
          },
    );
    if (result.ok) {
      const okMessage = result.pinned_ip
        ? t('ai.settings.validate.successPinned', 'OK — pinned to {{ip}}', {
            ip: result.pinned_ip,
          })
        : result.probed_model
          ? t('ai.settings.validate.successProbed', 'OK — {{model}} reachable', {
              model: result.probed_model,
            })
          : t('ai.settings.validate.success', 'OK — provider reachable');
      setValidateBanner({ kind: 'ok', message: okMessage });
      return;
    }
    setValidateBanner({ kind: 'fail', message: result.message });
  }

  const isAzure = isCloud && value.provider === 'azure';

  return (
    <View
      accessibilityLabel={t('ai.settings.provider.label', 'Provider configuration')}
      style={styles.section}
      testID="ai-provider-section">
      <Subhead>{t('ai.settings.provider.label', 'Provider configuration')}</Subhead>

      <Select
        label={t('ai.settings.provider.providerLabel', 'Provider')}
        onChange={next => patch({ provider: next })}
        options={isCloud ? CLOUD_PROVIDER_OPTIONS : LOCAL_PROVIDER_OPTIONS}
        testID="ai-provider-select"
        value={value.provider}
      />

      <Input
        hint={
          isAzure && value.flavor !== 'foundry'
            ? t(
                'ai.settings.provider.azureModelHint',
                'Used for cost tracking. Leave Deployment blank if your Azure deployment is named the same.',
              )
            : undefined
        }
        label={
          isAzure && value.flavor !== 'foundry'
            ? t(
                'ai.settings.provider.azureModelLabel',
                'Model identifier (e.g. gpt-4o-mini)',
              )
            : t('ai.settings.provider.model', 'Model')
        }
        onChangeText={next => patch({ model: next })}
        placeholder={isCloud ? 'gpt-4o-mini' : 'llama3.1:8b'}
        testID="ai-provider-model"
        value={value.model}
      />

      {/*
       * Azure surfaces both Azure OpenAI Service (deployment-name routing) and
       * the Azure AI Foundry / Inference API (model-in-body). The flavor switch +
       * deployment / api-version inputs live behind a provider===azure guard so
       * the existing OpenAI/Anthropic flows are unchanged (web L194-264).
       */}
      {isAzure && (
        <>
          <Select
            label={t('ai.settings.provider.azureFlavor', 'Azure surface')}
            onChange={next => patch({ flavor: next })}
            options={AZURE_FLAVOR_OPTIONS}
            testID="ai-provider-azure-flavor"
            value={value.flavor || 'openai'}
          />

          <Input
            hint={t(
              'ai.settings.provider.azureApiVersionHint',
              'Leave blank to use the adapter default.',
            )}
            label={t('ai.settings.provider.azureApiVersion', 'API version')}
            onChangeText={next => patch({ api_version: next })}
            placeholder="2024-10-21"
            testID="ai-provider-azure-api-version"
            value={value.api_version}
          />

          {value.flavor !== 'foundry' && (
            <>
              <Input
                hint={t(
                  'ai.settings.provider.azureDeploymentHint',
                  'Leave blank to reuse the Model field.',
                )}
                label={t('ai.settings.provider.azureDeployment', 'Chat deployment name')}
                onChangeText={next => patch({ deployment: next })}
                placeholder={value.model || 'gpt-4o-mini'}
                testID="ai-provider-azure-deployment"
                value={value.deployment}
              />

              <Input
                label={t(
                  'ai.settings.provider.azureEmbeddingDeployment',
                  'Embedding deployment name (optional)',
                )}
                onChangeText={next => patch({ embedding_deployment: next })}
                placeholder={value.embedding_model || 'text-embedding-3-small'}
                testID="ai-provider-azure-embedding-deployment"
                value={value.embedding_deployment}
              />
            </>
          )}
        </>
      )}

      {!isCloud && (
        <View style={styles.fieldStack}>
          <Input
            hint={t(
              'ai.settings.provider.baseUrlHint',
              'Must resolve to a private network address (loopback, RFC1918, link-local, or ULA).',
            )}
            label={t('ai.settings.provider.baseUrl', 'Base URL')}
            onChangeText={next => patch({ base_url: next })}
            placeholder="http://localhost:11434"
            testID="ai-provider-base-url"
            value={value.base_url}
          />
          <View style={styles.validateRow}>
            <Button
              disabled={validate.isPending || value.base_url.trim().length === 0}
              label={
                validate.isPending
                  ? t('ai.settings.validate.running', 'Validating…')
                  : t('ai.settings.validate.button', 'Validate')
              }
              onPress={runValidate}
              testID="ai-provider-validate"
              variant="ghost"
            />
            {validateBanner && (
              <AppText
                accessibilityRole="text"
                style={
                  validateBanner.kind === 'ok'
                    ? styles.validateBannerOk
                    : styles.validateBannerFail
                }
                testID="ai-provider-validate-banner">
                {validateBanner.message}
              </AppText>
            )}
          </View>
        </View>
      )}

      {isAzure && (
        <Input
          hint={t(
            'ai.settings.provider.azureBaseUrlHint',
            'The Azure OpenAI resource endpoint or Azure AI Foundry endpoint.',
          )}
          label={t('ai.settings.provider.azureBaseUrl', 'Resource endpoint URL')}
          onChangeText={next => patch({ base_url: next })}
          placeholder="https://my-resource.openai.azure.com"
          testID="ai-provider-azure-base-url"
          value={value.base_url}
        />
      )}

      {isCloud && (
        <>
          <Input
            // Masks typed values. The parent never pre-populates this field when
            // the server redacts the key; empty input on save means "do not
            // change the stored key" (web L328-348).
            hint={t(
              'ai.settings.provider.apiKeyHint',
              'Stored encrypted. Never displayed once saved.',
            )}
            label={t('ai.settings.provider.apiKey', 'API key')}
            onChangeText={next => patch({ api_key: next })}
            placeholder={t(
              'ai.settings.provider.apiKeyPlaceholder',
              'sk-…  (leave blank to keep current)',
            )}
            secureTextEntry
            testID="ai-provider-api-key"
            value={value.api_key}
          />

          <Input
            hint={t(
              'ai.settings.provider.costCapHint',
              'Daily cap on cloud spending. 0 disables the cap.',
            )}
            keyboardType="numeric"
            label={t('ai.settings.provider.costCap', 'Daily cost cap (USD)')}
            onChangeText={next => {
              const dollars = Number.parseFloat(next);
              const cents = Number.isFinite(dollars)
                ? Math.max(0, Math.round(dollars * 100))
                : 0;
              patch({ cost_cap_cents: cents });
            }}
            placeholder="5.00"
            testID="ai-provider-cost-cap"
            value={value.cost_cap_cents > 0 ? (value.cost_cap_cents / 100).toFixed(2) : ''}
          />

          {/*
           * Cloud Validate. Sends a 1-token chat probe. Empty api_key is allowed
           * — the backend falls back to the saved key — so the button stays
           * enabled even with an empty field (web L375-416).
           */}
          <View style={styles.validateRow}>
            <Button
              disabled={validate.isPending}
              label={
                validate.isPending
                  ? t('ai.settings.validate.running', 'Validating…')
                  : t('ai.settings.validate.cloudButton', 'Validate connection')
              }
              onPress={runValidate}
              testID="ai-provider-validate-cloud"
              variant="ghost"
            />
            {validateBanner && (
              <AppText
                accessibilityRole="text"
                style={
                  validateBanner.kind === 'ok'
                    ? styles.validateBannerOk
                    : styles.validateBannerFail
                }
                testID="ai-provider-validate-banner">
                {validateBanner.message}
              </AppText>
            )}
          </View>
        </>
      )}

      {!isCloud && (
        <Caption>
          {t(
            'ai.settings.provider.localExplainer',
            'Local-only mode never sends data outside your network. The validator pins the resolved IP at save time to defend against later DNS rebinding.',
          )}
        </Caption>
      )}

      <HelperText>
        {t(
          'ai.settings.provider.validateOptional',
          'Validation is optional but recommended — it catches mis-typed URLs and confirms the model is reachable.',
        )}
      </HelperText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AIFeatureToggleList — web ./AIFeatureToggleList. Per-feature opt-in switches,
// generated by mapping over AI_FEATURE_IDS (never hand-listed).
// ---------------------------------------------------------------------------

function AIFeatureToggleList({
  values,
  onToggle,
}: {
  values: Record<AiFeatureId, boolean>;
  onToggle: (id: AiFeatureId, value: boolean) => void;
}): React.ReactElement {
  const t = useNativeTranslationFallback();

  return (
    <View
      accessibilityLabel={t(
        'ai.settings.feature.legend',
        'Per-feature opt-in (all default off)',
      )}
      style={styles.section}
      testID="ai-feature-toggle-list">
      <Subhead>
        {t('ai.settings.feature.legend', 'Per-feature opt-in (all default off)')}
      </Subhead>
      <View style={styles.featureList}>
        {AI_FEATURE_IDS.map(id => {
          const meta = AI_FEATURES[id];
          // Fallback to registry name/description keeps the surface
          // self-describing for newly added features (web L50-60).
          const label = t(`ai.settings.feature.${id}.label`, meta.name);
          const description = t(`ai.settings.feature.${id}.description`, meta.description);
          return (
            <View key={id} style={styles.featureRow} testID={`ai-feature-row-${id}`}>
              <View style={styles.featureText}>
                <AppText style={styles.featureLabel} weight="semibold">
                  {label}
                </AppText>
                <Caption>{description}</Caption>
              </View>
              <Switch
                accessibilityLabel={label}
                onValueChange={next => onToggle(id, next)}
                testID={`ai-feature-toggle-${id}`}
                trackColor={{ false: colors.border, true: colors.accentSoft }}
                thumbColor={Boolean(values[id]) ? colors.accent : colors.textMuted}
                value={Boolean(values[id])}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AIRestorePanel — web ./AIRestorePanel. "Restore previous selection?" CTA.
// Surfaced only in a non-off mode with a non-empty archive that the user has not
// declined this session. Restore is never silent (ADR-015 §I7).
// ---------------------------------------------------------------------------

/**
 * Comma-separated preview of the archived feature names so the user can decide
 * without mentally diffing. Unknown IDs fall back to the raw ID (web L29-50).
 */
function previewLabels(
  archived: Record<string, boolean>,
  translate: (id: string, fallback: string) => string,
): string[] {
  const out: string[] = [];
  for (const [id, value] of Object.entries(archived)) {
    if (!value) {
      continue;
    }
    if (isKnownAiFeature(id)) {
      out.push(translate(id, AI_FEATURES[id].name));
    } else {
      out.push(id);
    }
  }
  return out;
}

function AIRestorePanel({
  archived,
  onConfirm,
  onDecline,
}: {
  archived: Record<string, boolean>;
  onConfirm: () => void;
  onDecline: () => void;
}): React.ReactElement {
  const t = useNativeTranslationFallback();
  const labels = previewLabels(archived, (id, fallback) =>
    t(`ai.settings.feature.${id}.label`, fallback),
  );

  return (
    <View accessibilityRole="alert" style={styles.restorePanel} testID="ai-restore-panel">
      <View style={styles.restoreHeader}>
        <AppText style={styles.restoreGlyph}>{SPARKLES_GLYPH}</AppText>
        <View style={styles.restoreText}>
          <Subhead>
            {t('ai.settings.archive.title', 'Restore previous Helix selection?')}
          </Subhead>
          <Caption>
            {t(
              'ai.settings.archive.description',
              'You previously had these features enabled. Re-enable them now?',
            )}
          </Caption>
          {labels.length > 0 && (
            <View style={styles.restoreList}>
              {labels.map(label => (
                <AppText key={label} style={styles.restoreListItem} tone="secondary">
                  {`\u2022 ${label}`}
                </AppText>
              ))}
            </View>
          )}
        </View>
      </View>
      <View style={styles.restoreActions}>
        <Button
          label={t('ai.settings.archive.decline', 'No thanks')}
          onPress={onDecline}
          testID="ai-restore-decline"
          variant="ghost"
        />
        <Button
          label={t('ai.settings.archive.restore', 'Restore selection')}
          onPress={onConfirm}
          testID="ai-restore-confirm"
          variant="primary"
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AIUsageCard — web ./AIUsageCard. Live "usage today" card reading /ai/usage/today
// via useAiUsageToday(). Empty / loading / error states degrade to the em-dash
// placeholder so the layout stays stable.
// ---------------------------------------------------------------------------

function microCentsToDollars(mc: number | null | undefined): number {
  if (mc == null || !Number.isFinite(mc)) {
    return 0;
  }
  return mc / 1_000_000;
}

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return PLACEHOLDER;
  }
  return fmtInt(n);
}

function UsageCell({
  label,
  value,
  isLoading,
}: {
  label: string;
  value: string;
  isLoading: boolean;
}): React.ReactElement {
  return (
    <View style={styles.usageCell}>
      <AppText style={styles.usageCellLabel} tone="muted">
        {label}
      </AppText>
      <AppText
        accessibilityState={{ busy: isLoading }}
        style={styles.usageCellValue}
        testID="ai-usage-value"
        weight="semibold">
        {value}
      </AppText>
    </View>
  );
}

function AIUsageCard(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const { data, isLoading, isError } = useAiUsageToday();

  const tokensIn = !data || isError ? PLACEHOLDER : formatCount(data.input_tokens);
  const tokensOut = !data || isError ? PLACEHOLDER : formatCount(data.output_tokens);
  const cost =
    !data || isError
      ? PLACEHOLDER
      : formatCurrency(microCentsToDollars(data.cost_micro_cents));

  return (
    <View
      accessibilityLabel={t('ai.settings.usage.title', 'Usage today')}
      style={styles.section}
      testID="ai-usage-card">
      <Subhead>{t('ai.settings.usage.title', 'Usage today')}</Subhead>
      <View style={styles.usageGrid}>
        <UsageCell
          isLoading={isLoading}
          label={t('ai.settings.usage.tokensIn', 'Tokens in')}
          value={tokensIn}
        />
        <UsageCell
          isLoading={isLoading}
          label={t('ai.settings.usage.tokensOut', 'Tokens out')}
          value={tokensOut}
        />
        <UsageCell
          isLoading={isLoading}
          label={t('ai.settings.usage.cost', 'Estimated cost')}
          value={cost}
        />
      </View>
      <Caption>
        {data && data.call_count > 0
          ? `${formatCount(data.call_count)} ${t(
              'ai.settings.usage.liveSuffix',
              'Helix calls today.',
            )}`
          : t(
              'ai.settings.usage.placeholder',
              'Usage populates as features run. Live numbers arrive in a follow-up update.',
            )}
      </Caption>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ModeRadio — web AISettings ModeRadio (web L564-609). Styled radio card.
// ---------------------------------------------------------------------------

function ModeRadio({
  value,
  checked,
  onChange,
  label,
  description,
  testID,
}: {
  value: AiMode;
  checked: boolean;
  onChange: (value: AiMode) => void;
  label: string;
  description: string;
  testID: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      onPress={() => onChange(value)}
      style={[styles.modeCard, checked && styles.modeCardChecked]}
      testID={testID}>
      <View style={styles.modeHeader}>
        <View style={[styles.radioOuter, checked && styles.radioOuterChecked]}>
          {checked ? <View style={styles.radioInner} /> : null}
        </View>
        <AppText style={styles.modeLabel} weight="semibold">
          {label}
        </AppText>
      </View>
      <AppText style={styles.modeDescription} tone="muted">
        {description}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// AICostCapSpendBar — web AISettings AICostCapSpendBar (web L611-708). Live
// "today" spend bar. Visible only in cloud mode AND when capCents > 0 (parent
// gates this). Reads /ai/usage/today so the value matches AIUsageCard.
// ---------------------------------------------------------------------------

function AICostCapSpendBar({ capCents }: { capCents: number }): React.ReactElement {
  const t = useNativeTranslationFallback();
  const { data, isLoading } = useAiUsageToday();

  // Backend stores spend in micro-cents (1e-4 cent). Cap is whole cents (web
  // L633-639).
  const todayMicroCents = data?.cost_micro_cents ?? 0;
  const capMicroCents = capCents * 10_000;
  const pct =
    capMicroCents > 0 ? Math.min(100, (todayMicroCents / capMicroCents) * 100) : 0;
  const todayDollars = todayMicroCents / 1_000_000;
  const capDollars = capCents / 100;

  const level: 'ok' | 'warn' | 'critical' =
    pct >= 100 ? 'critical' : pct >= 80 ? 'warn' : 'ok';

  // Toned color intent (web cyan-300 / amber-300 / rose-300 -> native accent /
  // warning / danger tokens).
  const levelColor =
    level === 'critical' ? colors.danger : level === 'warn' ? colors.warning : colors.accent;

  return (
    <View style={styles.spendBar} testID="ai-cost-cap-spend-bar">
      <View style={styles.spendHeader}>
        <Caption>{t('ai.settings.costCap.todayTitle', 'Today’s Helix spend')}</Caption>
        <AppText style={[styles.spendAmount, { color: levelColor }]} weight="semibold">
          {isLoading
            ? t('ai.settings.costCap.loading', 'Loading…')
            : t('ai.settings.costCap.amount', '${{spent}} / ${{cap}}', {
                spent: todayDollars.toFixed(2),
                cap: capDollars.toFixed(2),
                defaultValue: `$${todayDollars.toFixed(2)} / $${capDollars.toFixed(2)}`,
              })}
        </AppText>
      </View>
      <View
        accessibilityLabel={t('ai.settings.costCap.barLabel', 'Helix cost cap usage')}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
        style={styles.spendTrack}>
        <View style={[styles.spendFill, { width: `${pct}%`, backgroundColor: levelColor }]} />
      </View>
      {level === 'critical' && (
        <HelperText>
          {t(
            'ai.settings.costCap.criticalHint',
            'Cap reached — new Helix calls will be rejected until the cap resets at UTC midnight or you raise it.',
          )}
        </HelperText>
      )}
      {level === 'warn' && (
        <HelperText>
          {t(
            'ai.settings.costCap.warnHint',
            'You are nearing today’s cap. Calls will pause once you reach it.',
          )}
        </HelperText>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// AISettings — web AISettings (web L159-562). Mode picker, archive preview, and
// save flow. Mirrors the server payload into local state on first load / refetch.
// ---------------------------------------------------------------------------

export function AISettings(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const { data: settings, isLoading } = useSettings();
  const saveAi = useSaveAiSettings();

  const serverMode: AiMode = isAiMode(settings?.ai_mode)
    ? (settings!.ai_mode as AiMode)
    : 'off';

  const [mode, setMode] = useState<AiMode>(serverMode);
  const [features, setFeatures] = useState<Record<AiFeatureId, boolean>>(() =>
    normaliseFeatureMap(settings?.ai_features),
  );
  const [provider, setProvider] = useState<AIProviderDraft>(() => {
    const cfg = settings?.ai_provider_config;
    // F1 contract: read the user's "current" provider name from `default`
    // (legacy flat shape stored it as `provider`) (web L179-205).
    const providerName =
      readProviderString(cfg, 'default', '') ||
      readProviderString(cfg, 'provider', 'ollama');
    const entry = readProviderConfigEntry(cfg, providerName) ?? cfg;
    return {
      provider: providerName,
      base_url: readProviderString(entry, 'base_url', ''),
      model: readProviderString(entry, 'model', ''),
      api_key: '',
      cost_cap_cents: settings?.ai_cost_cap_cents ?? 0,
      api_version: readProviderString(entry, 'api_version', ''),
      flavor: readProviderString(entry, 'flavor', ''),
      deployment: readProviderString(entry, 'deployment', ''),
      embedding_model: readProviderString(entry, 'embedding_model', ''),
      embedding_deployment: readProviderString(entry, 'embedding_deployment', ''),
    };
  });
  // ADR-015 §I7 — when the user re-enables AI and the server still has an
  // ai_features_archived snapshot, surface a "Restore previous selection?"
  // prompt. Dismissed sets this true for the session (web L206-212).
  const [restoreDismissed, setRestoreDismissed] = useState(false);

  // Reset local state when the underlying settings document changes identity,
  // compared by JSON shape rather than reference (web L214-226).
  const aiSnapshot = useMemo(() => {
    if (settings == null) {
      return null;
    }
    return JSON.stringify({
      mode: settings.ai_mode,
      features: settings.ai_features ?? {},
      provider: settings.ai_provider_config ?? null,
      cap: settings.ai_cost_cap_cents ?? 0,
    });
  }, [settings]);

  useEffect(() => {
    if (settings == null) {
      return;
    }
    setMode(serverMode);
    setFeatures(normaliseFeatureMap(settings.ai_features));
    const cfg = settings.ai_provider_config;
    const providerName =
      readProviderString(cfg, 'default', '') ||
      readProviderString(cfg, 'provider', 'ollama');
    const entry = readProviderConfigEntry(cfg, providerName) ?? cfg;
    setProvider({
      provider: providerName,
      base_url: readProviderString(entry, 'base_url', ''),
      model: readProviderString(entry, 'model', ''),
      // ADR-015 §I9 — never pre-populate the key when the server's mode is off
      // (web L241-247).
      api_key: serverMode === 'off' ? '' : readProviderString(entry, 'api_key', ''),
      cost_cap_cents: settings.ai_cost_cap_cents ?? 0,
      api_version: readProviderString(entry, 'api_version', ''),
      flavor: readProviderString(entry, 'flavor', ''),
      deployment: readProviderString(entry, 'deployment', ''),
      embedding_model: readProviderString(entry, 'embedding_model', ''),
      embedding_deployment: readProviderString(entry, 'embedding_deployment', ''),
    });
    setRestoreDismissed(false);
    // Intentionally depend on the JSON snapshot, not the object reference, to
    // avoid infinite re-renders (web L260-262).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSnapshot]);

  // ── Mode change ──
  // Switching to OFF clears every per-feature toggle in local state (visual
  // "everything is off now" confirmation). The backend re-clears + archives on
  // PUT. We do NOT auto-save on a mode flip (web L264-281).
  function handleModeChange(next: AiMode) {
    if (next === mode) {
      return;
    }
    setMode(next);
    if (next === 'off') {
      setFeatures(normaliseFeatureMap(undefined));
    }
  }

  // ── Save handler ──
  // Builds the AI patch the server expects. When mode is 'off' we omit
  // ai_provider_config + the key so the backend's redaction path runs unchanged
  // (web L283-358).
  function handleSave() {
    if (mode === 'off') {
      saveAi.mutate({
        ai_mode: 'off',
        ai_features: {},
      });
      return;
    }
    saveAi.mutate({
      ai_mode: mode,
      ai_features: features,
      // F1 contract: namespaced shape. `default` names the selected provider;
      // each provider keeps its own sub-object. Strip legacy top-level keys and
      // merge (not replace) the per-provider sub-object (web L302-355).
      ai_provider_config: {
        ...stripLegacyTopLevelKeys(settings?.ai_provider_config),
        default: provider.provider,
        [provider.provider]: {
          ...(readProviderConfigEntry(settings?.ai_provider_config, provider.provider) ?? {}),
          base_url: provider.base_url,
          model: provider.model,
          // Optional / provider-specific fields are only emitted when non-empty.
          ...(provider.api_version.trim() === '' ? {} : { api_version: provider.api_version }),
          ...(provider.flavor.trim() === '' ? {} : { flavor: provider.flavor }),
          ...(provider.deployment.trim() === '' ? {} : { deployment: provider.deployment }),
          ...(provider.embedding_model.trim() === ''
            ? {}
            : { embedding_model: provider.embedding_model }),
          ...(provider.embedding_deployment.trim() === ''
            ? {}
            : { embedding_deployment: provider.embedding_deployment }),
          // Only forward a non-empty key; empty would clobber a saved key.
          ...(provider.api_key.trim() === '' ? {} : { api_key: provider.api_key }),
        },
      },
      ai_cost_cap_cents: provider.cost_cap_cents,
    } as Partial<AppSettings>);
  }

  function handleFeatureToggle(id: AiFeatureId, value: boolean) {
    setFeatures(prev => ({ ...prev, [id]: value }));
  }

  /**
   * Wraps the provider onChange so a provider-name switch pulls the new
   * provider's stored base_url / model from the namespaced config
   * (multi-provider preservation, F1). The api_key is intentionally NOT
   * pre-filled on switch (web L364-403).
   */
  const handleProviderChange = useCallback(
    (next: AIProviderDraft) => {
      if (next.provider === provider.provider) {
        setProvider(next);
        return;
      }
      const newEntry = readProviderConfigEntry(
        settings?.ai_provider_config,
        next.provider,
      );
      setProvider({
        provider: next.provider,
        base_url: readProviderString(newEntry, 'base_url', ''),
        model: readProviderString(newEntry, 'model', ''),
        api_key: '',
        cost_cap_cents: next.cost_cap_cents,
        api_version: readProviderString(newEntry, 'api_version', ''),
        flavor: readProviderString(newEntry, 'flavor', ''),
        deployment: readProviderString(newEntry, 'deployment', ''),
        embedding_model: readProviderString(newEntry, 'embedding_model', ''),
        embedding_deployment: readProviderString(newEntry, 'embedding_deployment', ''),
      });
    },
    [provider.provider, settings?.ai_provider_config],
  );

  function handleRestoreConfirm() {
    if (settings?.ai_features_archived == null) {
      return;
    }
    const restored = normaliseFeatureMap(settings.ai_features_archived);
    setFeatures(restored);
    setRestoreDismissed(true);
    // Persist immediately so the archive snapshot is cleared server-side on the
    // next round-trip (web L405-416).
    saveAi.mutate({
      ai_mode: mode,
      ai_features: restored,
    });
  }

  function handleRestoreDecline() {
    setRestoreDismissed(true);
  }

  // ── Derived state (web L422-429) ──
  const showProviderSection = mode !== 'off';
  const showRestorePanel =
    mode !== 'off' &&
    !restoreDismissed &&
    archiveHasRestorableEntries(settings?.ai_features_archived);
  const isCloud = mode === 'cloud';

  return (
    <FadeIn>
      <GlassPanel style={styles.panel} testID="ai-settings-panel">
        <View style={styles.headerRow}>
          <IconBox glyph={HELIX_GLYPH} />
          <View style={styles.headerText}>
            <PanelTitle>{t('ai.settings.title', 'Helix')}</PanelTitle>
            <AppText style={styles.subtitle} tone="muted">
              {t(
                'ai.settings.subtitle',
                'Optional. Helix is off by default; nothing is enabled until you opt in here.',
              )}
            </AppText>
          </View>
        </View>

        <View
          accessibilityLabel={t('ai.settings.modeLegend', 'Helix mode')}
          style={styles.fieldStack}>
          <Caption>{t('ai.settings.modeLegend', 'Helix mode')}</Caption>
          <View accessibilityRole="radiogroup" style={styles.modeGrid}>
            <ModeRadio
              checked={mode === 'off'}
              description={t(
                'ai.settings.mode.offHint',
                'No Helix features. The app works fully without them.',
              )}
              label={t('ai.settings.mode.off', 'Off (default)')}
              onChange={handleModeChange}
              testID="ai-mode-off"
              value="off"
            />
            <ModeRadio
              checked={mode === 'local'}
              description={t(
                'ai.settings.mode.localHint',
                'Use a private model on your network (e.g. Ollama). No data leaves your install.',
              )}
              label={t('ai.settings.mode.local', 'Local-only')}
              onChange={handleModeChange}
              testID="ai-mode-local"
              value="local"
            />
            <ModeRadio
              checked={mode === 'cloud'}
              description={t(
                'ai.settings.mode.cloudHint',
                'Use a cloud provider (e.g. OpenAI). Requires an API key.',
              )}
              label={t('ai.settings.mode.cloud', 'Cloud')}
              onChange={handleModeChange}
              testID="ai-mode-cloud"
              value="cloud"
            />
          </View>
          {mode === 'off' && (
            <HelperText>
              {t(
                'ai.settings.bannerOff',
                'Helix is off. Your app works fully without it. Enable a mode above to opt in.',
              )}
            </HelperText>
          )}
        </View>

        {showProviderSection && (
          <AIProviderSection
            isCloud={isCloud}
            onChange={handleProviderChange}
            value={provider}
          />
        )}

        {showRestorePanel && (
          <AIRestorePanel
            archived={settings?.ai_features_archived ?? {}}
            onConfirm={handleRestoreConfirm}
            onDecline={handleRestoreDecline}
          />
        )}

        {showProviderSection && (
          <AIFeatureToggleList onToggle={handleFeatureToggle} values={features} />
        )}

        {showProviderSection && <AIUsageCard />}

        {/*
          Cost-cap spend bar. Cloud mode only (local providers don't bill per
          token) and only when the user set a non-zero cap (web L534-544).
        */}
        {isCloud && provider.cost_cap_cents > 0 && (
          <AICostCapSpendBar capCents={provider.cost_cap_cents} />
        )}

        <View style={styles.saveRow}>
          <Button
            disabled={isLoading || saveAi.isPending}
            label={
              saveAi.isPending
                ? t('ai.settings.saving', 'Saving…')
                : t('ai.settings.save', 'Save Helix settings')
            }
            onPress={handleSave}
            testID="ai-settings-save"
            variant="primary"
          />
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

AISettings.displayName = 'AISettings';

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  ghost: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  primary: {
    color: colors.background,
    fontSize: 13,
  },
});

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonIcon: {
    fontSize: 14,
    lineHeight: 18,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  caption: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  featureLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  featureList: {
    gap: spacing.sm,
  },
  featureRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  featureText: {
    flex: 1,
    gap: 2,
  },
  fieldStack: {
    gap: spacing.sm,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputGroup: {
    gap: spacing.xs,
  },
  inputHint: {
    fontSize: 11,
    lineHeight: 15,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  modeCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modeCardChecked: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
  },
  modeDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  modeGrid: {
    gap: spacing.sm,
  },
  modeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  panel: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  radioInner: {
    backgroundColor: colors.violet,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  radioOuter: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 9,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  radioOuterChecked: {
    borderColor: colors.violetBorder,
  },
  restoreActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  restoreGlyph: {
    color: colors.violet,
    fontSize: 16,
    lineHeight: 20,
    marginTop: 2,
  },
  restoreHeader: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  restoreList: {
    gap: 2,
    marginTop: spacing.sm,
  },
  restoreListItem: {
    fontSize: 12,
    lineHeight: 16,
  },
  restorePanel: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
    borderRadius: 10,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  restoreText: {
    flex: 1,
    gap: spacing.xs,
  },
  saveRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  section: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  selectList: {
    gap: spacing.xs,
  },
  selectOption: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 14,
  },
  selectOptionLabelSelected: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  selectOptionPressed: {
    opacity: 0.82,
  },
  selectOptionSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  selectOptionTick: {
    color: colors.accent,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  spendAmount: {
    fontSize: 12,
  },
  spendBar: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  spendFill: {
    borderRadius: 999,
    height: '100%',
  },
  spendHeader: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  spendTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  subhead: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
  },
  usageCell: {
    flex: 1,
    gap: 2,
  },
  usageCellLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
  usageCellValue: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  usageGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  validateBannerFail: {
    color: colors.danger,
    fontSize: 12,
  },
  validateBannerOk: {
    color: colors.success,
    fontSize: 12,
  },
  validateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
