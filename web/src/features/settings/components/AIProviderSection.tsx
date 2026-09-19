/**
 * AI provider configuration. Visible only when AI mode is not off.
 *
 * Validate calls `/settings/ai/validate-config`, outside `/ai/*`, so users can
 * verify local provider URLs before saving. Local validation pins private or
 * loopback addresses and rejects public egress targets.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Input,
  Select,
  HelperText,
  SectionTitle,
  Caption,
  Button,
  GlassPanel,
  Text,
} from '@/components/ui'
import { Stack } from '@/components/layout'
import {
  useValidateAiProvider,
  type ValidateAiProviderRequest,
} from '@/api/hooks/useAiSettings'

/**
 * Local in-memory shape for the form. Mirrors the server's
 * `ai_provider_config` plus the cap (which is a sibling key) so
 * the parent can pass a single setter.
 */
export interface AIProviderDraft {
  provider: string
  base_url: string
  model: string
  /** Live in memory only. Empty string means "no change on save". */
  api_key: string
  /** Daily cap in cents. 0 means unset. */
  cost_cap_cents: number
  /** Foundry v1 chat protocol. No deployment-name heuristics. */
  api_protocol: string
  /**
   * Embedding model identifier. Used by the F7 RAG worker; not
   * always exposed in the UI but persisted so a previous setting
   * survives a save round-trip.
   */
  embedding_model: string
}

interface Props {
  value: AIProviderDraft
  isCloud: boolean
  onChange: (next: AIProviderDraft) => void
}

