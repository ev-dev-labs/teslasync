import { Icons } from '@/lib/icons';
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, Button, Textarea } from '@/components/ui'
import { useMutation } from '@tanstack/react-query'
import { ToolCard } from './ToolCard'
import { ResultPanel } from './ResultPanel'
import { BackendTool } from './BackendTool'
import { apiFetch } from './helpers'

/* ─── MQTT Test Tool ──────────────────────────────────────────────────── */

function MqttTestTool() {
  const { t } = useTranslation()
  const [topic, setTopic] = useState('')
  const [message, setMessage] = useState('')

  const mutation = useMutation({
    networkMode: 'always',
    mutationFn: () => apiFetch('mqtt-test', 'POST', { topic, message }),
  })
  const rawError: unknown = mutation.error ?? mutation.data?.error
  const hasError = mutation.isError || Boolean(rawError)
  const errorText = rawError instanceof Error && rawError.message.trim() !== ''
    ? rawError.message
    : typeof rawError === 'string' && rawError.trim() !== ''
      ? rawError
      : hasError
        ? t('devtools.backendTool.requestFailed', 'Request failed')
        : undefined

  return (
    <ToolCard
      icon={Icons.radio}
      color="amber"
      title={t('devtools.infra.mqtt', 'MQTT')}
      description={t('devtools.infra.mqttPingDesc', 'Run the fixed MQTT connectivity ping. The server publishes to teslasync/dev-tools/ping with a generated timestamp/source payload; topic and message inputs are ignored.')}
    >
      <div className="space-y-3">
        <Input
          label={t('devtools.infra.topic', 'Topic')}
          placeholder="test/topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          icon={<Icons.radio className="h-4 w-4" aria-hidden="true" />}
        />
        <Textarea
          label={t('devtools.infra.message', 'Message')}
          rows={3}
          placeholder='{"key": "value"}'
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <Button
          variant="primary"
          size="sm"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          icon={<Icons.play className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {t('devtools.infra.sendTest', 'Send test')}
        </Button>
        {(mutation.data || hasError) && (
          <ResultPanel
            title={t('devtools.infra.mqtt', 'MQTT')}
            data={hasError ? undefined : mutation.data}
            error={errorText}
          />
        )}
      </div>
    </ToolCard>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   Infrastructure Section
   ═══════════════════════════════════════════════════════════════════════ */

export function InfrastructureSection() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <BackendTool
        icon={Icons.database}
        color="cyan"
        title={t('devtools.infra.dbStats', 'DB stats')}
        description={t('devtools.infra.dbStatsDesc', 'Inspect TimescaleDB table sizes and row counts')}
        endpoint="db-stats"
      />
      <BackendTool
        icon={Icons.gitBranch}
        color="green"
        title={t('devtools.infra.migrations', 'Migrations')}
        description={t('devtools.infra.migrationsDesc', 'View applied and pending database migrations')}
        endpoint="migration-status"
      />
      <MqttTestTool />
      <BackendTool
        icon={Icons.security}
        color="purple"
        title={t('devtools.infra.envCheck', 'Env check')}
        description={t('devtools.infra.envCheckDesc', 'Verify required environment variables are configured')}
        endpoint="env-check"
      />
      <BackendTool
        icon={Icons.cpu}
        color="amber"
        title={t('devtools.infra.runtime', 'Runtime')}
        description={t('devtools.infra.runtimeDesc', 'Inspect Go runtime, memory, and goroutine stats')}
        endpoint="runtime-info"
      />
    </div>
  )
}
