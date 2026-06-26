// Native parity port of
// web/src/features/settings/components/AIProviderSection.tsx.
//
// The web source is the AI provider configuration card shown when AI mode is not
// off. It is a controlled form: the parent owns the AIProviderDraft and passes a
// single `onChange` setter; this component renders the provider/model fields, the
// Azure-only surface/api-version/deployment/embedding inputs, the local base-URL
// field, the cloud api-key + daily-cost-cap fields, and a "Validate" affordance
// that POSTs to `/settings/ai/validate-config` (via the useValidateAiProvider
// mutation) and surfaces an OK/FAIL banner. All behaviour — state names, the
// validate payload shapes (cloud full-config vs local mode+base_url), the empty
// api_key fall-back guard, the cost-cap cents<->dollars math, every conditional
// section, every testID, and every i18n key + English fallback + interpolation —
// is preserved verbatim.
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (AlertCard, ExportModal, UnitInput) — every web-only piece is rebuilt with
// React Native primitives, AppText and the design tokens:
//   * @/components/ui {Input, Select, HelperText, Subhead, Caption, Button} and
//     @/components/layout {Stack} are DOM/Tailwind primitives with no native
//     parity shim yet, so each is reproduced inline (Subhead/Caption/HelperText
//     -> AppText roles; Input -> a labelled bordered TextInput field with an
//     optional hint; Select -> a labelled radio-group of pressable option rows
//     preserving value/onChange/options; Button variant="ghost" -> a bordered
//     ghost Pressable; Stack direction="row" -> a wrapping row View).
//   * react-i18next useTranslation('settings') -> a self-contained
//     useNativeTranslationFallback() that returns the English fallback and applies
//     the same `{{var}}` interpolation react-i18next would (i18n is not wired in
//     this native build; the 'settings' namespace is irrelevant because every key
//     carries its full path). Every key + fallback + var is forwarded unchanged.
//   * useValidateAiProvider() is the existing native parity mutation hook
//     (web-parity/api/hooks/useAiSettings) — used as-is; the discriminated
//     ValidateAiProviderResult (ok / pinned_ip / probed_model / message) is read
//     exactly as the source did.
//   * The web grid (grid-cols-1 sm:grid-cols-2) collapses to the mobile baseline
//     single-column stack with the same gap; the `<section>`/`<span role="status">`
//     semantics map to accessibilityLabel / accessibilityLiveRegion. The DOM-only
//     `data-validate-kind` attribute has no RN analogue, so the ok/fail distinction
//     is preserved via tone colour (success/danger tokens, the emerald-300/rose-300
//     analogues) plus the stable testID.
//
// No DOM, no react-i18next, no web UI components, no Recharts/Leaflet are imported.

import { useCallback, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing, typography } from '../../../../theme/tokens';
import { useValidateAiProvider } from '../../../api/hooks/useAiSettings';

/* ------------------------------------------------------------------ */
/*  i18n fallback (react-i18next port)                                 */
/* ------------------------------------------------------------------ */

type TranslationVars = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

// The web component read `t` from react-i18next ('settings' namespace). Native
// parity has no i18n runtime wired yet, so this returns the English fallback and
// applies the same `{{var}}` interpolation react-i18next would.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback<NativeTFunction>((_key, fallback, vars) => {
    if (!vars) {
      return fallback;
    }
    return interpolate(fallback, vars);
  }, []);
}

/**
 * Local in-memory shape for the form. Mirrors the server's
 * `ai_provider_config` plus the cap (which is a sibling key) so
 * the parent can pass a single setter.
 */
export interface AIProviderDraft {
  provider: string;
  base_url: string;
  model: string;
  /** Live in memory only. Empty string means "no change on save". */
  api_key: string;
  /** Daily cap in cents. 0 means unset. */
  cost_cap_cents: number;
  /**
   * Azure-only: API version query parameter. Ignored by other
   * providers but persists in the per-provider sub-map so a user
   * who swaps providers doesn't lose their Azure config.
   */
  api_version: string;
  /**
   * Azure-only: selects between the Azure OpenAI Service surface
   * (deployment-name routing in URL) and the Azure AI Foundry /
   * Inference API (model-in-body routing).
   */
  flavor: string;
  /**
   * Azure-only: chat deployment name. Empty → adapter falls back
   * to `model`. Surfaced as a separate field so cost/audit can
   * record the model identity even when the deployment is named
   * differently.
   */
  deployment: string;
  /**
   * Embedding model identifier. Used by the F7 RAG worker; not
   * always exposed in the UI but persisted so a previous setting
   * survives a save round-trip.
   */
  embedding_model: string;
  /** Azure-only embedding deployment name (analog of `deployment`). */
  embedding_deployment: string;
}

