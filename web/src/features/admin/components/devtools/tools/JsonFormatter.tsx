import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Braces } from 'lucide-react'
import { Textarea } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '../CopyButton'

export function JsonFormatterTool() {
  const { t } = useTranslation()
  const [inputVal, setInputVal] = useState('')
  const result = useMemo(() => {
    if (!inputVal.trim()) return { formatted: '', error: '' }
    try {
      const parsed = JSON.parse(inputVal) as unknown
      return { formatted: JSON.stringify(parsed, null, 2), error: '' }
    } catch (e) {
      return { formatted: '', error: e instanceof Error ? e.message : t('Invalid Json') }
    }
  }, [inputVal, t])

  return (
    <ToolCard icon={Braces} color="green" title={t('Json Formatter')} description={t('Json Formatter Desc')}>
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Json Input')}</span>
          <Textarea rows={4} value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder='{"key":"value"}' />
        </div>
        {result.error && <p className="text-sm text-neon-red">{result.error}</p>}
        {result.formatted && (
          <div className="rounded bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">{t('Formatted')}</span>
              <CopyButton text={result.formatted} />
            </div>
            <pre className="mt-1 max-h-64 overflow-auto text-xs font-mono text-neon-green">{result.formatted}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  )
}
