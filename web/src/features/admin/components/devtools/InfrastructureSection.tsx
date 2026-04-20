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
    <ToolCard icon={Radio} color="amber" title={t('Mqtt')} description={t('Mqtt Desc')}>
      <div className="space-y-3">
        <Input
          label={t('Topic')}
          placeholder="test/topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          icon={<Radio className="h-4 w-4" />}
        />
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Message')}</span>
          <Textarea
            rows={3}
            placeholder='{"key": "value"}'
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <Button variant="primary" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()} icon={<Play className="h-3.5 w-3.5" />}>
          {t('Send Test')}
        </Button>
        {mutation.data && (
          <ResultPanel
            title={t('Mqtt')}
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
    <div className="grid gap-4 lg:grid-cols-2">
      <BackendTool icon={Database} color="cyan" title={t('Db Stats')} description={t('Db Stats Desc')} endpoint="db-stats" />
      <BackendTool icon={GitBranch} color="green" title={t('Migrations')} description={t('Migrations Desc')} endpoint="migration-status" />
      <MqttTestTool />
      <BackendTool icon={Shield} color="purple" title={t('Env Check')} description={t('Env Check Desc')} endpoint="env-check" />
      <BackendTool icon={Cpu} color="amber" title={t('Runtime')} description={t('Runtime Desc')} endpoint="runtime-info" />
    </div>
  )
}
