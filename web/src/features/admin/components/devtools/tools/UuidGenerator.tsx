import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Fingerprint, RefreshCw } from 'lucide-react'
import { Button, CopyButton } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { safeRandomUUID } from '@/lib/safeUUID'

/* Keep only the most recent ids so the panel can't grow without bound. */
const MAX_HISTORY = 10

export function UuidGeneratorTool() {
  const { t } = useTranslation()
  const [uuids, setUuids] = useState<string[]>([])

  const generate = useCallback(() => {
    /* safeRandomUUID covers non-secure-context deployments (LAN IP /
     * custom HTTP hostname) where crypto.randomUUID is undefined. */
    const uuid = safeRandomUUID()
    setUuids((prev) => [uuid, ...prev].slice(0, MAX_HISTORY))
  }, [])

  return (
    <ToolCard icon={Fingerprint} color="purple" title={t('Uuid Generator')} description={t('Uuid Generator Desc')}>
      <div className="space-y-3">
        <Button variant="primary" size="sm" onClick={generate} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          {t('Generate')}
        </Button>
        {uuids.length > 0 ? (
          <div role="list" aria-label={t('Generated UUIDs')} className="space-y-1">
            {uuids.map((u) => (
              <div
                key={u}
                role="listitem"
                className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1.5"
              >
                <code className="flex-1 text-xs font-mono text-purple-300">{u}</code>
                <CopyButton text={u} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-secondary)]">{t('Click Generate to create a UUID')}</p>
        )}
      </div>
    </ToolCard>
  )
}
