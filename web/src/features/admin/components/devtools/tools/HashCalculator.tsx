import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Hash } from 'lucide-react'
import { Button, Textarea } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '../CopyButton'

export function HashCalculatorTool() {
  const { t } = useTranslation()
  const [inputVal, setInputVal] = useState('')
  const [hashResult, setHashResult] = useState('')
  const [computing, setComputing] = useState(false)

  const compute = useCallback(async () => {
    if (!inputVal) return
    setComputing(true)
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(inputVal)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      setHashResult(hex)
    } catch {
      setHashResult(t('Hash Error'))
    }
    setComputing(false)
  }, [inputVal, t])

  return (
    <ToolCard icon={Hash} color="red" title={t('Hash Calculator')} description={t('Hash Calculator Desc')}>
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Hash Input')}</span>
          <Textarea rows={2} value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder={t('Hash Placeholder')} />
        </div>
        <Button variant="primary" size="sm" loading={computing} onClick={() => void compute()} icon={<Hash className="h-3.5 w-3.5" />}>
          {t('devtools.utils.computeSha256', 'Compute Sha256')}
        </Button>
        {hashResult && (
          <div className="flex items-center gap-2 rounded bg-black/20 px-3 py-2">
            <code className="flex-1 break-all text-xs font-mono text-rose-300">{hashResult}</code>
            <CopyButton text={hashResult} />
          </div>
        )}
      </div>
    </ToolCard>
  )
}
