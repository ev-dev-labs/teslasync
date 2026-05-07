import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Fingerprint, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '@/components/ui'
import { safeRandomUUID } from '@/lib/safeUUID'

export function UuidGeneratorTool() {
  const { t } = useTranslation()
  const [uuids, setUuids] = useState<string[]>([])

  const generate = useCallback(() => {
    /* safeRandomUUID covers non-secure-context deployments (LAN IP /
     * custom HTTP hostname) where crypto.randomUUID is undefined. */
    const uuid = safeRandomUUID()
    setUuids((prev) => [uuid, ...prev].slice(0, 10))
  }, [])

  return (
    <ToolCard icon={Fingerprint} color="purple" title={t('Uuid Generator')} description={t('Uuid Generator Desc')}>
      <div className="space-y-3">
        <Button variant="primary" size="sm" onClick={generate} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          {t('Generate')}
        </Button>
        {uuids.length > 0 && (
          <div className="space-y-1">
            {uuids.map((u, i) => (
              <div key={`${u}-${i}`} className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1.5">
                <code className="flex-1 text-xs font-mono text-purple-300">{u}</code>
                <CopyButton text={u} />
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}