interface Props {
  value: AIProviderDraft;
  isCloud: boolean;
  onChange: (next: AIProviderDraft) => void;
}

/* ------------------------------------------------------------------ */
/*  Inlined native parity primitives                                  */
/* ------------------------------------------------------------------ */

// web @/components/ui Subhead — a small section heading.
function Subhead({ children }: { children: string }) {
  return (
    <AppText style={styles.subhead} tone="primary" weight="semibold">
      {children}
    </AppText>
  );
}

// web @/components/ui Caption — secondary explanatory line.
function Caption({ children }: { children: string }) {
  return (
    <AppText style={styles.caption} tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

// web @/components/ui HelperText — muted helper hint below a group.
function HelperText({ children }: { children: string }) {
  return (
    <AppText style={styles.helperText} tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

interface SelectOption {
  value: string;
  label: string;
}

// web @/components/ui Select — a labelled dropdown. Reproduced as a radio-group
// of pressable option rows (touch-first parity) preserving value/onChange/options.
function SelectField({
  label,
  value,
  onChange,
  options,
  testID,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: SelectOption[];
  testID?: string;
}) {
  return (
    <View style={styles.field} testID={testID}>
      <AppText
        style={styles.fieldLabel}
        tone="secondary"
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
      <View style={styles.optionList}>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.optionPressed,
              ]}
            >
              <AppText
                style={styles.optionText}
                tone={selected ? 'accent' : 'primary'}
                variant="caption"
                weight={selected ? 'semibold' : 'regular'}
              >
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// web @/components/ui Input — a labelled text field with an optional hint line.
function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  secureTextEntry,
  keyboardType,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
}) {
  return (
    <View style={styles.field}>
      <AppText
        style={styles.fieldLabel}
        tone="secondary"
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
      <TextInput
        autoCapitalize="none"
        autoComplete="off"
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
      {hint ? (
        <AppText style={styles.fieldHint} tone="muted" variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// web @/components/ui Button variant="ghost" — a bordered ghost action button.
function GhostButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghostButton,
        disabled && styles.ghostButtonDisabled,
        pressed && !disabled && styles.ghostButtonPressed,
      ]}
      testID={testID}
    >
      <AppText
        style={styles.ghostButtonLabel}
        tone="primary"
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

type ValidateBannerState = { kind: 'ok' | 'fail'; message: string } | null;

// web <span role="status" className="text-emerald-300|text-rose-300"
// data-validate-kind={kind}>. The DOM data-* attribute has no RN analogue; the
// ok/fail distinction survives via the success/danger tone colour + testID.
function ValidateBanner({ banner }: { banner: ValidateBannerState }) {
  if (!banner) {
    return null;
  }
  return (
    <AppText
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        banner.kind === 'ok' ? styles.bannerOk : styles.bannerFail,
      ]}
      testID="ai-provider-validate-banner"
    >
      {banner.message}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  AIProviderSection                                                  */
/* ------------------------------------------------------------------ */

export function AIProviderSection({ value, isCloud, onChange }: Props) {
  const t = useNativeTranslationFallback();
  const validate = useValidateAiProvider();

  // Track the latest validation banner. Cleared on input change so
  // the user never sees stale feedback after editing the URL.
  const [validateBanner, setValidateBanner] = useState<ValidateBannerState>(
    null,
  );

  function patch(next: Partial<AIProviderDraft>) {
    onChange({ ...value, ...next });
    setValidateBanner(null);
  }

  async function runValidate() {
    setValidateBanner(null);
    // Build the request payload. For local mode only mode + base_url
    // matter (the validator is provider-agnostic). For cloud mode we
    // send the full configuration so the backend can build a real
    // adapter and run a 1-token chat probe — empty fields fall back
    // to the saved per-provider entry server-side, so editing one
    // field doesn't force the user to re-state the rest.
    const result = await validate.mutateAsync(
      isCloud
        ? {
            mode: 'cloud',
            provider: value.provider,
            base_url: value.base_url,
            // Only forward api_key when the user actually typed one;
            // empty string lets the backend fall back to the saved
            // (encrypted) value rather than clobbering it with "".
            ...(value.api_key.trim() === ''
              ? {}
              : { api_key: value.api_key }),
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
        ? t(
            'ai.settings.validate.successPinned',
            'OK — pinned to {{ip}}',
            { ip: result.pinned_ip },
          )
        : result.probed_model
          ? t(
              'ai.settings.validate.successProbed',
              'OK — {{model}} reachable',
              { model: result.probed_model },
            )
          : t('ai.settings.validate.success', 'OK — provider reachable');
      setValidateBanner({ kind: 'ok', message: okMessage });
      return;
    }
    setValidateBanner({ kind: 'fail', message: result.message });
  }

  return (
    <View
      accessibilityLabel={t(
        'ai.settings.provider.label',
        'Provider configuration',
      )}
      style={styles.section}
      testID="ai-provider-section"
    >
      <Subhead>
        {t('ai.settings.provider.label', 'Provider configuration')}
      </Subhead>

      <View style={styles.grid}>
        <SelectField
          label={t('ai.settings.provider.providerLabel', 'Provider')}
          onChange={provider => patch({ provider })}
          options={
            isCloud
              ? [
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'anthropic', label: 'Anthropic' },
                  { value: 'azure', label: 'Azure AI' },
                  { value: 'google', label: 'Google' },
                ]
              : [
                  { value: 'ollama', label: 'Ollama' },
                  { value: 'lmstudio', label: 'LM Studio' },
                  { value: 'llama-cpp', label: 'llama.cpp' },
                ]
          }
          testID="ai-provider-select"
          value={value.provider}
        />

        <InputField
          hint={
            value.provider === 'azure' && value.flavor !== 'foundry'
              ? t(
                  'ai.settings.provider.azureModelHint',
                  'Used for cost tracking. Leave Deployment blank if your Azure deployment is named the same.',
                )
              : undefined
          }
          label={
            value.provider === 'azure' && value.flavor !== 'foundry'
              ? t(
                  'ai.settings.provider.azureModelLabel',
                  'Model identifier (e.g. gpt-4o-mini)',
                )
              : t('ai.settings.provider.model', 'Model')
          }
          onChangeText={model => patch({ model })}
          placeholder={isCloud ? 'gpt-4o-mini' : 'llama3.1:8b'}
          testID="ai-provider-model"
          value={value.model}
        />
      </View>

      {/*
       * Azure surfaces both Azure OpenAI Service (deployment-name
       * routing in the URL) and the Azure AI Foundry / Inference API
       * (model-in-body multi-vendor surface). The flavor switch + the
       * deployment / api-version inputs live behind a provider===azure
       * guard so the existing OpenAI/Anthropic flows are unchanged.
       */}
      {isCloud && value.provider === 'azure' && (
        <View style={styles.grid}>
          <SelectField
            label={t('ai.settings.provider.azureFlavor', 'Azure surface')}
            onChange={flavor => patch({ flavor })}
            options={[
              {
                value: 'openai',
                label: 'Azure OpenAI Service (gpt-4o, gpt-4-turbo, …)',
              },
              {
                value: 'foundry',
                label: 'Azure AI Foundry / Inference (multi-vendor)',
              },
            ]}
            testID="ai-provider-azure-flavor"
            value={value.flavor || 'openai'}
          />

          <InputField
            hint={t(
              'ai.settings.provider.azureApiVersionHint',
              'Leave blank to use the adapter default.',
            )}
            label={t('ai.settings.provider.azureApiVersion', 'API version')}
            onChangeText={api_version => patch({ api_version })}
            placeholder="2024-10-21"
            testID="ai-provider-azure-api-version"
            value={value.api_version}
          />

          {value.flavor !== 'foundry' && (
            <>
              <InputField
                hint={t(
                  'ai.settings.provider.azureDeploymentHint',
                  'Leave blank to reuse the Model field.',
                )}
                label={t(
                  'ai.settings.provider.azureDeployment',
                  'Chat deployment name',
                )}
                onChangeText={deployment => patch({ deployment })}
                placeholder={value.model || 'gpt-4o-mini'}
                testID="ai-provider-azure-deployment"
                value={value.deployment}
              />

              <InputField
                label={t(
                  'ai.settings.provider.azureEmbeddingDeployment',
                  'Embedding deployment name (optional)',
                )}
                onChangeText={embedding_deployment =>
                  patch({ embedding_deployment })
                }
                placeholder={value.embedding_model || 'text-embedding-3-small'}
                testID="ai-provider-azure-embedding-deployment"
                value={value.embedding_deployment}
              />
            </>
          )}
        </View>
      )}

      {!isCloud && (
        <View style={styles.localGroup}>
          <InputField
            hint={t(
              'ai.settings.provider.baseUrlHint',
              'Must resolve to a private network address (loopback, RFC1918, link-local, or ULA).',
            )}
            label={t('ai.settings.provider.baseUrl', 'Base URL')}
            onChangeText={base_url => patch({ base_url })}
            placeholder="http://localhost:11434"
            testID="ai-provider-base-url"
            value={value.base_url}
          />
          <View style={styles.row}>
            <GhostButton
              disabled={
                validate.isPending || value.base_url.trim().length === 0
              }
              label={
                validate.isPending
                  ? t('ai.settings.validate.running', 'Validating…')
                  : t('ai.settings.validate.button', 'Validate')
              }
              onPress={runValidate}
              testID="ai-provider-validate"
            />
            <ValidateBanner banner={validateBanner} />
          </View>
        </View>
      )}

      {isCloud && value.provider === 'azure' && (
        <InputField
          hint={t(
            'ai.settings.provider.azureBaseUrlHint',
            'The Azure OpenAI resource endpoint or Azure AI Foundry endpoint.',
          )}
          label={t(
            'ai.settings.provider.azureBaseUrl',
            'Resource endpoint URL',
          )}
          onChangeText={base_url => patch({ base_url })}
          placeholder="https://my-resource.openai.azure.com"
          testID="ai-provider-azure-base-url"
          value={value.base_url}
        />
      )}

      {isCloud && (
        <>
          <InputField
            // `secureTextEntry` masks typed values. The parent never
            // pre-populates this field when the server redacts the key. Empty
            // input on save means "do not change the stored key".
            hint={t(
              'ai.settings.provider.apiKeyHint',
              'Stored encrypted. Never displayed once saved.',
            )}
            label={t('ai.settings.provider.apiKey', 'API key')}
            onChangeText={api_key => patch({ api_key })}
            placeholder={t(
              'ai.settings.provider.apiKeyPlaceholder',
              'sk-…  (leave blank to keep current)',
            )}
            secureTextEntry
            testID="ai-provider-api-key"
            value={value.api_key}
          />

          <InputField
            hint={t(
              'ai.settings.provider.costCapHint',
              'Daily cap on cloud spending. 0 disables the cap.',
            )}
            keyboardType="decimal-pad"
            label={t('ai.settings.provider.costCap', 'Daily cost cap (USD)')}
            onChangeText={textValue => {
              const dollars = Number.parseFloat(textValue);
              const cents = Number.isFinite(dollars)
                ? Math.max(0, Math.round(dollars * 100))
                : 0;
              patch({ cost_cap_cents: cents });
            }}
            placeholder="5.00"
            testID="ai-provider-cost-cap"
            value={
              value.cost_cap_cents > 0
                ? (value.cost_cap_cents / 100).toFixed(2)
                : ''
            }
          />

          {/*
           * Cloud Validate. Sends a 1-token chat probe to the
           * configured upstream so the user can confirm api_key +
           * URL + flavor + deployment all line up before saving.
           * Empty api_key is allowed — the backend falls back to
           * the previously-saved (encrypted) key, which keeps the
           * UX reasonable when the user is editing a non-secret
           * field. The button stays enabled even with an empty
           * api_key field for that reason; the backend returns a
           * precise `missing_api_key` code when neither side has
           * one.
           */}
          <View style={styles.row}>
            <GhostButton
              disabled={validate.isPending}
              label={
                validate.isPending
                  ? t('ai.settings.validate.running', 'Validating…')
                  : t(
                      'ai.settings.validate.cloudButton',
                      'Validate connection',
                    )
              }
              onPress={runValidate}
              testID="ai-provider-validate-cloud"
            />
            <ValidateBanner banner={validateBanner} />
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

export default AIProviderSection;

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.lg,
  },
  subhead: {
    fontSize: typography.body,
    fontWeight: '600',
  },
  caption: {
    color: colors.textMuted,
  },
  helperText: {
    color: colors.textMuted,
  },
  grid: {
    gap: spacing.md,
  },
  localGroup: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    marginBottom: spacing.xs / 2,
  },
  fieldHint: {
    marginTop: spacing.xs / 2,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  optionList: {
    gap: spacing.xs,
  },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    opacity: 0.82,
  },
  optionText: {
    fontSize: typography.caption,
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonDisabled: {
    opacity: 0.48,
  },
  ghostButtonPressed: {
    opacity: 0.82,
  },
  ghostButtonLabel: {
    fontSize: typography.caption,
  },
  banner: {
    fontSize: typography.caption,
  },
  bannerOk: {
    color: colors.success,
  },
  bannerFail: {
    color: colors.danger,
  },
});