export function AIProviderSection({ value, isCloud, onChange }: Props) {
  const { t } = useTranslation('settings')
  const validate = useValidateAiProvider()

  // Track the latest validation banner. Cleared on input change so
  // the user never sees stale feedback after editing the URL.
  const [validateBanner, setValidateBanner] = useState<
    { kind: 'ok' | 'fail'; message: string } | null
  >(null)

  function patch(next: Partial<AIProviderDraft>) {
    onChange({ ...value, ...next })
    setValidateBanner(null)
  }

  async function runValidate() {
    setValidateBanner(null)
    // Build the request payload. For local mode only mode + base_url
    // matter (the validator is provider-agnostic). For cloud mode we
    // send the full configuration so the backend can build a real
    // adapter and run a bounded chat probe — omitted fields fall back
    // to the saved per-provider entry server-side, so editing one
    // field doesn't force the user to re-state the rest.
    const req: ValidateAiProviderRequest = isCloud
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
          api_protocol: value.api_protocol,
          embedding_model: value.embedding_model,
        }
      : {
          mode: 'local',
          provider: value.provider,
          base_url: value.base_url,
        }
    try {
      const result = await validate.mutateAsync(req)
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
            : t('ai.settings.validate.success', 'OK — provider reachable')
        setValidateBanner({ kind: 'ok', message: okMessage })
        return
      }
      setValidateBanner({ kind: 'fail', message: result.message })
    } catch {
      // The hook re-shapes only the backend's 422 rejection into the
      // failure variant. A malformed request (400), a 5xx from the
      // probe, or the network being unreachable rejects out of
      // mutateAsync instead. Without this catch that rejection is
      // swallowed as an unhandled promise and the user gets no
      // feedback — the button just silently re-enables. Surface a
      // generic, non-technical banner so validation always resolves
      // to a visible outcome.
      setValidateBanner({
        kind: 'fail',
        message: t(
          'ai.settings.validate.networkError',
          'Validation failed — could not reach the server. Check your connection and try again.',
        ),
      })
    }
  }

  return (
    <GlassPanel
      className="space-y-4 p-4 sm:p-5"
      aria-label={t('ai.settings.provider.label', 'Provider configuration')}
      data-testid="ai-provider-section"
    >
      <SectionTitle>
        {t('ai.settings.provider.label', 'Provider configuration')}
      </SectionTitle>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Select
          label={t('ai.settings.provider.providerLabel', 'Provider')}
          value={value.provider}
          onChange={(e) => patch({ provider: e.target.value })}
          data-testid="ai-provider-select"
          options={
            isCloud
              ? [
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'anthropic', label: 'Anthropic' },
                  { value: 'azure', label: 'Microsoft Foundry' },
                  { value: 'google', label: 'Google' },
                ]
              : [
                  { value: 'ollama', label: 'Ollama' },
                  { value: 'lmstudio', label: 'LM Studio' },
                  { value: 'llama-cpp', label: 'llama.cpp' },
                ]
          }
        />

        <Input
          label={
            value.provider === 'azure'
              ? t(
                  'ai.settings.provider.azureModelLabel',
                  'Deployment name',
                )
              : t('ai.settings.provider.model', 'Model')
          }
          placeholder={
            value.provider === 'azure'
              ? 'your-deployment-name'
              : isCloud
                ? 'gpt-4o-mini'
                : 'llama3.1:8b'
          }
          value={value.model}
          onChange={(e) => patch({ model: e.target.value })}
          data-testid="ai-provider-model"
          hint={
            value.provider === 'azure'
              ? t(
                  'ai.settings.provider.azureModelHint',
                  'Use the exact deployment name from your Foundry portal, not the underlying model family.',
                )
              : undefined
          }
        />
      </div>

      {isCloud && value.provider === 'azure' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label={t('ai.settings.provider.azureProtocol', 'API protocol')}
            value={value.api_protocol || 'auto'}
            onChange={(e) => patch({ api_protocol: e.target.value })}
            data-testid="ai-provider-azure-protocol"
            options={[
              {
                value: 'auto',
                label: t('ai.settings.provider.azureProtocolAuto', 'Auto (Chat Completions first)'),
              },
              {
                value: 'chat_completions',
                label: t('ai.settings.provider.azureProtocolChat', 'Chat Completions'),
              },
              {
                value: 'responses',
                label: t('ai.settings.provider.azureProtocolResponses', 'Responses'),
              },
            ]}
          />
          <Input
            label={t('ai.settings.provider.azureEmbeddingModel', 'Embedding deployment name (optional)')}
            value={value.embedding_model}
            onChange={(e) => patch({ embedding_model: e.target.value })}
            data-testid="ai-provider-azure-embedding-model"
          />
          <HelperText className="sm:col-span-2">
            {t('ai.settings.provider.azureProtocolHint', 'Auto tries Responses only when Chat Completions is unavailable. Explicit protocols never fall back. Responses output is buffered until completion; embeddings always use v1.')}
          </HelperText>
        </div>
      )}

      {!isCloud && (
        <div className="space-y-1">
          <Input
            label={t('ai.settings.provider.baseUrl', 'Base URL')}
            placeholder="http://localhost:11434"
            value={value.base_url}
            onChange={(e) => patch({ base_url: e.target.value })}
            data-testid="ai-provider-base-url"
            hint={t(
              'ai.settings.provider.baseUrlHint',
              'Must resolve to a private network address (loopback, RFC1918, link-local, or ULA).',
            )}
          />
          <Stack gap={2} direction="row">
            <Button
              type="button"
              variant="ghost"
              onClick={runValidate}
              disabled={
                validate.isPending || value.base_url.trim().length === 0
              }
              data-testid="ai-provider-validate"
            >
              {validate.isPending
                ? t('ai.settings.validate.running', 'Validating…')
                : t('ai.settings.validate.button', 'Validate')}
            </Button>
            {validateBanner && <ValidateBanner banner={validateBanner} />}
          </Stack>
        </div>
      )}

      {isCloud && value.provider === 'azure' && (
        <Input
          label={t(
            'ai.settings.provider.azureBaseUrl',
            'Resource endpoint URL',
          )}
          placeholder="https://my-resource.services.ai.azure.com/openai/v1"
          value={value.base_url}
          onChange={(e) => patch({ base_url: e.target.value })}
          data-testid="ai-provider-azure-base-url"
          hint={t(
            'ai.settings.provider.azureBaseUrlHint',
            'Foundry OpenAI v1 only: https://{resource}.services.ai.azure.com/openai/v1. Resource roots also work; other API paths are rejected.',
          )}
        />
      )}

      {isCloud && (
        <>
          <Input
            // `type="password"` masks typed values. The parent never
            // pre-populates this field when the server redacts the key. Empty input on save
            // means "do not change the stored key".
            type="password"
            autoComplete="new-password"
            label={t('ai.settings.provider.apiKey', 'API key')}
            placeholder={t(
              'ai.settings.provider.apiKeyPlaceholder',
              'sk-…  (leave blank to keep current)',
            )}
            value={value.api_key}
            onChange={(e) => patch({ api_key: e.target.value })}
            data-testid="ai-provider-api-key"
            hint={t(
              'ai.settings.provider.apiKeyHint',
              'Stored encrypted. Never displayed once saved.',
            )}
          />

          <Input
            type="number"
            min={0}
            step={1}
            label={t('ai.settings.provider.costCap', 'Daily cost cap (USD)')}
            value={
              value.cost_cap_cents > 0
                ? (value.cost_cap_cents / 100).toFixed(2)
                : ''
            }
            onChange={(e) => {
              const dollars = Number.parseFloat(e.target.value)
              const cents = Number.isFinite(dollars)
                ? Math.max(0, Math.round(dollars * 100))
                : 0
              patch({ cost_cap_cents: cents })
            }}
            placeholder="5.00"
            data-testid="ai-provider-cost-cap"
            hint={t(
              'ai.settings.provider.costCapHint',
              'Daily cap on cloud spending. 0 disables the cap.',
            )}
          />

          {/*
           * Cloud Validate. Sends a bounded chat probe to the
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
          <Stack gap={2} direction="row">
            <Button
              type="button"
              variant="ghost"
              onClick={runValidate}
              disabled={validate.isPending}
              data-testid="ai-provider-validate-cloud"
            >
              {validate.isPending
                ? t('ai.settings.validate.running', 'Validating…')
                : t(
                    'ai.settings.validate.cloudButton',
                    'Validate connection',
                  )}
            </Button>
            {validateBanner && <ValidateBanner banner={validateBanner} />}
          </Stack>
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
    </GlassPanel>
  )
}

/**
 * Inline validate result. Colour + message are paired — the text itself
 * ("OK — …" / an error string) carries the meaning independent of hue.
 */
function ValidateBanner({
  banner,
}: {
  banner: { kind: 'ok' | 'fail'; message: string }
}) {
  return (
    <Text
      as="span"
      size="xs"
      weight="medium"
      role="status"
      className={banner.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}
      data-testid="ai-provider-validate-banner"
      data-validate-kind={banner.kind}
    >
      {banner.message}
    </Text>
  )
}
