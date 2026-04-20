import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Braces } from 'lucide-react'
import { Button, Textarea } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '../CopyButton'

export function Base64Tool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [inputVal, setInputVal] = useState('')
  const output = useMemo(() => {
    if (!inputVal) return ''
    try {
      return mode === 'encode' ? btoa(inputVal) : atob(inputVal)
    } catch {
      return t('Invalid Input')
    }
  }, [inputVal, mode, t])

  return (
    <ToolCard icon={Braces} color="amber" title={t('devtools.utils.base64', 'Base64')} description={t('devtools.utils.base64Desc', 'Base64Desc')}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant={mode === 'encode' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('encode')}>{t('Encode')}</Button>
          <Button variant={mode === 'decode' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('decode')}>{t('Decode')}</Button>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Input Label')}</span>
          <Textarea rows={3} value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder={mode === 'encode' ? 'Hello World' : 'SGVsbG8gV29ybGQ='} />
        </div>
        {output && (
          <div className="rounded bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">{t('Output Label')}</span>
              <CopyButton text={output} />
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all text-sm font-mono text-neon-cyan">{output}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  )
}
