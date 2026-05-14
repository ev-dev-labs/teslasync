/**
 * Phase-50 / 0003 — F2 Settings UI for AI.
 *
 * Provider configuration sub-section. Visible only when the parent
 * AISettings panel has a non-off mode selected. Collects provider
 * identifier, base URL (for local), API key (for cloud), model
 * name, and the daily cost cap (cloud-only).
 *
 * The "Validate" button hits the new `/settings/ai/validate-config`
 * endpoint which lives outside `/api/v1/ai/*` by design — see
 * ADR-015 §I7 commentary in the validate handler. The validate
 * call is OPTIONAL: the user can still save without validating,
 * but the local-mode validator is the only way to confirm that a
 * user-entered base URL resolves to an RFC1918 / loopback / link-
 * local / ULA address (the local validator pins the IP and
 * refuses public addresses to prevent silent egress).
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Input,
  Select,
  HelperText,
  Subhead,
  Caption,
  Button,
} from '@/components/ui'
import { Stack } from '@/components/layout'
import { useValidateAiProvider } from '@/api/hooks/useAiSettings'

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
    const result = await validate.mutateAsync({
      mode: isCloud ? 'cloud' : 'local',
      provider: value.provider,
      base_url: value.base_url,
    })
    if (result.ok) {
      setValidateBanner({
        kind: 'ok',
        message: result.pinned_ip
          ? t(
              'ai.settings.validate.successPinned',
              'OK — pinned to {{ip}}',
              { ip: result.pinned_ip },
            )
          : t('ai.settings.validate.success', 'OK — provider reachable'),
      })
      return
    }
    setValidateBanner({ kind: 'fail', message: result.message })
  }

  return (
    <section
      className="space-y-3 rounded-md border border-[var(--border-subtle)] p-4"
      aria-label={t('ai.settings.provider.label', 'Provider configuration')}
      data-testid="ai-provider-section"
    >
      <Subhead>
        {t('ai.settings.provider.label', 'Provider configuration')}
      </Subhead>

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
          label={t('ai.settings.provider.model', 'Model')}
          placeholder={isCloud ? 'gpt-4o-mini' : 'llama3.1:8b'}
          value={value.model}
          onChange={(e) => patch({ model: e.target.value })}
          data-testid="ai-provider-model"
        />
      </div>

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
            {validateBanner && (
              <span
                role="status"
                className={
                  validateBanner.kind === 'ok'
                    ? 'text-xs text-emerald-300'
                    : 'text-xs text-rose-300'
                }
                data-testid="ai-provider-validate-banner"
                data-validate-kind={validateBanner.kind}
              >
                {validateBanner.message}
              </span>
            )}
          </Stack>
        </div>
      )}

      {isCloud && (
        <>
          <Input
            // ADR-015 §I9 — `type="password"` masks any value the
            // user types. The parent NEVER pre-populates this field
            // when the server's mode is off (which is also when the
            // server itself redacts the key). Empty input on save
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
    </section>
  )
}
