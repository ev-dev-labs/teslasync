import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Database, GitBranch, Radio, Shield, Cpu, Play,
} from 'lucide-react'
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
    mutationFn: () => apiFetch('mqtt-test', 'POST', { topic, message }),
  })

  return (
    <ToolCard
      icon={Radio}
      color="amber"
      title={t('devtools.infra.mqtt', 'Mqtt')}
      description={t('devtools.infra.mqttDesc', 'Publish a test message to the MQTT broker')}
    >
      <div className="space-y-3">
        <Input
          label={t('devtools.infra.topic', 'Topic')}
          placeholder="test/topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          icon={<Radio className="h-4 w-4" aria-hidden="true" />}
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
          icon={<Play className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {t('devtools.infra.sendTest', 'Send Test')}
        </Button>
        {mutation.data && (
          <ResultPanel
            title={t('devtools.infra.mqtt', 'Mqtt')}
            data={mutation.data.error ? undefined : mutation.data}
            error={typeof mutation.data.error === 'string' ? mutation.data.error : undefined}
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
        icon={Database}
        color="cyan"
        title={t('devtools.infra.dbStats', 'Db Stats')}
        description={t('devtools.infra.dbStatsDesc', 'Inspect TimescaleDB table sizes and row counts')}
        endpoint="db-stats"
      />
      <BackendTool
        icon={GitBranch}
        color="green"
        title={t('devtools.infra.migrations', 'Migrations')}
        description={t('devtools.infra.migrationsDesc', 'View applied and pending database migrations')}
        endpoint="migration-status"
      />
      <MqttTestTool />
      <BackendTool
        icon={Shield}
        color="purple"
        title={t('devtools.infra.envCheck', 'Env Check')}
        description={t('devtools.infra.envCheckDesc', 'Verify required environment variables are configured')}
        endpoint="env-check"
      />
      <BackendTool
        icon={Cpu}
        color="amber"
        title={t('devtools.infra.runtime', 'Runtime')}
        description={t('devtools.infra.runtimeDesc', 'Inspect Go runtime, memory, and goroutine stats')}
        endpoint="runtime-info"
      />
    </div>
  )
}
